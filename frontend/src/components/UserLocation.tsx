import { useEffect, useRef, useState } from "react"
import { latLonToENU } from "../utils/geo"
import points from "../data/points.json"
import { useGPSSync } from "../hooks/useGPSSync"

interface UserLocationProps {
  origin: { lat: number; lon: number; alt: number }
  scale: number
  rotation?: number
  upsertDevice: (d: any) => void
}

export default function UserLocation({
  origin,
  scale,
  rotation = 0,
  upsertDevice,
}: UserLocationProps) {
  const upsertRef = useRef(upsertDevice)
  const [locationStatus, setLocationStatus] = useState<string>("")
  
  // ✅ 修改：加入 accuracy
  const [localGPS, setLocalGPS] = useState({ 
    lat: 0, 
    lon: 0, 
    alt: 0,
    accuracy: 999  // ✅ 新增：精度
  })
  
  // ✅ 檢測是否為手機
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  // ✅ 使用 WebSocket 同步 GPS（現在包含 accuracy）
  const syncedGPS = useGPSSync(localGPS)
  
  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  // 狀態追蹤
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

  // ✅ 新增：用於觸發面板更新
  const [, forceUpdate] = useState({})

  // ✅ 新增：檢查基準點載入狀態
  useEffect(() => {
    console.log('📍 載入基準點數量:', points.length)
    if (points.length === 0) {
      console.error('❌ 基準點資料載入失敗')
    } else {
      console.log('✅ 基準點資料已載入:', points.map(p => p.name).join(', '))
    }
  }, [])

  // 計算兩點距離
  function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6378137
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    return Math.sqrt(
      Math.pow(dLat * R, 2) +
      Math.pow(dLon * R * Math.cos(lat1 * Math.PI / 180), 2)
    )
  }

  // 檢測是否為有效移動（避免異常跳動）
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

  // 平滑位置（指數移動平均）
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

  // 更新移動狀態
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

  // 根據最近的已知點調整位置（輕微校正）
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

  // 顯示 GPS 精度品質
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

  // 處理精度太差的情況（改進版）
  function handlePoorAccuracy(lat: number, lon: number, accuracy: number): [number, number] | null {
    const lastReliable = lastReliablePositionRef.current
    const isFirstLocation = lastReliable.lat === 0
    
    // ✅ 修改：對首次定位更寬容，但會顯示警告
    const accuracyThreshold = isFirstLocation ? 500 : 150
    
    if (accuracy > accuracyThreshold) {
      poorAccuracyCountRef.current += 1
      
      console.warn(`❌ GPS 精度太差 (${accuracy.toFixed(2)}m)，第 ${poorAccuracyCountRef.current} 次`)
      
      // ✅ 修改：首次定位時即使精度差也會顯示，但持續等待更好的信號
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

  // ✅ 獲取本地 GPS（手機和筆電都執行，但只有手機會用於更新位置）
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

      // ✅ 增強日誌輸出，加入時間戳記
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

      // ✅ 更新本地 GPS（包含精度）
      setLocalGPS({ 
        lat, 
        lon, 
        alt,
        accuracy: acc  // ✅ 加入精度
      })
      console.log(`✅ [${isMobile ? '手機' : '筆電'}] 已更新 localGPS (精度: ${acc.toFixed(2)}m)`)

      // ✅ 只有手機才執行位置處理和更新
      if (!isMobile) {
        console.log('💻 筆電不處理本地 GPS，等待接收手機 GPS')
        return
      }

      console.log('📱 手機處理本地 GPS...')

      // ✅ 新增：如果精度過差，顯示警告但仍繼續處理（讓 handlePoorAccuracy 決定）
      if (acc > 500) {
        console.warn(`⚠️ GPS 精度過低 (${acc.toFixed(2)}m)，可能使用了網路定位而非 GPS`)
      }

      // 處理精度太差的情況
      const positionToUse = handlePoorAccuracy(lat, lon, acc)
      if (positionToUse === null) {
        return
      }
      
      const [useLat, useLon] = positionToUse

      // 檢查是否為有效移動
      if (!isValidMovement(useLat, useLon)) {
        return
      }

      // 更新移動狀態
      updateMovementState(useLat, useLon)

      // 平滑位置
      const [smoothedLat, smoothedLon] = smoothPosition(useLat, useLon, 0.3)

      // 用最近的已知點來輕微校正位置
      const [adjustedLat, adjustedLon] = adjustPosition(smoothedLat, smoothedLon, acc)
      
      if (adjustedLat !== smoothedLat || adjustedLon !== smoothedLon) {
        const offset = calcDistance(smoothedLat, smoothedLon, adjustedLat, adjustedLon)
        console.log(`📏 校正偏移量: ${offset.toFixed(2)} 公尺`)
      }

      // 用校正後的座標做 ENU 轉換
      const [east, north, up] = latLonToENU(adjustedLat, adjustedLon, alt, origin, rotation)

      const safeY = Math.max(up * scale, 10)

      console.log('📱 手機更新設備位置')
      upsertRef.current({
        id: "user",
        role: "user",
        position_x: east * scale,
        position_y: safeY,
        position_z: north * scale,
      })

      // 強制更新面板顯示
      forceUpdate({})
    }

    // ✅ 修改：增加超時時間到 30 秒，給 GPS 更多時間啟動
    const geoOptions = {
      enableHighAccuracy: true,  // 強制使用高精度（GPS）
      timeout: 30000,            // 增加超時時間到 30 秒
      maximumAge: 0              // 不使用緩存的位置
    }

    // ✅ 新增：初始定位前顯示提示
    setLocationStatus("📡 正在獲取 GPS 信號，請稍候...")

    // 初始定位
    navigator.geolocation.getCurrentPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 初始定位失敗：", err.code, err.message)
        
        // ✅ 根據錯誤類型顯示不同提示
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

    // 持續監聽
    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 定位更新失敗：", err.code, err.message)
        
        // ✅ 持續監聽時的錯誤處理
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
  }, [origin, scale, rotation, isMobile])

  // ✅ 筆電專用：使用 syncedGPS 更新設備位置
  useEffect(() => {
    // 只有筆電才執行
    if (isMobile) {
      console.log('📱 手機不需要使用 syncedGPS')
      return
    }

    if (syncedGPS.lat === 0 && syncedGPS.lon === 0) {
      console.log('💻 筆電等待手機 GPS...')
      return
    }

    console.log("💻 筆電使用手機的 syncedGPS 更新設備位置：", syncedGPS)

    // ✅ 更新筆電的精度參考值
    if (syncedGPS.accuracy !== undefined && syncedGPS.accuracy !== 999) {
      lastReliablePositionRef.current.accuracy = syncedGPS.accuracy
      lastReliablePositionRef.current.lat = syncedGPS.lat
      lastReliablePositionRef.current.lon = syncedGPS.lon
      console.log(`💻 筆電更新精度: ${syncedGPS.accuracy.toFixed(2)}m`)
    }

    // GPS → ENU 轉換
    const [east, north, up] = latLonToENU(
      syncedGPS.lat,
      syncedGPS.lon,
      syncedGPS.alt,
      origin,
      rotation
    )

    const safeY = Math.max(up * scale, 10)

    console.log('💻 筆電更新藍色球位置')
    upsertRef.current({
      id: "user",
      role: "user",
      position_x: east * scale,
      position_y: safeY,
      position_z: north * scale,
    })

    // 強制更新面板顯示
    forceUpdate({})
  }, [syncedGPS, origin, scale, rotation, isMobile])

  // ✅ 即時數據面板
  return (
    <>
      {/* GPS 狀態 */}
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
      
      {/* ✅ 即時數據面板 - 顯示同步的 GPS 資料 */}
      <div style={{
        position: 'fixed',
        top: '70px',
        left: '10px',
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#00ff00',
        padding: '15px',
        borderRadius: '5px',
        zIndex: 1000,
        fontSize: '12px',
        fontFamily: 'monospace',
        border: '1px solid #00ff00',
        minWidth: '250px'
      }}>
        <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
          🛰️ 數位孿生監控 {isMobile ? '📱' : '💻'}
        </div>
        <div>設備: {isMobile ? '手機' : '筆電'}</div>
        {/* ✅ 顯示同步的 GPS 資料 */}
        <div>緯度: {(isMobile ? localGPS.lat : syncedGPS.lat).toFixed(6)}°</div>
        <div>經度: {(isMobile ? localGPS.lon : syncedGPS.lon).toFixed(6)}°</div>
        <div>精度: {(isMobile ? localGPS.accuracy : syncedGPS.accuracy).toFixed(2)}m</div>
        <div>移動狀態: {isMovingRef.current ? '🟢 移動中' : '🔴 靜止'}</div>
        <div>基準點: {points.length > 0 ? `✅ ${points.length} 個` : '❌ 未載入'}</div>
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#888' }}>
          最後更新: {new Date().toLocaleTimeString()}
        </div>
      </div>
    </>
  )
}