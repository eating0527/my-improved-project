import logging
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional
import json

# ✅ 移除這行（不要從外部導入 lifespan）
# from app.db.lifespan import lifespan

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
    lifespan=lifespan,  # ✅ 使用上面定義的 lifespan
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
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
logger.info(f"Upload directory set to: {UPLOAD_DIR}")

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
logger.info(f"Mounted uploads directory '{UPLOAD_DIR}' at '/uploads'.")

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

# ✅ GPS WebSocket 連接管理器
class GPSConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"📡 GPS WebSocket 新客戶端連接，當前連接數: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(f"📡 GPS WebSocket 客戶端斷開，當前連接數: {len(self.active_connections)}")

    async def broadcast(self, message: str, sender: WebSocket):
        """廣播給所有客戶端（除了發送者）"""
        disconnected = []
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.error(f"❌ 廣播失敗: {e}")
                    disconnected.append(connection)
        
        for conn in disconnected:
            self.disconnect(conn)
    
    async def broadcast_to_all(self, message: str):
        """廣播給所有客戶端（包括發送者）"""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"❌ 廣播失敗: {e}")
                disconnected.append(connection)
        
        for conn in disconnected:
            self.disconnect(conn)

gps_manager = GPSConnectionManager()

@app.get("/ping", tags=["Test"])
async def ping():
    return {"message": "pong"}

@app.websocket("/ws/gps")
async def websocket_gps_endpoint(websocket: WebSocket):
    await gps_manager.connect(websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                message = json.loads(data)
                
                if message.get('type') == 'clear-path':
                    logger.info(
                        f"🗑️ 收到清除軌跡指令: "
                        f"device={message.get('deviceType')}, "
                        f"timestamp={message.get('timestamp')}"
                    )
                    await gps_manager.broadcast(data, websocket)
                    logger.info(f"✅ 清除軌跡指令已轉發給 {len(gps_manager.active_connections) - 1} 個客戶端")
                    continue
                
                if message.get('deviceType') == 'mobile' or message.get('lat') is not None:
                    logger.info(
                        f"📍 收到 GPS: lat={message.get('lat')}, "
                        f"lon={message.get('lon')}, "
                        f"accuracy={message.get('accuracy')}m, "
                        f"device={message.get('deviceType')}"
                    )
                    await gps_manager.broadcast(data, websocket)
                    logger.info(f"✅ GPS 資料已轉發給 {len(gps_manager.active_connections) - 1} 個客戶端")
                    continue
                
                logger.info(f"📤 收到其他訊息類型: {message.get('type')}")
                await gps_manager.broadcast(data, websocket)
                
            except json.JSONDecodeError as e:
                logger.error(f"❌ JSON 解析失敗: {e}, 原始資料: {data}")
            except Exception as e:
                logger.error(f"❌ 處理訊息時發生錯誤: {e}")
            
    except WebSocketDisconnect:
        gps_manager.disconnect(websocket)
        logger.info("✅ GPS WebSocket 客戶端正常斷開連接")
    except Exception as e:
        logger.error(f"❌ GPS WebSocket 錯誤: {e}")
        gps_manager.disconnect(websocket)

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
        
        # ✅ 使用實際當下時間生成時間戳記
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{photo.filename}"
        file_path = os.path.join(UPLOAD_DIR, filename)

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
        
        photos_json_path = os.path.join(UPLOAD_DIR, "photos.json")
        photos_list = []
        
        if os.path.exists(photos_json_path):
            try:
                with open(photos_json_path, "r", encoding="utf-8") as f:
                    photos_list = json.load(f)
            except json.JSONDecodeError:
                logger.warning("⚠️ photos.json 格式錯誤，將重新建立")
                photos_list = []
        
        photos_list.insert(0, photo_data)
        
        with open(photos_json_path, "w", encoding="utf-8") as f:
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
            "path": file_path,
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
        photos_json_path = os.path.join(UPLOAD_DIR, "photos.json")
        
        if os.path.exists(photos_json_path):
            try:
                with open(photos_json_path, "r", encoding="utf-8") as f:
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
            file_path = os.path.join(UPLOAD_DIR, filename)
            
            if os.path.isfile(file_path) and filename.lower().endswith(('.jpg', '.jpeg', '.png', '.gif')):
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
        file_path = os.path.join(UPLOAD_DIR, filename)
        
        if not os.path.exists(file_path):
            logger.warning(f"⚠️ 照片不存在: {filename}")
            return JSONResponse({
                "success": False,
                "error": "照片不存在"
            }, status_code=404)
        
        os.remove(file_path)
        logger.info(f"✅ 照片已刪除: {filename}")
        
        photos_json_path = os.path.join(UPLOAD_DIR, "photos.json")
        if os.path.exists(photos_json_path):
            try:
                with open(photos_json_path, "r", encoding="utf-8") as f:
                    photos_list = json.load(f)
                
                photos_list = [p for p in photos_list if p.get("filename") != filename]
                
                with open(photos_json_path, "w", encoding="utf-8") as f:
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
    """取得所有已上傳的照片列表（簡化版）"""
    try:
        photos = os.listdir(UPLOAD_DIR)
        photos.sort(reverse=True)
        return {"photos": photos}
    except Exception as e:
        logger.error(f"❌ 取得照片列表失敗: {str(e)}")
        return {"photos": [], "error": str(e)}

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