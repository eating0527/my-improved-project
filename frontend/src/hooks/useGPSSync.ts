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

// ✅ 修改：返回值類型（支援多裝置 + 裝置名稱）
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

// ✅ 新增：生成穩定的裝置 ID（基於瀏覽器指紋 + localStorage）
function getStableDeviceId(): string {
  // 1️⃣ 先檢查 localStorage 是否已有 ID
  const storedId = localStorage.getItem('sim-world-device-id')
  if (storedId) {
    console.log('📱 使用已儲存的裝置 ID:', storedId.substring(0, 12))
    return storedId
  }

  // 2️⃣ 生成基於瀏覽器指紋的 ID
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform
  ].join('|')

  // 3️⃣ 簡單 hash 函數
  let hash = 0
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }

  // 4️⃣ 生成 UUID 格式的 ID
  const uuid = `device-${Math.abs(hash).toString(16)}-${Date.now().toString(16)}`
  
  // 5️⃣ 儲存到 localStorage
  localStorage.setItem('sim-world-device-id', uuid)
  console.log('✅ 生成新的裝置 ID:', uuid.substring(0, 20))
  
  return uuid
}

// ✅ 新增：取得或設定裝置顯示名稱
function getDeviceDisplayName(): string {
  const storedName = localStorage.getItem('sim-world-device-name')
  if (storedName) {
    return storedName
  }
  
  // 預設名稱：裝置類型 + 隨機數字
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  const defaultName = `${isMobile ? '📱 手機' : '💻 筆電'}_${Math.floor(Math.random() * 1000)}`
  
  localStorage.setItem('sim-world-device-name', defaultName)
  return defaultName
}

