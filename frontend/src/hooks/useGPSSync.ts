import { useEffect, useState } from 'react'
import { useWebSocket } from './useWebSocket'

interface GPSData {
  lat: number
  lon: number
  alt: number
  accuracy: number  // ✅ 新增：精度
  timestamp: number
  deviceType: 'mobile' | 'desktop'
}

// ✅ 修改：localGPS 加入 accuracy
export function useGPSSync(localGPS: { lat: number; lon: number; alt: number; accuracy: number }) {
  const [syncedGPS, setSyncedGPS] = useState({
    ...localGPS,
    accuracy: 999  // ✅ 預設精度
  })
  
  // 檢測是否為手機
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  // 使用現有的 useWebSocket Hook
  const { isConnected, sendMessage, connectionStatus } = useWebSocket({
    url: 'wss://backend.simworld.website/ws/gps',
    reconnectInterval: 3000,
    maxReconnectAttempts: 10,
    enableReconnect: true,
    
    onConnect: () => {
      console.log('✅ GPS WebSocket 連接成功')
      console.log(`📱 設備類型: ${isMobile ? '手機' : '筆電'}`)
      
      // 連接成功後，如果是手機且有有效的 GPS，立即發送
      if (isMobile && localGPS.lat !== 0 && localGPS.lon !== 0) {
        const data: GPSData = {
          ...localGPS,
          accuracy: localGPS.accuracy,  // ✅ 加入精度
          timestamp: Date.now(),
          deviceType: 'mobile'
        }
        sendMessage(data)
        console.log('📤 [手機] 初次發送 GPS:', data)
      }
    },
    
    onMessage: (event) => {
      try {
        // ✅ 修正：event.data 已經是解析後的物件（由 useWebSocket 處理）
        const data: GPSData = event.data
        console.log('📥 收到遠端 GPS 原始資料:', data)
        
        // ✅ 新增：驗證資料格式
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
          accuracy: data.accuracy,  // ✅ 加入精度日誌
          deviceType: data.deviceType,
          isMobile: isMobile
        })
        
        // 如果是筆電，接收手機的 GPS
        if (!isMobile && data.deviceType === 'mobile') {
          console.log('💻 [筆電] 準備更新 GPS...')
          setSyncedGPS({
            lat: data.lat,
            lon: data.lon,
            alt: data.alt,
            accuracy: data.accuracy ?? 999  // ✅ 同步精度
          })
          console.log('💻 [筆電] 已更新手機 GPS:', {
            lat: data.lat.toFixed(6),
            lon: data.lon.toFixed(6),
            alt: data.alt.toFixed(2),
            accuracy: `${(data.accuracy ?? 999).toFixed(2)}m`  // ✅ 加入精度日誌
          })
        } else if (isMobile && data.deviceType === 'mobile') {
          console.log('📱 [手機] 收到自己發送的 GPS，忽略')
        } else {
          console.log('ℹ️ 其他情況，裝置類型:', isMobile ? '手機' : '筆電', '資料類型:', data.deviceType)
        }
      } catch (error) {
        console.error('❌ 解析 GPS 資料失敗:', error, '原始資料:', event)
      }
    },
    
    onError: (error) => {
      console.error('❌ GPS WebSocket 錯誤:', error)
    },
    
    onDisconnect: () => {
      console.log('📡 GPS WebSocket 已關閉')
    }
  })

  // 當本地 GPS 更新時，如果是手機則發送
  useEffect(() => {
    console.log('🔍 檢查是否需要發送 GPS:', {
      isMobile,
      isConnected,
      hasGPS: localGPS.lat !== 0 && localGPS.lon !== 0,
      lat: localGPS.lat,
      lon: localGPS.lon,
      accuracy: localGPS.accuracy  // ✅ 加入精度日誌
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
      accuracy: localGPS.accuracy,  // ✅ 加入精度
      timestamp: Date.now(),
      deviceType: 'mobile'
    }
    
    console.log('📤 [手機] 準備發送 GPS:', data)
    sendMessage(data)
    console.log('📤 [手機] GPS 已發送 (精度: ' + data.accuracy.toFixed(2) + 'm)')  // ✅ 加入精度日誌
  }, [localGPS.lat, localGPS.lon, localGPS.alt, localGPS.accuracy, isMobile, isConnected, sendMessage])  // ✅ 加入 accuracy 依賴

  // 顯示連接狀態
  useEffect(() => {
    console.log(`🔌 GPS WebSocket 狀態: ${connectionStatus}`)
  }, [connectionStatus])

  // ✅ 新增：監控 syncedGPS 的變化
  useEffect(() => {
    console.log('🔄 syncedGPS 已更新:', {
      lat: syncedGPS.lat,
      lon: syncedGPS.lon,
      alt: syncedGPS.alt,
      accuracy: syncedGPS.accuracy,  // ✅ 加入精度日誌
      isMobile
    })
  }, [syncedGPS, isMobile])

  // 手機使用本地 GPS，筆電使用同步的 GPS
  const result = isMobile ? localGPS : syncedGPS
  
  console.log('📍 useGPSSync 返回:', {
    isMobile,
    result: {
      lat: result.lat,
      lon: result.lon,
      alt: result.alt,
      accuracy: result.accuracy  // ✅ 加入精度日誌
    }
  })
  
  return result
}