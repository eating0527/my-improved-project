import logging
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional, Dict
import json
from pathlib import Path
import uuid
import time

from app.api.v1.router import api_router
from app.core.config import OUTPUT_DIR
from app.domains.satellite.services.cqrs_satellite_service import CQRSSatelliteService
from app.db.database import database
from app.domains.satellite.services.orbit_service import OrbitService

logger = logging.getLogger(__name__)

# ✅ 在這裡定義 lifespan（放在 FastAPI app 之前）
@asynccontextmanager
async def lifespan(app: FastAPI):
    """應用生命週期管理 - CQRS 版本"""

    # 啟動應用
    logger.info("🚀 SimWorld Backend 啟動中...")

    # 初始化資料庫
    await database.connect()
    logger.info("✅ 資料庫連線建立")

    # 初始化現有服務
    orbit_service = OrbitService()

    # 初始化新的 CQRS 衛星服務
    cqrs_satellite_service = CQRSSatelliteService(orbit_service)
    await cqrs_satellite_service.start()
    logger.info("✅ CQRS 衛星服務已啟動")

    # 將服務存儲到 app state
    app.state.orbit_service = orbit_service
    app.state.cqrs_satellite_service = cqrs_satellite_service

    logger.info("✅ SimWorld Backend 啟動完成")

    yield

    # 應用關閉
    logger.info("🛑 SimWorld Backend 關閉中...")

    # 停止 CQRS 衛星服務
    if hasattr(app.state, "cqrs_satellite_service"):
        await app.state.cqrs_satellite_service.stop()
        logger.info("✅ CQRS 衛星服務已停止")

    # 關閉資料庫連線
    await database.disconnect()
    logger.info("✅ 資料庫連線已關閉")

# Create FastAPI app instance using the lifespan manager
app = FastAPI(
    title="Sionna RT Simulation API",
    description="API for running Sionna RT simulations and managing devices.",
    version="0.1.0",
    lifespan=lifespan,
)

# --- Static Files Mount ---
os.makedirs(OUTPUT_DIR, exist_ok=True)
logger.info(f"Static files directory set to: {OUTPUT_DIR}")

app.mount("/rendered_images", StaticFiles(directory=OUTPUT_DIR), name="rendered_images")
logger.info(f"Mounted static files directory '{OUTPUT_DIR}' at '/rendered_images'.")

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
logger.info(f"Mounted static directory '{STATIC_DIR}' at '/static'.")

# 📷 設定照片上傳資料夾
UPLOAD_DIR = Path(__file__).parent / "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
logger.info(f"Upload directory set to: {UPLOAD_DIR}")

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
logger.info(f"Mounted uploads directory '{UPLOAD_DIR}' at '/uploads'.")

# ✅ 新增：照片和 USRP 資料的 JSON 檔案路徑
PHOTOS_JSON_PATH = UPLOAD_DIR / "photos.json"
USRP_DATA_PATH = UPLOAD_DIR / "usrp_data.json"

