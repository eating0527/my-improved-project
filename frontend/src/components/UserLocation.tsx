import { useEffect, useRef, useState, useMemo } from "react"
import { latLonToENU } from "../utils/geo"
import points from "../data/points.json"
import { useGPSSync } from "../hooks/useGPSSync"
// ✅ 引入 Witmotion Hook
import { useWitmotion } from "../hooks/useWitmotion"
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
  onMultiDevicePositionUpdate?: (
    deviceId: string,
    position: [number, number, number],
    lat: number,
    lon: number,
    accuracy: number,
    deviceName?: string,
    alt?: number
  ) => void
  onMyDeviceIdUpdate?: (deviceId: string) => void
  onDeviceDisconnected?: (deviceId: string) => void
  selectedDeviceId?: string | null
  onSelectedDeviceIdChange?: (deviceId: string) => void
  onAllDevicesUpdate?: (devices: Map<string, any>) => void
  onPhotoReceived?: (photoData: any) => void
  photos?: Array<{
    url: string
    timestamp: string
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
    deviceId?: string
  }>
}

interface GPSData {
  lat: number
  lon: number
  alt: number
  accuracy: number
  deviceName?: string
  timestamp?: number
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
  onMultiDevicePositionUpdate,
  onMyDeviceIdUpdate,
  onDeviceDisconnected,
  selectedDeviceId: propSelectedDeviceId,
  onSelectedDeviceIdChange,
  onAllDevicesUpdate,
  onPhotoReceived,
  photos = [],
}: UserLocationProps) {
  const upsertRef = useRef(upsertDevice)
  const [locationStatus, setLocationStatus] = useState<string>("")

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  // 🔥 1. 初始化 Witmotion Hook (新增 manualUnlock 與 debugMsg)
  const { 
    connect: connectWit, 
    witData, 
    status: witStatus, 
    resetHeight, 
    debugMsg,      // 👈 新增：除錯訊息
    manualUnlock   // 👈 新增：手動解鎖函式
  } = useWitmotion();

  const [localGPS, setLocalGPS] = useState({
    lat: 0,
    lon: 0,
    alt: 0,
    accuracy: 999
  })

  const [currentPhoto, setCurrentPhoto] = useState<string | null>(null)
  const [uavPosition, setUavPosition] = useState<[number, number, number]>([0, 10, 0])
  const [localSelectedDeviceId, setLocalSelectedDeviceId] = useState<string | null>(null)

  const [isEditingName, setIsEditingName] = useState(false)
  const [tempName, setTempName] = useState("")

  // 🔥 2. 決定要上傳給別人的高度
  const altitudeToSend = isMobile ? witData.height : 0;

  const {
    myDeviceId,
    deviceName,
    updateDeviceName,
    allDevices,
    myGPS,
    clearPathTrigger,
    sendClearPath,
    photoUploadEvent,
    photoDeleteEvent
  } = useGPSSync(localGPS, altitudeToSend)

  const prevDevicesRef = useRef<Set<string>>(new Set())
  const allDevicesUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 照片 ID 處理
  useEffect(() => {
    if (photoUploadEvent) {
      const rawEvent = photoUploadEvent as any;
      const incomingId = rawEvent.deviceId || rawEvent.device_id || rawEvent.senderId;
      setCurrentPhoto(photoUploadEvent.url)
      if (onPhotoReceived) {
        onPhotoReceived({
          ...photoUploadEvent,
          deviceId: incomingId
        })
      }
    }
  }, [photoUploadEvent, onPhotoReceived, myDeviceId])

  // 監聽照片刪除
  useEffect(() => {
    if (photoDeleteEvent && onPhotoReceived) {
      onPhotoReceived({ ...photoDeleteEvent, type: 'photo_deleted' })
    }
  }, [photoDeleteEvent, onPhotoReceived])

  useEffect(() => {
    setTempName(deviceName)
  }, [deviceName])

  useEffect(() => {
    if (myDeviceId && onMyDeviceIdUpdate) {
      onMyDeviceIdUpdate(myDeviceId)
    }
  }, [myDeviceId, onMyDeviceIdUpdate])

  useEffect(() => {
    if (propSelectedDeviceId) {
      setLocalSelectedDeviceId(propSelectedDeviceId)
    }
  }, [propSelectedDeviceId])

  useEffect(() => {
    if (myDeviceId && !propSelectedDeviceId && !localSelectedDeviceId) {
      setLocalSelectedDeviceId(myDeviceId)
      if (onSelectedDeviceIdChange) {
        onSelectedDeviceIdChange(myDeviceId)
      }
    }
  }, [myDeviceId, propSelectedDeviceId, localSelectedDeviceId, onSelectedDeviceIdChange])

  const selectedDeviceId = propSelectedDeviceId || localSelectedDeviceId

  // 處理裝置斷線
  useEffect(() => {
    const currentDeviceIds = new Set(allDevices.keys())
    const prevDeviceIds = prevDevicesRef.current

    if (prevDeviceIds.size === 0 && currentDeviceIds.size > 0) {
      prevDevicesRef.current = currentDeviceIds
      return
    }

    const disconnectedDevices: string[] = []
    prevDeviceIds.forEach(deviceId => {
      if (!currentDeviceIds.has(deviceId)) {
        disconnectedDevices.push(deviceId)
      }
    })

    if (disconnectedDevices.length > 0 && onDeviceDisconnected) {
      disconnectedDevices.forEach(deviceId => {
        onDeviceDisconnected(deviceId)
      })
    }

    prevDevicesRef.current = currentDeviceIds
  }, [allDevices, onDeviceDisconnected])

  // 監聽 allDevices 變化
  useEffect(() => {
    if (!onAllDevicesUpdate) return
    if (allDevices.size === 0) return

    if (allDevicesUpdateTimeoutRef.current) {
      clearTimeout(allDevicesUpdateTimeoutRef.current)
    }

    allDevicesUpdateTimeoutRef.current = setTimeout(() => {
      onAllDevicesUpdate(new Map(allDevices))
    }, 100)

    return () => {
      if (allDevicesUpdateTimeoutRef.current) clearTimeout(allDevicesUpdateTimeoutRef.current)
    }
  }, [allDevices, onAllDevicesUpdate])

  // --- 多裝置位置即時更新 (更新 3D 場景上的點 - 給電腦版看) ---
  useEffect(() => {
    if (!onMultiDevicePositionUpdate) return
    if (allDevices.size === 0) return

    allDevices.forEach((device, deviceId) => {
      if (device.lat === 0 && device.lon === 0) return

      let effectiveAlt = device.alt || 0;

      const [east, north, up] = latLonToENU(
        device.lat,
        device.lon,
        effectiveAlt,
        origin,
        rotation
      )

      const safeY = effectiveAlt * scale 
      
      const position: [number, number, number] = [east * scale, safeY, north * scale]

      onMultiDevicePositionUpdate(
        deviceId,
        position,
        device.lat,
        device.lon,
        device.accuracy,
        device.deviceName,
        effectiveAlt
      )
    })

  }, [allDevices, onMultiDevicePositionUpdate, origin, rotation, scale])

  // 計算 selectedGPS
  const selectedGPS = useMemo<GPSData>(() => {
    if (isMobile) {
      return {
        lat: myGPS.lat,
        lon: myGPS.lon,
        alt: myGPS.alt,
        accuracy: myGPS.accuracy,
        deviceName: deviceName || '我的裝置',
        timestamp: Date.now()
      }
    }

    if (selectedDeviceId) {
      const device = allDevices.get(selectedDeviceId)
      if (device) {
        return {
          lat: device.lat,
          lon: device.lon,
          alt: device.alt,
          accuracy: device.accuracy,
          deviceName: device.deviceName,
          timestamp: device.timestamp
        }
      } else {
        const firstDevice = allDevices.values().next()
        if (!firstDevice.done) {
          const firstDeviceId = Array.from(allDevices.keys())[0]
          setLocalSelectedDeviceId(firstDeviceId)
          if (onSelectedDeviceIdChange) {
            onSelectedDeviceIdChange(firstDeviceId)
          }
          return {
            lat: firstDevice.value.lat,
            lon: firstDevice.value.lon,
            alt: firstDevice.value.alt,
            accuracy: firstDevice.value.accuracy,
            deviceName: firstDevice.value.deviceName,
            timestamp: firstDevice.value.timestamp
          }
        }
      }
    }

    return {
      lat: myGPS.lat,
      lon: myGPS.lon,
      alt: myGPS.alt,
      accuracy: myGPS.accuracy,
      deviceName: '本地 GPS',
      timestamp: Date.now()
    }
  }, [selectedDeviceId, allDevices, myGPS, isMobile, deviceName, onSelectedDeviceIdChange])

  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  // --- 更新 UAV 位置 ---
  useEffect(() => {
    if (!onUAVPositionUpdate) return

    const gpsPos = selectedGPS
    if (gpsPos.lat === 0 && gpsPos.lon === 0) return
    if (gpsPos.accuracy > 500) return

    let finalAlt = 0;
    if (isMobile) {
      finalAlt = witData.height;
    } else {
      finalAlt = (gpsPos.alt || 0);
    }

    const gpsData = {
      lat: gpsPos.lat,
      lon: gpsPos.lon,
      altitude: finalAlt
    }

    onUAVPositionUpdate(uavPosition, gpsData)
  }, [uavPosition, onUAVPositionUpdate, selectedGPS, isMobile, selectedDeviceId, witData.height])

  // (演算法相關變數)
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
      lastProcessedGPSRef.current = { lat: 0, lon: 0 }
      onClearPath()
    }
  }, [clearPathTrigger, onClearPath])

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
    if (speed > 30) return false
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

    if (nearbyPoints.length === 0) return [lat, lon]
    if (nearbyPoints[0].distance > 50) return [lat, lon]

    if (accuracy < 15 && nearbyPoints[0].distance < 5) {
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
    }

    const adjustedLat = lat * (1 - correctionRatio) + correctedLat * correctionRatio
    const adjustedLon = lon * (1 - correctionRatio) + correctedLon * correctionRatio

    return [adjustedLat, adjustedLon]
  }

  function getGPSQualityStatus(accuracy: number): string {
    if (accuracy < 20) return "✅ GPS 精度：優秀"
    else if (accuracy < 50) return "⚠️ GPS 精度：良好"
    else if (accuracy < 100) return "⚠️ GPS 精度：一般"
    else return "❌ GPS 精度：較差"
  }

  function handlePoorAccuracy(lat: number, lon: number, accuracy: number): [number, number] | null {
    const lastReliable = lastReliablePositionRef.current
    const isFirstLocation = lastReliable.lat === 0
    const accuracyThreshold = isFirstLocation ? 500 : 150

    if (accuracy > accuracyThreshold) {
      poorAccuracyCountRef.current += 1
      if (isFirstLocation && poorAccuracyCountRef.current <= 5) {
        setLocationStatus(`⚠️ GPS 精度較差 (${accuracy.toFixed(0)}m)，正在改善中...`)
        lastReliablePositionRef.current = { lat, lon, accuracy }
        return [lat, lon]
      }
      if (poorAccuracyCountRef.current >= 5) {
        if (lastReliable.lat !== 0) {
          setLocationStatus("⚠️ GPS 信號差，使用已知位置")
          return [lastReliable.lat, lastReliable.lon]
        } else {
          if (points.length > 0) {
            setLocationStatus(`🏢 GPS 信號太差，暫時使用 ${points[0].name} 作為參考位置`)
            const defaultLat = points[0].lat
            const defaultLon = points[0].lon
            lastReliablePositionRef.current = { lat: defaultLat, lon: defaultLon, accuracy: 999 }
            return [defaultLat, defaultLon]
          }
          setLocationStatus("❌ 無法定位，請移動到空曠處或檢查定位權限")
          return null
        }
      }
    } else {
      poorAccuracyCountRef.current = 0
      if (accuracy < lastReliable.accuracy || isFirstLocation) {
        lastReliablePositionRef.current = { lat, lon, accuracy }
      }
      setLocationStatus(getGPSQualityStatus(accuracy))
    }
    return [lat, lon]
  }

  // --- 🔥 手機/本地 GPS 更新 ---
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("❌ 瀏覽器不支援定位功能")
      return
    }

    const updatePosition = (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      const rawAlt = pos.coords.altitude ?? 0
      const acc = pos.coords.accuracy

      setLocalGPS({ lat, lon, alt: rawAlt, accuracy: acc })

      if (!isMobile) return

      if (acc > 500) console.warn(`⚠️ GPS 精度過低 (${acc.toFixed(2)}m)`)

      // --- 1. 水平處理 (Horizontal) ---
      const positionToUse = handlePoorAccuracy(lat, lon, acc)
      if (positionToUse === null) return

      const [useLat, useLon] = positionToUse
      if (!isValidMovement(useLat, useLon)) return

      updateMovementState(useLat, useLon)
      const [smoothedLat, smoothedLon] = smoothPosition(useLat, useLon, 0.3)
      const [adjustedLat, adjustedLon] = adjustPosition(smoothedLat, smoothedLon, acc)

      // --- 2. 感測器融合 (Sensor Fusion) ---
      const [east, north, _ignoredUp] = latLonToENU(
        adjustedLat,
        adjustedLon,
        origin.alt,
        origin,
        rotation
      )

      // B. 垂直座標：🔥 來自 Witmotion
      const safeY = witData.height * scale

      // C. 組合
      const newPosition: [number, number, number] = [east * scale, safeY, north * scale]
      setUavPosition(newPosition)

      // D. 上傳
      upsertRef.current({
        id: "user",
        role: "user",
        position_x: east * scale,
        position_y: safeY,
        position_z: north * scale,
      })

      if (onPathUpdate) {
        onPathUpdate({ x: east * scale, y: safeY, z: north * scale })
      }

      forceUpdate({})
    }

    const geoOptions = { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    setLocationStatus("📡 正在獲取 GPS 信號，請稍候...")

    navigator.geolocation.getCurrentPosition(
      updatePosition,
      (err) => {
        if (err.code === 1) setLocationStatus("❌ 定位權限被拒絕，請允許定位權限")
        else if (err.code === 2) setLocationStatus("❌ 無法獲取位置")
        else if (err.code === 3) setLocationStatus("⚠️ 定位超時，重試中...")
        else setLocationStatus("❌ 定位失敗")
      },
      geoOptions
    )

    const watchId = navigator.geolocation.watchPosition(updatePosition, () => {}, geoOptions)
    return () => navigator.geolocation.clearWatch(watchId)
  }, [origin, scale, rotation, isMobile, onPathUpdate, witData.height])

  // --- 筆電/遠端 GPS 更新 ---
  useEffect(() => {
    if (isMobile) return
    if (selectedGPS.lat === 0 && selectedGPS.lon === 0) return
    if (selectedGPS.accuracy > 500) return

    const lastProcessed = lastProcessedGPSRef.current
    const distanceFromLast = calcDistance(
      lastProcessed.lat,
      lastProcessed.lon,
      selectedGPS.lat,
      selectedGPS.lon
    )

    if (distanceFromLast < 0.5 && lastProcessed.lat !== 0) return

    lastProcessedGPSRef.current = { lat: selectedGPS.lat, lon: selectedGPS.lon }

    if (selectedGPS.accuracy !== undefined && selectedGPS.accuracy !== 999) {
      lastReliablePositionRef.current.accuracy = selectedGPS.accuracy
      lastReliablePositionRef.current.lat = selectedGPS.lat
      lastReliablePositionRef.current.lon = selectedGPS.lon
    }

    const effectiveAlt = (selectedGPS.alt || 0);

    const [east, north, up] = latLonToENU(
      selectedGPS.lat,
      selectedGPS.lon,
      effectiveAlt,
      origin,
      rotation
    )

    const safeY = effectiveAlt * scale
    const newPosition: [number, number, number] = [east * scale, safeY, north * scale]
    setUavPosition(newPosition)

    upsertRef.current({
      id: "user",
      role: "user",
      position_x: east * scale,
      position_y: safeY,
      position_z: north * scale,
    })

    if (onPathUpdate) {
      onPathUpdate({ x: east * scale, y: safeY, z: north * scale })
    }

    forceUpdate({})
  }, [selectedGPS, origin, scale, rotation, isMobile, onPathUpdate, selectedDeviceId])

  const handleClearPath = () => {
    lastProcessedGPSRef.current = { lat: 0, lon: 0 }
    if (onClearPath) onClearPath()
    sendClearPath()
  }

  const handleClosePhoto = () => {
    setCurrentPhoto(null)
  }

  return (
    <>
      {locationStatus && (
        <div style={{
          position: 'fixed', top: '10px', left: '10px', background: 'rgba(0, 0, 0, 0.7)',
          color: 'white', padding: '10px', borderRadius: '5px', zIndex: 1000, fontSize: '14px', maxWidth: '300px'
        }}>
          {locationStatus}
        </div>
      )}

      {/* 🔥🔥🔥 數位孿生監控 + Witmotion 面板 🔥🔥🔥 */}
      <div style={{
        position: 'fixed', top: '60px', left: '1px', background: 'rgba(0, 0, 0, 0.85)',
        color: '#00ff00', padding: '15px', borderRadius: '8px', zIndex: 1000,
        fontSize: '11px', fontFamily: 'monospace', border: '1px solid #00ff00', minWidth: '250px',
        boxShadow: '0 0 10px rgba(0, 255, 0, 0.2)'
      }}>
        <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
          🚁 數位孿生監控 {isMobile ? '📱' : '💻'}
        </div>

        {/* 裝置 ID 與名稱編輯 */}
        <div style={{
          marginBottom: '10px', padding: '8px', background: 'rgba(0, 191, 255, 0.1)',
          borderRadius: '3px', border: '1px solid #00BFFF'
        }}>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '3px' }}>
            裝置 ID: {myDeviceId?.substring(0, 12)}
          </div>

          {isEditingName ? (
            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                style={{
                  flex: 1, padding: '3px 5px', background: '#222', border: '1px solid #00ff00',
                  color: '#00ff00', borderRadius: '3px', fontSize: '11px', fontFamily: 'monospace'
                }}
                maxLength={20}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { updateDeviceName(tempName); setIsEditingName(false); }
                  else if (e.key === 'Escape') { setTempName(deviceName); setIsEditingName(false); }
                }}
              />
              <button onClick={() => { updateDeviceName(tempName); setIsEditingName(false); }} style={{ padding: '3px 8px', background: '#00ff00', color: 'black', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>✓</button>
              <button onClick={() => { setTempName(deviceName); setIsEditingName(false); }} style={{ padding: '3px 8px', background: '#ff4444', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '3px' }} onClick={() => { setIsEditingName(true); setTempName(deviceName); }}>
              <span style={{ fontSize: '12px', color: '#00BFFF', fontWeight: 'bold' }}>{deviceName}</span>
              <span style={{ fontSize: '10px', color: '#888' }}>✏️ 編輯</span>
            </div>
          )}
        </div>

        <div>設備: {isMobile ? '手機' : `筆電 ${selectedDeviceId ? `(使用: ${selectedGPS.deviceName || '未知裝置'})` : '(未選擇裝置)'}`}</div>
        <div>緯度: {selectedGPS.lat.toFixed(6)}°</div>
        <div>經度: {selectedGPS.lon.toFixed(6)}°</div>
        <div>誤差: {selectedGPS.accuracy.toFixed(2)}m</div>
        {/* 顯示高度 */}
        <div>高度: {(isMobile ? witData.height : (selectedGPS.alt || 0)).toFixed(2)}m</div>

        {/* 🔥🔥🔥 Witmotion 專屬區塊 (只在手機上顯示) 🔥🔥🔥 */}
        {isMobile && (
          <div style={{
            marginTop: '8px', padding: '8px',
            background: 'rgba(0, 123, 255, 0.15)', borderRadius: '5px',
            borderLeft: '3px solid #007BFF'
          }}>
            <div style={{ fontSize: '10px', color: '#007BFF', marginBottom: '2px', display: 'flex', justifyContent: 'space-between' }}>
              <span>WITMOTION 傳感器</span>
              <span style={{ color: witStatus.includes("成功") || witStatus.includes("數據") ? '#00ff00' : 'orange' }}>{witStatus}</span>
            </div>

            {/* 連線按鈕 */}
            {!witStatus.includes("成功") && !witStatus.includes("數據") && (
              <button
                onClick={connectWit}
                style={{
                  width: '100%', padding: '5px', margin: '5px 0',
                  background: '#007bff', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontWeight: 'bold'
                }}
              >
                🔗 連接藍牙 (Connect)
              </button>
            )}

            <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'white' }}>
              H: {witData.height.toFixed(2)} m
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#ccc', marginTop: '4px' }}>
              <span>Yaw: {witData.yaw.toFixed(1)}°</span>
              <span>Pitch: {witData.pitch.toFixed(1)}°</span>
            </div>

            {/* 歸零按鈕 */}
            <button
              onClick={resetHeight}
              style={{
                marginTop: '6px', width: '100%', padding: '5px',
                background: 'linear-gradient(90deg, #FF9500, #FFCC00)',
                border: 'none', borderRadius: '3px',
                color: 'black', fontWeight: 'bold', cursor: 'pointer',
                fontSize: '11px'
              }}
            >
              📍 高度歸零 (SET ZERO)
            </button>

            {/* 🔥 新增：手動解鎖按鈕 (急救用) */}
            {witStatus.includes("成功") && (
              <button
                onClick={manualUnlock}
                style={{
                  width: '100%', padding: '5px', margin: '5px 0',
                  background: '#6c757d', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px'
                }}
              >
                🔓 重發解鎖指令 (Fix Unlock)
              </button>
            )}

            {/* 🔥 新增：除錯訊息顯示 */}
            <div style={{ 
              marginTop: '8px', fontSize: '10px', color: 'yellow', 
              borderTop: '1px dashed #666', paddingTop: '4px',
              wordBreak: 'break-all' 
            }}>
              DEBUG: {debugMsg || "等待操作..."}
            </div>

          </div>
        )}

        <div style={{ marginTop: '8px' }}>基準點: {points.length > 0 ? `📡 ${points.length} 個` : '❌ 未載入'}</div>

        {!isMobile && (
          <div>可用裝置: {Array.from(allDevices.values()).filter(d => d.lat !== 0 && d.lon !== 0).length} 台</div>
        )}

        {isMobile && allDevices.size > 0 && (
          <div>連線裝置: {allDevices.size} 台</div>
        )}

        <div style={{ marginTop: '8px', borderTop: '1px solid #00ff00', paddingTop: '8px' }}>
          <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>
            📊 移動軌跡資訊
          </div>
          <div>移動記錄點: {pathLength}</div>
          <div>目前移動距離: {totalDistance.toFixed(2)}m</div>
        </div>

        <button onClick={handleClearPath} style={{ marginTop: '10px', padding: '5px 10px', background: 'rgba(255, 0, 0, 0.7)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '12px', width: '100%' }}>
          🗑️ 清除軌跡
        </button>

        <div style={{ marginTop: '8px', fontSize: '10px', color: '#888' }}>
          最後更新: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <PhotoHistory
        photos={photos}
        onPhotoClick={(url) => setCurrentPhoto(url)}
        photoDeleteEvent={photoDeleteEvent}
      />
      <PhotoViewer photoUrl={currentPhoto} onClose={handleClosePhoto} autoCloseTime={10000} />
    </>
  )
}