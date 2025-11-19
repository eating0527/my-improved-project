import { Line } from '@react-three/drei'
import { useMemo } from 'react'

interface UAVPathProps {
  path: Array<{ x: number; y: number; z: number }>
  color?: string
  lineWidth?: number
}

export default function UAVPath({ 
  path, 
  color = '#00ff00',
  lineWidth = 3
}: UAVPathProps) {
  // 如果路徑少於 2 個點，不渲染
  if (path.length < 2) {
    return null
  }

  console.log(`📍 渲染 UAV 軌跡，點數: ${path.length}`)

  // 轉換為 Line 組件需要的格式
  const points = useMemo(() => {
    return path.map(p => [p.x, p.y, p.z] as [number, number, number])
  }, [path])

  return (
    <Line
      points={points}
      color={color}
      lineWidth={lineWidth}
      transparent
      opacity={0.8}
    />
  )
}