# --- CORS Middleware ---
origins = [
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://frontend.simworld.website",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info(f"CORS middleware added with origins: {origins}")

# ✅ 修改：GPS WebSocket 連接管理器（支援多裝置 + 裝置名稱）
class GPSConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.device_gps_data: Dict[str, dict] = {}
        self.device_names: Dict[str, str] = {}  # ✅ 新增：儲存裝置名稱

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        logger.info(f"📡 GPS WebSocket 新客戶端連接，當前連接數: {len(self.active_connections) + 1}")

    def register_device(self, device_id: str, websocket: WebSocket, device_name: str = "Unknown Device"):
        """註冊裝置（連結 WebSocket 和 deviceId）"""
        self.active_connections[device_id] = websocket
        self.device_names[device_id] = device_name
        logger.info(f"✅ 裝置已註冊: {device_id[:12]} ({device_name})，當前連接數: {len(self.active_connections)}")

    def disconnect(self, device_id: str):
        if device_id in self.active_connections:
            del self.active_connections[device_id]
        if device_id in self.device_gps_data:
            del self.device_gps_data[device_id]
        if device_id in self.device_names:
            del self.device_names[device_id]
        logger.info(f"📡 GPS WebSocket 客戶端斷開 (設備 ID: {device_id[:12]})，當前連接數: {len(self.active_connections)}")

    async def broadcast_to_all(self, message: str):
        """廣播給所有客戶端（包含發送者）"""
        disconnected = []
        for device_id, connection in self.active_connections.items():
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"❌ 廣播失敗 (設備 ID: {device_id[:12]}): {e}")
                disconnected.append(device_id)
        
        for device_id in disconnected:
            self.disconnect(device_id)
    
    async def broadcast_to_others(self, message: str, exclude_device_id: str):
        """廣播給除了指定裝置外的所有客戶端（不包含發送者）"""
        disconnected = []
        for device_id, connection in self.active_connections.items():
            if device_id == exclude_device_id:
                logger.debug(f"⏭️ 跳過發送者 (設備 ID: {device_id[:12]})")
                continue
            
            try:
                await connection.send_text(message)
                logger.debug(f"📤 已廣播給 (設備 ID: {device_id[:12]})")
            except Exception as e:
                logger.error(f"❌ 廣播失敗 (設備 ID: {device_id[:12]}): {e}")
                disconnected.append(device_id)
        
        for device_id in disconnected:
            self.disconnect(device_id)
        
        logger.info(f"📡 已廣播給 {len(self.active_connections) - 1} 個其他裝置（排除發送者）")
    
    def update_gps(self, device_id: str, gps_data: dict):
        """更新裝置的 GPS 資料"""
        self.device_gps_data[device_id] = gps_data
        device_name = self.device_names.get(device_id, "Unknown")
        logger.debug(
            f"📍 更新設備 {device_id[:12]} ({device_name}) 的 GPS: "
            f"lat={gps_data.get('lat')}, lon={gps_data.get('lon')}"
        )

    def update_device_name(self, device_id: str, device_name: str):
        """更新裝置名稱"""
        self.device_names[device_id] = device_name
        logger.info(f"📝 更新設備 {device_id[:12]} 名稱為: {device_name}")

    async def broadcast_device_disconnected(self, device_id: str):
        """廣播裝置斷線事件給所有客戶端"""
        device_name = self.device_names.get(device_id, "Unknown Device")
        message = json.dumps({
            "type": "device-disconnected",
            "deviceId": device_id,
            "deviceName": device_name,
            "timestamp": datetime.now().isoformat()
        })
        logger.info(f"📤 準備廣播裝置斷線事件: {device_id[:12]} ({device_name})")
        
        await self.broadcast_to_all(message)
        
        logger.info(f"✅ 裝置斷線事件已廣播: {device_id[:12]}")

gps_manager = GPSConnectionManager()

@app.get("/ping", tags=["Test"])
async def ping():
    return {"message": "pong"}

