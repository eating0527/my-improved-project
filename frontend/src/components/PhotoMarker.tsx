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
}

function calculateRelativeFreshness(photoIndex: number, totalPhotos: number): number {
  if (totalPhotos <= 1) return 1
  const minOpacity = 0.2
  const maxOpacity = 1.0
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
  latitude,
  longitude,
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
          e.stopPropagation() // 防止事件穿透
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
          // 手機版優化：點擊時也可以切換預覽顯示，方便觸控操作
          setShowPreview(prev => !prev) 
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

      {/* 光環效果 */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6, 8, 32]} />
        <meshBasicMaterial
          color="#ffa500"
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
        zIndexRange={[90, 0]} // ✅ 新增：確保標籤不會被建築物遮得很嚴重
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

      {/* 懸浮預覽視窗 */}
      {showPreview && (
        <Html
          position={[0, 30, 0]}
          center
          zIndexRange={[100, 0]} // ✅ 新增：讓預覽視窗永遠顯示在最上層
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 99999, // CSS 層級保險
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
              minWidth: '220px', // 固定最小寬度，避免太窄
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
                border: '2px solid #ffa500',
                opacity: 1.0,
                backgroundColor: '#333' // 載入前顯示深色背景
              }}
              onError={(e) => {
                console.error('❌ 照片載入失敗:', photoUrl)
                e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect fill="%23333" width="200" height="200"/%3E%3Ctext fill="%23fff" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3E載入失敗%3C/text%3E%3C/svg%3E'
              }}
            />
            
            <div
              style={{
                color: '#ffa500',
                fontSize: '12px',
                fontFamily: 'monospace',
                textAlign: 'center',
                width: '100%'
              }}
            >
              <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{formatTimestamp(timestamp)}</div>
              
              <div style={{ fontSize: '10px', color: '#ffcc00' }}>
                💡 亮度: {(freshness * 100).toFixed(0)}% ({photoIndex + 1}/{totalPhotos})
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