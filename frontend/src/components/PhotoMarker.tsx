import React, { useState, useRef } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

interface PhotoMarkerProps {
  position: [number, number, number]
  photoUrl: string
  timestamp: string
  onClick?: () => void
  photoIndex?: number
  totalPhotos?: number
  latitude?: number   // ✅ 新增：緯度
  longitude?: number  // ✅ 新增：經度
}

/**
 * ✅ 計算照片的相對新鮮度（基於照片列表中的順序）
 * @param photoIndex 照片在列表中的索引（0 = 最新）
 * @param totalPhotos 照片總數
 * @returns 新鮮度值（1 = 最新，0.2 = 最舊）
 */
function calculateRelativeFreshness(photoIndex: number, totalPhotos: number): number {
  if (totalPhotos <= 1) {
    return 1 // 只有一張照片時，設為最亮
  }
  
  const minOpacity = 0.2
  const maxOpacity = 1.0
  
  // 線性插值：第一張照片 = 1.0，最後一張照片 = 0.2
  const freshness = maxOpacity - (photoIndex / (totalPhotos - 1)) * (maxOpacity - minOpacity)
  
  return freshness
}

const PhotoMarker: React.FC<PhotoMarkerProps> = ({
  position,
  photoUrl,
  timestamp,
  onClick,
  photoIndex = 0,
  totalPhotos = 1,
  latitude,   // ✅ 接收緯度
  longitude,  // ✅ 接收經度
}) => {
  const [hovered, setHovered] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)

  // ✅ 計算相對新鮮度
  const freshness = calculateRelativeFreshness(photoIndex, totalPhotos)

  // 格式化時間戳記
  const formatTimestamp = (ts: string) => {
    try {
      // 假設格式為 "20251118_143000"
      const year = ts.substring(0, 4)
      const month = ts.substring(4, 6)
      const day = ts.substring(6, 8)
      const hour = ts.substring(9, 11)
      const minute = ts.substring(11, 13)
      const second = ts.substring(13, 15)
      
      return `${year}/${month}/${day} ${hour}:${minute}:${second}`
    } catch {
      return ts
    }
  }

  // ✅ 格式化經緯度（保留 6 位小數）
  const formatGPS = (lat?: number, lon?: number) => {
    if (lat === undefined || lon === undefined) {
      return '無 GPS 資料'
    }
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
  }

  return (
    <group position={position}>
      {/* 照片圖標球體（根據相對新鮮度調整透明度） */}
      <mesh
        ref={meshRef}
        onPointerOver={() => {
          setHovered(true)
          setShowPreview(true)
        }}
        onPointerOut={() => {
          setHovered(false)
          setShowPreview(false)
        }}
        onClick={() => {
          console.log('📸 點擊照片標記:', photoUrl)
          onClick?.()
        }}
      >
        <sphereGeometry args={[5, 32, 32]} />
        <meshStandardMaterial
          color={hovered ? '#ff69b4' : '#ffa500'}
          emissive={hovered ? '#ff1493' : '#ff8c00'}
          emissiveIntensity={hovered ? freshness * 2.0 : freshness * 1.5}
          opacity={freshness * 0.9}
          transparent
        />
      </mesh>

      {/* 光環效果（根據相對新鮮度調整透明度） */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6, 8, 32]} />
        <meshBasicMaterial
          color="#ffa500"
          opacity={freshness * 0.5}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 照片圖標 HTML 標籤（根據相對新鮮度調整背景透明度） */}
      <Html
        position={[0, 15, 0]}
        center
        sprite
        style={{
          background: hovered
            ? `rgba(255, 105, 180, ${freshness * 0.95})`
            : `rgba(255, 165, 0, ${freshness * 0.9})`,
          color: 'white',
          padding: '5px 10px',
          borderRadius: '5px',
          fontSize: '14px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          userSelect: 'none',
          border: hovered ? '2px solid #ff69b4' : '2px solid #ffa500',
          boxShadow: hovered
            ? `0 4px 16px rgba(255, 105, 180, ${freshness * 0.6})`
            : `0 4px 12px rgba(255, 165, 0, ${freshness * 0.5})`,
          transition: 'all 0.3s ease',
        }}
      >
        📷 照片 #{totalPhotos - photoIndex}
      </Html>

      {/* 滑鼠懸停時顯示照片預覽 */}
      {showPreview && (
        <Html
          position={[0, 30, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.9)',
              padding: '10px',
              borderRadius: '10px',
              border: '2px solid #ffa500',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {/* 照片預覽 */}
            <img
              src={`https://backend.simworld.website${photoUrl}`}
              alt="Photo preview"
              style={{
                width: '200px',
                height: '200px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: '2px solid #ffa500',
                opacity: 1.0,
              }}
              onError={(e) => {
                console.error('❌ 照片載入失敗:', photoUrl)
                e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23333" width="200" height="200"/%3E%3Ctext fill="%23fff" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3E載入失敗%3C/text%3E%3C/svg%3E'
              }}
            />
            
            {/* 時間戳記 + 球體亮度資訊 + 經緯度 */}
            <div
              style={{
                color: '#ffa500',
                fontSize: '12px',
                fontFamily: 'monospace',
                textAlign: 'center',
              }}
            >
              {/* 時間戳記 */}
              <div>{formatTimestamp(timestamp)}</div>
              
              {/* 球體亮度 */}
              <div style={{ marginTop: '4px', fontSize: '10px', color: '#ffcc00' }}>
                💡 球體亮度: {(freshness * 100).toFixed(0)}% ({photoIndex + 1}/{totalPhotos})
              </div>
              
              {/* ✅ 經緯度 */}
              <div style={{ marginTop: '4px', fontSize: '10px', color: '#66ff66' }}>
                📍 GPS: {formatGPS(latitude, longitude)}
              </div>
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

export default PhotoMarker