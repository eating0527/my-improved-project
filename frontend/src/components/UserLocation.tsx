import { useEffect, useRef } from "react"
import { latLonToENU } from "../utils/geo"
import points from "../data/points.json"

interface UserLocationProps {
  origin: { lat: number; lon: number; alt: number }
  scale: number
  rotation?: number
  upsertDevice: (d: any) => void
}

export default function UserLocation({
  origin,
  scale,
  rotation = 0,
  upsertDevice,
}: UserLocationProps) {
  const upsertRef = useRef(upsertDevice)
  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  // 計算兩點距離
  function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6378137
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    return Math.sqrt(
      Math.pow(dLat * R, 2) +
      Math.pow(dLon * R * Math.cos(lat1 * Math.PI / 180), 2)
    )
  }

  // 找最近的已知點
  function findNearestPoint(lat: number, lon: number): any {
    let nearest = null
    let minDist = Infinity
    points.forEach(pt => {
      const dist = calcDistance(pt.lat, pt.lon, lat, lon)
      if (dist < minDist) {
        minDist = dist
        nearest = { ...pt, distance: dist }
      }
    })
    return nearest
  }

  // 根據最近的已知點調整位置
  function adjustPosition(lat: number, lon: number): [number, number] {
    const nearestPoint = findNearestPoint(lat, lon)
    if (!nearestPoint) return [lat, lon]

    const error = nearestPoint.distance
    console.log(`📍 最近的點: ${nearestPoint.name}, 誤差: ${error.toFixed(2)} 公尺`)

    // 如果誤差超過 20 公尺，用已知點的位置
    if (error > 20) {
      console.log(`⚠️ GPS 誤差過大 (${error.toFixed(2)}m)，使用已知點座標`)
      return [nearestPoint.lat, nearestPoint.lon]
    }

    return [lat, lon]
  }

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      console.error("❌ 瀏覽器不支援 geolocation")
      return
    }

    const updatePosition = (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      const alt = pos.coords.altitude ?? 0
      const acc = pos.coords.accuracy

      console.log("📍 GPS 原始定位：", { lat, lon, alt, acc })

      // 計算與所有已知點的誤差
      points.forEach(pt => {
        const error = calcDistance(pt.lat, pt.lon, lat, lon)
        console.log(`  - ${pt.name} 距離: ${error.toFixed(2)} 公尺`)
      })

      // 用最近的已知點來校正位置
      const [adjustedLat, adjustedLon] = adjustPosition(lat, lon)
      
      if (adjustedLat !== lat || adjustedLon !== lon) {
        console.log("✅ 使用校正後座標：", { lat: adjustedLat, lon: adjustedLon })
      }

      // 用校正後的座標做 ENU 轉換
      const [east, north, up] = latLonToENU(adjustedLat, adjustedLon, alt, origin, rotation)

      const safeY = Math.max(up * scale, 10)

      upsertRef.current({
        id: "user",
        role: "user",
        position_x: east * scale,
        position_y: safeY,
        position_z: north * scale,
      })
    }

    // 初始定位
    navigator.geolocation.getCurrentPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 初始定位失敗：", err)
      },
      { enableHighAccuracy: true }
    )

    // 持續監聽
    const watchId = navigator.geolocation.watchPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 定位更新失敗：", err)
      },
      { enableHighAccuracy: true }
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [origin, scale, rotation])

  return null
}