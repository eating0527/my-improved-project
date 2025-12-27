import { useLayoutEffect, useMemo, useState, useEffect, Suspense } from 'react'
import { useGLTF, Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { TextureLoader, RepeatWrapping, SRGBColorSpace } from 'three'
import UAVFlight, { UAVManualDirection } from './UAVFlight'
import StaticModel from './StaticModel'
import { VisibleSatelliteInfo } from '../../types/satellite'
import SatelliteManager from './satellite/SatelliteManager'
import { ApiRoutes } from '../../config/apiRoutes'
import {
  getBackendSceneName,
  getSceneTextureName,
} from '../../utils/sceneUtils'
import UAVPath from '../UAVPath'
import PhotoMarker from '../PhotoMarker'
import USRPMarker from '../USRPMarker'
import { latLonToENU } from '../../utils/geo'

export interface MainSceneProps {
  devices: any[]
  auto: boolean
  manualControl?: (direction: UAVManualDirection) => void
  manualDirection?: UAVManualDirection
  onUAVPositionUpdate?: (
    position: [number, number, number],
    deviceId?: number
  ) => void
  uavAnimation: boolean
  selectedReceiverIds?: number[]
  satellites?: VisibleSatelliteInfo[]
  sceneName: string
  uavPath?: Array<{ x: number; y: number; z: number }>
  uavPosition?: [number, number, number]
  photos?: Array<{
    url: string
    timestamp: string
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
  }>
  origin?: { lat: number; lon: number; alt: number }
  scale?: number
  usrpData?: Array<{
    id: number
    timestamp: string
    frequency: number
    power: number
    snr: number
    bandwidth: number
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
    device_name: string
  }>
  allDevicePositions?: Map<string, {
    position: [number, number, number]
    deviceId: string
    deviceName?: string  // ✅ 新增：裝置名稱
    lat: number
    lon: number
    accuracy: number
  }>
  myDeviceId?: string | null
}

const UAV_SCALE = 10

const MainScene: React.FC<MainSceneProps> = ({
  devices = [],
  auto,
  manualDirection,
  manualControl,
  onUAVPositionUpdate,
  uavAnimation,
  selectedReceiverIds = [],
  satellites = [],
  sceneName,
  uavPath = [],
  uavPosition = [0, 10, 0],
  photos = [],
  origin,
  scale,
  usrpData = [],
  allDevicePositions,
  myDeviceId,
}) => {
  const [isMouseStill, setIsMouseStill] = useState(true)

  useEffect(() => {
    let timer: NodeJS.Timeout

    const handleMouseActivity = () => {
      setIsMouseStill(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIsMouseStill(true), 800)
    }

    window.addEventListener('mousemove', handleMouseActivity)
    window.addEventListener('wheel', handleMouseActivity)
    window.addEventListener('mousedown', handleMouseActivity)
    window.addEventListener('touchstart', handleMouseActivity, { passive: true })
    window.addEventListener('touchmove', handleMouseActivity, { passive: true })
    window.addEventListener('touchend', handleMouseActivity)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousemove', handleMouseActivity)
      window.removeEventListener('wheel', handleMouseActivity)
      window.removeEventListener('mousedown', handleMouseActivity)
      window.removeEventListener('touchstart', handleMouseActivity)
      window.removeEventListener('touchmove', handleMouseActivity)
      window.removeEventListener('touchend', handleMouseActivity)
    }
  }, [])

  const backendSceneName = getBackendSceneName(sceneName)
  const SCENE_URL = ApiRoutes.scenes.getSceneModel(backendSceneName)
  const BS_MODEL_URL = ApiRoutes.simulations.getModel('tower')
  const JAMMER_MODEL_URL = ApiRoutes.simulations.getModel('jam')
  const SATELLITE_TEXTURE_URL = ApiRoutes.scenes.getSceneTexture(
    backendSceneName,
    getSceneTextureName(sceneName)
  )

  useMemo(() => {
    useGLTF.preload(SCENE_URL)
    useGLTF.preload(BS_MODEL_URL)
    useGLTF.preload(JAMMER_MODEL_URL)
  }, [SCENE_URL, BS_MODEL_URL, JAMMER_MODEL_URL])

  const { scene: mainScene } = useGLTF(SCENE_URL) as any
  const { controls } = useThree()

  useLayoutEffect(() => {
    ;(controls as OrbitControlsImpl)?.target?.set(0, 0, 0)
  }, [controls])

  const prepared = useMemo(() => {
    const root = mainScene.clone(true)
    let maxArea = 0
    let groundMesh: THREE.Mesh | null = null
    const loader = new TextureLoader()
    const satelliteTexture = loader.load(SATELLITE_TEXTURE_URL)
    satelliteTexture.wrapS = RepeatWrapping
    satelliteTexture.wrapT = RepeatWrapping
    satelliteTexture.colorSpace = SRGBColorSpace
    satelliteTexture.repeat.set(1, 1)
    satelliteTexture.anisotropy = 16
    satelliteTexture.flipY = false

    root.traverse((o: THREE.Object3D) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh
        m.castShadow = true
        m.receiveShadow = true

        if (m.material) {
          if (Array.isArray(m.material)) {
            m.material = m.material.map((mat) =>
              mat instanceof THREE.MeshBasicMaterial
                ? new THREE.MeshStandardMaterial({
                    color: mat.color,
                    map: mat.map,
                  })
                : mat
            )
          } else if (m.material instanceof THREE.MeshBasicMaterial) {
            const basicMat = m.material
            m.material = new THREE.MeshStandardMaterial({
              color: basicMat.color,
              map: basicMat.map,
            })
          }
        }

        if (m.geometry) {
          m.geometry.computeBoundingBox()
          const bb = m.geometry.boundingBox
          if (bb) {
            const size = new THREE.Vector3()
            bb.getSize(size)
            const area = size.x * size.z
            if (area > maxArea) {
              if (groundMesh) groundMesh.castShadow = true
              maxArea = area
              groundMesh = m
              groundMesh.material = new THREE.MeshStandardMaterial({
                map: satelliteTexture,
                color: 0xffffff,
                roughness: 0.8,
                metalness: 0.1,
                emissive: 0x555555,
                emissiveIntensity: 0.4,
                vertexColors: false,
                normalScale: new THREE.Vector2(0.5, 0.5),
              })
              groundMesh.receiveShadow = true
              groundMesh.castShadow = false
            }
          }
        }
      }
    })
    return root
  }, [mainScene, SATELLITE_TEXTURE_URL])

  useEffect(() => {
    if (uavPath && uavPath.length > 0) {
      console.log('📍 MainScene 收到軌跡資料，點數:', uavPath.length)
    }
  }, [uavPath])

  useEffect(() => {
    if (uavPosition[1] < 5) {
      console.warn('⚠️ UAV 的 Y 座標太低，可能看不到！', uavPosition[1])
    }
  }, [uavPosition])

  useEffect(() => {
    if (allDevicePositions) {
      console.log('🚁 MainScene 裝置位置更新，當前數量:', allDevicePositions.size)
      
      const deviceIds = Array.from(allDevicePositions.keys())
      console.log('🚁 當前裝置列表:', deviceIds.map(id => id.substring(0, 8)))
      
      // ✅ 顯示裝置名稱
      allDevicePositions.forEach((device, deviceId) => {
        console.log(`🚁 裝置 ${deviceId.substring(0, 8)}: ${device.deviceName || 'N/A'}`)
      })
    }
  }, [allDevicePositions])

  useEffect(() => {
    if (photos.length > 0) {
      console.log('📸 MainScene 收到照片資料，數量:', photos.length)
    }
  }, [photos])

  useEffect(() => {
    if (usrpData.length > 0) {
      console.log('📡 MainScene 收到 USRP 資料，數量:', usrpData.length)
    }
  }, [usrpData])

  const deviceMeshes = useMemo(() => {
    return devices.map((device: any) => {
      if (device.role === 'receiver') {
        return null
      }
      
      if (device.role === 'desired') {
        return (
          <StaticModel
            key={device.id ?? `desired-${device.position_x}-${device.position_z}`}
            url={BS_MODEL_URL}
            position={[
              device.position_x,
              device.position_y + 5,
              device.position_z,
            ]}
            scale={[0.05, 0.05, 0.05]}
            pivotOffset={[0, -900, 0]}
          />
        )
      } else if (device.role === 'jammer') {
        return (
          <StaticModel
            key={device.id ?? `jammer-${device.position_x}-${device.position_z}`}
            url={JAMMER_MODEL_URL}
            position={[
              device.position_x,
              device.position_y + 5,
              device.position_z,
            ]}
            scale={[0.005, 0.005, 0.005]}
            pivotOffset={[0, -8970, 0]}
          />
        )
      } else if (device.role === 'user') {
        return null
      } 
      else if (device.role && String(device.role).trim() === 'tx-interference') {
        return (
          <group
            key={device.id ?? `tx-${device.position_x}-${device.position_z}`}
            position={[
              device.position_x,
              device.position_y,
              device.position_z,
            ]}
          >
            <mesh>
              <sphereGeometry args={[10, 32, 32]} />
              <meshStandardMaterial 
                color="red" 
                emissive={0xff0000}
                emissiveIntensity={1.5}
                opacity={1.0}
                transparent={false}
              />
            </mesh>

            {isMouseStill && (
              <Html
                position={[0, 50, 0]}
                center
                sprite
                style={{
                  background: 'rgba(255, 0, 0, 0.85)',
                  color: 'black',
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  border: '2px solid #ff0000',
                  boxShadow: '0 4px 12px rgba(255, 0, 0, 0.5)',
                }}
              >
                📡 基準點2 繁星樓宿舍
              </Html>
            )}
          </group>
        )
      }
      else if (device.role && String(device.role).trim() === 'rx-interference') {
        return (
          <group
            key={device.id ?? `rx-${device.position_x}-${device.position_z}`}
            position={[
              device.position_x,
              device.position_y,
              device.position_z,
            ]}
          >
            <mesh>
              <sphereGeometry args={[10, 32, 32]} />
              <meshStandardMaterial 
                color="green" 
                emissive={0x00ff00}
                emissiveIntensity={1.5}
                opacity={1.0}
                transparent={false}
              />
            </mesh>

            {isMouseStill && (
              <Html
                position={[0, 50, 0]}
                center
                sprite
                style={{
                  background: 'rgba(0, 255, 0, 0.85)',
                  color: 'black',
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  border: '2px solid #00ff00',
                  boxShadow: '0 4px 12px rgba(0, 255, 0, 0.5)',
                }}
              >
                📡 基準點1 電機資訊大樓
              </Html>
            )}
          </group>
        )
      }
      else if (device.role && String(device.role).trim() === 'baseline-point-3') {
        return (
          <group
            key={device.id ?? `baseline-point-3-${device.position_x}-${device.position_z}`}
            position={[
              device.position_x,
              device.position_y,
              device.position_z,
            ]}
          >
            <mesh>
              <sphereGeometry args={[10, 32, 32]} />
              <meshStandardMaterial 
                color="yellow" 
                emissive={0xffff00}
                emissiveIntensity={1.5}
                opacity={1.0}
                transparent={false}
              />
            </mesh>

            {isMouseStill && (
              <Html
                position={[0, 50, 0]}
                center
                sprite
                style={{
                  background: 'rgba(255, 255, 0, 0.85)',
                  color: 'black',
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  border: '2px solid #ffff00',
                  boxShadow: '0 4px 12px rgba(255, 255, 0, 0.5)',
                }}
              >
                📡 基準點3 行政大樓
              </Html>
            )}
          </group>
        )
      }
      else {
        return null
      }
    })
  }, [
    devices,
    BS_MODEL_URL,
    JAMMER_MODEL_URL,
    isMouseStill,
  ])

  // ✅ 統一使用 allDevicesUAVs 渲染所有裝置的 UAV（包含裝置名稱）
  const allDevicesUAVs = useMemo(() => {
    if (!allDevicePositions || allDevicePositions.size === 0) {
      console.log('⚠️ 沒有裝置位置資料，顯示預設 UAV')
      return (
        <Suspense key="default-uav" fallback={null}>
          <group position={uavPosition}>
            <UAVFlight
              position={[0, 0, 0]}
              scale={[10, 10, 10]}
              auto={false}
              uavAnimation={true}
              onPositionUpdate={() => {}}
            />

            {isMouseStill && (
              <Html
                position={[0, 30, 0]}
                center
                sprite
                style={{
                  background: 'rgba(30, 30, 30, 0.95)',
                  color: 'white',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  border: '2px solid #555',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6)',
                  lineHeight: '1.4',
                }}
              >
                🚁 UAV 預設位置
              </Html>
            )}
          </group>
        </Suspense>
      )
    }

    console.log('🚁 準備渲染 UAV，數量:', allDevicePositions.size)

    return Array.from(allDevicePositions.entries()).map(([deviceId, device]) => {
      const isMyDevice = deviceId === myDeviceId
      
      // ✅ 取得裝置顯示名稱（優先使用 deviceName，否則使用 deviceId 前 8 碼）
      const displayName = device.deviceName || deviceId.substring(0, 8)
      
      console.log(`🚁 渲染 UAV: ${displayName}`, {
        deviceId: deviceId.substring(0, 8),
        deviceName: device.deviceName,
        isMyDevice,
        position: device.position,
        accuracy: device.accuracy
      })
      
      return (
        <Suspense key={deviceId} fallback={null}>
          <group position={device.position}>
            <UAVFlight
              position={[0, 0, 0]}
              scale={[10, 10, 10]}
              auto={false}
              uavAnimation={true}
              onPositionUpdate={() => {}}
            />

            {isMouseStill && (
              <Html
                position={[0, 30, 0]}
                center
                sprite
                style={{
                  // ✅ 我的裝置：深色背景 (深灰色)
                  // ✅ 其他裝置：淺色背景 (淺藍綠色)
                  background: isMyDevice 
                    ? 'rgba(30, 30, 30, 0.95)'      // 深色
                    : 'rgba(173, 216, 230, 0.95)',  // 淺色
                  color: isMyDevice ? 'white' : 'black',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  border: isMyDevice 
                    ? '2px solid #555'       // 深色邊框
                    : '2px solid #87CEEB',   // 淺色邊框
                  boxShadow: isMyDevice 
                    ? '0 4px 12px rgba(0, 0, 0, 0.6)' 
                    : '0 4px 12px rgba(135, 206, 235, 0.6)',
                  lineHeight: '1.4',
                }}
              >
                {/* ✅ 修改：顯示裝置名稱而非 deviceId */}
                <div style={{ marginBottom: '3px' }}>
                  {isMyDevice ? '🟤 我的裝置: ' : '⚪ '}{displayName}
                </div>
                <div style={{ fontSize: '9px', opacity: 0.9, marginBottom: '2px' }}>
                  📍 {device.lat.toFixed(6)}°, {device.lon.toFixed(6)}°
                </div>
                <div style={{ fontSize: '9px', opacity: 0.8 }}>
                  🎯 精度: {device.accuracy.toFixed(1)}m
                </div>
                {/* ✅ 新增：顯示完整 deviceId（縮小字體） */}
                <div style={{ fontSize: '8px', opacity: 0.6, marginTop: '3px' }}>
                  ID: {deviceId.substring(0, 12)}...
                </div>
              </Html>
            )}
          </group>
        </Suspense>
      )
    })
  }, [allDevicePositions, myDeviceId, isMouseStill, uavPosition])

  return (
    <>
      <primitive object={prepared} castShadow receiveShadow />
      {deviceMeshes}
      <SatelliteManager satellites={satellites} />
      
      {uavPath && uavPath.length > 1 && (
        <UAVPath 
          path={uavPath} 
          color="#00ff00" 
          lineWidth={3} 
        />
      )}

      {origin && scale && photos.length > 0 && (
        <>
          {photos.map((photo, index) => {
            if (!photo.latitude || !photo.longitude) {
              return null
            }

            const [east, north, up] = latLonToENU(
              photo.latitude,
              photo.longitude,
              photo.altitude ?? 0,
              origin,
              0
            )

            const x = east * scale
            const z = north * scale
            const y = Math.max(up * scale, 10)

            return (
              <PhotoMarker
                key={`photo-${index}`}
                position={[x, y, z]}
                photoUrl={photo.url}
                timestamp={photo.timestamp}
                photoIndex={index}
                totalPhotos={photos.length}
                latitude={photo.latitude}
                longitude={photo.longitude}
                onClick={() => {
                  console.log('📸 點擊照片:', photo.url)
                }}
              />
            )
          })}
        </>
      )}

      {origin && scale && usrpData.length > 0 && (
        <>
          {usrpData.map((usrp) => {
            if (!usrp.latitude || !usrp.longitude) {
              return null
            }

            const [east, north, up] = latLonToENU(
              usrp.latitude,
              usrp.longitude,
              usrp.altitude ?? 0,
              origin,
              0
            )

            const x = east * scale
            const z = north * scale
            const y = Math.max(up * scale, 10)

            return (
              <USRPMarker
                key={`usrp-${usrp.id}`}
                position={[x, y, z]}
                frequency={usrp.frequency}
                power={usrp.power}
                snr={usrp.snr}
                bandwidth={usrp.bandwidth}
                timestamp={usrp.timestamp}
                deviceName={usrp.device_name}
                latitude={usrp.latitude}
                longitude={usrp.longitude}
                onClick={() => {
                  console.log('📡 點擊 USRP:', usrp.device_name)
                }}
              />
            )
          })}
        </>
      )}

      {allDevicesUAVs}
    </>
  )
}

export default MainScene