# ✅ 修正：WebSocket 端點（完整版）
@app.websocket("/ws/gps")
async def websocket_gps_endpoint(websocket: WebSocket):
    await gps_manager.connect(websocket)
    
    device_id = None  # ✅ 等待客戶端註冊
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                
                # ✅ 處理裝置註冊
                if message.get("type") == "register-device":
                    device_id = message.get("deviceId")
                    device_name = message.get("deviceName", "Unknown Device")
                    device_type = message.get("deviceType", "mobile")
                    
                    if not device_id:
                        logger.error("❌ 收到無效的裝置註冊請求（缺少 deviceId）")
                        continue
                    
                    # ✅ 註冊裝置
                    gps_manager.register_device(device_id, websocket, device_name)
                    
                    logger.info(
                        f"✅ 裝置已註冊: {device_id[:12]} ({device_name}), "
                        f"類型: {device_type}, "
                        f"當前連接數: {len(gps_manager.active_connections)}"
                    )
                    
                    # ✅ 確認註冊
                    await websocket.send_text(json.dumps({
                        "type": "device-registered",
                        "deviceId": device_id,
                        "deviceName": device_name,
                        "timestamp": time.time()
                    }))
                    
                    continue
                
                # ✅ 處理名稱更新
                if message.get("type") == "update-device-name":
                    update_device_id = message.get("deviceId")
                    new_device_name = message.get("deviceName")
                    
                    if update_device_id and new_device_name:
                        gps_manager.update_device_name(update_device_id, new_device_name)
                        
                        logger.info(f"📝 更新裝置名稱: {update_device_id[:12]} -> {new_device_name}")
                        
                        # ✅ 廣播給所有人
                        await gps_manager.broadcast_to_all(json.dumps({
                            "type": "device-name-updated",
                            "deviceId": update_device_id,
                            "deviceName": new_device_name,
                            "timestamp": time.time()
                        }))
                    
                    continue
                
                # ✅ 檢查裝置是否已註冊
                if not device_id:
                    logger.warning("⚠️ 收到未註冊裝置的訊息，忽略")
                    continue
                
                # ✅ 處理清除軌跡指令（廣播給其他裝置）
                if message.get('type') == 'clear-path':
                    logger.info(f"🗑️ 收到清除軌跡指令 (設備 ID: {device_id[:12]})")
                    
                    clear_message = {
                        "type": "clear-path",
                        "deviceId": device_id,
                        "deviceName": gps_manager.device_names.get(device_id, "Unknown Device"),
                        "timestamp": time.time()
                    }
                    
                    await gps_manager.broadcast_to_others(json.dumps(clear_message), device_id)
                    logger.info(f"📤 已廣播清除軌跡指令給其他 {len(gps_manager.active_connections) - 1} 個裝置")
                    continue
                
                # ✅ 處理 GPS 資料（廣播給所有人，包含發送者）
                if message.get('lat') is not None and message.get('lon') is not None:
                    # ✅ 確保使用正確的 device_id（優先使用訊息中的，其次使用 WebSocket 的）
                    message_device_id = message.get('deviceId', device_id)
                    
                    # ✅ 從快取中獲取裝置名稱（如果沒有則使用訊息中的）
                    device_name = gps_manager.device_names.get(
                        message_device_id, 
                        message.get('deviceName', f'Device {message_device_id[:8]}')
                    )
                    
                    # ✅ 確保訊息中包含完整資訊
                    broadcast_message = {
                        "lat": message.get('lat'),
                        "lon": message.get('lon'),
                        "alt": message.get('alt', 0),
                        "accuracy": message.get('accuracy', 999),
                        "deviceId": message_device_id,
                        "deviceName": device_name,
                        "deviceType": message.get('deviceType', 'unknown'),
                        "timestamp": message.get('timestamp', time.time())
                    }
                    
                    logger.info(
                        f"📍 收到 GPS (設備 ID: {message_device_id[:12]}, "
                        f"名稱: {device_name}): "
                        f"lat={broadcast_message['lat']:.6f}, "
                        f"lon={broadcast_message['lon']:.6f}, "
                        f"alt={broadcast_message['alt']:.2f}, "
                        f"accuracy={broadcast_message['accuracy']:.2f}m"
                    )
                    
                    # ✅ 儲存 GPS 資料
                    gps_manager.update_gps(message_device_id, broadcast_message)
                    
                    # ✅ 廣播給所有人（包含發送者）
                    await gps_manager.broadcast_to_all(json.dumps(broadcast_message))
                    logger.info(f"📤 已廣播 GPS 給 {len(gps_manager.active_connections)} 個裝置（包含發送者）")
                    continue
                
                # ✅ 其他訊息類型：加上 deviceId 和 deviceName 後廣播
                if "deviceId" not in message:
                    message["deviceId"] = device_id
                if "deviceName" not in message:
                    message["deviceName"] = gps_manager.device_names.get(device_id, "Unknown Device")
                
                await gps_manager.broadcast_to_all(json.dumps(message))
                logger.debug(f"📤 已廣播其他訊息: {message.get('type', 'unknown')}")
                
            except json.JSONDecodeError as e:
                logger.error(f"❌ JSON 解析失敗 (設備 ID: {device_id[:12] if device_id else 'N/A'}): {e}")
            except Exception as e:
                logger.error(f"❌ 處理訊息時發生錯誤 (設備 ID: {device_id[:12] if device_id else 'N/A'}): {e}")
                import traceback
                logger.error(traceback.format_exc())
            
    except WebSocketDisconnect:
        if device_id:
            logger.info(f"📡 裝置準備斷線 (設備 ID: {device_id[:12]})")
            
            # ✅ 廣播斷線事件給所有其他客戶端
            await gps_manager.broadcast_device_disconnected(device_id)
            
            # ✅ 清理該裝置的連線和資料
            gps_manager.disconnect(device_id)
            
            logger.info(f"✅ GPS WebSocket 客戶端正常斷開連接 (設備 ID: {device_id[:12]})")
        else:
            logger.warning("⚠️ 未註冊的裝置斷線")
        
    except Exception as e:
        logger.error(f"❌ GPS WebSocket 錯誤 (設備 ID: {device_id[:12] if device_id else 'N/A'}): {e}")
        import traceback
        logger.error(traceback.format_exc())
        
        if device_id:
            # ✅ 發生錯誤時也要廣播斷線事件
            try:
                await gps_manager.broadcast_device_disconnected(device_id)
            except:
                logger.error(f"❌ 廣播斷線事件失敗")
            
            gps_manager.disconnect(device_id)

