import logging
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import os
from contextlib import asynccontextmanager
from datetime import datetime

# Import lifespan manager and API router from their new locations
from app.db.lifespan import lifespan
from app.api.v1.router import api_router
from app.core.config import OUTPUT_DIR  # 導入設定的圖片目錄路徑
from app.domains.satellite.services.cqrs_satellite_service import CQRSSatelliteService

# 添加缺失的導入
from app.db.database import database
from app.domains.satellite.services.orbit_service import OrbitService

logger = logging.getLogger(__name__)

# Create FastAPI app instance using the lifespan manager
app = FastAPI(
    title="Sionna RT Simulation API",
    description="API for running Sionna RT simulations and managing devices.",
    version="0.1.0",
    lifespan=lifespan,  # Use the imported lifespan context manager
)

# --- Static Files Mount ---
# 確保靜態文件目錄存在
os.makedirs(OUTPUT_DIR, exist_ok=True)
logger.info(f"Static files directory set to: {OUTPUT_DIR}")

# 掛載靜態文件目錄到 /rendered_images URL 路徑 (保持與前端組件兼容的 URL)
app.mount("/rendered_images", StaticFiles(directory=OUTPUT_DIR), name="rendered_images")
logger.info(f"Mounted static files directory '{OUTPUT_DIR}' at '/rendered_images'.")

# 掛載 static 目錄
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
logger.info(f"Mounted static directory '{STATIC_DIR}' at '/static'.")

# 📷 設定照片上傳資料夾
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
logger.info(f"Upload directory set to: {UPLOAD_DIR}")

# --- CORS Middleware ---
# 允許本地開發與正式前端
origins = [
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://frontend.simworld.website",  # ✅ Cloudflare 前端
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info(f"CORS middleware added with origins: {origins}")

# --- Test Endpoint (Before API v1 Router) ---
@app.get("/ping", tags=["Test"])
async def ping():
    return {"message": "pong"}

# 📷 照片上傳 API
@app.post("/api/upload-photo", tags=["Photo Upload"])
async def upload_photo(photo: UploadFile = File(...)):
    """接收照片並儲存到本地資料夾"""
    try:
        # 生成唯一檔名
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{photo.filename}"
        file_path = os.path.join(UPLOAD_DIR, filename)

        # 儲存檔案
        with open(file_path, "wb") as buffer:
            content = await photo.read()
            buffer.write(content)

        logger.info(f"✅ 照片已上傳: {file_path}")

        return JSONResponse({
            "success": True,
            "filename": filename,
            "path": file_path
        })
    except Exception as e:
        logger.error(f"❌ 照片上傳失敗: {str(e)}")
        return JSONResponse({
            "success": False,
            "error": str(e)
        }, status_code=500)

# 📷 取得已上傳照片列表 API (選擇性)
@app.get("/api/photos", tags=["Photo Upload"])
async def get_photos():
    """取得所有已上傳的照片列表"""
    try:
        photos = os.listdir(UPLOAD_DIR)
        photos.sort(reverse=True)  # 最新的在前面
        return {"photos": photos}
    except Exception as e:
        logger.error(f"❌ 取得照片列表失敗: {str(e)}")
        return {"photos": [], "error": str(e)}

# --- Include API Routers ---
app.include_router(api_router, prefix="/api/v1")  # Add a /api/v1 prefix
logger.info("Included API router v1 at /api/v1.")

# --- Root Endpoint ---
@app.get("/", tags=["Root"])
async def read_root():
    """Provides a basic welcome message."""
    logger.info("--- Root endpoint '/' requested ---")
    return {"message": "Welcome to the Sionna RT Simulation API"}

# --- Uvicorn Entry Point (for direct run, if needed) ---
if __name__ == "__main__":
    import uvicorn
    logger.info(
        "Starting Uvicorn server directly (use 'docker compose up' for full setup)..."
    )
    uvicorn.run(app, host="0.0.0.0", port=8888)

logger.info("FastAPI application setup complete. Ready for Uvicorn via external command.")

# --- Lifespan Context Manager ---
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