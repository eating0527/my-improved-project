// src/components/MainScene.tsx
import { useLayoutEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
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

    return devices.map((device: any) => {
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
          <mesh
            key={device.id ?? `user-${device.position_x}-${device.position_z}`}
            position={[
              device.position_x, // 東
              device.position_y, // 高度 (safeY 已經算過)
              device.position_z, // 北
            ]}
          >
            <sphereGeometry args={[20, 32, 32]} />
            <meshStandardMaterial
              color="blue"
              emissive={0x0000ff}
              emissiveIntensity={1}
            />
          </mesh>
        )
      } else {
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