# ✅ 新增：取得所有已連線裝置的 API（包含裝置名稱）
@app.get("/api/gps/devices", tags=["GPS"])
async def get_gps_devices():
    """取得所有已連線的裝置 GPS 資料（包含裝置名稱）"""
    devices_with_names = {}
    
    for device_id, gps_data in gps_manager.device_gps_data.items():
        devices_with_names[device_id] = {
            **gps_data,
            "deviceName": gps_manager.device_names.get(device_id, "Unknown Device")
        }
    
    return {
        "devices": devices_with_names,
        "count": len(devices_with_names)
    }

@app.get("/api/gps/health", tags=["GPS"])
async def gps_health_check():
    return {
        "status": "ok",
        "websocket_connections": len(gps_manager.active_connections),
        "timestamp": datetime.now().isoformat()
    }

# ✅ 修改：照片上傳 API（使用實際時間戳記）
@app.post("/api/upload-photo", tags=["Photo Upload"])
async def upload_photo(
    photo: UploadFile = File(...),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    altitude: Optional[float] = Form(None)
):
    """接收照片並儲存到本地資料夾，並通過 WebSocket 廣播（包含 GPS 座標和實際時間）"""
    try:
        logger.info(f"📦 接收到上傳請求")
        logger.info(f"  照片: {photo.filename}")
        logger.info(f"  latitude: {latitude} (type: {type(latitude)})")
        logger.info(f"  longitude: {longitude} (type: {type(longitude)})")
        logger.info(f"  altitude: {altitude} (type: {type(altitude)})")
        
        MAX_FILE_SIZE = 10 * 1024 * 1024
        content = await photo.read()
        
        if len(content) > MAX_FILE_SIZE:
            return JSONResponse({
                "success": False,
                "error": "檔案大小超過 10MB"
            }, status_code=413)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{photo.filename}"
        file_path = UPLOAD_DIR / filename

        with open(file_path, "wb") as buffer:
            buffer.write(content)

        gps_lat = latitude
        gps_lon = longitude
        gps_alt = altitude

        logger.info(
            f"✅ 照片已上傳: {file_path}, "
            f"時間: {timestamp}, "
            f"GPS: lat={gps_lat}, lon={gps_lon}, alt={gps_alt}"
        )

        photo_data = {
            "filename": filename,
            "url": f"/uploads/{filename}",
            "timestamp": timestamp,
            "latitude": gps_lat,
            "longitude": gps_lon,
            "altitude": gps_alt
        }
        
        photos_list = []
        
        if os.path.exists(PHOTOS_JSON_PATH):
            try:
                with open(PHOTOS_JSON_PATH, "r", encoding="utf-8") as f:
                    photos_list = json.load(f)
            except json.JSONDecodeError:
                logger.warning("⚠️ photos.json 格式錯誤，將重新建立")
                photos_list = []
        
        photos_list.insert(0, photo_data)
        
        with open(PHOTOS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(photos_list, f, ensure_ascii=False, indent=2)
        
        logger.info(f"✅ 照片資訊已儲存到 photos.json，時間戳記: {timestamp}")

        photo_message = {
            "type": "photo-upload",
            "filename": filename,
            "url": photo_data["url"],
            "timestamp": timestamp,
            "latitude": gps_lat,
            "longitude": gps_lon,
            "altitude": gps_alt
        }
        
        await gps_manager.broadcast_to_all(json.dumps(photo_message))
        logger.info(f"📸 照片上傳事件已廣播（含GPS和時間）: {filename}")

        return JSONResponse({
            "success": True,
            "filename": filename,
            "path": str(file_path),
            "url": photo_data["url"],
            "timestamp": timestamp,
            "latitude": gps_lat,
            "longitude": gps_lon,
            "altitude": gps_alt
        })
    except Exception as e:
        logger.error(f"❌ 照片上傳失敗: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)

@app.get("/api/photo-history", tags=["Photo Upload"])
async def get_photo_history():
    """取得所有已上傳的照片列表（包含 GPS 座標）"""
    try:
        if os.path.exists(PHOTOS_JSON_PATH):
            try:
                with open(PHOTOS_JSON_PATH, "r", encoding="utf-8") as f:
                    photos = json.load(f)
                
                logger.info(f"✅ 照片歷史記錄查詢成功，共 {len(photos)} 張照片")
                
                return {
                    "success": True,
                    "photos": photos,
                    "count": len(photos)
                }
            except json.JSONDecodeError:
                logger.warning("⚠️ photos.json 格式錯誤")
        
        photos = []
        for filename in os.listdir(UPLOAD_DIR):
            file_path = UPLOAD_DIR / filename
            
            if file_path.is_file() and filename.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
                timestamp = filename.split('_')[0] if '_' in filename else ''
                
                photos.append({
                    "filename": filename,
                    "url": f"/uploads/{filename}",
                    "timestamp": timestamp,
                    "latitude": None,
                    "longitude": None,
                    "altitude": None
                })
        
        photos.sort(key=lambda x: x['timestamp'], reverse=True)
        
        logger.info(f"✅ 照片歷史記錄查詢成功（從資料夾掃描），共 {len(photos)} 張照片")
        
        return {
            "success": True,
            "photos": photos,
            "count": len(photos)
        }
    except Exception as e:
        logger.error(f"❌ 照片歷史記錄查詢失敗: {str(e)}")
        return JSONResponse({
            "success": False,
            "error": str(e),
            "photos": []
        }, status_code=500)

@app.delete("/api/delete-photo/{filename}", tags=["Photo Upload"])
async def delete_photo(filename: str):
    """刪除指定的照片"""
    try:
        file_path = UPLOAD_DIR / filename
        
        if not os.path.exists(file_path):
            logger.warning(f"⚠️ 照片不存在: {filename}")
            return JSONResponse({
                "success": False,
                "error": "照片不存在"
            }, status_code=404)
        
        os.remove(file_path)
        logger.info(f"✅ 照片已刪除: {filename}")
        
        if os.path.exists(PHOTOS_JSON_PATH):
            try:
                with open(PHOTOS_JSON_PATH, "r", encoding="utf-8") as f:
                    photos_list = json.load(f)
                
                photos_list = [p for p in photos_list if p.get("filename") != filename]
                
                with open(PHOTOS_JSON_PATH, "w", encoding="utf-8") as f:
                    json.dump(photos_list, f, ensure_ascii=False, indent=2)
                
                logger.info(f"✅ 已從 photos.json 移除照片記錄: {filename}")
            except Exception as e:
                logger.error(f"❌ 更新 photos.json 失敗: {e}")
        
        delete_event = {
            "type": "photo_deleted",
            "filename": filename,
            "timestamp": datetime.now().isoformat()
        }
        await gps_manager.broadcast_to_all(json.dumps(delete_event))
        logger.info(f"📤 照片刪除事件已廣播: {filename}")
        
        return {
            "success": True,
            "message": "照片已刪除",
            "filename": filename
        }
    except Exception as e:
        logger.error(f"❌ 刪除照片失敗: {str(e)}")
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)

@app.get("/api/photos", tags=["Photo Upload"])
async def get_photos():
    """取得所有已上傳的照片列表（簡化版，從 photos.json 讀取）"""
    try:
        if os.path.exists(PHOTOS_JSON_PATH):
            with open(PHOTOS_JSON_PATH, "r", encoding="utf-8") as f:
                photos = json.load(f)
            logger.info(f"✅ 取得照片列表成功，共 {len(photos)} 張照片")
            return photos
        else:
            logger.warning("⚠️ photos.json 不存在")
            return []
    except Exception as e:
        logger.error(f"❌ 取得照片列表失敗: {str(e)}")
        return []

# ✅ 新增：USRP 資料 API
@app.get("/api/usrp-data", tags=["USRP"])
async def get_usrp_data():
    """獲取 USRP 資料"""
    try:
        if not os.path.exists(USRP_DATA_PATH):
            logger.warning("⚠️ usrp_data.json 不存在")
            return []
        
        with open(USRP_DATA_PATH, 'r', encoding='utf-8') as f:
            usrp_data = json.load(f)
        
        logger.info(f"✅ 取得 USRP 資料成功，共 {len(usrp_data)} 筆")
        return usrp_data
    except json.JSONDecodeError as e:
        logger.error(f"❌ usrp_data.json 格式錯誤: {e}")
        return []
    except Exception as e:
        logger.error(f"❌ 讀取 USRP 資料失敗: {e}")
        return []

@app.post("/api/usrp-data", tags=["USRP"])
async def upload_usrp_data(data: dict):
    """接收並儲存 USRP 資料（用於之後接收真實資料）"""
    try:
        logger.info(f"📡 接收到 USRP 資料: {data}")
        
        # 讀取現有資料
        usrp_data = []
        if os.path.exists(USRP_DATA_PATH):
            try:
                with open(USRP_DATA_PATH, 'r', encoding='utf-8') as f:
                    usrp_data = json.load(f)
            except json.JSONDecodeError:
                logger.warning("⚠️ usrp_data.json 格式錯誤，將重新建立")
                usrp_data = []
        
        # 新增新資料（插入最前面）
        usrp_data.insert(0, data)
        
        # 只保留最新的 100 筆資料
        usrp_data = usrp_data[:100]
        
        # 寫入檔案
        with open(USRP_DATA_PATH, 'w', encoding='utf-8') as f:
            json.dump(usrp_data, f, indent=2, ensure_ascii=False)
        
        logger.info(f"✅ USRP 資料已儲存，總數: {len(usrp_data)}")
        
        return {
            "success": True,
            "message": "USRP 資料上傳成功",
            "total": len(usrp_data)
        }
    except Exception as e:
        logger.error(f"❌ 上傳 USRP 資料失敗: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)

app.include_router(api_router, prefix="/api/v1")
logger.info("Included API router v1 at /api/v1.")

@app.get("/", tags=["Root"])
async def read_root():
    """Provides a basic welcome message."""
    logger.info("--- Root endpoint '/' requested ---")
    return {"message": "Welcome to the Sionna RT Simulation API"}

if __name__ == "__main__":
    import uvicorn
    logger.info(
        "Starting Uvicorn server directly (use 'docker compose up' for full setup)..."
    )
    uvicorn.run(app, host="0.0.0.0", port=8888)

logger.info("FastAPI application setup complete. Ready for Uvicorn via external command.")