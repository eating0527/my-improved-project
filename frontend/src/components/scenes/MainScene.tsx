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
import { latLonToENU } from '../../utils/geo'  // ✅ 加入這行

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
  origin?: { lat: number; lon: number; alt: number }  // ✅ 加入 alt
  scale?: number
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
    console.log('🚁 MainScene 收到 UAV 位置:', uavPosition)
    console.log('🚁 UAV 位置詳細:', {
      x: uavPosition[0],
      y: uavPosition[1],
      z: uavPosition[2],
    })
    
    if (uavPosition[1] < 5) {
      console.warn('⚠️ UAV 的 Y 座標太低，可能看不到！', uavPosition[1])
    }
  }, [uavPosition])

  // ✅ 監聽照片資料
  useEffect(() => {
    if (photos.length > 0) {
      console.log('📸 MainScene 收到照片資料，數量:', photos.length)
      console.log('📸 照片詳細資訊:', photos)
      console.log('📸 origin:', origin)
      console.log('📸 scale:', scale)
    }
  }, [photos, origin, scale])

  const deviceMeshes = useMemo(() => {
    console.log('🎯 MainScene devices:', devices)
    console.log('🎯 devices 數量:', devices.length)
    
    devices.forEach((d, index) => {
      console.log(`🎯 設備 ${index}:`, {
        id: d.id,
        idType: typeof d.id,
        role: d.role,
        roleType: typeof d.role,
        roleValue: `"${d.role}"`,
        roleLength: d.role?.length,
        position: [d.position_x, d.position_y, d.position_z]
      })
    })

    return devices.map((device: any) => {
      console.log('🔍 正在處理 device:', { 
        id: device.id, 
        role: device.role,
        roleMatch: device.role === 'tx-interference',
        roleTrimMatch: String(device.role).trim() === 'tx-interference',
        position: [device.position_x, device.position_y, device.position_z] 
      })

      const isSelected =
        device.role === 'receiver' &&
        device.id !== null &&
        selectedReceiverIds.includes(device.id)

      if (device.role === 'receiver') {
        const position: [number, number, number] = [
          device.position_x,
          device.position_y,
          device.position_z,
        ]
        const shouldControl = isSelected

        return (
          <UAVFlight
            key={
              device.id
                ? `uav-${device.id}`
                : `temp-${device.position_x}-${device.position_y}-${device.position_z}`
            }
            position={position}
            scale={[UAV_SCALE, UAV_SCALE, UAV_SCALE]}
            auto={shouldControl ? auto : false}
            manualDirection={shouldControl ? manualDirection : null}
            onManualMoveDone={() => {
              if (manualControl) manualControl(null)
            }}
            onPositionUpdate={(pos) => {
              if (onUAVPositionUpdate && shouldControl) {
                onUAVPositionUpdate(pos, device.id ?? undefined)
              }
            }}
            uavAnimation={shouldControl ? uavAnimation : false}
          />
        )
      } else if (device.role === 'desired') {
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
        console.log('🔵 User device 已被 UAVFlight 替代，不再渲染藍色球')
        return null
      } 
      else if (device.role && String(device.role).trim() === 'tx-interference') {
        console.log('🔴🔴🔴 找到 TX 干擾源!!!', device)
        console.log('🔴 TX 干擾源座標:', {
          x: device.position_x,
          y: device.position_y,
          z: device.position_z,
        })
        
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
        console.log('🟢🟢🟢 找到 RX 干擾源!!!', device)
        console.log('🟢 RX 干擾源座標:', {
          x: device.position_x,
          y: device.position_y,
          z: device.position_z,
        })
        
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
        console.log('🟡🟡🟡 找到基準點3!!!', device)
        console.log('🟡 基準點3座標:', {
          x: device.position_x,
          y: device.position_y,
          z: device.position_z,
        })
        
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
        console.log('⚪ 未知的 device role:', device.role)
        return null
      }
    })
  }, [
    devices,
    auto,
    manualDirection,
    onUAVPositionUpdate,
    manualControl,
    uavAnimation,
    selectedReceiverIds,
    BS_MODEL_URL,
    JAMMER_MODEL_URL,
    isMouseStill,
  ])

  return (
    <>
      <primitive object={prepared} castShadow receiveShadow />
      {deviceMeshes}
      <SatelliteManager satellites={satellites} />
      
      {/* ✅ 渲染 UAV 軌跡 */}
      {uavPath && uavPath.length > 1 && (
        <UAVPath 
          path={uavPath} 
          color="#00ff00" 
          lineWidth={3} 
        />
      )}

      {/* ✅ 渲染照片標記（使用 latLonToENU 正確轉換） */}
      {origin && scale && photos.length > 0 && (
        <>
          {console.log('📸 開始渲染 PhotoMarker，照片數量:', photos.length)}
          {photos.map((photo, index) => {
            console.log(`📸 處理照片 ${index}:`, photo);
            
            if (!photo.latitude || !photo.longitude) {
              console.warn(`⚠️ 照片 ${index} 缺少 GPS 資料:`, photo);
              return null;
            }

            // ✅ 使用 latLonToENU 轉換（和 UserLocation 一樣）
            const [east, north, up] = latLonToENU(
              photo.latitude,
              photo.longitude,
              photo.altitude ?? 0,
              origin,
              0  // rotation
            )

            // ✅ 轉換成場景座標
            const x = east * scale
            const z = north * scale
            const y = Math.max(up * scale, 10)  // 最少 10 單位高度

            console.log(`📸 照片 ${index} 的 3D 座標:`, {
              原始GPS: { 
                lat: photo.latitude, 
                lon: photo.longitude, 
                alt: photo.altitude 
              },
              origin: origin,
              ENU: { east, north, up },
              scale: scale,
              最終座標: { x, y, z }
            });

            return (
              <PhotoMarker
                key={`photo-${index}`}
                position={[x, y, z]}
                photoUrl={photo.url}
                timestamp={photo.timestamp}
                onClick={() => {
                  console.log('📸 點擊照片:', photo.url)
                }}
              />
            );
          })}
        </>
      )}

      {/* ✅ 渲染 UAV 模型（包在 Suspense 裡） + 位置標示 */}
      {console.log('🎯 準備渲染 UAV，位置:', uavPosition)}
      <Suspense fallback={null}>
        <group position={uavPosition}>
          {/* UAV 模型 */}
          <UAVFlight
            position={[0, 0, 0]}
            scale={[10, 10, 10]}
            auto={false}
            uavAnimation={true}
            onPositionUpdate={(pos) => {
              console.log('🚁 UAV 位置回調:', pos)
            }}
          />

          {/* ✅ UAV 位置標示（當滑鼠靜止時顯示） */}
          {isMouseStill && (
            <Html
              position={[0, 30, 0]}
              center
              sprite
              style={{
                background: 'rgba(0, 191, 255, 0.9)',
                color: 'white',
                padding: '5px 10px',
                borderRadius: '5px',
                fontSize: '12px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                userSelect: 'none',
                border: '2px solid #00BFFF',
                boxShadow: '0 4px 12px rgba(0, 191, 255, 0.6)',
              }}
            >
              🚁 UAV 目前位置
            </Html>
          )}
        </group>
      </Suspense>
    </>
  )
}

export default MainScene