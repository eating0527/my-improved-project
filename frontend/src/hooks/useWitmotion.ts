import { useState, useRef, useCallback, useEffect } from 'react';

export interface WitData {
  height: number;
  roll: number;
  pitch: number;
  yaw: number;
}

export function useWitmotion() {
  const [status, setStatus] = useState<string>("未連線");
  const [debugMsg, setDebugMsg] = useState<string>(""); 
  const [witData, setWitData] = useState<WitData>({ height: 0, roll: 0, pitch: 0, yaw: 0 });
  
  const baseHeightRef = useRef<number | null>(null);
  const deviceRef = useRef<any>(null);
  const writeCharRef = useRef<any>(null);
  const pollTimerRef = useRef<any>(null);

  const resetHeight = useCallback(() => {
    baseHeightRef.current = null;
    setDebugMsg("基準高度已重設");
  }, []);

  const sendRequest = async () => {
    const char = writeCharRef.current;
    if (!char || !deviceRef.current?.gatt.connected) return;
    try {
      await char.writeValueWithoutResponse(new Uint8Array([0xFF, 0xAA, 0x27, 0x45, 0x00]));
    } catch (e) {}
  };

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (deviceRef.current?.gatt.connected) deviceRef.current.gatt.disconnect();
    };
  }, []);

  const connect = useCallback(async () => {
    try {
      setStatus("搜尋中...");
      const nav = navigator as any;
      const device = await nav.bluetooth.requestDevice({
        filters: [{ namePrefix: "WT" }, { namePrefix: "Wit" }],
        optionalServices: ["0000ffe5-0000-1000-8000-00805f9a34fb"]
      });
      deviceRef.current = device;
      const server = await device.gatt?.connect();
      const service = await server?.getPrimaryService("0000ffe5-0000-1000-8000-00805f9a34fb");
      const characteristics = await service?.getCharacteristics();
      
      const notifyChar = characteristics?.find((c: any) => c.properties.notify);
      const writeChar = characteristics?.find((c: any) => c.uuid.includes("ffe9") || c.properties.writeWithoutResponse || c.properties.write);
      writeCharRef.current = writeChar;

      if (notifyChar) {
        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', (event: any) => handleData(event.target.value));
        setStatus("✅ 連線成功");

        if (writeChar) {
          await writeChar.writeValueWithoutResponse(new Uint8Array([0xFF, 0xAA, 0x69, 0x88, 0xB5]));
          await new Promise(r => setTimeout(r, 200));
          await writeChar.writeValueWithoutResponse(new Uint8Array([0xFF, 0xAA, 0x02, 0xFF, 0x00]));
        }

        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = setInterval(sendRequest, 1000); 
      }
    } catch (error: any) { 
      setStatus("❌ 失敗"); 
      setDebugMsg(error.message); 
    }
  }, []);

  const handleData = (dataView: DataView) => {
    const buffer = new Uint8Array(dataView.buffer);
    
    for (let i = 0; i < buffer.length - 10; i++) {
      if (buffer[i] === 0x55) {
        const type = buffer[i + 1];

        // 1. 處理角度 (55 61) - 解決 Yaw/Pitch 卡住問題
        if (type === 0x61 && i + 19 < buffer.length) {
          const roll = ((buffer[i+15] << 8) | buffer[i+14]) / 32768.0 * 180.0;
          const pitch = ((buffer[i+17] << 8) | buffer[i+16]) / 32768.0 * 180.0;
          const yaw = ((buffer[i+19] << 8) | buffer[i+18]) / 32768.0 * 180.0;
          setWitData(prev => ({ ...prev, roll, pitch, yaw }));
        }

        // 2. 處理高度主動包 (55 57)
        else if (type === 0x57 && i + 9 < buffer.length) {
          const hRaw = (buffer[i+9] << 24) | (buffer[i+8] << 16) | (buffer[i+7] << 8) | buffer[i+6];
          const curH = hRaw / 100.0;
          
          if (Math.abs(curH) > 0.01) {
            if (baseHeightRef.current === null) baseHeightRef.current = curH;
            // 🔥 修正：使用 ! 確保 baseHeightRef.current 不為 null
            setWitData(prev => ({ ...prev, height: curH - baseHeightRef.current! }));
            setDebugMsg(`📡 模式: 55 57 | Abs: ${curH.toFixed(2)}m`);
          }
        }

        // 3. 處理高度問答包 (55 71 45)
        else if (type === 0x71 && buffer[i+2] === 0x45 && i + 10 < buffer.length) {
          const hL = buffer[i + 8]; 
          const hH = buffer[i + 9];
          let hRaw = (hH << 8) | hL;
          if (hRaw > 32767) hRaw -= 65536;
          
          const curH = hRaw / 100.0;
          if (curH !== 3.93 && Math.abs(curH) > 0.01) {
            if (baseHeightRef.current === null) baseHeightRef.current = curH;
            // 🔥 修正：使用 ! 確保 baseHeightRef.current 不為 null
            setWitData(prev => ({ ...prev, height: curH - baseHeightRef.current! }));
            setDebugMsg(`✅ 模式: 0x45 | Abs: ${curH.toFixed(2)}m`);
          }
        }
      }
    }
  };

  return { connect, witData, status, debugMsg, resetHeight, manualUnlock: sendRequest };
}