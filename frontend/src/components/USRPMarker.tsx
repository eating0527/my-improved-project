import React, { useState, useRef } from 'react'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

interface USRPMarkerProps {
  position: [number, number, number]
  frequency: number
  power: number
  snr: number
  bandwidth: number
  timestamp: string
  deviceName: string
  latitude?: number | null
  longitude?: number | null
  onClick?: () => void
}

const USRPMarker: React.FC<USRPMarkerProps> = ({
  position,
  frequency,
  power,
  snr,
  bandwidth,
  timestamp,
  deviceName,
  latitude,
  longitude,
  onClick,
}) => {
  const [hovered, setHovered] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)

  const formatFrequency = (freq: number) => {
    if (freq >= 1e9) return `${(freq / 1e9).toFixed(3)} GHz`
    if (freq >= 1e6) return `${(freq / 1e6).toFixed(3)} MHz`
    if (freq >= 1e3) return `${(freq / 1e3).toFixed(3)} kHz`
    return `${freq} Hz`
  }

  const formatBandwidth = (bw: number) => {
    if (bw >= 1e6) return `${(bw / 1e6).toFixed(1)} MHz`
    if (bw >= 1e3) return `${(bw / 1e3).toFixed(1)} kHz`
    return `${bw} Hz`
  }

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

  const formatCoordinate = (value: number | null | undefined, type: 'lat' | 'lon') => {
    if (value === null || value === undefined) return 'N/A'
    const fixed = value.toFixed(6)
    if (type === 'lat') {
      return value >= 0 ? `${fixed}°N` : `${Math.abs(value).toFixed(6)}°S`
    } else {
      return value >= 0 ? `${fixed}°E` : `${Math.abs(value).toFixed(6)}°W`
    }
  }

  const getSignalColor = () => {
    if (snr >= 15) return '#00ff00'
    if (snr >= 10) return '#ffff00'
    return '#ff0000'
  }

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => {
          setHovered(true)
          setShowInfo(true)
        }}
        onPointerOut={() => {
          setHovered(false)
          setShowInfo(false)
        }}
        onClick={() => {
          console.log('📡 點擊 USRP 標記:', deviceName)
          onClick?.()
        }}
      >
        <sphereGeometry args={[5, 32, 32]} />
        <meshStandardMaterial
          color={hovered ? '#00ffff' : getSignalColor()}
          emissive={hovered ? '#00ffff' : getSignalColor()}
          emissiveIntensity={hovered ? 2.0 : 1.5}
          opacity={0.9}
          transparent
        />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6, 8, 32]} />
        <meshBasicMaterial
          color={getSignalColor()}
          opacity={0.5}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>

      <Html
        position={[0, 15, 0]}
        center
        sprite
        style={{
          background: hovered
            ? 'rgba(0, 255, 255, 0.95)'
            : getSignalColor() === '#00ff00'
            ? 'rgba(0, 255, 0, 0.9)'
            : getSignalColor() === '#ffff00'
            ? 'rgba(255, 255, 0, 0.9)'
            : 'rgba(255, 0, 0, 0.9)',
          color: 'white',
          padding: '5px 10px',
          borderRadius: '5px',
          fontSize: '14px',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          userSelect: 'none',
          border: hovered ? '2px solid #00ffff' : `2px solid ${getSignalColor()}`,
          boxShadow: hovered
            ? '0 4px 16px rgba(0, 255, 255, 0.6)'
            : `0 4px 12px ${getSignalColor()}80`,
          transition: 'all 0.3s ease',
        }}
      >
        📡 {deviceName}
      </Html>

      {showInfo && (
        <Html
          position={[0, 35, 0]}
          center
          style={{
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.95)',
              padding: '15px',
              borderRadius: '10px',
              border: `2px solid ${getSignalColor()}`,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.8)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '8px',
              minWidth: '280px',
            }}
          >
            <div
              style={{
                color: getSignalColor(),
                fontSize: '16px',
                fontWeight: 'bold',
                fontFamily: 'monospace',
                borderBottom: `2px solid ${getSignalColor()}`,
                paddingBottom: '8px',
                width: '100%',
              }}
            >
              📡 {deviceName}
            </div>

            <div
              style={{
                color: '#ffffff',
                fontSize: '12px',
                fontFamily: 'monospace',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#aaa' }}>🕐 時間:</span>
                <span>{formatTimestamp(timestamp)}</span>
              </div>

              {/* ✅ 經緯度區塊（移除海拔） */}
              <div style={{ 
                borderTop: '1px solid #444', 
                paddingTop: '6px', 
                marginTop: '4px' 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#aaa' }}>📍 緯度:</span>
                  <span>{formatCoordinate(latitude, 'lat')}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#aaa' }}>📍 經度:</span>
                  <span>{formatCoordinate(longitude, 'lon')}</span>
                </div>
              </div>

              <div style={{ 
                borderTop: '1px solid #444', 
                paddingTop: '6px', 
                marginTop: '4px' 
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#aaa' }}>📻 頻率:</span>
                  <span>{formatFrequency(frequency)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#aaa' }}>📊 頻寬:</span>
                  <span>{formatBandwidth(bandwidth)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#aaa' }}>⚡ 功率:</span>
                  <span>{power.toFixed(1)} dBm</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#aaa' }}>📶 SNR:</span>
                  <span style={{ 
                    color: getSignalColor(),
                    fontWeight: 'bold' 
                  }}>
                    {snr.toFixed(1)} dB
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

export default USRPMarker