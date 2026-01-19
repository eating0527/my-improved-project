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

// 1. 簡易 Hash 函式：根據字串產生固定的顏色索引
const getHashColor = (str: string, colors: string[]) => {
  if (!str) return '#ffa500' // 如果沒有 ID，預設橘色
  
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % colors.length
  return colors[index]
}

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
    deviceId?: string // ✅ 接收 deviceId
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
    deviceName?: string
    lat: number
    lon: number
    accuracy: number
  }>
  myDeviceId?: string | null
  devicePaths?: Map<string, Array<{ x: number; y: number; z: number }>>
  deviceColors?: string[]
}

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
  devicePaths,
  deviceColors = ['#00ff00', '#ff0000', '#0000ff', '#ffff00', '#00ffff'],
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

  const deviceMeshes = useMemo(() => {
    return devices.map((device: any) => {
      if (device.role === 'receiver') return null
      
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
      } else if (device.role && String(device.role).trim() === 'tx-interference') {
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
      return null
    })
  }, [devices, BS_MODEL_URL, JAMMER_MODEL_URL, isMouseStill])

  const allDevicesUAVs = useMemo(() => {
    let devicesToRender: any[] = []

    if (allDevicePositions && allDevicePositions.size > 0) {
      devicesToRender = Array.from(allDevicePositions.entries()).map(([id, device]) => ({
        ...device,
        id,
        isMe: id === myDeviceId
      }))
    } else {
      devicesToRender = [{
        id: myDeviceId || 'self',
        position: uavPosition,
        deviceName: '', 
        lat: 0,
        lon: 0,
        accuracy: 0,
        isMe: true
      }]
    }

    return devicesToRender.map((device) => {
      const displayName = device.deviceName || device.id.substring(0, 8)
      
      return (
        <Suspense key={device.id} fallback={null}>
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
                  background: device.isMe 
                    ? 'rgba(30, 30, 30, 0.95)'      
                    : 'rgba(173, 216, 230, 0.95)',  
                  color: device.isMe ? 'white' : 'black',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  border: device.isMe 
                    ? '2px solid #555' 
                    : '2px solid #87CEEB',
                  boxShadow: device.isMe 
                    ? '0 4px 12px rgba(0, 0, 0, 0.6)' 
                    : '0 4px 12px rgba(135, 206, 235, 0.6)',
                  lineHeight: '1.4',
                }}
              >
                <div style={{ marginBottom: '3px' }}>
                  {device.isMe ? 'UAV' : '⚪ '}{displayName}
                </div>
                {device.lat !== 0 && (
                  <>
                    <div style={{ fontSize: '9px', opacity: 0.9, marginBottom: '2px' }}>
                      📍 {device.lat.toFixed(6)}°, {device.lon.toFixed(6)}°
                    </div>
                    <div style={{ fontSize: '9px', opacity: 0.8 }}>
                      🎯 精度: {device.accuracy.toFixed(1)}m
                    </div>
                  </>
                )}
                <div style={{ fontSize: '8px', opacity: 0.6, marginTop: '3px' }}>
                  ID: {device.id.substring(0, 12)}...
                </div>
              </Html>
            )}
          </group>
        </Suspense>
      )
    })
  }, [allDevicePositions, myDeviceId, isMouseStill, uavPosition])

  // 🔥🔥🔥 關鍵新邏輯：計算每張照片在「該裝置」中的排名
  // 這樣不同裝置的照片亮度就會分開計算，互不影響
  const processedPhotos = useMemo(() => {
    if (!photos || photos.length === 0) return []

    // 1. 先把照片依據 deviceId 分組
    const groups: { [key: string]: typeof photos } = {}
    
    // 為了安全起見，先複製一份並按時間排序（舊到新），這樣 index 越大代表越新
    const sortedPhotos = [...photos].sort((a, b) => 
      (a.timestamp || '').localeCompare(b.timestamp || '')
    )

    sortedPhotos.forEach(photo => {
      const id = photo.deviceId || 'unknown'
      if (!groups[id]) groups[id] = []
      groups[id].push(photo)
    })

    // 2. 遍歷原始 photos，找出它在自己組別裡的 index 和該組總數
    return photos.map(photo => {
      const id = photo.deviceId || 'unknown'
      const groupList = groups[id]
      
      // 找出這張照片在該裝置清單中的排名 (0 是最舊，length-1 是最新)
      const myIndex = groupList.findIndex(p => p.url === photo.url)
      const myTotal = groupList.length

      return {
        ...photo,
        // 這些是用來算亮度的參數
        devicePhotoIndex: myIndex, 
        deviceTotalPhotos: myTotal
      }
    })
  }, [photos])

  return (
    <>
      <primitive object={prepared} castShadow receiveShadow />
      {deviceMeshes}
      <SatelliteManager satellites={satellites} />
      
      {/* 1. 單機模式的軌跡 (uavPath) */}
      {uavPath && uavPath.length > 1 && !devicePaths && (
        <UAVPath 
          path={uavPath} 
          color="#00ff00" 
          lineWidth={3} 
        />
      )}

      {/* 2. ✅ 多機模式的彩色軌跡 (devicePaths) */}
      {devicePaths && Array.from(devicePaths.entries()).map(([deviceId, path]) => {
        // 如果點太少不畫
        if (path.length < 2) return null
        
        // 恢復原本的顏色邏輯 (隨機/Hash 分配)
        const pathColor = getHashColor(deviceId, deviceColors)

        return (
          <UAVPath 
            // 🔥🔥🔥 關鍵修正：移除 path.length，解決閃爍問題
            // 只用 deviceId 作為 key，讓 React 知道這還是同一條線，只是屬性更新了
            key={`path-${deviceId}`} 
            
            path={path} 
            color={pathColor} 
            lineWidth={3} 
          />
        )
      })}

      {/* ✅ 3. 渲染照片球體 (帶顏色 + 獨立亮度計算) */}
      {origin && scale && processedPhotos.length > 0 && (
        <>
          {processedPhotos.map((photo, index) => {
            if (!photo.latitude || !photo.longitude) return null

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

            // 計算顏色
            const photoColor = getHashColor(photo.deviceId || '', deviceColors)

            return (
              <PhotoMarker
                key={`photo-${index}`}
                position={[x, y, z]}
                photoUrl={photo.url}
                timestamp={photo.timestamp}
                
                // ✅ 關鍵修改：傳入該裝置專屬的排名
                // 這樣 PhotoMarker 算出來的 freshness 就是針對該裝置的
                photoIndex={photo.devicePhotoIndex}
                totalPhotos={photo.deviceTotalPhotos}
                
                latitude={photo.latitude}
                longitude={photo.longitude}
                color={photoColor}
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
            if (!usrp.latitude || !usrp.longitude) return null

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