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
  latitude?: number
  longitude?: number
  color?: string
}

// ✅ 修改亮度計算：越新的照片 (Index 越大) 越亮，越舊的越暗
function calculateRelativeFreshness(photoIndex: number, totalPhotos: number): number {
  if (totalPhotos <= 1) return 1
  
  const minOpacity = 0.3 // 最舊的照片最低亮度 (可以自己調，例如 0.2)
  const maxOpacity = 1.0 // 最新的照片亮度
  
  // 公式：(當前排名 / (總數 - 1)) * 範圍 + 最低值
  // Index 0 (最早) => 0 + 0.3 = 0.3
  // Index Max (最新) => 0.7 + 0.3 = 1.0
  const freshness = (photoIndex / (totalPhotos - 1)) * (maxOpacity - minOpacity) + minOpacity
  
  return freshness
}

const PhotoMarker: React.FC<PhotoMarkerProps> = ({
  position,
  photoUrl,
  timestamp,
  onClick,
  photoIndex = 0,
  totalPhotos = 1,
  latitude,
  longitude,
  color = '#ffa500',
}) => {
  const [hovered, setHovered] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)

  const freshness = calculateRelativeFreshness(photoIndex, totalPhotos)

  const formatTimestamp = (ts: string) => {
    try {
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

  const formatGPS = (lat?: number, lon?: number) => {
    if (lat === undefined || lon === undefined) return '無 GPS 資料'
    return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
  }

  return (
    <group position={position}>
      {/* 照片圖標球體 */}
      <mesh
        ref={meshRef}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          setShowPreview(true)
        }}
        onPointerOut={() => {
          setHovered(false)
          setShowPreview(false)
        }}
        onClick={(e) => {
          e.stopPropagation()
          console.log('📸 點擊照片標記:', photoUrl)
          onClick?.()
          setShowPreview(prev => !prev) 
        }}
      >
        <sphereGeometry args={[5, 32, 32]} />
        <meshStandardMaterial
          color={hovered ? '#ff69b4' : color}
          emissive={hovered ? '#ff1493' : color}
          // 滑鼠移上去時最亮，平常依照新舊程度顯示亮度
          emissiveIntensity={hovered ? 2.0 : freshness * 1.5}
          opacity={freshness * 0.9}
          transparent
        />
      </mesh>

      {/* 光環效果 */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6, 8, 32]} />
        <meshBasicMaterial
          color={color}
          opacity={freshness * 0.5}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 標籤：照片編號 */}
      <Html
        position={[0, 15, 0]}
        center
        sprite
        zIndexRange={[90, 0]}
        style={{
          background: hovered
            ? `rgba(255, 105, 180, 0.95)` // Hover 時不透明
            : `rgba(40, 40, 40, ${freshness})`, // 平常跟著亮度淡出
          color: 'white',
          padding: '5px 10px',
          borderRadius: '5px',
          fontSize: '14px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          userSelect: 'none',
          border: hovered ? '2px solid #ff69b4' : `2px solid ${color}`,
          // 越舊的照片，標籤越透明，避免干擾視覺
          opacity: hovered ? 1 : Math.max(0.5, freshness),
          boxShadow: hovered
            ? `0 4px 16px rgba(255, 105, 180, 0.6)`
            : `0 4px 12px ${color}66`,
          transition: 'all 0.3s ease',
        }}
      >
        {/* ✅ 修改這裡：最早的是 #1，依序增加 */}
        📷 照片 #{photoIndex + 1}
      </Html>

      {/* 懸浮預覽視窗 */}
      {showPreview && (
        <Html
          position={[0, 30, 0]}
          center
          zIndexRange={[100, 0]}
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 99999,
          }}
        >
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.9)',
              padding: '10px',
              borderRadius: '10px',
              border: `2px solid ${color}`,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              minWidth: '220px',
            }}
          >
            <img
              src={`https://backend.simworld.website${photoUrl}`}
              alt="Photo preview"
              style={{
                width: '200px',
                height: '200px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: `2px solid ${color}`,
                opacity: 1.0,
                backgroundColor: '#333'
              }}
              onError={(e) => {
                console.error('❌ 照片載入失敗:', photoUrl)
                e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23333" width="200" height="200"/%3E%3Ctext fill="%23fff" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3E載入失敗%3C/text%3E%3C/svg%3E'
              }}
            />
            
            <div
              style={{
                color: color,
                fontSize: '12px',
                fontFamily: 'monospace',
                textAlign: 'center',
                width: '100%'
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{formatTimestamp(timestamp)}</div>
              
              <div style={{ fontSize: '10px', color: '#ccc' }}>
                {/* 顯示亮度資訊，方便除錯 */}
                💡 亮度: {(freshness * 100).toFixed(0)}% (No.{photoIndex + 1})
              </div>
              
              <div style={{ marginTop: '4px', fontSize: '10px', color: '#66ff66' }}>
                📍 {formatGPS(latitude, longitude)}
              </div>
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

export default PhotoMarker