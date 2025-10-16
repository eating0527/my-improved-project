import { useEffect, useRef } from "react"
import { latLonToENU } from "../utils/geo"

interface UserLocationProps {
  origin: { lat: number; lon: number; alt: number }
  scale: number
  upsertDevice: (d: any) => void
}

export default function UserLocation({
  origin,
  scale,
  upsertDevice,
}: UserLocationProps) {
  const upsertRef = useRef(upsertDevice)
  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      console.error("❌ 瀏覽器不支援 geolocation")
      return
    }

    // ✅ 定義更新座標的函式
    const updatePosition = (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      const alt = pos.coords.altitude ?? 0
      const acc = pos.coords.accuracy

      console.log("📍 定位更新：", { lat, lon, alt, acc })

      const [east, north, up] = latLonToENU(lat, lon, alt, origin)

      // 🟢 安全高度 (至少 50 單位，避免掉到地板下)
      const safeY = Math.max(up * scale, 10)

      upsertRef.current({
        id: "user",
        role: "user",
        position_x: east * scale,
        position_y: safeY,
        position_z: north * scale,
      })
    }

    // ✅ 進來先抓一次
    navigator.geolocation.getCurrentPosition(
      updatePosition,
      (err) => {
        console.error("⚠️ 初始定位失敗：", err)
      },
      { enableHighAccuracy: true }
    )

    // ✅ 持續監聽
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
  }, [origin, scale])

  return null
}