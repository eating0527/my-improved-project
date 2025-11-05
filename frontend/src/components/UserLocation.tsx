import { useEffect, useRef, useState } from "react"
import { latLonToENU } from "../utils/geo"
import points from "../data/points.json"

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
    const timeDiff = (now - lastPos.time) / 1000 // 秒
    
    if (timeDiff === 0) return false
    
    const speed = distance / timeDiff // 公尺/秒
    
    // 如果速度超過 30 m/s (108 km/h)，可能是誤差
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
    
    // 指數移動平均
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
    
    if (distance > 5) { // 移動超過 5 公尺
      isMovingRef.current = true
      lastMovementTimeRef.current = Date.now()
    } else if (Date.now() - lastMovementTimeRef.current > 5000) { // 5 秒內沒有移動
      isMovingRef.current = false
    }
  }

  // 根據最近的已知點調整位置（輕微校正）
  function adjustPosition(lat: number, lon: number, accuracy: number): [number, number] {
    const threshold = 100 // 只考慮 100 公尺內的點
    
    const nearbyPoints = points
      .map(pt => ({
        ...pt,
        distance: calcDistance(pt.lat, pt.lon, lat, lon),
      }))
      .filter(pt => pt.distance <= threshold)
      .sort((a, b) => a.distance - b.distance) // 按距離排序

    // 如果沒有足夠接近的已知點，使用原始座標
    if (nearbyPoints.length === 0) {
      console.log("ℹ️ 沒有找到附近的已知點，使用原始 GPS 座標")
      return [lat, lon]
    }

    // 顯示最近的點
    console.log(`📍 最近的點: ${nearbyPoints[0].name}, 距離: ${nearbyPoints[0].distance.toFixed(2)} 公尺`)
    
    // 如果最近點距離超過 50 公尺，直接使用原始 GPS 定位
    if (nearbyPoints[0].distance > 50) {
      console.log("ℹ️ 最近點距離較遠，使用原始 GPS 座標")
      return [lat, lon]
    }

    // 如果 GPS 精度很高（< 15m）且非常接近已知點（< 5m），直接使用該點
    if (accuracy < 15 && nearbyPoints[0].distance < 5) {
      console.log(`✅ GPS 精度高且距離非常近，使用 ${nearbyPoints[0].name} 的座標`)
      return [nearbyPoints[0].lat, nearbyPoints[0].lon]
    }

    // 使用加權平均計算校正後的座標（最多使用前 3 個最近點）
    const topPoints = nearbyPoints.slice(0, 3)
    let sumLat = 0
    let sumLon = 0
    let weightSum = 0

    topPoints.forEach(pt => {
      const weight = 1 / (pt.distance + 1) // 距離越近，權重越大（+1 避免除以 0）
      sumLat += pt.lat * weight
      sumLon += pt.lon * weight
      weightSum += weight
    })

    const correctedLat = sumLat / weightSum
    const correctedLon = sumLon / weightSum

    // 根據距離、精度和移動狀態，決定校正的比例
    let correctionRatio = 0
    
    // 基於距離的校正比例
    if (nearbyPoints[0].distance < 20) {
      correctionRatio = Math.min(0.3, (20 - nearbyPoints[0].distance) / 20 * 0.3) // 最多 30% 校正
    }
    
    // 如果精度低，降低校正比例
    if (accuracy > 50) {
      correctionRatio = Math.min(correctionRatio, 0.1)
    }
    
    // 如果靜止不動，增加校正比例以減少漂移
    if (!isMovingRef.current && nearbyPoints[0].distance < 30) {
      correctionRatio = Math.min(0.5, correctionRatio * 1.5)
      console.log("🛑 靜止狀態，增加校正比例以減少漂移")
    }

    // 混合原始 GPS 定位和校正後的座標
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
    
    // 首次定位時，降低精度要求到 300m
    const accuracyThreshold = isFirstLocation ? 300 : 150
    
    if (accuracy > accuracyThreshold) {
      poorAccuracyCountRef.current += 1
      
      console.warn(`❌ GPS 精度太差 (${accuracy.toFixed(2)}m)，第 ${poorAccuracyCountRef.current} 次`)
      
      // 首次定位時，即使精度差也要先建立位置（給用戶一些反饋）
      if (isFirstLocation && poorAccuracyCountRef.current <= 3) {
        console.log(`🔰 首次定位，即使精度差也先使用 (${accuracy.toFixed(2)}m)`)
        setLocationStatus(`🔰 首次定位中... (精度: ${accuracy.toFixed(0)}m，持續改善中)`)
        lastReliablePositionRef.current = { lat, lon, accuracy }
        return [lat, lon]
      }
      
      // 如果連續多次精度都太差
      if (poorAccuracyCountRef.current >= 5) {
        if (lastReliable.lat !== 0) {
          console.log(`🔄 使用上次的位置 (精度: ${lastReliable.accuracy.toFixed(2)}m)`)
          setLocationStatus("⚠️ GPS 信號差，使用已知位置")
          return [lastReliable.lat, lastReliable.lon]
        } else {
          // 完全沒有可用位置，嘗試使用預設位置
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
      // 精度可接受，重置計數器
      poorAccuracyCountRef.current = 0
      
      // 更新可靠位置
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

      console.log("📍 GPS 原始定位：", { lat, lon, alt, acc: `${acc.toFixed(2)}m` })

      // 處理精度太差的情況
      const positionToUse = handlePoorAccuracy(lat, lon, acc)
      if (positionToUse === null) {
        return // 精度太差且沒有可靠位置，跳過此次更新
      }
      
      const [useLat, useLon] = positionToUse

      // 檢查是否為有效移動
      if (!isValidMovement(useLat, useLon)) {
        return // 忽略異常的定位更新
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

      upsertRef.current({
        id: "user",
        role: "user",
        position_x: east * scale,
        position_y: safeY,
        position_z: north * scale,
      })

      // ✅ 強制更新面板顯示
      forceUpdate({})
    }

    // 初始定位
    navigator.geolocation.getCurrentPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 初始定位失敗：", err)
        setLocationStatus("❌ 定位失敗，請檢查定位權限")
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )

    // 持續監聽
    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 定位更新失敗：", err)
        setLocationStatus("❌ 定位更新失敗")
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [origin, scale, rotation])

  // ✅ 新增：即時數據面板
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
      
      {/* ✅ 新增：即時數據面板 */}
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
          🛰️ 數位孿生監控
        </div>
        <div>緯度: {lastReliablePositionRef.current.lat.toFixed(6)}°</div>
        <div>經度: {lastReliablePositionRef.current.lon.toFixed(6)}°</div>
        <div>精度: {lastReliablePositionRef.current.accuracy.toFixed(2)}m</div>
        <div>移動狀態: {isMovingRef.current ? '🟢 移動中' : '🔴 靜止'}</div>
        <div style={{ marginTop: '8px', fontSize: '10px', color: '#888' }}>
          最後更新: {new Date().toLocaleTimeString()}
        </div>
      </div>
    </>
  )
}