import { useEffect, useRef, useState, useMemo } from "react"
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
    deviceName?: string  // ✅ 新增：deviceName 參數
  ) => void
  onMyDeviceIdUpdate?: (deviceId: string) => void
  onDeviceDisconnected?: (deviceId: string) => void
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
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  
  // ✅ 新增：裝置名稱編輯狀態
  const [isEditingName, setIsEditingName] = useState(false)
  const [tempName, setTempName] = useState("")
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  // ✅ 修改：從 useGPSSync 取得 deviceName 和 updateDeviceName
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
  
  // ✅ 追蹤上一次的裝置列表，用於檢測斷線
  const prevDevicesRef = useRef<Set<string>>(new Set())
  
  // ✅ 當 deviceName 變更時，同步 tempName
  useEffect(() => {
    setTempName(deviceName)
  }, [deviceName])
  
  // ✅ 當收到 myDeviceId 時，通知父組件
  useEffect(() => {
    if (myDeviceId && onMyDeviceIdUpdate) {
      console.log('📱 通知父組件當前裝置 ID:', myDeviceId.substring(0, 8))
      onMyDeviceIdUpdate(myDeviceId)
    }
  }, [myDeviceId, onMyDeviceIdUpdate])
  
  // ✅ 自動選擇當前裝置
  useEffect(() => {
    if (myDeviceId && !selectedDeviceId) {
      setSelectedDeviceId(myDeviceId)
      console.log('📱 自動選擇當前裝置:', myDeviceId.substring(0, 8))
    }
  }, [myDeviceId, selectedDeviceId])
  
  // ✅ 關鍵修正：當 myDeviceId 變更時，立即清理舊的裝置資料
  useEffect(() => {
    if (!myDeviceId) {
      return
    }

    // ✅ 檢查是否是重新連線（deviceId 變更）
    const allDeviceIds = Array.from(allDevices.keys())
    const oldDeviceIds = allDeviceIds.filter(id => id !== myDeviceId)

    if (oldDeviceIds.length > 0) {
      console.log('🔄 檢測到重新連線，清理舊裝置:', oldDeviceIds.map(id => id.substring(0, 8)))
      
      // ✅ 通知父組件清理舊裝置
      if (onDeviceDisconnected) {
        oldDeviceIds.forEach(oldId => {
          console.log('🗑️ UserLocation 通知父組件清理舊裝置:', oldId.substring(0, 8))
          onDeviceDisconnected(oldId)
        })
      }
    }
  }, [myDeviceId, allDevices, onDeviceDisconnected])
  
  // ✅ 監聽 allDevices 變化，檢測裝置斷線並通知父組件
  useEffect(() => {
    const currentDeviceIds = new Set(allDevices.keys())
    const prevDeviceIds = prevDevicesRef.current
    
    // ✅ 第一次執行，初始化 prevDevicesRef
    if (prevDeviceIds.size === 0 && currentDeviceIds.size > 0) {
      prevDevicesRef.current = currentDeviceIds
      console.log('🔵 初始化 prevDevicesRef，裝置數:', currentDeviceIds.size)
      return
    }
    
    // ✅ 找出斷線的裝置（在舊列表中但不在新列表中）
    const disconnectedDevices: string[] = []
    prevDeviceIds.forEach(deviceId => {
      if (!currentDeviceIds.has(deviceId)) {
        disconnectedDevices.push(deviceId)
      }
    })
    
    // ✅ 通知父組件清理斷線裝置
    if (disconnectedDevices.length > 0 && onDeviceDisconnected) {
      disconnectedDevices.forEach(deviceId => {
        console.log('🗑️ UserLocation 通知父組件清理斷線裝置:', deviceId.substring(0, 8))
        onDeviceDisconnected(deviceId)
      })
    }
    
    // ✅ 更新 ref
    prevDevicesRef.current = currentDeviceIds
  }, [allDevices, onDeviceDisconnected])
  
  // ✅ 修改：當 allDevices 更新時，通知父組件所有裝置的位置（包含自己 + deviceName）
  useEffect(() => {
    if (!onMultiDevicePositionUpdate) {
      return
    }

    if (allDevices.size === 0) {
      console.log('📱 目前沒有裝置連線')
      return
    }

    console.log(`📱 開始更新 ${allDevices.size} 個裝置的位置（包含自己）`)

    allDevices.forEach((device, deviceId) => {
      // 計算 3D 座標
      const [east, north, up] = latLonToENU(
        device.lat,
        device.lon,
        device.alt,
        origin,
        rotation
      )

      const safeY = Math.max(up * scale, 10)
      const position: [number, number, number] = [east * scale, safeY, north * scale]

      const isMyDevice = deviceId === myDeviceId

      console.log(`📱 通知父組件裝置 ${deviceId.substring(0, 8)} 位置:`, {
        deviceName: device.deviceName,
        position,
        lat: device.lat,
        lon: device.lon,
        accuracy: device.accuracy,
        isMyDevice
      })

      // ✅ 修改：傳遞 deviceName 給父組件
      onMultiDevicePositionUpdate(
        deviceId,
        position,
        device.lat,
        device.lon,
        device.accuracy,
        device.deviceName  // ✅ 新增：傳遞 deviceName
      )
    })

    console.log(`✅ 已更新 ${allDevices.size} 個裝置的位置（包含自己）`)
  }, [allDevices, origin, scale, rotation, onMultiDevicePositionUpdate, myDeviceId])
  
  // ✅ 取得當前選擇的裝置 GPS
  const selectedGPS = useMemo(() => {
    // ✅ 手機永遠使用本地 GPS
    if (isMobile) {
      return myGPS
    }

    // ✅ 筆電：如果有選擇裝置，使用該裝置的 GPS
    if (selectedDeviceId) {
      const device = allDevices.get(selectedDeviceId)
      if (device) {
        console.log('📍 筆電使用選擇的裝置 GPS:', {
          deviceId: selectedDeviceId.substring(0, 8),
          deviceName: device.deviceName,
          lat: device.lat,
          lon: device.lon,
          accuracy: device.accuracy
        })
        return device
      } else {
        console.log('⚠️ 選擇的裝置已斷線，切換到第一個可用裝置')
        // ✅ 如果選擇的裝置已斷線，自動切換到第一個可用裝置
        const firstDevice = allDevices.values().next()
        if (!firstDevice.done) {
          const firstDeviceId = Array.from(allDevices.keys())[0]
          setSelectedDeviceId(firstDeviceId)
          console.log('✅ 已切換到裝置:', firstDeviceId.substring(0, 8))
          return firstDevice.value
        }
      }
    }
    
    // ✅ 筆電：沒有選擇裝置時，使用本地 GPS（通常是 0,0）
    console.log('⚠️ 筆電沒有選擇裝置或找不到裝置，使用本地 GPS')
    return myGPS
  }, [selectedDeviceId, allDevices, myGPS, isMobile])
  
  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  // ✅ 只有當 GPS 座標有效時才通知父組件
  useEffect(() => {
    if (!onUAVPositionUpdate) {
      return
    }
    
    const gpsPos = selectedGPS
    
    // ✅ 只有當 GPS 座標有效時才回傳（不是 0,0）
    if (gpsPos.lat === 0 && gpsPos.lon === 0) {
      console.log('⚠️ GPS 座標無效 (0, 0)，跳過更新')
      return
    }
    
    // ✅ 額外檢查：精度太差時也不更新
    if (gpsPos.accuracy > 500) {
      console.log(`⚠️ GPS 精度太差 (${gpsPos.accuracy.toFixed(2)}m)，跳過更新`)
      return
    }
    
    const gpsData = {
      lat: gpsPos.lat,
      lon: gpsPos.lon,
      altitude: gpsPos.alt
    }
    
    console.log('✅ 通知父組件 UAV 位置更新:', {
      position: uavPosition,
      gps: gpsData,
      deviceType: isMobile ? '手機' : '筆電',
      deviceId: selectedDeviceId?.substring(0, 8) || 'N/A'
    })
    
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
      return [lat, lon]
    }

    if (nearbyPoints[0].distance > 50) {
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
    }

    const adjustedLat = lat * (1 - correctionRatio) + correctedLat * correctionRatio
    const adjustedLon = lon * (1 - correctionRatio) + correctedLon * correctionRatio

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

  // ✅ 手機處理本地 GPS（使用 Geolocation API）
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

      // ✅ 更新 localGPS（觸發 useGPSSync 發送）
      setLocalGPS({ 
        lat, 
        lon, 
        alt,
        accuracy: acc
      })

      // ✅ 筆電不處理本地 GPS，只等待接收
      if (!isMobile) {
        console.log('💻 筆電不處理本地 GPS，等待接收手機 GPS')
        return
      }

      // ✅ 以下是手機的 GPS 處理邏輯
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

  // ✅ 筆電根據選擇的裝置更新位置
  useEffect(() => {
    if (isMobile) {
      return
    }

    if (selectedGPS.lat === 0 && selectedGPS.lon === 0) {
      console.log('💻 筆電等待 GPS 資料...')
      return
    }

    const lastProcessed = lastProcessedGPSRef.current
    const distanceFromLast = calcDistance(
      lastProcessed.lat,
      lastProcessed.lon,
      selectedGPS.lat,
      selectedGPS.lon
    )

    if (distanceFromLast < 0.5 && lastProcessed.lat !== 0) {
      return
    }

    console.log("💻 筆電使用選擇的裝置 GPS 更新位置：", {
      deviceId: selectedDeviceId?.substring(0, 8),
      lat: selectedGPS.lat,
      lon: selectedGPS.lon
    })

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
    console.log('🗑️ 點擊清除軌跡按鈕')
    lastProcessedGPSRef.current = { lat: 0, lon: 0 }
    
    if (onClearPath) {
      onClearPath()
    }
    
    sendClearPath()
  }

  const handleClosePhoto = () => {
    setCurrentPhoto(null)
  }

  return (
    <>
      {!isMobile && allDevices.size > 0 && (
        <div style={{
          position: 'fixed',
          top: '55px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          padding: '10px',
          borderRadius: '5px',
          zIndex: 1000,
          border: '1px solid #00ff00',
        }}>
          <label style={{ 
            color: '#00ff00', 
            marginRight: '10px',
            fontSize: '12px',
            fontFamily: 'monospace'
          }}>
            📱 選擇裝置:
          </label>
          <select
            value={selectedDeviceId || ''}
            onChange={(e) => {
              setSelectedDeviceId(e.target.value)
              console.log('📱 切換裝置:', e.target.value.substring(0, 8))
            }}
            style={{
              padding: '5px 10px',
              borderRadius: '3px',
              border: '1px solid #00ff00',
              background: '#222',
              color: '#00ff00',
              cursor: 'pointer',
              fontSize: '12px',
              fontFamily: 'monospace'
            }}
          >
            {Array.from(allDevices.entries()).map(([deviceId, device]) => (
              <option key={deviceId} value={deviceId}>
                {deviceId === myDeviceId ? '🔵 ' : '📱 '} 
                {device.deviceName || deviceId.substring(0, 8)}
              </option>
            ))}
          </select>
          <div style={{
            marginTop: '5px',
            fontSize: '10px',
            color: '#888',
            fontFamily: 'monospace'
          }}>
            連線裝置數: {allDevices.size}
          </div>
        </div>
      )}

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
        
        {/* ✅ 新增：裝置名稱編輯區塊 */}
        <div style={{ 
          marginBottom: '10px', 
          padding: '8px',
          background: 'rgba(0, 191, 255, 0.1)',
          borderRadius: '3px',
          border: '1px solid #00BFFF'
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
                  flex: 1,
                  padding: '3px 5px',
                  background: '#222',
                  border: '1px solid #00ff00',
                  color: '#00ff00',
                  borderRadius: '3px',
                  fontSize: '11px',
                  fontFamily: 'monospace'
                }}
                maxLength={20}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateDeviceName(tempName)
                    setIsEditingName(false)
                  } else if (e.key === 'Escape') {
                    setTempName(deviceName)
                    setIsEditingName(false)
                  }
                }}
              />
              <button
                onClick={() => {
                  updateDeviceName(tempName)
                  setIsEditingName(false)
                }}
                style={{
                  padding: '3px 8px',
                  background: '#00ff00',
                  color: 'black',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}
              >
                ✓
              </button>
              <button
                onClick={() => {
                  setTempName(deviceName)
                  setIsEditingName(false)
                }}
                style={{
                  padding: '3px 8px',
                  background: '#ff4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <div 
              style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                cursor: 'pointer',
                padding: '3px'
              }}
              onClick={() => {
                setIsEditingName(true)
                setTempName(deviceName)
              }}
            >
              <span style={{ fontSize: '12px', color: '#00BFFF', fontWeight: 'bold' }}>
                {deviceName}
              </span>
              <span style={{ fontSize: '10px', color: '#888' }}>✏️ 編輯</span>
            </div>
          )}
        </div>
        
        <div>設備: {isMobile ? '手機' : '筆電'}</div>
        <div>緯度: {selectedGPS.lat.toFixed(6)}°</div>
        <div>經度: {selectedGPS.lon.toFixed(6)}°</div>
        <div>誤差範圍: {selectedGPS.accuracy.toFixed(2)}m</div>
        <div>移動狀態: {isMovingRef.current ? '🟢 移動中' : '🔴 靜止'}</div>
        <div>基準點: {points.length > 0 ? `📡 ${points.length} 個` : '❌ 未載入'}</div>
        
        {!isMobile && (
          <div>連線裝置: {allDevices.size} 台</div>
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

      <PhotoHistory
        onPhotoClick={(url) => {
          setCurrentPhoto(url)
        }}
        photoDeleteEvent={photoDeleteEvent}
      />

      <PhotoViewer
        photoUrl={currentPhoto}
        onClose={handleClosePhoto}
        autoCloseTime={10000}
      />
    </>
  )
}