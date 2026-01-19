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

function getUniqueSessionId(): string {
  const sessionKey = 'sim-world-session-id-v2' 
  const storedId = sessionStorage.getItem(sessionKey)
  
  if (storedId) {
    console.log('📱 使用現有 Session ID:', storedId.substring(0, 12))
    return storedId
  }

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

function isMoved(prev: {lat: number, lon: number}, curr: {lat: number, lon: number}): boolean {
  const diffLat = Math.abs(prev.lat - curr.lat)
  const diffLon = Math.abs(prev.lon - curr.lon)
  return diffLat > 0.000001 || diffLon > 0.000001
}

export function useGPSSync(localGPS: { lat: number; lon: number; alt: number; accuracy: number }): GPSSyncResult {
  const [myDeviceId] = useState<string>(getUniqueSessionId())
  const [deviceName, setDeviceName] = useState<string>(getDeviceDisplayName())
  
  const [allDevices, setAllDevices] = useState<Map<string, MultiDeviceGPSData>>(new Map())
  const [clearPathTrigger, setClearPathTrigger] = useState<number>(0)
  const [photoUploadEvent, setPhotoUploadEvent] = useState<PhotoUploadEvent | null>(null)
  const [photoDeleteEvent, setPhotoDeleteEvent] = useState<PhotoDeleteEvent | null>(null)
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  const lastSentTimeRef = useRef<number>(0)
  const lastSentPosRef = useRef<{lat: number, lon: number}>({ lat: 0, lon: 0 })
  
  // ✅ 新增：用 Ref 存最新的 localGPS，避免 useEffect 依賴變動
  const localGPSRef = useRef(localGPS)
  useEffect(() => {
    localGPSRef.current = localGPS
  }, [localGPS])

  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const registeredRef = useRef<boolean>(false)
  const lastLogTimeRef = useRef<number>(0)
  const cleanupIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null)

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
        
        if (data.type === 'connection-established' || data.type === 'device-registered') {
          registeredRef.current = true
          return
        }
        
        if (data.type === 'device-name-updated') {
          setAllDevices(prev => {
            const device = prev.get(data.deviceId)
            if (device && device.deviceName === data.deviceName) return prev
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
          setAllDevices(prev => {
            if (!prev.has(data.deviceId)) return prev
            const newMap = new Map(prev)
            newMap.delete(data.deviceId)
            return newMap
          })
          return
        }
        
        if (data.type === 'photo_deleted') {
          setPhotoDeleteEvent(data)
          return
        }
        
        if (data.type === 'photo-upload') {
          setPhotoUploadEvent(data)
          return
        }
        
        if (data.type === 'clear-path') {
          if (data.deviceId === myDeviceId) return
          setClearPathTrigger(prev => prev + 1)
          return
        }
        
        if (data.lat !== undefined && data.lon !== undefined && data.deviceId) {
          const now = Date.now()
          
          if (data.lat === 0 && data.lon === 0) return
          
          setAllDevices(prev => {
            const existingDevice = prev.get(data.deviceId)
            
            if (existingDevice) {
              const latChanged = Math.abs(existingDevice.lat - data.lat) > 0.000001
              const lonChanged = Math.abs(existingDevice.lon - data.lon) > 0.000001
              
              if (!latChanged && !lonChanged) {
                const newMap = new Map(prev)
                const updatedDevice = { ...existingDevice, lastUpdateTime: now }
                newMap.set(data.deviceId, updatedDevice)
                return newMap
              }
            }
            
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
            
            return newMap
          })
        }
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
    }
  })

  useEffect(() => {
    const DEVICE_TIMEOUT = 60000 
    
    cleanupIntervalRef.current = setInterval(() => {
      const now = Date.now()
      setAllDevices(prev => {
        let hasExpiredDevice = false
        const newMap = new Map(prev)
        prev.forEach((device, deviceId) => {
          if (now - device.lastUpdateTime > DEVICE_TIMEOUT) {
            newMap.delete(deviceId)
            hasExpiredDevice = true
          }
        })
        return hasExpiredDevice ? newMap : prev
      })
    }, 5000)
    
    return () => {
      if (cleanupIntervalRef.current) clearInterval(cleanupIntervalRef.current)
    }
  }, [])

  // ✅ 🔥 關鍵優化：使用 localGPSRef，避免 interval 被重置
  useEffect(() => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }

    if (!isMobile) return
    
    const checkAndSendGPS = () => {
      if (!isConnected || !registeredRef.current) return
      
      const currentGPS = localGPSRef.current // ✅ 讀取最新 GPS
      if (currentGPS.lat === 0 && currentGPS.lon === 0) return

      const now = Date.now()
      const timeSinceLastSend = now - lastSentTimeRef.current
      
      const hasMoved = isMoved(lastSentPosRef.current, currentGPS)

      const shouldSend = (hasMoved && timeSinceLastSend > 150) || 
                         (timeSinceLastSend > 2000)

      if (shouldSend) {
        const data: GPSData = {
          lat: currentGPS.lat,
          lon: currentGPS.lon,
          alt: currentGPS.alt,
          accuracy: currentGPS.accuracy,
          timestamp: now,
          deviceType: 'mobile',
          deviceId: myDeviceId,
          deviceName: deviceName
        }
        
        sendMessage(data)
        
        lastSentTimeRef.current = now
        lastSentPosRef.current = { lat: currentGPS.lat, lon: currentGPS.lon }
      }
    }

    sendIntervalRef.current = setInterval(checkAndSendGPS, 100) 

    return () => {
      if (sendIntervalRef.current) clearInterval(sendIntervalRef.current)
    }
  }, [isMobile, isConnected, myDeviceId, deviceName, sendMessage]) // ❌ 移除 localGPS 依賴

  const prevDeviceCountRef = useRef<number>(0)
  
  useEffect(() => {
    if (allDevices.size !== prevDeviceCountRef.current) {
      prevDeviceCountRef.current = allDevices.size
    }
  }, [allDevices])

  const sendClearPath = useCallback(() => {
    if (!isConnected) return
    const message: ClearPathMessage = {
      type: 'clear-path',
      timestamp: Date.now(),
      deviceType: isMobile ? 'mobile' : 'desktop',
      deviceId: myDeviceId
    }
    sendMessage(message)
  }, [isConnected, isMobile, myDeviceId, sendMessage])

  const updateDeviceName = useCallback((newName: string) => {
    setDeviceName(newName)
    localStorage.setItem('sim-world-device-name', newName)
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