export type GeoOrigin = {
  lat: number;
  lon: number;
  alt: number;
};

/**
 * ENU 原點（地圖中心的經緯度）
 */
export const ENU_ORIGIN = {
  lat: 24.942349,
  lon: 121.367164,
  alt: 0
};

/**
 * 將 GPS 座標 (WGS84) 轉換為 ENU 座標
 * 可選 rotation（地圖旋轉角度，單位：度，正值為逆時針）
 */
export function gpsToENU(
  lat: number,
  lon: number,
  alt: number,
  origin: GeoOrigin,
  rotation: number = 0 // 新增 rotation 參數，預設 0
): [number, number, number] {
  const R = 6378137; // 地球半徑 (公尺)
  const dLat = (lat - origin.lat) * Math.PI / 180;
  const dLon = (lon - origin.lon) * Math.PI / 180;
  let x = dLon * R * Math.cos(origin.lat * Math.PI / 180); // 東向
  let y = dLat * R; // 北向
  const z = (alt ?? 0) - origin.alt; // 上向

  // 加入 rotation（旋轉地圖座標）
  if (rotation !== 0) {
    const angleRad = rotation * Math.PI / 180;
    const xr = x * Math.cos(angleRad) - y * Math.sin(angleRad);
    const yr = x * Math.sin(angleRad) + y * Math.cos(angleRad);
    x = xr;
    y = yr;
  }

  return [x, y, z];
}

// 讓 latLonToENU 直接指向 gpsToENU
export const latLonToENU = gpsToENU;