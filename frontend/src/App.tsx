console.log("🔥 App component render 了");

import { useState, useCallback, useMemo, useEffect } from "react";
import { useParams } from "react-router-dom";
import SceneView from "./components/scenes/StereogramView";
import Layout from "./components/layout/Layout";
import Sidebar from "./components/layout/Sidebar";
import Navbar from "./components/layout/Navbar";
import SceneViewer from "./components/scenes/FloorView";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import "./styles/App.scss";
import { Device } from "./types/device";
import { countActiveDevices } from "./utils/deviceUtils";
import { useDevices } from "./hooks/useDevices";
import { VisibleSatelliteInfo } from "./types/satellite";
import "./styles/Dashboard.scss";
import UserLocation from "./components/UserLocation";
import TxInterferenceLocation from "./components/TxInterferenceLocation";
import RxInterferenceLocation from "./components/RxInterferenceLocation";
import BaselinePoint3Location from "./components/BaselinePoint3Location";
import UploadPhoto from "./components/UploadPhoto";
import CameraUpload from "./components/CameraUpload";

console.log("Origin LAT:", import.meta.env.VITE_ORIGIN_LAT);

interface AppProps {
  activeView: "stereogram" | "floor-plan";
}

function App({ activeView }: AppProps) {
  const { scenes } = useParams<{ scenes: string }>();
  const currentScene = scenes || "nycu";
  const initialComponent = activeView === "stereogram" ? "3DRT" : "2DRT";

  // ✅ 場景準備狀態
  const [isSceneReady, setIsSceneReady] = useState(false);

  // ✅ UAV 軌跡狀態（統一管理）
  const [uavPath, setUavPath] = useState<Array<{ x: number; y: number; z: number }>>([]);
  
  // ✅ UAV 當前位置狀態
  const [uavPosition, setUavPosition] = useState<[number, number, number]>([0, 10, 0]);
  
  // ✅ GPS 位置狀態
  const [currentGPSPosition, setCurrentGPSPosition] = useState<{ 
    lat: number; 
    lon: number; 
    altitude?: number | null 
  } | null>(null)

  // ✅ 照片列表狀態
  const [photos, setPhotos] = useState<Array<{
    url: string
    timestamp: string
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
  }>>([])

  // ✅ 新增：USRP 資料狀態
  const [usrpData, setUsrpData] = useState<Array<{
    id: number
    timestamp: string
    frequency: number
    power: number
    snr: number
    bandwidth: number
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
    device_name: string
  }>>([])
  
  // ✅ 移動距離狀態
  const [totalDistance, setTotalDistance] = useState<number>(0);

  const {
    tempDevices,
    loading,
    apiStatus,
    hasTempDevices,
    fetchDevices: refreshDeviceData,
    setTempDevices,
    setHasTempDevices,
    applyDeviceChanges,
    deleteDeviceById,
    addNewDevice,
    updateDeviceField,
    cancelDeviceChanges,
    updateDevicePositionFromUAV,
  } = useDevices();

  const [skyfieldSatellites, setSkyfieldSatellites] =
    useState<VisibleSatelliteInfo[]>([]);
  const [satelliteDisplayCount, setSatelliteDisplayCount] =
    useState<number>(10);
  const [satelliteEnabled, setSatelliteEnabled] = useState<boolean>(false);

  const [activeComponent, setActiveComponent] =
    useState<string>(initialComponent);
  const [auto, setAuto] = useState(false);
  const [manualDirection, setManualDirection] = useState<
    | "up"
    | "down"
    | "left"
    | "right"
    | "ascend"
    | "descend"
    | "left-up"
    | "right-up"
    | "left-down"
    | "right-down"
    | "rotate-left"
    | "rotate-right"
    | null
  >(null);
  const [uavAnimation, setUavAnimation] = useState(false);
  const [selectedReceiverIds, setSelectedReceiverIds] = useState<number[]>([]);

  const origin = useMemo(
    () => ({
      lat: Number(import.meta.env.VITE_ORIGIN_LAT),
      lon: Number(import.meta.env.VITE_ORIGIN_LON),
      alt: Number(import.meta.env.VITE_ORIGIN_ALT ?? 0),
    }),
    []
  );
  console.log("App origin:", origin);
  const scale = Number(import.meta.env.VITE_SCENE_SCALE ?? 1);

  // ✅ 等待場景準備好
  useEffect(() => {
    console.log("⏳ 開始載入場景，等待 3 秒...")
    
    const timer = setTimeout(() => {
      console.log("✅ 場景已準備好，開始渲染基準點")
      setIsSceneReady(true)
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  // ✅ 載入照片資料
  useEffect(() => {
    const fetchPhotos = async () => {
      try {
        const response = await fetch('https://backend.simworld.website/api/photo-history')
        const data = await response.json()
        if (data.success) {
          setPhotos(data.photos)
          console.log(`✅ 載入照片資料成功，共 ${data.count} 張`)
        }
      } catch (err) {
        console.error('❌ 載入照片資料失敗:', err)
      }
    }

    fetchPhotos()
  }, [])

  // ✅ 新增：載入 USRP 資料
  useEffect(() => {
    const fetchUSRPData = async () => {
      try {
        const response = await fetch('https://backend.simworld.website/api/usrp-data')
        const data = await response.json()
        setUsrpData(data)
        console.log(`📡 載入 USRP 資料成功，共 ${data.length} 筆`)
      } catch (err) {
        console.error('❌ 載入 USRP 資料失敗:', err)
      }
    }

    // 初次載入
    fetchUSRPData()
    
    // ✅ 每 5 秒更新一次 USRP 資料（即時更新）
    const interval = setInterval(fetchUSRPData, 5000)
    
    return () => clearInterval(interval)
  }, [])

  // ✅ 計算移動距離
  useEffect(() => {
    if (uavPath.length < 2) {
      setTotalDistance(0)
      return
    }

    const calculateDistance = (path: Array<{ x: number; y: number; z: number }>) => {
      let distance = 0
      for (let i = 1; i < path.length; i++) {
        const prev = path[i - 1]
        const curr = path[i]
        distance += Math.sqrt(
          Math.pow(curr.x - prev.x, 2) +
          Math.pow(curr.y - prev.y, 2) +
          Math.pow(curr.z - prev.z, 2)
        )
      }
      return distance
    }

    const newDistance = calculateDistance(uavPath)
    setTotalDistance(newDistance)
    console.log(`📏 更新移動距離: ${newDistance.toFixed(2)}m`)
  }, [uavPath])

  // ✅ 監聽軌跡變化
  useEffect(() => {
    if (uavPath.length > 0) {
      console.log("📍 App 收到軌跡更新，點數:", uavPath.length);
    }
  }, [uavPath]);

  // ✅ 監聽 UAV 位置變化
  useEffect(() => {
    console.log("🚁 App 收到 UAV 位置更新:", uavPosition);
  }, [uavPosition]);

  const sortedDevicesForSidebar = useMemo(() => {
    return [...tempDevices].sort((a, b) => {
      const roleOrder: { [key: string]: number } = {
        receiver: 1,
        desired: 2,
        jammer: 3,
        user: 4,
        "tx-interference": 5,
        "rx-interference": 6,
        "baseline-point-3": 7,
      };
      const roleA = roleOrder[a.role] || 99;
      const roleB = roleOrder[b.role] || 99;
      if (roleA !== roleB) return roleA - roleB;
      return a.name.localeCompare(b.name);
    });
  }, [tempDevices]);

  const handleApply = async () => {
    const { activeTx: currentActiveTx, activeRx: currentActiveRx } =
      countActiveDevices(tempDevices);
    if (currentActiveTx < 1 || currentActiveRx < 1) {
      alert("套用失敗：至少需要一個啟用的 desired 和 receiver");
      return;
    }
    await applyDeviceChanges();
  };

  const handleCancel = () => {
    cancelDeviceChanges();
  };

  const handleDeleteDevice = async (id: number | string) => {
    if (
      id === "tx-interference" || 
      id === "rx-interference" ||
      id === "baseline-point-3" ||
      id === -888 || 
      id === -999
    ) {
      alert("無法刪除干擾源");
      return;
    }
    
    if (typeof id === 'number' && id < 0) {
      setTempDevices((prev) => prev.filter((device) => device.id !== id));
      setHasTempDevices(true);
      console.log(`已從前端移除臨時設備 ID: ${id}`);
      return;
    }
    
    const devicesAfterDelete = tempDevices.filter(
      (device) => device.id !== id
    );
    const { activeTx: futureActiveTx, activeRx: futureActiveRx } =
      countActiveDevices(devicesAfterDelete);
    if (futureActiveTx < 1 || futureActiveRx < 1) {
      alert("刪除失敗：至少需要一個啟用的 desired 和 receiver");
      return;
    }
    if (!window.confirm("確定要刪除這個設備嗎？")) return;
    await deleteDeviceById(id as number);
  };

  const handleAddDevice = () => {
    addNewDevice();
  };
  
  const handleDeviceChange = (
    id: number,
    field: string | number | symbol,
    value: any
  ) => {
    updateDeviceField(id, field as keyof Device, value);
  };
  
  const handleMenuClick = (component: string) => {
    setActiveComponent(component);
  };
  
  const handleSelectedReceiversChange = useCallback((ids: number[]) => {
    setSelectedReceiverIds(ids);
  }, []);
  
  const handleSatelliteDataUpdate = useCallback(
    (satellites: VisibleSatelliteInfo[]) => {
      setSkyfieldSatellites(satellites);
    },
    []
  );
  
  const handleSatelliteCountChange = useCallback((count: number) => {
    setSatelliteDisplayCount(count);
  }, []);
  
  const handleManualControl = useCallback(
    (
      direction:
        | "up"
        | "down"
        | "left"
        | "right"
        | "ascend"
        | "descend"
        | "left-up"
        | "right-up"
        | "left-down"
        | "right-down"
        | "rotate-left"
        | "rotate-right"
        | null
    ) => {
      if (selectedReceiverIds.length === 0) {
        console.log("沒有選中的 receiver，無法控制 UAV");
        return;
      }
      setManualDirection(direction);
    },
    [selectedReceiverIds, setManualDirection]
  );
  
  const handleUAVPositionUpdate = useCallback(
    (pos: [number, number, number], deviceId?: number) => {
      if (deviceId === undefined || !selectedReceiverIds.includes(deviceId))
        return;
      updateDevicePositionFromUAV(deviceId, pos);
    },
    [selectedReceiverIds, updateDevicePositionFromUAV]
  );

  const handleUploadSuccess = (filename: string) => {
    console.log("✅ 照片上傳成功:", filename);
  };

  const handleUpsertDevice = useCallback((d: any) => {
    console.log("📡 更新設備:", d);
    setTempDevices((prev) => {
      const i = prev.findIndex((x) => x.id === d.id);
      if (i !== -1) {
        const existing = prev[i];
        if (
          existing.position_x === d.position_x &&
          existing.position_y === d.position_y &&
          existing.position_z === d.position_z
        ) {
          return prev;
        }
      }
      if (i === -1) return [...prev, d];
      const next = prev.slice();
      next[i] = { ...prev[i], ...d };
      return next;
    });
    setHasTempDevices(true);
  }, [setTempDevices, setHasTempDevices]);

  // ✅ 軌跡更新回調函數（接收單個點）
  const handlePathUpdate = useCallback((newPoint: { x: number; y: number; z: number }) => {
    console.log("📍 App 接收到新軌跡點:", newPoint);
    setUavPath((prevPath) => {
      const newPath = [...prevPath, newPoint]
      const finalPath = newPath.length > 2000 ? newPath.slice(-2000) : newPath
      console.log(`📍 軌跡點數: ${finalPath.length}`)
      return finalPath
    })
  }, [])

  // ✅ 清除軌跡回調函數
  const handleClearPath = useCallback(() => {
    setUavPath([])
    setTotalDistance(0)
    console.log("🗑️ 已清除所有軌跡")
  }, [])

  // ✅ UAV 位置更新回調函數（接收位置和 GPS 座標）
  const handleUAVCurrentPositionUpdate = useCallback((
    position: [number, number, number],
    gpsPosition?: { lat: number; lon: number; altitude?: number | null }
  ) => {
    setUavPosition(position)
    if (gpsPosition) {
      setCurrentGPSPosition(gpsPosition)
      console.log("📍 GPS 位置更新:", gpsPosition)
    }
    console.log("🚁 App 接收到 UAV 位置更新:", position)
  }, [])

  const renderActiveComponent = useCallback(() => {
    switch (activeComponent) {
      case "2DRT":
        return (
          <SceneViewer
            devices={tempDevices}
            refreshDeviceData={refreshDeviceData}
            sceneName={currentScene}
          />
        );
      case "3DRT":
        return (
          <SceneView
            devices={tempDevices}
            auto={auto}
            manualDirection={manualDirection}
            onManualControl={handleManualControl}
            onUAVPositionUpdate={handleUAVPositionUpdate}
            uavAnimation={uavAnimation}
            selectedReceiverIds={selectedReceiverIds}
            satellites={satelliteEnabled ? skyfieldSatellites : []}
            sceneName={currentScene}
            uavPath={uavPath}
            uavPosition={uavPosition}
            photos={photos}
            origin={origin}
            scale={scale}
            usrpData={usrpData}  // ✅✅✅ 新增：傳遞 USRP 資料
          />
        );
      default:
        return (
          <SceneViewer
            devices={tempDevices}
            refreshDeviceData={refreshDeviceData}
            sceneName={currentScene}
          />
        );
    }
  }, [
    activeComponent,
    tempDevices,
    auto,
    manualDirection,
    handleManualControl,
    handleUAVPositionUpdate,
    uavAnimation,
    selectedReceiverIds,
    refreshDeviceData,
    skyfieldSatellites,
    satelliteEnabled,
    currentScene,
    uavPath,
    uavPosition,
    photos,
    origin,
    scale,
    usrpData,  // ✅ 新增：加入依賴
  ]);

  if (loading) return <div className="loading">載入中...</div>;

  return (
    <>
      {isSceneReady ? (
        <>
          <UserLocation
            origin={origin}
            scale={scale}
            upsertDevice={handleUpsertDevice}
            onPathUpdate={handlePathUpdate}
            pathLength={uavPath.length}
            totalDistance={totalDistance}
            onClearPath={handleClearPath}
            onUAVPositionUpdate={handleUAVCurrentPositionUpdate}
          />

          <TxInterferenceLocation
            origin={origin}
            scale={scale}
            upsertDevice={handleUpsertDevice}
          />

          <RxInterferenceLocation
            origin={origin}
            scale={scale}
            upsertDevice={handleUpsertDevice}
          />

          <BaselinePoint3Location
            origin={origin}
            scale={scale}
            upsertDevice={handleUpsertDevice}
          />
        </>
      ) : (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 0, 0, 0.9)',
          color: 'white',
          padding: '30px 40px',
          borderRadius: '15px',
          fontSize: '18px',
          textAlign: 'center',
          zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          border: '2px solid #00ff00',
        }}>
          <div style={{ marginBottom: '15px', fontSize: '24px' }}>⏳</div>
          <div style={{ fontWeight: 'bold' }}>正在載入 3D 場景...</div>
          <div style={{ fontSize: '14px', marginTop: '10px', color: '#aaa' }}>
            行動網路可能需要較長時間
          </div>
          <div style={{ fontSize: '12px', marginTop: '5px', color: '#666' }}>
            請稍候 3 秒
          </div>
        </div>
      )}

      <UploadPhoto uploadUrl="https://your-backend-api/upload-image" />
      <CameraUpload 
        onUploadSuccess={handleUploadSuccess}
        currentPosition={currentGPSPosition}
      />

      <ErrorBoundary>
        <div className="app-container">
          <Navbar
            onMenuClick={handleMenuClick}
            activeComponent={activeComponent}
            currentScene={currentScene}
          />
          <div className="content-wrapper">
            <Layout
              sidebar={
                <ErrorBoundary fallback={<div>側邊欄發生錯誤</div>}>
                  <Sidebar
                    devices={sortedDevicesForSidebar}
                    onDeviceChange={handleDeviceChange}
                    onDeleteDevice={handleDeleteDevice}
                    onAddDevice={handleAddDevice}
                    onApply={handleApply}
                    onCancel={handleCancel}
                    loading={loading}
                    apiStatus={apiStatus}
                    hasTempDevices={hasTempDevices}
                    auto={auto}
                    onAutoChange={setAuto}
                    onManualControl={handleManualControl}
                    activeComponent={activeComponent}
                    uavAnimation={uavAnimation}
                    onUavAnimationChange={setUavAnimation}
                    onSelectedReceiversChange={handleSelectedReceiversChange}
                    onSatelliteDataUpdate={handleSatelliteDataUpdate}
                    onSatelliteCountChange={handleSatelliteCountChange}
                    satelliteDisplayCount={satelliteDisplayCount}
                    satelliteEnabled={satelliteEnabled}
                    onSatelliteEnabledChange={setSatelliteEnabled}
                  />
                </ErrorBoundary>
              }
              content={
                <ErrorBoundary fallback={<div>主視圖發生錯誤</div>}>
                  {renderActiveComponent()}
                </ErrorBoundary>
              }
              activeComponent={activeComponent}
            />
          </div>
        </div>
      </ErrorBoundary>
    </>
  );
}

export default App;