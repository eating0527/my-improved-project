import { Line } from '@react-three/drei'
import { useMemo, useRef, useLayoutEffect } from 'react'
import { Line2 } from 'three-stdlib'

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
  
  // 1. 取得線條的參考 (Reference)
  const lineRef = useRef<Line2>(null)

  // 2. 資料轉換與防呆
  const points = useMemo(() => {
    if (!path || path.length < 2) return null

    const validPoints = path.filter(p => 
      Number.isFinite(p.x) && 
      Number.isFinite(p.y) && 
      Number.isFinite(p.z)
    );

    if (validPoints.length < 2) return null;

    return validPoints.map(p => [
      p.x,
      // 🔥 強制抬高，確保不被地圖遮擋
      Math.max(p.y, 15), 
      p.z
    ] as [number, number, number])
  }, [path])

  // 🔥🔥🔥 3. 關鍵修正：手動更新包圍球 (Bounding Sphere) 🔥🔥🔥
  // 這行程式碼是「線條不斷裂」的保證！
  useLayoutEffect(() => {
    if (lineRef.current && lineRef.current.geometry) {
      lineRef.current.computeLineDistances();
      lineRef.current.geometry.computeBoundingSphere(); // 更新範圍球
      lineRef.current.geometry.computeBoundingBox();    // 更新範圍盒
    }
  }, [points]) // 只要點變了，就重算一次

  if (!points) return null

  return (
    <Line
      ref={lineRef} // 綁定 Ref
      points={points}
      color={color}
      lineWidth={lineWidth}
      transparent
      opacity={0.8}
      polygonOffset
      polygonOffsetFactor={-1} // 防止與地圖重疊閃爍
    />
  )
}