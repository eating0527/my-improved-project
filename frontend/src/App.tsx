console.log("🔥 App component render 了");

import { useState, useCallback, useMemo } from "react";
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
import UserLocation from "./components/UserLocation"; // ✅ 掛上定位元件
import UploadPhoto from "./components/UploadPhoto";
import CameraUpload from "./components/CameraUpload"; // 📷 新增拍照上傳組件

console.log("Origin LAT:", import.meta.env.VITE_ORIGIN_LAT);


interface AppProps {
  activeView: "stereogram" | "floor-plan";
}

function App({ activeView }: AppProps) {
  const { scenes } = useParams<{ scenes: string }>();
  const currentScene = scenes || "nycu";
  const initialComponent = activeView === "stereogram" ? "3DRT" : "2DRT";


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

  // 從 .env 讀取原點 & scale
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

  const sortedDevicesForSidebar = useMemo(() => {
    return [...tempDevices].sort((a, b) => {
      const roleOrder: { [key: string]: number } = {
        receiver: 1,
        desired: 2,
        jammer: 3,
        user: 4, // ✅ user 也加入排序
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

  const handleDeleteDevice = async (id: number) => {
    if (id < 0) {
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
    await deleteDeviceById(id);
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

  // 📷 處理照片上傳成功
  const handleUploadSuccess = (filename: string) => {
    console.log('✅ 照片上傳成功:', filename);
    // 可以在這裡做其他處理，例如顯示通知
  };

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
  ]);

  if (loading) return <div className="loading">載入中...</div>;

  return (
    <>
      {/* 📍 掛上 UserLocation，每 10 秒更新一次 */}
      <UserLocation
        origin={origin}
        scale={scale}
        upsertDevice={(d) => {
          console.log("📡 更新 user device:", d);
          setTempDevices((prev) => {
            const i = prev.findIndex((x) => x.id === d.id);
            // 檢查是否真的有變化
            if (i !== -1) {
              const existing = prev[i];
              if (
                existing.position_x === d.position_x &&
                existing.position_y === d.position_y &&
                existing.position_z === d.position_z
              ) {
                return prev; // 沒變化就不更新
              }
            }
            if (i === -1) return [...prev, d];
            const next = prev.slice();
            next[i] = { ...prev[i], ...d };
            return next;
          });
          setHasTempDevices(true);
        }}
      />

      {/* 📸 掛上自動上傳元件 */}
      <UploadPhoto uploadUrl="https://your-backend-api/upload-image" />

      {/* 📷 掛上拍照上傳組件 */}
      <CameraUpload onUploadSuccess={handleUploadSuccess} />

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