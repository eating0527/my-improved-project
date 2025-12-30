import { useEffect, useRef, useState, useMemo, useCallback } from "react"
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
}

// GPS 資料的完整型別定義
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
  const [uavPosition, setUavPosition] = useState<[number, number, number]>([0, 10, 0])
  const [localSelectedDeviceId, setLocalSelectedDeviceId] = useState<string | null>(null)
  
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempName, setTempName] = useState("")
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
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
  } = useGPSSync(localGPS)
  
  const prevDevicesRef = useRef<Set<string>>(new Set())
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const allDevicesUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  useEffect(() => {
    setTempName(deviceName)
  }, [deviceName])
  
  useEffect(() => {
    if (myDeviceId && onMyDeviceIdUpdate) {
      console.log('📱 通知父組件當前裝置 ID:', myDeviceId.substring(0, 8))
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
  
  // 🔥 我已經幫你刪除了那個會誤殺裝置的 useEffect
  
  // 處理裝置斷線 (這是正確的邏輯，保留)
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

  // --- 監聽 allDevices 變化，向上傳遞給 App ---
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
  }) 
  
  // --- 更新多裝置位置 ---
  useEffect(() => {
    if (!onMultiDevicePositionUpdate) return
    if (allDevices.size === 0) return

    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current)
    }

    updateTimeoutRef.current = setTimeout(() => {
      allDevices.forEach((device, deviceId) => {
        if (device.lat === 0 && device.lon === 0) return

        const [east, north, up] = latLonToENU(
          device.lat,
          device.lon,
          device.alt,
          origin,
          rotation
        )

        const safeY = Math.max(up * scale, 10)
        const position: [number, number, number] = [east * scale, safeY, north * scale]

        onMultiDevicePositionUpdate(
          deviceId,
          position,
          device.lat,
          device.lon,
          device.accuracy,
          device.deviceName,
          device.alt
        )
      })
    }, 300) 

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }) 

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

  useEffect(() => {
    if (!onUAVPositionUpdate) return
    
    const gpsPos = selectedGPS
    if (gpsPos.lat === 0 && gpsPos.lon === 0) return
    if (gpsPos.accuracy > 500) return
    
    const gpsData = {
      lat: gpsPos.lat,
      lon: gpsPos.lon,
      altitude: gpsPos.alt
    }
    
    onUAVPositionUpdate(uavPosition, gpsData)
  }, [uavPosition, onUAVPositionUpdate, selectedGPS, isMobile, selectedDeviceId])

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

  useEffect(() => {
    if (photoUploadEvent) {
      setCurrentPhoto(photoUploadEvent.url)
    }
  }, [photoUploadEvent])

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

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("❌ 瀏覽器不支援定位功能")
      return
    }

    const updatePosition = (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      const alt = pos.coords.altitude ?? 0
      const acc = pos.coords.accuracy

      setLocalGPS({ lat, lon, alt, accuracy: acc })

      if (!isMobile) return

      if (acc > 500) console.warn(`⚠️ GPS 精度過低 (${acc.toFixed(2)}m)`)

      const positionToUse = handlePoorAccuracy(lat, lon, acc)
      if (positionToUse === null) return
      
      const [useLat, useLon] = positionToUse
      if (!isValidMovement(useLat, useLon)) return

      updateMovementState(useLat, useLon)
      const [smoothedLat, smoothedLon] = smoothPosition(useLat, useLon, 0.3)
      const [adjustedLat, adjustedLon] = adjustPosition(smoothedLat, smoothedLon, acc)
      const [east, north, up] = latLonToENU(adjustedLat, adjustedLon, alt, origin, rotation)
      const safeY = Math.max(up * scale, 10)
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
  }, [origin, scale, rotation, isMobile, onPathUpdate])

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

    const [east, north, up] = latLonToENU(
      selectedGPS.lat,
      selectedGPS.lon,
      selectedGPS.alt,
      origin,
      rotation
    )

    const safeY = Math.max(up * scale, 10)
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
      
      <div style={{
        position: 'fixed', top: '60px', left: '1px', background: 'rgba(0, 0, 0, 0.8)',
        color: '#00ff00', padding: '15px', borderRadius: '5px', zIndex: 1000,
        fontSize: '11px', fontFamily: 'monospace', border: '1px solid #00ff00', minWidth: '250px'
      }}>
        <div style={{ marginBottom: '10px', fontSize: '14px', fontWeight: 'bold' }}>
          🚁 數位孿生監控 {isMobile ? '📱' : '💻'}
        </div>
        
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
        <div>誤差範圍: {selectedGPS.accuracy.toFixed(2)}m</div>
        <div>移動狀態: {isMovingRef.current ? '🟢 移動中' : '🔴 靜止'}</div>
        <div>基準點: {points.length > 0 ? `📡 ${points.length} 個` : '❌ 未載入'}</div>
        
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

      <PhotoHistory onPhotoClick={(url) => setCurrentPhoto(url)} photoDeleteEvent={photoDeleteEvent} />
      <PhotoViewer photoUrl={currentPhoto} onClose={handleClosePhoto} autoCloseTime={10000} />
    </>
  )
}