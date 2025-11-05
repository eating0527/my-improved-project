import { useEffect, useRef } from "react"

interface TxInterferenceLocationProps {
  origin: { lat: number; lon: number; alt: number }
  scale: number
  upsertDevice: (d: any) => void
}

export default function TxInterferenceLocation({
  origin,
  scale,
  upsertDevice,
}: TxInterferenceLocationProps) {
  const upsertRef = useRef(upsertDevice)
  
  useEffect(() => {
    upsertRef.current = upsertDevice
  }, [upsertDevice])

  useEffect(() => {
    console.log('🔴 TxInterferenceLocation 初始化')
    
    // ✅ 直接在 ENU 座標系的原點 (0, 0, 0) 創建 TX 干擾源
    const txInterferenceDevice = {
      id: "tx-interference", // ✅ 使用字串 ID，與 user 一致
      role: "tx-interference",
      position_x: 80,    // ENU 東向座標
      position_y: 30,  // ENU 高度（100 公尺）
      position_z: 150,    // ENU 北向座標
      name: "TX 干擾源",
      is_active: true,
    }

    console.log('🔴 準備添加 TX 干擾源:', txInterferenceDevice)
    
    // ✅ 使用 upsertDevice 添加到 tempDevices
    upsertRef.current(txInterferenceDevice)
    
    console.log('🔴 TX 干擾源已添加')
  }, [origin, scale])

  return null // 不需要渲染任何 UI
}