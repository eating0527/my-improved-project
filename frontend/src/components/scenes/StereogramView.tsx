import { Suspense, useRef, useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import Starfield from '../ui/Starfield'
import MainScene from './MainScene'
import { Device } from '../../types/device'
import { VisibleSatelliteInfo } from '../../types/satellite'

// 添加圖例组件
const SatelliteLegend = () => {
    return (
        <div className="satellite-legend">
            <h4>衛星圖例</h4>
            <div className="legend-item">
                <div className="color-sample high-elevation"></div>
                <span>高仰角衛星 - 通訊優質</span>
            </div>
            <div className="legend-note">
                • 接近頭頂，信號路徑短 • 連接穩定，抗干擾能力強
            </div>
            <div className="legend-item">
                <div className="color-sample low-elevation"></div>
                <span>低仰角衛星 - 信號較弱</span>
            </div>
            <div className="legend-note">
                • 接近地平線，易受地形障礙影響 • 信號衰減大，連接易中斷
            </div>
        </div>
    )
}

interface SceneViewProps {
    devices: Device[]
    auto: boolean
    manualDirection?: any
    onManualControl?: (direction: any) => void
    onUAVPositionUpdate?: (
        position: [number, number, number],
        deviceId?: number
    ) => void
    uavAnimation: boolean
    selectedReceiverIds?: number[]
    satellites?: VisibleSatelliteInfo[]
    sceneName: string
    uavPath?: Array<{ x: number; y: number; z: number }>
    uavPosition?: [number, number, number]
    photos?: Array<{
        url: string
        timestamp: string
        latitude?: number | null
        longitude?: number | null
        altitude?: number | null
    }>
    origin?: { lat: number; lon: number; alt: number }
    scale?: number
    usrpData?: Array<{
        id: number
        timestamp: string
        frequency: number
        power: number
        snr: number
        bandwidth: number
        latitude?: number | null
        longitude?: number | null
        altitude?: number | null
        device_name: string
    }>
    // ✅ 新增：多裝置 UAV 位置
    allDevicePositions?: Map<string, {
        position: [number, number, number]
        deviceId: string
        lat: number
        lon: number
        accuracy: number
    }>
    myDeviceId?: string | null
}

export default function SceneView({
    devices = [],
    auto,
    manualDirection,
    onManualControl,
    onUAVPositionUpdate,
    uavAnimation,
    selectedReceiverIds = [],
    satellites = [],
    sceneName,
    uavPath = [],
    uavPosition = [0, 10, 0],
    photos: initialPhotos = [],
    origin,
    scale,
    usrpData = [],
    allDevicePositions,  // ✅ 新增
    myDeviceId,  // ✅ 新增
}: SceneViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    
    // ✅ 使用 state 來管理照片列表，這樣可以動態更新
    const [photos, setPhotos] = useState(initialPhotos)
    
    // ✅ 當 props 中的 photos 改變時，更新 state
    useEffect(() => {
        setPhotos(initialPhotos)
    }, [initialPhotos])

    // ✅ 添加調試訊息，確認 devices 是否正確傳遞
    useEffect(() => {
        console.log('🎥 SceneView 收到的 devices:', devices);
        console.log('🎥 devices 數量:', devices.length);
        console.log('🎥 devices 的 roles:', devices.map(d => ({ id: d.id, role: d.role })));
    }, [devices]);

    // ✅ 監聽軌跡資料
    useEffect(() => {
        if (uavPath.length > 0) {
            console.log('🎥 SceneView 收到軌跡資料，點數:', uavPath.length);
        }
    }, [uavPath]);

    // ✅ 監聽 UAV 位置變化
    useEffect(() => {
        console.log('🎥 SceneView 收到 UAV 位置:', uavPosition);
    }, [uavPosition]);

    // ✅ 監聽照片資料
    useEffect(() => {
        if (photos.length > 0) {
            console.log('🎥 SceneView 收到照片資料，數量:', photos.length);
            console.log('🎥 照片內容:', photos);
        }
    }, [photos]);

    // ✅ 新增：監聽 USRP 資料
    useEffect(() => {
        if (usrpData.length > 0) {
            console.log('📡 SceneView 收到 USRP 資料，數量:', usrpData.length);
            console.log('📡 USRP 內容:', usrpData);
        }
    }, [usrpData]);

    // ✅ 新增：監聽多裝置位置
    useEffect(() => {
        if (allDevicePositions && allDevicePositions.size > 0) {
            console.log('🎥 SceneView 收到多裝置位置，數量:', allDevicePositions.size);
            allDevicePositions.forEach((device, deviceId) => {
                console.log(`🎥 裝置 ${deviceId.substring(0, 8)}:`, device);
            });
        }
    }, [allDevicePositions]);

    // ✅ 新增：監聽當前裝置 ID
    useEffect(() => {
        if (myDeviceId) {
            console.log('🎥 SceneView 收到當前裝置 ID:', myDeviceId.substring(0, 8));
        }
    }, [myDeviceId]);

    // ✅ 監聽 origin 和 scale
    useEffect(() => {
        console.log('🎥 SceneView origin:', origin);
        console.log('🎥 SceneView scale:', scale);
    }, [origin, scale]);

    // ✅ 新增：WebSocket 監聽，處理照片上傳和刪除事件
    useEffect(() => {
        let ws: WebSocket | null = null
        
        const connectWebSocket = () => {
            try {
                ws = new WebSocket('wss://backend.simworld.website/ws/gps')
                
                ws.onopen = () => {
                    console.log('✅ StereogramView WebSocket 連線成功')
                }
                
                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data)
                        console.log('📩 StereogramView 收到 WebSocket 訊息:', data)
                        
                        // ✅ 處理照片上傳事件
                        if (data.type === 'photo-upload') {
                            console.log('📸 StereogramView 收到照片上傳事件:', data)
                            
                            const newPhoto = {
                                url: data.url,
                                timestamp: data.timestamp,
                                latitude: data.latitude,
                                longitude: data.longitude,
                                altitude: data.altitude
                            }
                            
                            // ✅ 檢查照片是否已存在（避免重複）
                            setPhotos(prevPhotos => {
                                const exists = prevPhotos.some(p => p.url === newPhoto.url)
                                if (exists) {
                                    console.log('⚠️ 照片已存在，不重複新增:', newPhoto.url)
                                    return prevPhotos
                                }
                                
                                console.log('✅ 添加新照片到場景:', newPhoto)
                                return [newPhoto, ...prevPhotos]
                            })
                        }
                        
                        // ✅ 處理照片刪除事件
                        if (data.type === 'photo_deleted') {
                            console.log('🗑️ StereogramView 收到照片刪除事件:', data)
                            
                            // ✅ 從照片列表中移除
                            setPhotos(prevPhotos => {
                                const newPhotos = prevPhotos.filter(photo => 
                                    !photo.url.includes(data.filename)
                                )
                                console.log(`✅ 已從場景移除照片: ${data.filename}，剩餘 ${newPhotos.length} 張`)
                                return newPhotos
                            })
                        }
                        
                    } catch (error) {
                        console.error('❌ StereogramView 解析 WebSocket 訊息失敗:', error)
                    }
                }
                
                ws.onerror = (error) => {
                    console.error('❌ StereogramView WebSocket 錯誤:', error)
                }
                
                ws.onclose = () => {
                    console.log('🔌 StereogramView WebSocket 連線關閉')
                    // ✅ 嘗試重新連線
                    setTimeout(() => {
                        console.log('🔄 嘗試重新連線 WebSocket...')
                        connectWebSocket()
                    }, 3000)
                }
                
            } catch (error) {
                console.error('❌ StereogramView WebSocket 連線失敗:', error)
            }
        }
        
        // ✅ 啟動 WebSocket 連線
        connectWebSocket()
        
        // ✅ 清理函數：組件卸載時關閉 WebSocket
        return () => {
            if (ws) {
                console.log('🔌 關閉 StereogramView WebSocket 連線')
                ws.close()
            }
        }
    }, []) // ✅ 空依賴陣列，只在組件掛載時執行一次

    // WebGL 上下文恢復處理
    const handleWebGLContextLost = useCallback((event: Event) => {
        console.warn('WebGL 上下文丟失，嘗試恢復...')
        event.preventDefault()
    }, [])

    const handleWebGLContextRestored = useCallback(() => {
        console.log('WebGL 上下文已恢復')
    }, [])

    // 添加 WebGL 上下文事件監聽器
    useEffect(() => {
        const canvas = canvasRef.current
        if (canvas) {
            canvas.addEventListener('webglcontextlost', handleWebGLContextLost)
            canvas.addEventListener(
                'webglcontextrestored',
                handleWebGLContextRestored
            )

            return () => {
                canvas.removeEventListener(
                    'webglcontextlost',
                    handleWebGLContextLost
                )
                canvas.removeEventListener(
                    'webglcontextrestored',
                    handleWebGLContextRestored
                )
            }
        }
    }, [handleWebGLContextLost, handleWebGLContextRestored])

    return (
        <div
            className="scene-container"
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                background:
                    'radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%)',
                overflow: 'hidden',
            }}
        >
            {/* 星空星點層（在最底層，不影響互動） */}
            <Starfield starCount={180} />

            {/* 添加衛星圖例 - 只有在有衛星資料時才顯示 */}
            {satellites && satellites.length > 0 && <SatelliteLegend />}

            {/* 3D Canvas內容照舊，會蓋在星空上 */}
            <Canvas
                ref={canvasRef}
                shadows
                camera={{ position: [0, 400, 500], near: 0.1, far: 1e4 }}
                gl={{
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: 1.2,
                    alpha: true,
                    preserveDrawingBuffer: false,
                    powerPreference: 'high-performance',
                    antialias: true,
                    failIfMajorPerformanceCaveat: false,
                }}
                onCreated={({ gl }) => {
                    // 配置渲染器的上下文恢復選項
                    gl.debug.checkShaderErrors = true
                    console.log('WebGL 渲染器已創建')
                }}
            >
                <hemisphereLight args={[0xffffff, 0x444444, 1.0]} />
                <ambientLight intensity={0.2} />
                <directionalLight
                    castShadow
                    position={[15, 30, 10]}
                    intensity={1.5}
                    shadow-mapSize-width={4096}
                    shadow-mapSize-height={4096}
                    shadow-camera-near={1}
                    shadow-camera-far={1000}
                    shadow-camera-top={500}
                    shadow-camera-bottom={-500}
                    shadow-camera-left={500}
                    shadow-camera-right={-500}
                    shadow-bias={-0.0004}
                    shadow-radius={8}
                />
                <Suspense fallback={null}>
                    <MainScene
                        devices={devices}
                        auto={auto}
                        manualDirection={manualDirection}
                        manualControl={onManualControl}
                        onUAVPositionUpdate={onUAVPositionUpdate}
                        uavAnimation={uavAnimation}
                        selectedReceiverIds={selectedReceiverIds}
                        satellites={satellites}
                        sceneName={sceneName}
                        uavPath={uavPath}
                        uavPosition={uavPosition}
                        photos={photos}
                        origin={origin}
                        scale={scale}
                        usrpData={usrpData}
                        allDevicePositions={allDevicePositions}  // ✅ 新增
                        myDeviceId={myDeviceId}  // ✅ 新增
                    />
                    <ContactShadows
                        position={[0, 0.1, 0]}
                        opacity={0.4}
                        scale={400}
                        blur={1.5}
                        far={50}
                    />
                </Suspense>
                <OrbitControls makeDefault />
            </Canvas>
        </div>
    )
}

// 添加CSS樣式
const styleSheet = document.createElement('style')
styleSheet.type = 'text/css'
styleSheet.innerHTML = `
.satellite-legend {
    position: absolute;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 10px;
    border-radius: 5px;
    font-size: 12px;
    z-index: 1000;
}

.satellite-legend h4 {
    margin-top: 0;
    margin-bottom: 8px;
    font-size: 14px;
}

.legend-item {
    display: flex;
    align-items: center;
    margin-bottom: 5px;
}

.color-sample {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    margin-right: 8px;
}

.high-elevation {
    background-color: #ff3300;
    box-shadow: 0 0 8px #ff3300;
}

.low-elevation {
    background-color: #0088ff;
    box-shadow: 0 0 8px #0088ff;
}

.legend-note {
    font-size: 10px;
    margin-top: 5px;
    opacity: 0.8;
}
`
document.head.appendChild(styleSheet)