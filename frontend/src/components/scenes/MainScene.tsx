import { useLayoutEffect, useMemo, useState, useEffect } from 'react'
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
}) => {
  // ✅ 追蹤滑鼠/觸控是否靜止
  const [isMouseStill, setIsMouseStill] = useState(true)

  // ✅ 監聽滑鼠和觸控活動（適用於桌面和手機）
  useEffect(() => {
    let timer: NodeJS.Timeout

    const handleMouseActivity = () => {
      setIsMouseStill(false) // 互動時隱藏標籤
      clearTimeout(timer)
      timer = setTimeout(() => setIsMouseStill(true), 800) // 800ms 後顯示標籤
    }

    // 桌面事件
    window.addEventListener('mousemove', handleMouseActivity)
    window.addEventListener('wheel', handleMouseActivity)
    window.addEventListener('mousedown', handleMouseActivity)

    // ✅ 手機觸控事件
    window.addEventListener('touchstart', handleMouseActivity, { passive: true })
    window.addEventListener('touchmove', handleMouseActivity, { passive: true })
    window.addEventListener('touchend', handleMouseActivity)

    return () => {
      clearTimeout(timer)
      // 移除桌面事件
      window.removeEventListener('mousemove', handleMouseActivity)
      window.removeEventListener('wheel', handleMouseActivity)
      window.removeEventListener('mousedown', handleMouseActivity)
      // 移除手機觸控事件
      window.removeEventListener('touchstart', handleMouseActivity)
      window.removeEventListener('touchmove', handleMouseActivity)
      window.removeEventListener('touchend', handleMouseActivity)
    }
  }, [])

  // 根據場景名稱動態生成 URL
  const backendSceneName = getBackendSceneName(sceneName)
  const SCENE_URL = ApiRoutes.scenes.getSceneModel(backendSceneName)
  const BS_MODEL_URL = ApiRoutes.simulations.getModel('tower')
  const JAMMER_MODEL_URL = ApiRoutes.simulations.getModel('jam')
  const SATELLITE_TEXTURE_URL = ApiRoutes.scenes.getSceneTexture(
    backendSceneName,
    getSceneTextureName(sceneName)
  )

  // 預加載模型
  useMemo(() => {
    useGLTF.preload(SCENE_URL)
    useGLTF.preload(BS_MODEL_URL)
    useGLTF.preload(JAMMER_MODEL_URL)
  }, [SCENE_URL, BS_MODEL_URL, JAMMER_MODEL_URL])

  // 載入主場景
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

  // 🎯 渲染各類 device
  const deviceMeshes = useMemo(() => {
    console.log('🎯 MainScene devices:', devices)
    console.log('🎯 devices 數量:', devices.length)
    
    // ✅ 詳細打印每個設備的資訊
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

      // ✅ 三軸統一： [X=東, Y=高度, Z=北]
      if (device.role === 'receiver') {
        const position: [number, number, number] = [
          device.position_x, // 東
          device.position_y, // 高度
          device.position_z, // 北
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
        console.log('🔵 User device:', device)
        return (
          <group
            key={device.id ?? `user-${device.position_x}-${device.position_z}`}
            position={[
              device.position_x, // 東
              device.position_y, // 高度
              device.position_z, // 北
            ]}
          >
            {/* 藍色球 */}
            <mesh>
              <sphereGeometry args={[10, 32, 32]} />
              <meshStandardMaterial 
                color="blue" 
                emissive={0x0000ff}
                emissiveIntensity={0.5}
              />
            </mesh>

            {/* ✅ 只在靜止時顯示標籤（適用桌面和手機） */}
            {isMouseStill && (
              <Html
                position={[0, 50, 0]}
                center
                sprite
                style={{
                  background: 'rgba(0, 0, 0, 0.85)',
                  color: 'white',
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  border: '2px solid #00bfff',
                  boxShadow: '0 4px 12px rgba(0, 191, 255, 0.5)',
                }}
              >
                📍 目前手機位置
              </Html>
            )}
          </group>
        )
      } 
      // ✅ 渲染 TX 干擾源（紅色球）
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
            {/* 紅色球 */}
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
      // ✅ 渲染 RX 干擾源（綠色球）
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
            {/* 綠色球 */}
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
      // ✅ 新增：渲染基準點3（黃色球）
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
            {/* 黃色球 */}
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
    </>
  )
}

export default MainScene