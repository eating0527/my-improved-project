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

const DEVICE_COLORS = [
  '#ff0000', // 紅(預設)
  '#00ff00', // 綠
  '#0088ff', // 藍
  '#ffff00', // 黃
  '#ff00ff', // 紫
  '#00ffff', // 青
  '#ff8800', // 橘
  '#ffffff', // 白
];

interface AppProps {
  activeView: "stereogram" | "floor-plan";
}

function App({ activeView }: AppProps) {
  const { scenes } = useParams<{ scenes: string }>();
  const currentScene = scenes || "nycu";
  const initialComponent = activeView === "stereogram" ? "3DRT" : "2DRT";

  const [isSceneReady, setIsSceneReady] = useState(false);
  const [uavPath, setUavPath] = useState<Array<{ x: number; y: number; z: number }>>([]);
  const [devicePaths, setDevicePaths] = useState<Map<string, Array<{ x: number; y: number; z: number }>>>(new Map());
  const [uavPosition, setUavPosition] = useState<[number, number, number]>([0, 10, 0]);
  const [currentGPSPosition, setCurrentGPSPosition] = useState<{ 
    lat: number; 
    lon: number; 
    altitude?: number | null 
  } | null>(null)

  const [photos, setPhotos] = useState<Array<{
    url: string
    timestamp: string
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
    deviceId?: string 
  }>>([])

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
  
  const [totalDistance, setTotalDistance] = useState<number>(0);

  const [allDevicePositions, setAllDevicePositions] = useState<Map<string, {
    position: [number, number, number]
    deviceId: string
    deviceName: string
    lat: number
    lon: number
    alt: number
    accuracy: number
  }>>(new Map())

  const [gpsAllDevices, setGpsAllDevices] = useState<Map<string, {
    lat: number
    lon: number
    alt: number
    accuracy: number
    deviceName: string
    timestamp: number
    lastUpdateTime: number
  }>>(new Map())

  const [myDeviceId, setMyDeviceId] = useState<string>(() => {
    const savedId = localStorage.getItem('simworld_device_id');
    if (savedId) {
        console.log("📱 [App] 從 localStorage 恢復 ID:", savedId);
        return savedId;
    }
    const newId = `user-${Math.random().toString(36).substr(2, 9)}`;
    console.log("📱 [App] 生成新 ID:", newId);
    localStorage.setItem('simworld_device_id', newId);
    return newId;
  });

  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)

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

  const [skyfieldSatellites, setSkyfieldSatellites] = useState<VisibleSatelliteInfo[]>([]);
  const [satelliteDisplayCount, setSatelliteDisplayCount] = useState<number>(10);
  const [satelliteEnabled, setSatelliteEnabled] = useState<boolean>(false);

  const [activeComponent, setActiveComponent] = useState<string>(initialComponent);
  const [auto, setAuto] = useState(false);
  const [manualDirection, setManualDirection] = useState<
    | "up" | "down" | "left" | "right" | "ascend" | "descend" 
    | "left-up" | "right-up" | "left-down" | "right-down" 
    | "rotate-left" | "rotate-right" | null
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
  
  const scale = Number(import.meta.env.VITE_SCENE_SCALE ?? 1);

  useEffect(() => {
    console.log("⏳ 開始載入場景，等待 3 秒...")
    const timer = setTimeout(() => {
      console.log("✅ 場景已準備好，開始渲染基準點")
      setIsSceneReady(true)
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  // 載入照片資料
  useEffect(() => {
    const fetchPhotos = async () => {
      try {
        const response = await fetch('https://backend.simworld.website/api/photo-history')
        const data = await response.json()
        if (data.success) {
          const photosWithId = data.photos.map((p: any) => ({
            ...p,
            deviceId: p.deviceId || `legacy-${Math.floor(Math.random() * 1000)}`
          }))
          setPhotos(photosWithId)
          console.log(`✅ 載入照片資料成功，共 ${data.count} 張`)
        }
      } catch (err) {
        console.error('❌ 載入照片資料失敗:', err)
      }
    };
    fetchPhotos()
  }, [])

  // 處理 WebSocket 照片
  const handlePhotoReceivedFromUserLocation = useCallback((photoData: any) => {
    if (photoData.type === 'photo_deleted') {
       console.log('🗑️ [App] 從 UserLocation 收到刪除通知:', photoData.filename);
       setPhotos(prev => prev.filter(p => !p.url.includes(photoData.filename)));
       return;
    }

    console.log('🔥 [App] 從 UserLocation 收到新照片，原始 ID:', photoData.deviceId);
    const finalDeviceId = photoData.deviceId || myDeviceId;

    const newPhoto = {
      url: photoData.url,
      timestamp: photoData.timestamp,
      latitude: photoData.latitude,
      longitude: photoData.longitude,
      altitude: photoData.altitude,
      deviceId: finalDeviceId
    };

    setPhotos(prev => {
      if (prev.some(p => p.url === newPhoto.url)) return prev;
      return [newPhoto, ...prev];
    });
  }, [myDeviceId]);

  // 載入 USRP
  useEffect(() => {
    const fetchUSRPData = async () => {
      try {
        const response = await fetch('https://backend.simworld.website/api/usrp-data')
        const data = await response.json()
        setUsrpData(data)
      } catch (err) {
        console.error('❌ 載入 USRP 資料失敗:', err)
      }
    }
    fetchUSRPData()
    const interval = setInterval(fetchUSRPData, 5000)
    return () => clearInterval(interval)
  }, [])

  // 計算距離
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
  }, [uavPath])

  const handlePathUpdate = useCallback((newPoint: { x: number; y: number; z: number }) => {
    setUavPath((prevPath) => {
      const newPath = [...prevPath, newPoint]
      const finalPath = newPath.length > 2000 ? newPath.slice(-2000) : newPath
      return finalPath
    })
  }, [])

  const handleClearPath = useCallback(() => {
    console.log("🗑️ 清除所有軌跡");
    setDevicePaths(new Map()); 
    setUavPath([]);            
    setTotalDistance(0);       
  }, []);

  const handleUAVCurrentPositionUpdate = useCallback((
    position: [number, number, number],
    gpsPosition?: { lat: number; lon: number; altitude?: number | null }
  ) => {
    setUavPosition(position)
    if (gpsPosition) {
      setCurrentGPSPosition(gpsPosition)
    }
  }, [])

  // ✅ 補回：處理設備新增/更新 (UserLocation 需要)
  const handleUpsertDevice = useCallback((d: any) => {
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
        const next = prev.slice();
        next[i] = { ...existing, ...d };
        return next;
      }
      return [...prev, d];
    });
    setHasTempDevices(true);
  }, [setTempDevices, setHasTempDevices]);

  // ✅ 處理多裝置位置更新 (移除 Log，優化效能)
  const handleMultiDevicePositionUpdate = useCallback((
    deviceId: string,
    position: [number, number, number],
    lat: number,
    lon: number,
    accuracy: number,
    deviceName?: string,
    alt?: number
  ) => {
    // 1. 更新位置
    setAllDevicePositions(prev => {
      const existing = prev.get(deviceId);
      if (existing && existing.position[0] === position[0] && existing.position[2] === position[2]) {
          return prev;
      }
      const newMap = new Map(prev);
      newMap.set(deviceId, {
        position,
        deviceId,
        deviceName: deviceName || 'Unknown',
        lat,
        lon,
        alt: alt || 0,
        accuracy
      });
      return newMap;
    });

    // 2. 記錄軌跡 (零門檻)
    setDevicePaths(prev => {
      const newMap = new Map(prev);
      const currentPath = newMap.get(deviceId) || [];
      
      const safeHeight = Math.max(position[1], 20);
      const newPoint = { x: position[0], y: safeHeight, z: position[2] };
      
      const lastPoint = currentPath[currentPath.length - 1];

      let isDuplicate = false;
      if (lastPoint) {
        if (lastPoint.x === newPoint.x && lastPoint.z === newPoint.z) {
            isDuplicate = true;
        }
      }

      if (!lastPoint || !isDuplicate) {
          const updatedPath = [...currentPath, newPoint];
          if (updatedPath.length > 5000) updatedPath.shift();
          
          newMap.set(deviceId, updatedPath);
          return newMap;
      }
      return prev; 
    });
  }, []);

  const handleAllDevicesUpdate = useCallback((devices: Map<string, any>) => {
    setGpsAllDevices(new Map(devices))
  }, [])

  const handleUploadSuccess = (filename: string) => {
    console.log("✅ 照片上傳成功:", filename);
  };

  const handleMyDeviceIdUpdate = useCallback((deviceId: string) => {
    if (deviceId && deviceId !== myDeviceId) {
        setMyDeviceId(deviceId);
        localStorage.setItem('simworld_device_id', deviceId);
    }
  }, [myDeviceId]);

  const handleDeviceDisconnected = useCallback((deviceId: string) => {
    console.log("🗑️ App 接收到裝置斷線通知:", deviceId.substring(0, 8));
    setAllDevicePositions(prev => {
      const newMap = new Map(prev);
      newMap.delete(deviceId);
      return newMap;
    });
    setGpsAllDevices(prev => {
      const newMap = new Map(prev);
      newMap.delete(deviceId);
      return newMap;
    });
    if (deviceId === selectedDeviceId) {
      setSelectedDeviceId(prev => {
        const remainingDevices = Array.from(gpsAllDevices.keys()).filter(id => id !== deviceId);
        return remainingDevices.length > 0 ? remainingDevices[0] : null;
      });
    }
  }, [selectedDeviceId, gpsAllDevices]);

  const handleDeviceSelect = useCallback((deviceId: string) => {
    console.log('📱 App 切換裝置:', deviceId.substring(0, 8));
    setSelectedDeviceId(deviceId);
  }, []);

  // 側邊欄設備排序
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
        | "up" | "down" | "left" | "right" | "ascend" | "descend"
        | "left-up" | "right-up" | "left-down" | "right-down"
        | "rotate-left" | "rotate-right" | null
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
            usrpData={usrpData}
            allDevicePositions={allDevicePositions}
            myDeviceId={myDeviceId}
            devicePaths={devicePaths}
            deviceColors={DEVICE_COLORS}
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
    usrpData,
    allDevicePositions,
    myDeviceId,
    devicePaths, 
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
            
            pathLength={
                (selectedDeviceId 
                    ? devicePaths.get(selectedDeviceId)?.length 
                    : (devicePaths.get(myDeviceId)?.length || uavPath.length)
                ) || 0
            }

            totalDistance={totalDistance}
            onClearPath={handleClearPath}
            onUAVPositionUpdate={handleUAVCurrentPositionUpdate}
            onMultiDevicePositionUpdate={handleMultiDevicePositionUpdate}
            onMyDeviceIdUpdate={handleMyDeviceIdUpdate}
            onDeviceDisconnected={handleDeviceDisconnected}
            selectedDeviceId={selectedDeviceId}
            onSelectedDeviceIdChange={handleDeviceSelect}
            onAllDevicesUpdate={handleAllDevicesUpdate}
            onPhotoReceived={handlePhotoReceivedFromUserLocation}
            photos={photos} 
          />

          <TxInterferenceLocation origin={origin} scale={scale} upsertDevice={handleUpsertDevice} />
          <RxInterferenceLocation origin={origin} scale={scale} upsertDevice={handleUpsertDevice} />
          <BaselinePoint3Location origin={origin} scale={scale} upsertDevice={handleUpsertDevice} />
        </>
      ) : (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 0, 0, 0.9)', color: 'white', padding: '30px 40px',
          borderRadius: '15px', fontSize: '18px', textAlign: 'center', zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)', border: '2px solid #00ff00',
        }}>
          <div style={{ marginBottom: '15px', fontSize: '24px' }}>⏳</div>
          <div style={{ fontWeight: 'bold' }}>正在載入 3D 場景...</div>
          <div style={{ fontSize: '14px', marginTop: '10px', color: '#aaa' }}>行動網路可能需要較長時間</div>
          <div style={{ fontSize: '12px', marginTop: '5px', color: '#666' }}>請稍候 3 秒</div>
        </div>
      )}

      <UploadPhoto uploadUrl="https://your-backend-api/upload-image" />
      <CameraUpload onUploadSuccess={handleUploadSuccess} currentPosition={currentGPSPosition} deviceId={myDeviceId} />

      <ErrorBoundary>
        <div className="app-container">
          <Navbar
            onMenuClick={handleMenuClick}
            activeComponent={activeComponent}
            currentScene={currentScene}
            allDevices={gpsAllDevices}
            myDeviceId={myDeviceId}
            selectedDeviceId={selectedDeviceId}
            onDeviceSelect={handleDeviceSelect}
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