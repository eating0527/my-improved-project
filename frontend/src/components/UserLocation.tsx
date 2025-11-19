import { useEffect, useRef, useState, useMemo } from "react"  // ✅ 加入 useMemo
import { latLonToENU } from "../utils/geo"
import points from "../data/points.json"
import { useGPSSync } from "../hooks/useGPSSync"
import PhotoViewer from "./PhotoViewer"
import PhotoHistory from "./PhotoHistory"

interface UserLocationProps {
  origin: { lat: number; lon: number; alt: number }
  scale: number
  rotation?: number
  upsertDevice: (d: any) => void
  onPathUpdate?: (point: { x: number; y: number; z: number }) => void
  pathLength?: number
  totalDistance?: number
  onClearPath?: () => void
  onUAVPositionUpdate?: (
    position: [number, number, number],
    gpsPosition?: { lat: number; lon: number; altitude?: number | null }
  ) => void
}

export default function UserLocation({
  origin,
  scale,
  rotation = 0,
  upsertDevice,
  onPathUpdate,
  pathLength = 0,
  totalDistance = 0,
  onClearPath,
  onUAVPositionUpdate,
}: UserLocationProps) {
  const upsertRef = useRef(upsertDevice)
  const [locationStatus, setLocationStatus] = useState<string>("")
  
  const [localGPS, setLocalGPS] = useState({ 
    lat: 0, 
    lon: 0, 
    alt: 0,
    accuracy: 999
  })
  
  const [currentPhoto, setCurrentPhoto] = useState<string | null>(null)
  
  // ✅ UAV 位置狀態
  const [uavPosition, setUavPosition] = useState<[number, number, number]>([0, 10, 0])
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  const { 
    lat: syncedLat, 
    lon: syncedLon, 
    alt: syncedAlt, 
    accuracy: syncedAccuracy, 
    clearPathTrigger, 
    sendClearPath,
    photoUploadEvent,
    photoDeleteEvent
  } = useGPSSync(localGPS)
  
  // ✅ 使用 useMemo 避免每次都建立新物件
  const syncedGPS = useMemo(() => ({
    lat: syncedLat,
    lon: syncedLon,
    alt: syncedAlt,
    accuracy: syncedAccuracy
  }), [syncedLat, syncedLon, syncedAlt, syncedAccuracy])
  
  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  // ✅ 修改：只有當 GPS 座標有效時才通知父組件
  useEffect(() => {
    console.log('🔍 [UserLocation] useEffect 觸發');
    console.log('🔍 onUAVPositionUpdate 存在?', !!onUAVPositionUpdate);
    console.log('🔍 uavPosition:', uavPosition);
    console.log('🔍 isMobile:', isMobile);
    console.log('🔍 localGPS:', localGPS);
    console.log('🔍 syncedGPS:', syncedGPS);
    
    if (!onUAVPositionUpdate) {
      console.warn('⚠️ [UserLocation] onUAVPositionUpdate 不存在');
      return;
    }
    
    const gpsPos = isMobile ? localGPS : syncedGPS;
    const alt = isMobile ? localGPS.alt : syncedGPS.alt;
    
    // ✅ 只有當 GPS 座標有效時才回傳（不是 0,0）
    if (gpsPos.lat === 0 && gpsPos.lon === 0) {
      console.warn('⚠️ [UserLocation] GPS 座標無效 (0, 0)，跳過更新');
      return;
    }
    
    // ✅ 額外檢查：精度太差時也不更新
    if (gpsPos.accuracy > 500) {
      console.warn(`⚠️ [UserLocation] GPS 精度太差 (${gpsPos.accuracy.toFixed(2)}m)，跳過更新`);
      return;
    }
    
    const gpsData = {
      lat: gpsPos.lat,
      lon: gpsPos.lon,
      altitude: alt
    };
    
    console.log('✅ [UserLocation] 準備回傳有效的 GPS 資料:', gpsData);
    
    onUAVPositionUpdate(uavPosition, gpsData);
    
    console.log('✅ [UserLocation] 已通知父組件 UAV 位置更新:', uavPosition, gpsData);
  }, [uavPosition, onUAVPositionUpdate, isMobile, localGPS, syncedGPS]);

  const lastPositionRef = useRef<{ lat: number; lon: number; time: number }>({ 
    lat: 0, 
    lon: 0, 
    time: 0 
  })
  const lastReliablePositionRef = useRef<{ lat: number; lon: number; accuracy: number }>({ 
    lat: 0, 
    lon: 0, 
    accuracy: 999 
  })
  const smoothedPositionRef = useRef<{ lat: number; lon: number }>({ 
    lat: 0, 
    lon: 0 
  })
  const lastMovementTimeRef = useRef<number>(Date.now())
  const isMovingRef = useRef<boolean>(false)
  const poorAccuracyCountRef = useRef<number>(0)
  const lastProcessedGPSRef = useRef<{ lat: number; lon: number }>({ 
    lat: 0, 
    lon: 0 
  })

  const [, forceUpdate] = useState({})

  useEffect(() => {
    if (clearPathTrigger > 0 && onClearPath) {
      console.log('🗑️ 收到遠端清除軌跡指令，觸發器值:', clearPathTrigger)
      lastProcessedGPSRef.current = { lat: 0, lon: 0 }
      onClearPath()
    }
  }, [clearPathTrigger, onClearPath])

  useEffect(() => {
    if (photoUploadEvent) {
      console.log('📸 收到照片上傳事件，準備顯示照片:', photoUploadEvent)
      setCurrentPhoto(photoUploadEvent.url)
    }
  }, [photoUploadEvent])

  useEffect(() => {
    console.log('📍 載入基準點數量:', points.length)
    if (points.length === 0) {
      console.error('❌ 基準點資料載入失敗')
    } else {
      console.log('✅ 基準點資料已載入:', points.map(p => p.name).join(', '))
    }
  }, [])

  function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6378137
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    return Math.sqrt(
      Math.pow(dLat * R, 2) +
      Math.pow(dLon * R * Math.cos(lat1 * Math.PI / 180), 2)
    )
  }

  function isValidMovement(lat: number, lon: number): boolean {
    const now = Date.now()
    const lastPos = lastPositionRef.current
    
    if (lastPos.time === 0) {
      lastPositionRef.current = { lat, lon, time: now }
      return true
    }
    
    const distance = calcDistance(lastPos.lat, lastPos.lon, lat, lon)
    const timeDiff = (now - lastPos.time) / 1000
    
    if (timeDiff === 0) return false
    
    const speed = distance / timeDiff
    
    if (speed > 30) {
      console.warn(`⚠️ 檢測到異常移動速度: ${speed.toFixed(2)} m/s，忽略此次更新`)
      return false
    }
    
    lastPositionRef.current = { lat, lon, time: now }
    return true
  }

  function smoothPosition(lat: number, lon: number, alpha: number = 0.3): [number, number] {
    const smoothed = smoothedPositionRef.current
    
    if (smoothed.lat === 0) {
      smoothedPositionRef.current = { lat, lon }
      return [lat, lon]
    }
    
    const smoothedLat = smoothed.lat * (1 - alpha) + lat * alpha
    const smoothedLon = smoothed.lon * (1 - alpha) + lon * alpha
    
    smoothedPositionRef.current = { lat: smoothedLat, lon: smoothedLon }
    return [smoothedLat, smoothedLon]
  }

  function updateMovementState(lat: number, lon: number): void {
    const lastPos = lastPositionRef.current
    
    if (lastPos.time === 0) return
    
    const distance = calcDistance(lastPos.lat, lastPos.lon, lat, lon)
    
    if (distance > 5) {
      isMovingRef.current = true
      lastMovementTimeRef.current = Date.now()
    } else if (Date.now() - lastMovementTimeRef.current > 5000) {
      isMovingRef.current = false
    }
  }

  function adjustPosition(lat: number, lon: number, accuracy: number): [number, number] {
    const threshold = 100
    
    const nearbyPoints = points
      .map(pt => ({
        ...pt,
        distance: calcDistance(pt.lat, pt.lon, lat, lon),
      }))
      .filter(pt => pt.distance <= threshold)
      .sort((a, b) => a.distance - b.distance)

    if (nearbyPoints.length === 0) {
      console.log("ℹ️ 沒有找到附近的已知點，使用原始 GPS 座標")
      return [lat, lon]
    }

    console.log(`📍 最近的點: ${nearbyPoints[0].name}, 距離: ${nearbyPoints[0].distance.toFixed(2)} 公尺`)
    
    if (nearbyPoints[0].distance > 50) {
      console.log("ℹ️ 最近點距離較遠，使用原始 GPS 座標")
      return [lat, lon]
    }

    if (accuracy < 15 && nearbyPoints[0].distance < 5) {
      console.log(`✅ GPS 精度高且距離非常近，使用 ${nearbyPoints[0].name} 的座標`)
      return [nearbyPoints[0].lat, nearbyPoints[0].lon]
    }

    const topPoints = nearbyPoints.slice(0, 3)
    let sumLat = 0
    let sumLon = 0
    let weightSum = 0

    topPoints.forEach(pt => {
      const weight = 1 / (pt.distance + 1)
      sumLat += pt.lat * weight
      sumLon += pt.lon * weight
      weightSum += weight
    })

    const correctedLat = sumLat / weightSum
    const correctedLon = sumLon / weightSum

    let correctionRatio = 0
    
    if (nearbyPoints[0].distance < 20) {
      correctionRatio = Math.min(0.3, (20 - nearbyPoints[0].distance) / 20 * 0.3)
    }
    
    if (accuracy > 50) {
      correctionRatio = Math.min(correctionRatio, 0.1)
    }
    
    if (!isMovingRef.current && nearbyPoints[0].distance < 30) {
      correctionRatio = Math.min(0.5, correctionRatio * 1.5)
      console.log("🛑 靜止狀態，增加校正比例以減少漂移")
    }

    const adjustedLat = lat * (1 - correctionRatio) + correctedLat * correctionRatio
    const adjustedLon = lon * (1 - correctionRatio) + correctedLon * correctionRatio

    if (correctionRatio > 0) {
      console.log(`📐 校正比例: ${(correctionRatio * 100).toFixed(1)}%`)
    } else {
      console.log("ℹ️ 使用原始 GPS 座標")
    }

    return [adjustedLat, adjustedLon]
  }

  function getGPSQualityStatus(accuracy: number): string {
    if (accuracy < 20) {
      return "✅ GPS 精度：優秀"
    } else if (accuracy < 50) {
      return "⚠️ GPS 精度：良好"
    } else if (accuracy < 100) {
      return "⚠️ GPS 精度：一般"
    } else {
      return "❌ GPS 精度：較差"
    }
  }

  function handlePoorAccuracy(lat: number, lon: number, accuracy: number): [number, number] | null {
    const lastReliable = lastReliablePositionRef.current
    const isFirstLocation = lastReliable.lat === 0
    
    const accuracyThreshold = isFirstLocation ? 500 : 150
    
    if (accuracy > accuracyThreshold) {
      poorAccuracyCountRef.current += 1
      
      console.warn(`❌ GPS 精度太差 (${accuracy.toFixed(2)}m)，第 ${poorAccuracyCountRef.current} 次`)
      
      if (isFirstLocation && poorAccuracyCountRef.current <= 5) {
        console.log(`🔰 首次定位，即使精度差也先使用 (${accuracy.toFixed(2)}m)`)
        setLocationStatus(`⚠️ GPS 精度較差 (${accuracy.toFixed(0)}m)，正在改善中...`)
        lastReliablePositionRef.current = { lat, lon, accuracy }
        return [lat, lon]
      }
      
      if (poorAccuracyCountRef.current >= 5) {
        if (lastReliable.lat !== 0) {
          console.log(`🔄 使用上次的位置 (精度: ${lastReliable.accuracy.toFixed(2)}m)`)
          setLocationStatus("⚠️ GPS 信號差，使用已知位置")
          return [lastReliable.lat, lastReliable.lon]
        } else {
          if (points.length > 0) {
            console.log(`🏢 使用預設位置: ${points[0].name}`)
            setLocationStatus(`🏢 GPS 信號太差，暫時使用 ${points[0].name} 作為參考位置`)
            const defaultLat = points[0].lat
            const defaultLon = points[0].lon
            lastReliablePositionRef.current = { lat: defaultLat, lon: defaultLon, accuracy: 999 }
            return [defaultLat, defaultLon]
          }
          
          console.error(`❌ 無法取得任何定位，請移動到空曠處`)
          setLocationStatus("❌ 無法定位，請移動到空曠處或檢查定位權限")
          return null
        }
      }
    } else {
      poorAccuracyCountRef.current = 0
      
      if (accuracy < lastReliable.accuracy || isFirstLocation) {
        lastReliablePositionRef.current = { lat, lon, accuracy }
        console.log(`💾 儲存可靠位置 (精度: ${accuracy.toFixed(2)}m)`)
      }
      
      setLocationStatus(getGPSQualityStatus(accuracy))
    }
    
    return [lat, lon]
  }

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      console.error("❌ 瀏覽器不支援 geolocation")
      setLocationStatus("❌ 瀏覽器不支援定位功能")
      return
    }

    const updatePosition = (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      const alt = pos.coords.altitude ?? 0
      const acc = pos.coords.accuracy

      console.log(
        `📍 [${isMobile ? '手機' : '筆電'}] GPS 原始定位：`,
        {
          lat: lat.toFixed(6),
          lon: lon.toFixed(6),
          alt: alt.toFixed(2),
          acc: `${acc.toFixed(2)}m`,
          timestamp: new Date(pos.timestamp).toLocaleTimeString(),
        }
      )

      setLocalGPS({ 
        lat, 
        lon, 
        alt,
        accuracy: acc
      })
      console.log(`✅ [${isMobile ? '手機' : '筆電'}] 已更新 localGPS (精度: ${acc.toFixed(2)}m)`)

      if (!isMobile) {
        console.log('💻 筆電不處理本地 GPS，等待接收手機 GPS')
        return
      }

      console.log('📱 手機處理本地 GPS...')

      if (acc > 500) {
        console.warn(`⚠️ GPS 精度過低 (${acc.toFixed(2)}m)，可能使用了網路定位而非 GPS`)
      }

      const positionToUse = handlePoorAccuracy(lat, lon, acc)
      if (positionToUse === null) {
        return
      }
      
      const [useLat, useLon] = positionToUse

      if (!isValidMovement(useLat, useLon)) {
        return
      }

      updateMovementState(useLat, useLon)

      const [smoothedLat, smoothedLon] = smoothPosition(useLat, useLon, 0.3)

      const [adjustedLat, adjustedLon] = adjustPosition(smoothedLat, smoothedLon, acc)
      
      if (adjustedLat !== smoothedLat || adjustedLon !== smoothedLon) {
        const offset = calcDistance(smoothedLat, smoothedLon, adjustedLat, adjustedLon)
        console.log(`📏 校正偏移量: ${offset.toFixed(2)} 公尺`)
      }

      const [east, north, up] = latLonToENU(adjustedLat, adjustedLon, alt, origin, rotation)

      const safeY = Math.max(up * scale, 10)

      // ✅ 更新 UAV 位置
      const newPosition: [number, number, number] = [east * scale, safeY, north * scale]
      setUavPosition(newPosition)
      console.log('📱 手機更新 UAV 位置:', newPosition)

      console.log('📱 手機更新設備位置')
      upsertRef.current({
        id: "user",
        role: "user",
        position_x: east * scale,
        position_y: safeY,
        position_z: north * scale,
      })

      if (onPathUpdate) {
        onPathUpdate({ x: east * scale, y: safeY, z: north * scale })
        console.log('📱 手機傳遞軌跡點給父組件')
      }

      forceUpdate({})
    }

    const geoOptions = {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 0
    }

    setLocationStatus("📡 正在獲取 GPS 信號，請稍候...")

    navigator.geolocation.getCurrentPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 初始定位失敗：", err.code, err.message)
        
        if (err.code === 1) {
          setLocationStatus("❌ 定位權限被拒絕，請允許定位權限")
        } else if (err.code === 2) {
          setLocationStatus("❌ 無法獲取位置，請確保 GPS 已開啟並移動到空曠處")
        } else if (err.code === 3) {
          setLocationStatus("⚠️ 定位超時，GPS 信號可能較弱，重試中...")
        } else {
          setLocationStatus("❌ 定位失敗，請檢查定位權限")
        }
      },
      geoOptions
    )

    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 定位更新失敗：", err.code, err.message)
        
        if (err.code === 3) {
          setLocationStatus("⚠️ GPS 信號弱，持續嘗試中...")
        } else if (err.code === 2) {
          setLocationStatus("⚠️ 無法獲取 GPS，請確保在空曠處")
        }
      },
      geoOptions
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [origin, scale, rotation, isMobile, onPathUpdate])

  useEffect(() => {
    if (isMobile) {
      console.log('📱 手機不需要使用 syncedGPS')
      return
    }

    if (syncedGPS.lat === 0 && syncedGPS.lon === 0) {
      console.log('💻 筆電等待手機 GPS...')
      return
    }

    const lastProcessed = lastProcessedGPSRef.current
    const distanceFromLast = calcDistance(
      lastProcessed.lat,
      lastProcessed.lon,
      syncedGPS.lat,
      syncedGPS.lon
    )

    if (distanceFromLast < 0.5 && lastProcessed.lat !== 0) {
      console.log('💻 筆電：座標變化太小，忽略此次更新')
      return
    }

    console.log("💻 筆電使用手機的 syncedGPS 更新設備位置：", syncedGPS)

    lastProcessedGPSRef.current = { lat: syncedGPS.lat, lon: syncedGPS.lon }

    if (syncedGPS.accuracy !== undefined && syncedGPS.accuracy !== 999) {
      lastReliablePositionRef.current.accuracy = syncedGPS.accuracy
      lastReliablePositionRef.current.lat = syncedGPS.lat
      lastReliablePositionRef.current.lon = syncedGPS.lon
      console.log(`💻 筆電更新精度: ${syncedGPS.accuracy.toFixed(2)}m`)
    }

    const [east, north, up] = latLonToENU(
      syncedGPS.lat,
      syncedGPS.lon,
      syncedGPS.alt,
      origin,
      rotation
    )

    const safeY = Math.max(up * scale, 10)

    // ✅ 筆電也更新 UAV 位置
    const newPosition: [number, number, number] = [east * scale, safeY, north * scale]
    setUavPosition(newPosition)
    console.log('💻 筆電更新 UAV 位置:', newPosition)

    console.log('💻 筆電更新設備位置')
    upsertRef.current({
      id: "user",
      role: "user",
      position_x: east * scale,
      position_y: safeY,
      position_z: north * scale,
    })

    if (onPathUpdate) {
      onPathUpdate({ x: east * scale, y: safeY, z: north * scale })
      console.log('💻 筆電傳遞軌跡點給父組件')
    }

    forceUpdate({})
  }, [syncedGPS, origin, scale, rotation, isMobile, onPathUpdate])

  const handleClearPath = () => {
    console.log('🗑️ 點擊清除軌跡按鈕')
    lastProcessedGPSRef.current = { lat: 0, lon: 0 }
    
    if (onClearPath) {
      onClearPath()
      console.log('✅ 已通知父組件清除軌跡')
    }
    
    sendClearPath()
    console.log('✅ 已發送清除軌跡指令到 WebSocket')
  }

  const handleClosePhoto = () => {
    console.log('📸 關閉照片顯示')
    setCurrentPhoto(null)
  }

  return (
    <>
      {locationStatus && (
        <div style={{
          position: 'fixed',
          top: '10px',
          left: '10px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '10px',
          borderRadius: '5px',
          zIndex: 1000,
          fontSize: '14px',
          maxWidth: '300px'
        }}>
          {locationStatus}
        </div>
      )}
      
      <div style={{
        position: 'fixed',
        top: '60px',
        left: '1px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#00ff00',
        padding: '15px',
        borderRadius: '5px',
        zIndex: 1000,
        fontSize: '11px',
        fontFamily: 'monospace',
        border: '1px solid #00ff00',
        minWidth: '250px'
      }}>
        <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
          🚁 數位孿生監控 {isMobile ? '📱' : '💻'}
        </div>
        <div>設備: {isMobile ? '手機' : '筆電'}</div>
        <div>緯度: {(isMobile ? localGPS.lat : syncedGPS.lat).toFixed(6)}°</div>
        <div>經度: {(isMobile ? localGPS.lon : syncedGPS.lon).toFixed(6)}°</div>
        <div>誤差範圍: {(isMobile ? localGPS.accuracy : syncedGPS.accuracy).toFixed(2)}m</div>
        <div>移動狀態: {isMovingRef.current ? '🟢 移動中' : '🔴 靜止'}</div>
        <div>基準點: {points.length > 0 ? `📡 ${points.length} 個` : '❌ 未載入'}</div>
        
        <div style={{ marginTop: '8px', borderTop: '1px solid #00ff00', paddingTop: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>
            📊 移動軌跡資訊
          </div>
          <div>移動記錄點: {pathLength}</div>
          <div>目前移動距離: {totalDistance.toFixed(2)}m</div>
        </div>
        
        <button
          onClick={handleClearPath}
          style={{
            marginTop: '10px',
            padding: '5px 10px',
            background: 'rgba(255, 0, 0, 0.7)',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px',
            width: '100%'
          }}
        >
          🗑️ 清除軌跡
        </button>
        
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#888' }}>
          最後更新: {new Date().toLocaleTimeString()}
        </div>
      </div>

      {/* ✅ 照片歷史記錄 */}
      <PhotoHistory
        onPhotoClick={(url) => {
          console.log('📸 點擊照片:', url)
          setCurrentPhoto(url)
        }}
        photoDeleteEvent={photoDeleteEvent}
      />

      {/* ✅ 照片顯示組件 */}
      <PhotoViewer
        photoUrl={currentPhoto}
        onClose={handleClosePhoto}
        autoCloseTime={10000}
      />
    </>
  )
}