export function useGPSSync(localGPS: { lat: number; lon: number; alt: number; accuracy: number }): GPSSyncResult {
  // ✅ 使用穩定的裝置 ID（不會變）
  const [myDeviceId] = useState<string>(getStableDeviceId())
  const [deviceName, setDeviceName] = useState<string>(getDeviceDisplayName())
  
  const [allDevices, setAllDevices] = useState<Map<string, MultiDeviceGPSData>>(new Map())
  const [clearPathTrigger, setClearPathTrigger] = useState<number>(0)
  const [photoUploadEvent, setPhotoUploadEvent] = useState<PhotoUploadEvent | null>(null)
  const [photoDeleteEvent, setPhotoDeleteEvent] = useState<PhotoDeleteEvent | null>(null)
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  
  // ✅ 新增：防止重複發送的 ref
  const lastSentGPSRef = useRef<string>('')
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null)

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
      
      // ✅ 連線後立即發送自己的 deviceId 給後端
      sendMessage({
        type: 'register-device',
        deviceId: myDeviceId,
        deviceName: deviceName,
        deviceType: isMobile ? 'mobile' : 'desktop'
      })
    },
    
    onMessage: (event) => {
      try {
        const data = event.data
        
        // ✅ 後端確認註冊
        if (data.type === 'device-registered') {
          console.log('✅ 後端已確認裝置註冊:', data.deviceId.substring(0, 12))
          return
        }
        
        // ✅ 處理裝置名稱更新（其他人更新名稱時同步）
        if (data.type === 'device-name-updated') {
          console.log('📝 收到裝置名稱更新:', {
            deviceId: data.deviceId.substring(0, 8),
            newName: data.deviceName
          })
          
          setAllDevices(prev => {
            const newMap = new Map(prev)
            const device = newMap.get(data.deviceId)
            
            if (device) {
              device.deviceName = data.deviceName
              newMap.set(data.deviceId, device)
            }
            
            return newMap
          })
          
          return
        }
        
        // ✅ 處理裝置斷線事件
        if (data.type === 'device-disconnected') {
          const disconnectedDeviceId = data.deviceId
          console.log('📡 收到裝置斷線事件:', disconnectedDeviceId.substring(0, 8))
          
          setAllDevices(prev => {
            const newMap = new Map(prev)
            const deleted = newMap.delete(disconnectedDeviceId)
            
            if (deleted) {
              console.log(`✅ 已移除斷線裝置 ${disconnectedDeviceId.substring(0, 8)}，剩餘裝置數: ${newMap.size}`)
              console.log('📊 剩餘裝置列表:', Array.from(newMap.keys()).map(id => id.substring(0, 8)))
            } else {
              console.log(`⚠️ 嘗試移除不存在的裝置: ${disconnectedDeviceId.substring(0, 8)}`)
            }
            
            return newMap
          })
          
          return
        }
        
        // ✅ 處理照片刪除事件
        if (data && data.type === 'photo_deleted') {
          console.log('🗑️ 收到照片刪除事件:', {
            filename: data.filename,
            timestamp: data.timestamp
          })
          
          setPhotoDeleteEvent({
            type: 'photo_deleted',
            filename: data.filename,
            timestamp: data.timestamp
          })
          return
        }
        
        // ✅ 處理照片上傳事件
        if (data && data.type === 'photo-upload') {
          console.log('📸 收到照片上傳事件:', {
            filename: data.filename,
            url: data.url,
            timestamp: data.timestamp
          })
          
          setPhotoUploadEvent({
            type: 'photo-upload',
            filename: data.filename,
            url: data.url,
            timestamp: data.timestamp
          })
          return
        }
        
        // ✅ 處理清除軌跡訊息
        if (data && data.type === 'clear-path') {
          if (data.deviceId === myDeviceId) {
            console.log('⏭️ 忽略自己的清除軌跡指令')
            return
          }
          
          console.log('🗑️ 收到其他裝置的清除軌跡指令:', {
            from: data.deviceType,
            deviceId: data.deviceId?.substring(0, 8),
            timestamp: new Date(data.timestamp).toLocaleTimeString()
          })
          
          setClearPathTrigger(prev => prev + 1)
          return
        }
        
        // ✅ 處理 GPS 資料（包含自己的 GPS + 裝置名稱）
        if (data && data.deviceId && typeof data.lat === 'number' && typeof data.lon === 'number') {
          console.log('📍 收到 GPS 資料:', {
            deviceId: data.deviceId.substring(0, 8),
            deviceName: data.deviceName || 'N/A',
            isMyDevice: data.deviceId === myDeviceId,
            lat: data.lat.toFixed(6),
            lon: data.lon.toFixed(6),
            accuracy: data.accuracy?.toFixed(2) || 'N/A'
          })
          
          setAllDevices(prev => {
            const newMap = new Map(prev)
            newMap.set(data.deviceId, {
              lat: data.lat,
              lon: data.lon,
              alt: data.alt ?? 0,
              accuracy: data.accuracy ?? 999,
              timestamp: data.timestamp ?? Date.now(),
              deviceType: data.deviceType ?? 'mobile',
              deviceId: data.deviceId,
              deviceName: data.deviceName || 'Unknown Device' // ✅ 儲存裝置名稱
            })
            
            console.log(`📱 更新後裝置總數: ${newMap.size}`)
            return newMap
          })
          return
        }
        
        console.log('ℹ️ 未處理的訊息類型:', data)
      } catch (error) {
        console.error('❌ 解析訊息失敗:', error)
      }
    },
    
    onError: (error) => {
      console.error('❌ GPS WebSocket 錯誤:', error)
    },
    
    onDisconnect: () => {
      console.log('📡 GPS WebSocket 已關閉')
      
      // ✅ 清理定時器
      if (sendIntervalRef.current) {
        clearInterval(sendIntervalRef.current)
        sendIntervalRef.current = null
        console.log('🛑 已停止 GPS 定期發送')
      }
      
      console.log('⚠️ WebSocket 斷線，保留現有裝置資料等待重連')
    }
  })

  // ✅ 修改：手機定期發送 GPS（使用 setInterval + 帶上 deviceName）
  useEffect(() => {
    // ✅ 清理舊的定時器
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current)
      sendIntervalRef.current = null
    }

    if (!isMobile) {
      console.log('💻 筆電不發送 GPS，只接收')
      return
    }
    
    if (!isConnected) {
      console.log('⚠️ WebSocket 未連接，無法發送 GPS')
      return
    }
    
    if (localGPS.lat === 0 && localGPS.lon === 0) {
      console.log('⚠️ GPS 座標為 0，暫不發送')
      return
    }

    // ✅ 立即發送一次
    const sendGPS = () => {
      const gpsKey = `${localGPS.lat.toFixed(6)},${localGPS.lon.toFixed(6)},${localGPS.alt.toFixed(2)}`
      
      // ✅ 防止重複發送相同座標
      if (lastSentGPSRef.current === gpsKey) {
        console.log('⏭️ GPS 座標未變化，跳過發送')
        return
      }
      
      const data: GPSData = {
        ...localGPS,
        accuracy: localGPS.accuracy,
        timestamp: Date.now(),
        deviceType: 'mobile',
        deviceId: myDeviceId,
        deviceName: deviceName // ✅ 發送裝置名稱
      }
      
      console.log('📤 [手機] 發送 GPS:', {
        deviceId: myDeviceId.substring(0, 8),
        deviceName: deviceName,
        lat: data.lat.toFixed(6),
        lon: data.lon.toFixed(6),
        accuracy: data.accuracy.toFixed(2)
      })
      
      sendMessage(data)
      lastSentGPSRef.current = gpsKey
    }

    // ✅ 立即發送一次
    sendGPS()

    // ✅ 每 1 秒發送一次（節流）
    sendIntervalRef.current = setInterval(sendGPS, 1000)
    console.log('⏰ 已啟動 GPS 定期發送（每 1 秒）')

    // ✅ 清理函數
    return () => {
      if (sendIntervalRef.current) {
        clearInterval(sendIntervalRef.current)
        sendIntervalRef.current = null
        console.log('🛑 已停止 GPS 定期發送')
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
    deviceName, // ✅ 新增：監聽 deviceName 變化
    sendMessage
  ])

  useEffect(() => {
    console.log(`🔌 GPS WebSocket 狀態: ${connectionStatus}`)
  }, [connectionStatus])

  useEffect(() => {
    if (allDevices.size > 0) {
      console.log('🔄 allDevices 已更新:', {
        deviceCount: allDevices.size,
        devices: Array.from(allDevices.entries()).map(([id, device]) => ({
          id: id.substring(0, 8),
          name: device.deviceName || 'N/A',
          lat: device.lat.toFixed(6),
          lon: device.lon.toFixed(6),
          accuracy: device.accuracy.toFixed(2),
          isMe: id === myDeviceId
        }))
      })
    } else {
      console.log('📭 allDevices 已清空或尚無資料')
    }
  }, [allDevices, myDeviceId])

  const sendClearPath = () => {
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

    console.log('📤 發送清除軌跡指令:', {
      from: isMobile ? '手機' : '筆電',
      deviceId: myDeviceId.substring(0, 8),
      timestamp: new Date(message.timestamp).toLocaleTimeString()
    })

    sendMessage(message)
  }

  // ✅ 新增：提供修改裝置名稱的函數
  const updateDeviceName = useCallback((newName: string) => {
    setDeviceName(newName)
    localStorage.setItem('sim-world-device-name', newName)
    console.log('✅ 已更新裝置名稱:', newName)
    
    // 立即發送更新給後端
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
    deviceName,              // ✅ 新增：返回裝置名稱
    updateDeviceName,        // ✅ 新增：返回修改函數
    allDevices,
    myGPS: localGPS,
    clearPathTrigger,
    sendClearPath,
    photoUploadEvent,
    photoDeleteEvent
  }
}