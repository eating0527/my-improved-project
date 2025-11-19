import { useEffect, useState } from 'react'
import { useWebSocket } from './useWebSocket'

interface GPSData {
  lat: number
  lon: number
  alt: number
  accuracy: number
  timestamp: number
  deviceType: 'mobile' | 'desktop'
}

// ✅ 清除軌跡訊息類型
interface ClearPathMessage {
  type: 'clear-path'
  timestamp: number
  deviceType: 'mobile' | 'desktop'
}

// ✅ 照片上傳事件類型
interface PhotoUploadEvent {
  type: 'photo-upload'
  filename: string
  url: string
  timestamp: string
}

// ✅ 新增：照片刪除事件類型
interface PhotoDeleteEvent {
  type: 'photo_deleted'
  filename: string
  timestamp: string
}

// ✅ 修改：返回值類型（新增照片刪除事件）
interface GPSSyncResult {
  lat: number
  lon: number
  alt: number
  accuracy: number
  clearPathTrigger: number
  sendClearPath: () => void
  photoUploadEvent: PhotoUploadEvent | null
  photoDeleteEvent: PhotoDeleteEvent | null  // ✅ 新增：照片刪除事件
}

export function useGPSSync(localGPS: { lat: number; lon: number; alt: number; accuracy: number }): GPSSyncResult {
  const [syncedGPS, setSyncedGPS] = useState({
    ...localGPS,
    accuracy: 999
  })
  
  const [clearPathTrigger, setClearPathTrigger] = useState<number>(0)
  const [photoUploadEvent, setPhotoUploadEvent] = useState<PhotoUploadEvent | null>(null)
  
  // ✅ 新增：照片刪除事件狀態
  const [photoDeleteEvent, setPhotoDeleteEvent] = useState<PhotoDeleteEvent | null>(null)
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  const { isConnected, sendMessage, connectionStatus } = useWebSocket({
    url: 'wss://backend.simworld.website/ws/gps',
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
    enableReconnect: true,
    
    onConnect: () => {
      console.log('✅ GPS WebSocket 連接成功')
      console.log(`📱 設備類型: ${isMobile ? '手機' : '筆電'}`)
      
      if (isMobile && localGPS.lat !== 0 && localGPS.lon !== 0) {
        const data: GPSData = {
          ...localGPS,
          accuracy: localGPS.accuracy,
          timestamp: Date.now(),
          deviceType: 'mobile'
        }
        sendMessage(data)
        console.log('📤 [手機] 初次發送 GPS:', data)
      }
    },
    
    onMessage: (event) => {
      try {
        const data = event.data
        console.log('📥 收到遠端訊息原始資料:', data)
        
        // ✅ 新增：處理照片刪除事件
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
          
          console.log('✅ 照片刪除事件已更新狀態')
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
          
          console.log('✅ 照片上傳事件已更新狀態')
          return
        }
        
        // ✅ 處理清除軌跡訊息
        if (data && data.type === 'clear-path') {
          console.log('🗑️ 收到清除軌跡指令:', {
            from: data.deviceType,
            to: isMobile ? '手機' : '筆電',
            timestamp: new Date(data.timestamp).toLocaleTimeString()
          })
          
          setClearPathTrigger(prev => {
            const newValue = prev + 1
            console.log(`🗑️ 清除軌跡觸發器更新: ${prev} -> ${newValue}`)
            return newValue
          })
          return
        }
        
        // ✅ 驗證 GPS 資料格式
        if (!data || typeof data !== 'object') {
          console.error('❌ 收到的資料格式不正確:', data)
          return
        }
        
        if (typeof data.lat !== 'number' || typeof data.lon !== 'number') {
          console.error('❌ GPS 座標資料不正確:', data)
          return
        }
        
        console.log('📥 解析後的 GPS 資料:', {
          lat: data.lat,
          lon: data.lon,
          alt: data.alt,
          accuracy: data.accuracy,
          deviceType: data.deviceType,
          isMobile: isMobile
        })
        
        if (!isMobile && data.deviceType === 'mobile') {
          console.log('💻 [筆電] 準備更新 GPS...')
          setSyncedGPS({
            lat: data.lat,
            lon: data.lon,
            alt: data.alt,
            accuracy: data.accuracy ?? 999
          })
          console.log('💻 [筆電] 已更新手機 GPS:', {
            lat: data.lat.toFixed(6),
            lon: data.lon.toFixed(6),
            alt: data.alt.toFixed(2),
            accuracy: `${(data.accuracy ?? 999).toFixed(2)}m`
          })
        } else if (isMobile && data.deviceType === 'mobile') {
          console.log('📱 [手機] 收到自己發送的 GPS，忽略')
        } else {
          console.log('ℹ️ 其他情況，裝置類型:', isMobile ? '手機' : '筆電', '資料類型:', data.deviceType)
        }
      } catch (error) {
        console.error('❌ 解析訊息失敗:', error, '原始資料:', event)
      }
    },
    
    onError: (error) => {
      console.error('❌ GPS WebSocket 錯誤:', error)
    },
    
    onDisconnect: () => {
      console.log('📡 GPS WebSocket 已關閉')
    }
  })

  useEffect(() => {
    console.log('🔍 檢查是否需要發送 GPS:', {
      isMobile,
      isConnected,
      hasGPS: localGPS.lat !== 0 && localGPS.lon !== 0,
      lat: localGPS.lat,
      lon: localGPS.lon,
      accuracy: localGPS.accuracy
    })

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

    const data: GPSData = {
      ...localGPS,
      accuracy: localGPS.accuracy,
      timestamp: Date.now(),
      deviceType: 'mobile'
    }
    
    console.log('📤 [手機] 準備發送 GPS:', data)
    sendMessage(data)
    console.log('📤 [手機] GPS 已發送 (精度: ' + data.accuracy.toFixed(2) + 'm)')
  }, [localGPS.lat, localGPS.lon, localGPS.alt, localGPS.accuracy, isMobile, isConnected, sendMessage])

  useEffect(() => {
    console.log(`🔌 GPS WebSocket 狀態: ${connectionStatus}`)
  }, [connectionStatus])

  useEffect(() => {
    console.log('🔄 syncedGPS 已更新:', {
      lat: syncedGPS.lat,
      lon: syncedGPS.lon,
      alt: syncedGPS.alt,
      accuracy: syncedGPS.accuracy,
      isMobile
    })
  }, [syncedGPS, isMobile])

  const sendClearPath = () => {
    if (!isConnected) {
      console.warn('⚠️ WebSocket 未連接，無法發送清除軌跡指令')
      return
    }

    const message: ClearPathMessage = {
      type: 'clear-path',
      timestamp: Date.now(),
      deviceType: isMobile ? 'mobile' : 'desktop'
    }

    console.log('📤 發送清除軌跡指令:', {
      from: isMobile ? '手機' : '筆電',
      timestamp: new Date(message.timestamp).toLocaleTimeString()
    })

    sendMessage(message)
    console.log('✅ 清除軌跡指令已發送')
  }

  const gpsData = isMobile ? localGPS : syncedGPS
  
  console.log('📍 useGPSSync 返回:', {
    isMobile,
    gps: {
      lat: gpsData.lat,
      lon: gpsData.lon,
      alt: gpsData.alt,
      accuracy: gpsData.accuracy
    },
    clearPathTrigger,
    photoUploadEvent: photoUploadEvent ? '有照片事件' : '無照片事件',
    photoDeleteEvent: photoDeleteEvent ? '有刪除事件' : '無刪除事件'  // ✅ 新增日誌
  })
  
  // ✅ 修改：返回 GPS 資料 + 清除軌跡功能 + 照片上傳事件 + 照片刪除事件
  return {
    ...gpsData,
    clearPathTrigger,
    sendClearPath,
    photoUploadEvent,
    photoDeleteEvent  // ✅ 新增：返回照片刪除事件
  }
}