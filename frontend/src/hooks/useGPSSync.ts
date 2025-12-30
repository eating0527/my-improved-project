import { useEffect, useState, useRef, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'

interface GPSData {
  lat: number
  lon: number
  alt: number
  accuracy: number
  timestamp: number
  deviceType: 'mobile' | 'desktop'
  deviceId?: string
  deviceName?: string
}

interface MultiDeviceGPSData extends GPSData {
  deviceId: string
  deviceName?: string
  lastUpdateTime: number
}

interface ClearPathMessage {
  type: 'clear-path'
  timestamp: number
  deviceType: 'mobile' | 'desktop'
  deviceId?: string
}

interface PhotoUploadEvent {
  type: 'photo-upload'
  filename: string
  url: string
  timestamp: string
}

interface PhotoDeleteEvent {
  type: 'photo_deleted'
  filename: string
  timestamp: string
}

interface GPSSyncResult {
  myDeviceId: string
  deviceName: string
  updateDeviceName: (newName: string) => void
  allDevices: Map<string, MultiDeviceGPSData>
  myGPS: { lat: number; lon: number; alt: number; accuracy: number }
  clearPathTrigger: number
  sendClearPath: () => void
  photoUploadEvent: PhotoUploadEvent | null
  photoDeleteEvent: PhotoDeleteEvent | null
}

// 🔄 修改 1：生成絕對唯一的 Session ID (隨機亂數)
// 確保每次開分頁或不同手機連線，ID 都絕對不同
function getUniqueSessionId(): string {
  const sessionKey = 'sim-world-session-id-v2' 
  const storedId = sessionStorage.getItem(sessionKey)
  
  if (storedId) {
    console.log('📱 使用現有 Session ID:', storedId.substring(0, 12))
    return storedId
  }

  // 生成絕對唯一的 ID (時間戳 + 隨機亂數)
  const randomPart = Math.random().toString(36).substring(2, 10)
  const timestamp = Date.now().toString(36)
  const newId = `device-${timestamp}-${randomPart}`
  
  sessionStorage.setItem(sessionKey, newId)
  console.log('✨ 生成全新的 Session ID:', newId)
  
  return newId
}

function getDeviceDisplayName(): string {
  const storedName = localStorage.getItem('sim-world-device-name')
  if (storedName) {
    return storedName
  }
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const defaultName = `${isMobile ? '📱 手機' : '💻 筆電'}_${Math.floor(Math.random() * 1000)}`
  
  localStorage.setItem('sim-world-device-name', defaultName)
  return defaultName
}

// 輔助函式：判斷是否移動
function isMoved(prev: {lat: number, lon: number}, curr: {lat: number, lon: number}): boolean {
  const diffLat = Math.abs(prev.lat - curr.lat)
  const diffLon = Math.abs(prev.lon - curr.lon)
  return diffLat > 0.000001 || diffLon > 0.000001
}

export function useGPSSync(localGPS: { lat: number; lon: number; alt: number; accuracy: number }): GPSSyncResult {
  // 使用新的 ID 生成邏輯
  const [myDeviceId] = useState<string>(getUniqueSessionId())
  const [deviceName, setDeviceName] = useState<string>(getDeviceDisplayName())
  
  const [allDevices, setAllDevices] = useState<Map<string, MultiDeviceGPSData>>(new Map())
  const [clearPathTrigger, setClearPathTrigger] = useState<number>(0)
  const [photoUploadEvent, setPhotoUploadEvent] = useState<PhotoUploadEvent | null>(null)
  const [photoDeleteEvent, setPhotoDeleteEvent] = useState<PhotoDeleteEvent | null>(null)
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  // 用來記錄上次發送的狀態，做動態頻率控制
  const lastSentTimeRef = useRef<number>(0)
  const lastSentPosRef = useRef<{lat: number, lon: number}>({ lat: 0, lon: 0 })
  
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const registeredRef = useRef<boolean>(false)
  const lastLogTimeRef = useRef<number>(0)
  const cleanupIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null)

  // ✅ 新增：請求螢幕常亮 (Wake Lock)
  // 這能防止手機進入休眠，導致 WebSocket 斷線
  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isMobile) {
        try {
          wakeLockSentinelRef.current = await navigator.wakeLock.request('screen')
          console.log('💡 螢幕喚醒鎖已啟動')
        } catch (err) {
          console.warn('⚠️ 無法啟動螢幕喚醒鎖:', err)
        }
      }
    }

    requestWakeLock()

    // 當頁面重新顯示時，再次請求鎖定
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release()
      }
    }
  }, [isMobile])

  const { isConnected, sendMessage, connectionStatus } = useWebSocket({
    url: 'wss://backend.simworld.website/ws/gps',
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
    enableReconnect: true,
    
    onConnect: () => {
      console.log('✅ GPS WebSocket 連接成功')
      console.log(`📱 裝置 ID: ${myDeviceId.substring(0, 20)}`)
      console.log(`📝 顯示名稱: ${deviceName}`)
      console.log(`🖥️ 設備類型: ${isMobile ? '手機' : '筆電'}`)
      
      registeredRef.current = false
      
      setTimeout(() => {
        if (!registeredRef.current) {
          console.log('📤 發送註冊訊息...')
          sendMessage({
            type: 'register-device',
            deviceId: myDeviceId,
            deviceName: deviceName,
            deviceType: isMobile ? 'mobile' : 'desktop'
          })
          registeredRef.current = true
        }
      }, 100)
    },
    
    onMessage: (event) => {
      try {
        let data: any
        
        if (typeof event.data === 'string') {
          try {
            data = JSON.parse(event.data)
          } catch (e) {
            console.error('❌ JSON 解析失敗:', event.data)
            return
          }
        } else {
          data = event.data
        }
        
        if (data.type !== undefined && data.lat === undefined) {
          console.log('📩 收到 WebSocket 訊息:', data)
        }
        
        if (data.type === 'connection-established') {
          console.log('✅ 後端確認連線建立:', data.deviceId?.substring(0, 12))
          registeredRef.current = true
          return
        }
        
        if (data.type === 'device-registered') {
          console.log('✅ 後端已確認裝置註冊:', data.deviceId?.substring(0, 12))
          registeredRef.current = true
          return
        }
        
        if (data.type === 'device-name-updated') {
          console.log('📝 收到裝置名稱更新:', {
            deviceId: data.deviceId?.substring(0, 8),
            newName: data.deviceName
          })
          
          setAllDevices(prev => {
            const device = prev.get(data.deviceId)
            
            if (device && device.deviceName === data.deviceName) {
              return prev
            }
            
            const newMap = new Map(prev)
            if (device) {
              device.deviceName = data.deviceName
              newMap.set(data.deviceId, device)
            }
            
            return newMap
          })
          
          return
        }
        
        if (data.type === 'device-disconnected') {
          const disconnectedDeviceId = data.deviceId
          console.log('📡 收到裝置斷線事件:', disconnectedDeviceId?.substring(0, 8))
          
          setAllDevices(prev => {
            if (!prev.has(disconnectedDeviceId)) {
              return prev
            }
            
            const newMap = new Map(prev)
            newMap.delete(disconnectedDeviceId)
            
            console.log(`✅ 已移除斷線裝置 ${disconnectedDeviceId?.substring(0, 8)}，剩餘裝置數: ${newMap.size}`)
            
            return newMap
          })
          
          return
        }
        
        if (data.type === 'photo_deleted') {
          console.log('🗑️ 收到照片刪除事件:', data.filename)
          setPhotoDeleteEvent(data)
          return
        }
        
        if (data.type === 'photo-upload') {
          console.log('📸 收到照片上傳事件:', data.filename)
          setPhotoUploadEvent(data)
          return
        }
        
        if (data.type === 'clear-path') {
          if (data.deviceId === myDeviceId) {
            console.log('⏭️ 忽略自己的清除軌跡指令')
            return
          }
          
          console.log('🗑️ 收到其他裝置的清除軌跡指令:', data.deviceId?.substring(0, 8))
          setClearPathTrigger(prev => prev + 1)
          return
        }
        
        // ✅ 處理 GPS 資料
        if (data.lat !== undefined && data.lon !== undefined && data.deviceId) {
          const isMyDevice = data.deviceId === myDeviceId
          const now = Date.now()
          
          // ✅ 記錄收到的 GPS 資料（每 5 秒記錄一次）
          const shouldLog = now - lastLogTimeRef.current > 5000
          if (shouldLog) {
            console.log(`📍 收到 GPS 資料 (${isMyDevice ? '我的裝置' : '其他裝置'}):`, {
              deviceId: data.deviceId.substring(0, 8),
              deviceName: data.deviceName || 'N/A',
              lat: data.lat.toFixed(6),
              lon: data.lon.toFixed(6),
              alt: data.alt?.toFixed(2) || 'N/A',
              accuracy: data.accuracy?.toFixed(2) || 'N/A',
              isMobile: isMobile
            })
            lastLogTimeRef.current = now
          }
          
          // ✅ 關鍵修正：只過濾無效的 GPS 座標 (0, 0)
          if (data.lat === 0 && data.lon === 0) {
            console.log('⏭️ GPS 座標為 (0, 0)，忽略此筆資料')
            return
          }
          
          // ✅ 更新 allDevices（包含自己和其他裝置）
          setAllDevices(prev => {
            const existingDevice = prev.get(data.deviceId)
            
            if (existingDevice) {
              const latChanged = Math.abs(existingDevice.lat - data.lat) > 0.000001
              const lonChanged = Math.abs(existingDevice.lon - data.lon) > 0.000001
              const altChanged = Math.abs(existingDevice.alt - (data.alt ?? 0)) > 0.01
              const accChanged = Math.abs(existingDevice.accuracy - (data.accuracy ?? 999)) > 0.1
              const nameChanged = existingDevice.deviceName !== (data.deviceName || 'Unknown Device')
              
              const hasChange = latChanged || lonChanged || altChanged || accChanged || nameChanged
              
              if (!hasChange) {
                // ✅ 資料沒變化，但更新最後更新時間
                // 注意：這裡如果直接回傳 prev，React 可能不會觸發更新
                // 但為了效能，我們只在必要時更新 state
                // 這裡我們稍微修改一下策略，如果是純心跳包，只更新時間戳
                const newMap = new Map(prev) // 複製 Map 確保 React 偵測到變更
                const updatedDevice = { ...existingDevice, lastUpdateTime: now }
                newMap.set(data.deviceId, updatedDevice)
                return newMap
              }
            }
            
            // ✅ 有變化或新裝置，建立新 Map
            const newMap = new Map(prev)
            newMap.set(data.deviceId, {
              lat: data.lat,
              lon: data.lon,
              alt: data.alt ?? 0,
              accuracy: data.accuracy ?? 999,
              timestamp: data.timestamp ?? now,
              deviceType: data.deviceType ?? 'mobile',
              deviceId: data.deviceId,
              deviceName: data.deviceName || 'Unknown Device',
              lastUpdateTime: now
            })
            
            if (shouldLog) {
              console.log(`✅ 已加入/更新裝置 ${data.deviceId.substring(0, 8)}，當前裝置數: ${newMap.size}`)
            }
            
            return newMap
          })
          
          return
        }
        
        console.log('ℹ️ 未處理的訊息類型:', data.type || '無 type')
      } catch (error) {
        console.error('❌ 處理訊息時發生錯誤:', error)
      }
    },
    
    onError: (error) => {
      console.error('❌ GPS WebSocket 錯誤:', error)
    },
    
    onDisconnect: () => {
      console.log('📡 GPS WebSocket 已關閉')
      
      registeredRef.current = false
      
      if (sendIntervalRef.current) {
        clearInterval(sendIntervalRef.current)
        sendIntervalRef.current = null
      }
      
      console.log('⚠️ WebSocket 斷線，保留現有裝置資料等待重連')
    }
  })

  // ✅ 定時清理過期裝置（超過 60 秒沒更新的裝置）
  useEffect(() => {
    // 🔴 修改這裡：原本是 10000 (10秒)，改成 60000 (60秒)，給手機多一點緩衝時間
    const DEVICE_TIMEOUT = 60000 
    
    cleanupIntervalRef.current = setInterval(() => {
      const now = Date.now()
      
      setAllDevices(prev => {
        let hasExpiredDevice = false
        const newMap = new Map(prev)
        
        prev.forEach((device, deviceId) => {
          const timeSinceLastUpdate = now - device.lastUpdateTime
          
          if (timeSinceLastUpdate > DEVICE_TIMEOUT) {
            console.log(`⏰ 裝置 ${deviceId.substring(0, 8)} 超過 ${DEVICE_TIMEOUT / 1000} 秒沒更新，移除`)
            newMap.delete(deviceId)
            hasExpiredDevice = true
          }
        })
        
        return hasExpiredDevice ? newMap : prev
      })
    }, 5000)
    
    return () => {
      if (cleanupIntervalRef.current) {
        clearInterval(cleanupIntervalRef.current)
      }
    }
  }, [])

  // ✅ 🔥 關鍵優化：動態頻率發送 GPS
  useEffect(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }

    if (!isMobile) {
      console.log('💻 筆電不發送 GPS，只接收')
      return
    }
    
    // 定義檢查與發送邏輯
    const checkAndSendGPS = () => {
      if (!isConnected) return
      if (!registeredRef.current) return
      if (localGPS.lat === 0 && localGPS.lon === 0) return

      const now = Date.now()
      const timeSinceLastSend = now - lastSentTimeRef.current
      
      // 判斷是否移動
      const hasMoved = isMoved(lastSentPosRef.current, localGPS)

      // 🚀 策略：
      // 1. 如果有移動：每 150ms 發送一次 (極速同步)
      // 2. 如果沒移動：每 2000ms 發送一次 (維持心跳，防止斷線)
      const shouldSend = (hasMoved && timeSinceLastSend > 150) || 
                         (timeSinceLastSend > 2000)

      if (shouldSend) {
        const data: GPSData = {
          lat: localGPS.lat,
          lon: localGPS.lon,
          alt: localGPS.alt,
          accuracy: localGPS.accuracy,
          timestamp: now,
          deviceType: 'mobile',
          deviceId: myDeviceId,
          deviceName: deviceName
        }
        
        // 為了避免 Log 刷頻，這裡我們只在心跳包的時候，或每隔 2 秒印一次 log
        if (timeSinceLastSend > 2000) {
             console.log('📤 [手機] 發送 GPS:', {
                deviceId: myDeviceId.substring(0, 8),
                lat: data.lat.toFixed(6),
                lon: data.lon.toFixed(6)
             })
        }
        
        sendMessage(data)
        
        // 更新紀錄
        lastSentTimeRef.current = now
        lastSentPosRef.current = { lat: localGPS.lat, lon: localGPS.lon }
      }
    }

    // ✅ 將檢查頻率設為 100ms (檢查很快，不會耗效能)
    // 實際發送頻率由上面的逻辑控制
    sendIntervalRef.current = setInterval(checkAndSendGPS, 100) 
    console.log('🚀 已啟動動態 GPS 同步 (移動時極速/靜止時心跳)')

    return () => {
      if (sendIntervalRef.current) {
        clearInterval(sendIntervalRef.current)
        sendIntervalRef.current = null
      }
    }
  }, [
    localGPS.lat, 
    localGPS.lon, 
    localGPS.alt, 
    localGPS.accuracy, 
    isMobile, 
    isConnected, 
    myDeviceId, 
    deviceName, 
    sendMessage
  ])

  useEffect(() => {
    console.log(`🔌 GPS WebSocket 狀態: ${connectionStatus}`)
  }, [connectionStatus])

  const prevDeviceCountRef = useRef<number>(0)
  
  useEffect(() => {
    if (allDevices.size !== prevDeviceCountRef.current) {
      console.log('🔄 allDevices 已更新:', {
        deviceCount: allDevices.size,
        devices: Array.from(allDevices.entries()).map(([id, device]) => ({
          id: id.substring(0, 8),
          name: device.deviceName || 'N/A',
          lat: device.lat.toFixed(6),
          lon: device.lon.toFixed(6),
          isMe: id === myDeviceId,
          lastUpdate: `${Math.floor((Date.now() - device.lastUpdateTime) / 1000)}s ago`
        }))
      })
      prevDeviceCountRef.current = allDevices.size
    }
  }, [allDevices, myDeviceId])

  const sendClearPath = useCallback(() => {
    if (!isConnected) {
      console.warn('⚠️ WebSocket 未連接，無法發送清除軌跡指令')
      return
    }

    const message: ClearPathMessage = {
      type: 'clear-path',
      timestamp: Date.now(),
      deviceType: isMobile ? 'mobile' : 'desktop',
      deviceId: myDeviceId
    }

    console.log('📤 發送清除軌跡指令')
    sendMessage(message)
  }, [isConnected, isMobile, myDeviceId, sendMessage])

  const updateDeviceName = useCallback((newName: string) => {
    setDeviceName(newName)
    localStorage.setItem('sim-world-device-name', newName)
    console.log('✅ 已更新裝置名稱:', newName)
    
    if (isConnected) {
      sendMessage({
        type: 'update-device-name',
        deviceId: myDeviceId,
        deviceName: newName
      })
    }
  }, [isConnected, sendMessage, myDeviceId])

  return {
    myDeviceId,
    deviceName,
    updateDeviceName,
    allDevices,
    myGPS: localGPS,
    clearPathTrigger,
    sendClearPath,
    photoUploadEvent,
    photoDeleteEvent
  }
}