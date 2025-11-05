import { useEffect, useRef } from "react";

interface BaselinePoint3LocationProps {
  origin: { lat: number; lon: number; alt: number };
  scale: number;
  upsertDevice: (d: any) => void;
}

export default function BaselinePoint3Location({
  origin,
  scale,
  upsertDevice,
}: BaselinePoint3LocationProps) {
  const upsertRef = useRef(upsertDevice);

  useEffect(() => {
    upsertRef.current = upsertDevice;
  }, [upsertDevice]);

  useEffect(() => {
    console.log("🟡 BaselinePoint3Location 初始化");

    // ✅ 創建基準點3（黃色球）
    const baselinePoint3Device = {
      id: "baseline-point-3", // 使用字串 ID
      role: "baseline-point-3",
      position_x: 350, // ENU 東向座標
      position_y: 30, // ENU 高度
      position_z: -230, // ENU 北向座標
      name: "基準點3",
      is_active: true,
    };

    console.log("🟡 準備添加基準點3:", baselinePoint3Device);

    // ✅ 使用 upsertDevice 添加到 tempDevices
    upsertRef.current(baselinePoint3Device);

    console.log("🟡 基準點3已添加");
  }, [origin, scale]);

  return null; // 不需要渲染任何 UI
}