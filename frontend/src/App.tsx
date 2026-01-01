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

// ✅ 1. 定義顏色庫 (分配給不同裝置的軌跡)
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

  // ✅ 場景準備狀態
  const [isSceneReady, setIsSceneReady] = useState(false);

  // ✅ UAV 軌跡狀態（單機模式保留，多機模式用 devicePaths）
  const [uavPath, setUavPath] = useState<Array<{ x: number; y: number; z: number }>>([]);
  
  // ✅ 2. 新增：多裝置軌跡狀態 (Map<DeviceId, PathArray>)
  const [devicePaths, setDevicePaths] = useState<Map<string, Array<{ x: number; y: number; z: number }>>>(new Map());

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
    deviceId?: string // ✅ 新增：用來存拍照者的 ID
  }>>([])

  // ✅ USRP 資料狀態
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

  // ✅ 修改：多裝置 UAV 位置管理（加上 alt）
  // 這是給 3D 場景用的高頻率更新資料
  const [allDevicePositions, setAllDevicePositions] = useState<Map<string, {
    position: [number, number, number]
    deviceId: string
    deviceName: string
    lat: number
    lon: number
    alt: number
    accuracy: number
  }>>(new Map())

  // ✅ 新增：儲存來自 UserLocation 的 allDevices（完整 GPS 資料）
  // 這是給 Navbar UI 用的穩定資料
  const [gpsAllDevices, setGpsAllDevices] = useState<Map<string, {
    lat: number
    lon: number
    alt: number
    accuracy: number
    deviceName: string
    timestamp: number
    lastUpdateTime: number
  }>>(new Map())

  // 🔥🔥🔥 修正 1：初始化當前裝置 ID (確保一開始就有值，避免 Race Condition)
  const [myDeviceId, setMyDeviceId] = useState<string>(() => {
    // 嘗試從 localStorage 讀取，沒有就隨機產生
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

  // ✅ 新增：選擇的裝置 ID 狀態
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

  // ✅ 載入照片資料 (初始載入)
  useEffect(() => {
    const fetchPhotos = async () => {
      try {
        const response = await fetch('https://backend.simworld.website/api/photo-history')
        const data = await response.json()
        if (data.success) {
          // 這裡如果歷史資料沒有 ID，我們為了前端顯示，可以暫時補一個模擬 ID
          // 但主要還是靠上面 myDeviceId 的修復來保證新照片有 ID
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

  // 🔥🔥🔥 修正 2：處理從 UserLocation 傳來的照片事件
  // 加入 myDeviceId 作為依賴，並在沒有 ID 時進行補救
  const handlePhotoReceivedFromUserLocation = useCallback((photoData: any) => {
    // 1. 處理刪除
    if (photoData.type === 'photo_deleted') {
       console.log('🗑️ [App] 從 UserLocation 收到刪除通知:', photoData.filename);
       setPhotos(prev => prev.filter(p => !p.url.includes(photoData.filename)));
       return;
    }

    // 2. 處理上傳
    console.log('🔥 [App] 從 UserLocation 收到新照片，原始 ID:', photoData.deviceId);
    
    // 如果後端回傳有帶 ID 就用後端的，不然就用當下 App 的 ID 補救 (確保 MainScene 有顏色)
    const finalDeviceId = photoData.deviceId || myDeviceId;

    const newPhoto = {
      url: photoData.url,
      timestamp: photoData.timestamp,
      latitude: photoData.latitude,
      longitude: photoData.longitude,
      altitude: photoData.altitude,
      deviceId: finalDeviceId // ✅ 確保這裡有值
    };

    setPhotos(prev => {
      // 避免重複添加
      if (prev.some(p => p.url === newPhoto.url)) return prev;
      return [newPhoto, ...prev];
    });
  }, [myDeviceId]); // ✅ 加入依賴

  // ✅ 載入 USRP 資料
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

  // ✅ 修改：監聽多裝置位置變化（顯示 deviceName 和 alt）
  useEffect(() => {
    if (allDevicePositions.size > 0) {
      console.log("📱 App 收到多裝置位置更新，裝置數:", allDevicePositions.size);
      allDevicePositions.forEach((device, deviceId) => {
        console.log(`📱 裝置 ${deviceId.substring(0, 8)} (${device.deviceName || 'N/A'}):`, {
          ...device,
          alt: device.alt
        });
      });
    }
  }, [allDevicePositions]);

  // ✅ 新增：監聽 gpsAllDevices 變化
  useEffect(() => {
    if (gpsAllDevices.size > 0) {
      console.log("📡 App 收到 GPS 裝置列表更新，裝置數:", gpsAllDevices.size);
      gpsAllDevices.forEach((device, deviceId) => {
        console.log(`📡 GPS 裝置 ${deviceId.substring(0, 8)}:`, {
          deviceName: device.deviceName,
          lat: device.lat.toFixed(6),
          lon: device.lon.toFixed(6),
          accuracy: device.accuracy.toFixed(2)
        });
      });
    }
  }, [gpsAllDevices]);

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
    setDevicePaths(new Map()) // ✅ 3. 清除所有裝置軌跡
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

  // ✅ 修改：多裝置位置更新回調（同時更新位置 + 軌跡）
  const handleMultiDevicePositionUpdate = useCallback((
    deviceId: string,
    position: [number, number, number],
    lat: number,
    lon: number,
    accuracy: number,
    deviceName?: string,
    alt?: number
  ) => {
    console.log(`📱 App 接收到裝置 ${deviceId.substring(0, 8)} 位置更新`);

    // 1. 更新當前位置 (保持原本邏輯)
    setAllDevicePositions(prev => {
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

    // 2. 🔥 新增：同時更新該裝置的軌跡
    setDevicePaths(prev => {
      const newMap = new Map(prev);
      const currentPath = newMap.get(deviceId) || [];
      const newPoint = { x: position[0], y: position[1], z: position[2] };
      
      // 簡單優化：只有位置移動超過 0.1 單位才記錄，避免原地累積太多點
      const lastPoint = currentPath[currentPath.length - 1];
      const hasMoved = !lastPoint || 
          Math.abs(lastPoint.x - newPoint.x) > 0.1 || 
          Math.abs(lastPoint.y - newPoint.y) > 0.1 || 
          Math.abs(lastPoint.z - newPoint.z) > 0.1;

      if (hasMoved) {
          const updatedPath = [...currentPath, newPoint];
          // 限制軌跡長度，只保留最近 1000 點
          if (updatedPath.length > 1000) updatedPath.shift();
          newMap.set(deviceId, updatedPath);
          return newMap;
      }
      return prev; // 沒變動就不更新 state，節省效能
    });
  }, []);

  // --- 💡 關鍵修正：接收 UserLocation 的 allDevices (移除 0,0 過濾) ---
  const handleAllDevicesUpdate = useCallback((devices: Map<string, any>) => {
    console.log('📱 App 接收到 allDevices 更新，原始裝置數:', devices.size)
    
    // ✅ 改為：直接接收所有裝置，不做過濾
    setGpsAllDevices(new Map(devices))
    
  }, [])

  // ✅ 新增：接收當前裝置 ID
  const handleMyDeviceIdUpdate = useCallback((deviceId: string) => {
    console.log("📱 UserLocation 回報 ID:", deviceId);
    // UserLocation 產生的 ID 通常跟我們 localStorage 裡的一樣
    // 如果不一樣，我們選擇信任 UserLocation 或者是維持現狀都可以
    // 這裡我們做個同步，確保一致性
    if (deviceId && deviceId !== myDeviceId) {
        setMyDeviceId(deviceId);
        localStorage.setItem('simworld_device_id', deviceId);
    }
  }, [myDeviceId]);

  // ✅ 新增：處理裝置斷線（從 UserLocation 接收）
  const handleDeviceDisconnected = useCallback((deviceId: string) => {
    console.log("🗑️ App 接收到裝置斷線通知:", deviceId.substring(0, 8));
    
    setAllDevicePositions(prev => {
      const newMap = new Map(prev);
      const deleted = newMap.delete(deviceId);
      
      if (deleted) {
        console.log(`✅ 已從 allDevicePositions 移除裝置 ${deviceId.substring(0, 8)}，剩餘: ${newMap.size}`);
      } else {
        console.log(`⚠️ 裝置 ${deviceId.substring(0, 8)} 不在 allDevicePositions 中`);
      }
      
      return newMap;
    });

    // ✅ 同時從 gpsAllDevices 移除
    setGpsAllDevices(prev => {
      const newMap = new Map(prev);
      const deleted = newMap.delete(deviceId);
      
      if (deleted) {
        console.log(`✅ 已從 gpsAllDevices 移除裝置 ${deviceId.substring(0, 8)}，剩餘: ${newMap.size}`);
      }
      
      return newMap;
    });

    // ✅ 如果刪除的是當前選擇的裝置，自動切換到第一個可用裝置
    if (deviceId === selectedDeviceId) {
      setSelectedDeviceId(prev => {
        const remainingDevices = Array.from(gpsAllDevices.keys()).filter(id => id !== deviceId);
        const newSelectedId = remainingDevices.length > 0 ? remainingDevices[0] : null;
        if (newSelectedId) {
          console.log(`🔄 當前選擇的裝置已斷線，自動切換到: ${newSelectedId.substring(0, 8)}`);
        } else {
          console.log(`⚠️ 沒有其他裝置可切換`);
        }
        return newSelectedId;
      });
    }
  }, [selectedDeviceId, gpsAllDevices]);

  // ✅ 新增：處理裝置選擇
  const handleDeviceSelect = useCallback((deviceId: string) => {
    console.log('📱 App 切換裝置:', deviceId.substring(0, 8));
    setSelectedDeviceId(deviceId);
  }, []);

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
    devicePaths, // 加入依賴
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
            onMultiDevicePositionUpdate={handleMultiDevicePositionUpdate}
            onMyDeviceIdUpdate={handleMyDeviceIdUpdate}
            onDeviceDisconnected={handleDeviceDisconnected}
            selectedDeviceId={selectedDeviceId}
            onSelectedDeviceIdChange={handleDeviceSelect}
            onAllDevicesUpdate={handleAllDevicesUpdate}
            
            // 🔥🔥 接上對講機
            onPhotoReceived={handlePhotoReceivedFromUserLocation}

            // ✅✅✅ 新增這一行：把照片清單傳進去！
            photos={photos} 
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
      
      {/* 🔥🔥🔥 修正 3：這裡一定要傳入 deviceId */}
      <CameraUpload 
        onUploadSuccess={handleUploadSuccess}
        currentPosition={currentGPSPosition}
        deviceId={myDeviceId} 
      />

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