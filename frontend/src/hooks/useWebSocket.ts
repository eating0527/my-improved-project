/**
 * WebSocket Hook
 * 負責管理 WebSocket 連接，提供實時數據更新功能
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketEvent } from '../types/charts';

interface UseWebSocketOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  enableReconnect?: boolean;
  onMessage?: (event: WebSocketEvent) => void;
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
    url = 'wss://backend.simworld.website/ws/gps',  // ✅ 修改為正確的 WebSocket URL
    reconnectInterval = 3000,  // ✅ 減少重連間隔到 3 秒
    maxReconnectAttempts = 10,  // ✅ 增加最大重試次數
    enableReconnect = true,
    onMessage,
    onError,
    onConnect,
    onDisconnect
  } = options;

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

  const connect = useCallback(() => {
    // 如果已經連接或正在連接，不重複連接
    if (wsRef.current?.readyState === WebSocket.CONNECTING || 
        wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('WebSocket 已經連接或正在連接，跳過重複連接');
      return;
    }

    // 如果超過最大重試次數，標記為失敗
    if (reconnectCount >= maxReconnectAttempts) {
      console.warn(`WebSocket 已達到最大重試次數 (${maxReconnectAttempts})，停止重連`);
      setConnectionStatus('failed');
      shouldReconnect.current = false;
      return;
    }

    try {
      setConnectionStatus('connecting');
      
      // ✅ 使用傳入的 URL 參數
      console.log(`🔌 正在連接 WebSocket (嘗試 ${reconnectCount + 1}/${maxReconnectAttempts}):`, url);
      
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        console.log('✅ WebSocket 連接已建立');
        setIsConnected(true);
        setConnectionStatus('connected');
        setReconnectCount(0);
        isManualDisconnect.current = false;
        onConnect?.();
      };

      wsRef.current.onmessage = (event) => {
        try {
          // ✅ 修改：event.data 是字串，需要先解析
          const data = JSON.parse(event.data);
          console.log('📥 收到 WebSocket 消息:', data);
          
          // 轉換為標準格式
          const wsEvent: WebSocketEvent = {
            type: data.type || 'gps',
            data: data,
            timestamp: data.timestamp || new Date().toISOString()
          };
          
          onMessage?.(wsEvent);
        } catch (error) {
          console.error('❌ 解析 WebSocket 消息失敗:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log(`📡 WebSocket 連接已關閉: code=${event.code}, reason=${event.reason}`);
        setIsConnected(false);
        
        if (!isManualDisconnect.current) {
          setConnectionStatus('disconnected');
          onDisconnect?.();

          // 如果需要重連且未超過最大重連次數且啟用重連
          if (shouldReconnect.current && 
              enableReconnect && 
              reconnectCount < maxReconnectAttempts) {
            
            console.log(`🔄 將在 ${reconnectInterval}ms 後嘗試重連...`);
            reconnectTimeoutRef.current = window.setTimeout(() => {
              setReconnectCount(prev => prev + 1);
              connect();
            }, reconnectInterval);
          } else if (reconnectCount >= maxReconnectAttempts) {
            console.warn('❌ 已達最大重連次數，停止重連');
            setConnectionStatus('failed');
            shouldReconnect.current = false;
          }
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('❌ WebSocket 錯誤:', error);
        setConnectionStatus('disconnected');
        onError?.(error);
      };

    } catch (error) {
      console.error('❌ 創建 WebSocket 連接失敗:', error);
      setConnectionStatus('failed');
      onError?.(error as Event);
    }
  }, [url, reconnectInterval, maxReconnectAttempts, reconnectCount, onMessage, onError, onConnect, onDisconnect, enableReconnect]);

  const disconnect = useCallback(() => {
    console.log('🛑 手動斷開 WebSocket 連接');
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        const message = typeof data === 'string' ? data : JSON.stringify(data);
        wsRef.current.send(message);
        console.log('📤 發送 WebSocket 消息:', message);
      } catch (error) {
        console.error('❌ 發送 WebSocket 消息失敗:', error);
      }
    } else {
      console.warn('⚠️ WebSocket 未連接，無法發送消息 (當前狀態:', wsRef.current?.readyState, ')');
    }
  }, []);

  // 組件掛載時嘗試連接
  useEffect(() => {
    let mounted = true;
    let connectTimeout: number;

    if (enableReconnect && mounted) {
      // 延遲連接，避免立即失敗
      connectTimeout = window.setTimeout(() => {
        if (mounted) {
          connect();
        }
      }, 500);
    }

    return () => {
      mounted = false;
      if (connectTimeout) {
        clearTimeout(connectTimeout);
      }
      disconnect();
    };
  }, [url, enableReconnect]); // ✅ 加入 url 依賴

  // 瀏覽器可見性變化時的處理
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && 
          !isConnected && 
          enableReconnect && 
          connectionStatus !== 'failed') {
        console.log('👀 頁面變為可見，嘗試重連 WebSocket');
        resetReconnection();
        // 延遲一點再連接，確保頁面已完全恢復
        setTimeout(() => {
          connect();
        }, 1000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isConnected, enableReconnect, connectionStatus, resetReconnection, connect]);

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