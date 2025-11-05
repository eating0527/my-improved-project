import { useEffect, useRef } from "react"

interface RxInterferenceLocationProps {
  origin: { lat: number; lon: number; alt: number }
  scale: number
  upsertDevice: (d: any) => void
}

export default function RxInterferenceLocation({
  origin,
  scale,
  upsertDevice,
}: RxInterferenceLocationProps) {
  const upsertRef = useRef(upsertDevice)
  
  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  useEffect(() => {
    console.log('🟢 RxInterferenceLocation 初始化')
    
    // ✅ 創建 RX 干擾源（綠色球）
    const rxInterferenceDevice = {
      id: "rx-interference", // ✅ 使用字串 ID
      role: "rx-interference",
      position_x: 340,   // ENU 東向座標（與 TX 對稱）
      position_y: 40,    // ENU 高度
      position_z: 5,    // ENU 北向座標（與 TX 對稱）
      name: "RX 干擾源",
      is_active: true,
    }

    console.log('🟢 準備添加 RX 干擾源:', rxInterferenceDevice)
    
    // ✅ 使用 upsertDevice 添加到 tempDevices
    upsertRef.current(rxInterferenceDevice)
    
    console.log('🟢 RX 干擾源已添加')
  }, [origin, scale])

  return null // 不需要渲染任何 UI
}