/**
 * WebSocket Hook (終極優化版)
 * 1. 解決父元件渲染導致的頻繁斷線 (Ref Pattern)
 * 2. 解決手機螢幕關閉/休眠後的斷線重連 (Page Lifecycle)
 */
import { useState, useEffect, useCallback, useRef } from 'react';

interface UseWebSocketOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  enableReconnect?: boolean;
  onMessage?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  reconnectCount: number;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'failed';
  sendMessage: (data: any) => void;
  disconnect: () => void;
  connect: () => void;
  resetReconnection: () => void;
}

export const useWebSocket = (options: UseWebSocketOptions = {}): UseWebSocketReturn => {
  const {
    url = 'wss://backend.simworld.website/ws/gps',
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
    enableReconnect = true,
    onMessage,
    onError,
    onConnect,
    onDisconnect
  } = options;

  // --- 💡 優化 1：使用 Ref 儲存回呼函式，避免依賴變動觸發重連 ---
  const callbacksRef = useRef({ onMessage, onError, onConnect, onDisconnect });
  
  useEffect(() => {
    callbacksRef.current = { onMessage, onError, onConnect, onDisconnect };
  }, [onMessage, onError, onConnect, onDisconnect]);

  const [isConnected, setIsConnected] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'failed'>('disconnected');
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnect = useRef(true);
  const isManualDisconnect = useRef(false);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const resetReconnection = useCallback(() => {
    setReconnectCount(0);
    shouldReconnect.current = true;
    clearReconnectTimeout();
    if (connectionStatus === 'failed') {
      setConnectionStatus('disconnected');
    }
  }, [connectionStatus, clearReconnectTimeout]);

  // --- 💡 核心連線邏輯 ---
  const connect = useCallback(() => {
    // 檢查是否已經在連接中或已連接
    if (wsRef.current?.readyState === WebSocket.CONNECTING || 
        wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (reconnectCount >= maxReconnectAttempts) {
      setConnectionStatus('failed');
      shouldReconnect.current = false;
      return;
    }

    try {
      console.log('🔄 建立 WebSocket 連線...');
      setConnectionStatus('connecting');
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        console.log('✅ WebSocket 已連接');
        setIsConnected(true);
        setConnectionStatus('connected');
        setReconnectCount(0);
        isManualDisconnect.current = false;
        callbacksRef.current.onConnect?.();
      };

      wsRef.current.onmessage = (event: MessageEvent) => {
        try {
          callbacksRef.current.onMessage?.(event);
        } catch (error) {
          console.error('❌ 處理 WebSocket 消息失敗:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log(`🔌 WebSocket 已斷開 (Code: ${event.code})`);
        setIsConnected(false);
        setConnectionStatus('disconnected');
        
        // 只有非手動斷開才觸發外部 callback
        if (!isManualDisconnect.current) {
          callbacksRef.current.onDisconnect?.();

          // 自動重連機制
          if (shouldReconnect.current && enableReconnect && reconnectCount < maxReconnectAttempts) {
            console.log(`⏳ ${reconnectInterval / 1000} 秒後嘗試重連...`);
            reconnectTimeoutRef.current = window.setTimeout(() => {
              setReconnectCount(prev => prev + 1);
              connect();
            }, reconnectInterval);
          }
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('❌ WebSocket 發生錯誤');
        setConnectionStatus('disconnected');
        callbacksRef.current.onError?.(error);
      };

    } catch (error) {
      console.error('❌ WebSocket 初始化失敗:', error);
      setConnectionStatus('failed');
      callbacksRef.current.onError?.(error as Event);
    }
  }, [url, reconnectInterval, maxReconnectAttempts, reconnectCount, enableReconnect]);

  const disconnect = useCallback(() => {
    isManualDisconnect.current = true;
    shouldReconnect.current = false;
    clearReconnectTimeout();
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setReconnectCount(0);
  }, [clearReconnectTimeout]);

  const sendMessage = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      wsRef.current.send(message);
    }
  }, []);

  // --- 💡 優化 2：監聽「頁面喚醒」與「網路恢復」事件 ---
  // 這能解決手機關螢幕後，瀏覽器凍結導致 WebSocket 斷線卻沒重連的問題
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('👀 頁面已喚醒 (Visible)，檢查連線狀態...');
        
        // 如果 WebSocket 物件不存在，或是已經關閉/正在關閉
        if (!wsRef.current || 
            wsRef.current.readyState === WebSocket.CLOSED || 
            wsRef.current.readyState === WebSocket.CLOSING) {
          
          console.log('⚡ 偵測到斷線，立即執行喚醒重連！');
          // 重置狀態以允許立即重連
          shouldReconnect.current = true;
          isManualDisconnect.current = false;
          setReconnectCount(0); 
          connect();
        }
      }
    };

    const handleOnline = () => {
      console.log('🌐 網路已恢復 (Online)，嘗試重連...');
      shouldReconnect.current = true;
      isManualDisconnect.current = false;
      setReconnectCount(0);
      connect();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [connect]);

  // 組件掛載時連線
  useEffect(() => {
    if (enableReconnect) {
      shouldReconnect.current = true;
      connect(); // 立即嘗試連線
      
      return () => {
        disconnect();
      };
    }
  }, [connect, disconnect, enableReconnect]);

  return {
    isConnected,
    reconnectCount,
    connectionStatus,
    sendMessage,
    disconnect,
    connect,
    resetReconnection
  };
};

export default useWebSocket;