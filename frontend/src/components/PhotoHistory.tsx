import { useEffect, useState } from 'react'

// 定義照片的格式
interface Photo {
  filename: string
  url: string
  timestamp: string
  deviceId?: string
}

interface PhotoHistoryProps {
  onPhotoClick?: (photoUrl: string) => void
  photoDeleteEvent?: { filename: string; timestamp: string } | null
  photoUploadEvent?: { url: string; filename: string; timestamp: string } | null
  
  // ✅ 新增這個 prop：接收外部傳入的照片清單
  photos?: Array<{
    url: string
    timestamp: string
    latitude?: number | null
    longitude?: number | null
    altitude?: number | null
    deviceId?: string
  }>
}

export default function PhotoHistory({ 
  onPhotoClick, 
  photoDeleteEvent,
  photoUploadEvent,
  photos: externalPhotos // 把傳進來的 props 改個名，方便內部區分
}: PhotoHistoryProps) {
  // 內部狀態 (如果沒有外部資料時才用，作為備案)
  const [internalPhotos, setInternalPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)

  // 🔥 決定要顯示哪一份資料：如果有外部傳入的(來自App)，就用外部的；否則用內部的
  const photosToDisplay = externalPhotos && externalPhotos.length > 0 
    ? externalPhotos.map(p => ({
        filename: p.url.split('/').pop() || '', 
        url: p.url,
        timestamp: p.timestamp,
        deviceId: p.deviceId
      }))
    : internalPhotos

  // ✅ 如果有收到外部資料，就直接停止 loading，並清除錯誤訊息
  useEffect(() => {
    if (externalPhotos) {
      setLoading(false)
      setError(null)
    }
  }, [externalPhotos])

  // 初始化：只有在「沒有」外部資料時，才自己去 fetch
  useEffect(() => {
    if (!externalPhotos) {
      fetchPhotoHistory()
    } else {
      setLoading(false) // 有外部資料就不需要 loading
    }
  }, [])

  // 處理新照片上傳 (主要是為了自動展開視窗)
  useEffect(() => {
    if (photoUploadEvent) {
      console.log('📸 PhotoHistory 收到上傳事件:', photoUploadEvent)
      
      // 如果是用內部狀態，才需要自己更新 (外部資料會由 App 更新並透過 props 傳進來)
      if (!externalPhotos) {
        setInternalPhotos(prevPhotos => {
          const exists = prevPhotos.some(p => p.filename === photoUploadEvent.filename)
          if (exists) return prevPhotos
          
          const newPhoto: Photo = {
            filename: photoUploadEvent.filename,
            url: photoUploadEvent.url,
            timestamp: photoUploadEvent.timestamp
          }
          return [newPhoto, ...prevPhotos]
        })
      }
      
      // ✅ 自動展開歷史記錄
      if (!isExpanded) {
        setIsExpanded(true)
      }
    }
  }, [photoUploadEvent, isExpanded, externalPhotos])

  // 處理刪除事件
  useEffect(() => {
    if (photoDeleteEvent && !externalPhotos) {
      setInternalPhotos(prevPhotos => prevPhotos.filter(photo => photo.filename !== photoDeleteEvent.filename))
    }
  }, [photoDeleteEvent, externalPhotos])

  const fetchPhotoHistory = async () => {
    if (externalPhotos) return // 如果有爸爸給的資料，就不用自己抓了

    try {
      setLoading(true)
      const response = await fetch('https://backend.simworld.website/api/photo-history')
      const data = await response.json()

      if (data.success) {
        setInternalPhotos(data.photos)
        setError(null)
      } else {
        setError('無法載入照片歷史記錄')
      }
    } catch (err) {
      setError('網路錯誤，無法載入照片')
    } finally {
      setLoading(false)
    }
  }

  const handleDeletePhoto = async (filename: string, event: React.MouseEvent) => {
    event.stopPropagation()
    
    if (!window.confirm(`確定要刪除照片「${filename}」嗎？`)) {
      return
    }

    try {
      setDeletingPhoto(filename)
      const response = await fetch(`https://backend.simworld.website/api/delete-photo/${filename}`, {
        method: 'DELETE'
      })
      const data = await response.json()

      if (data.success) {
        console.log('✅ 照片刪除成功:', filename)
        // 如果是內部管理狀態，手動移除；如果是外部傳入，App 會透過 WebSocket 收到刪除通知並更新 props
        if (!externalPhotos) {
            setInternalPhotos(prev => prev.filter(photo => photo.filename !== filename))
        }
      } else {
        alert(`刪除失敗: ${data.error}`)
      }
    } catch (err) {
      alert('刪除失敗，請檢查網路連線')
    } finally {
      setDeletingPhoto(null)
    }
  }

  const displayList = photosToDisplay

  return (
    <div style={{
      position: 'fixed',
      bottom: isExpanded ? '0' : '-500px',
      left: '0',
      right: '0',
      height: '500px',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      borderTop: '2px solid #00ff00',
      transition: 'bottom 0.3s ease',
      zIndex: 999,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 標題列 */}
      <div style={{
        padding: '15px',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        borderBottom: '1px solid #00ff00',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{
          color: '#00ff00',
          fontSize: '16px',
          fontWeight: 'bold',
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span>📸</span>
          <span>照片歷史記錄</span>
          <span style={{ fontSize: '14px', color: '#888' }}>({displayList.length} 張)</span>
        </div>
        
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            background: 'none',
            border: 'none',
            color: '#00ff00',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '5px 10px'
          }}
        >
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>

      {/* 照片列表網格 */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '15px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: '15px',
        alignContent: 'start'
      }}>
        {loading && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#00ff00', padding: '20px' }}>
            ⏳ 載入中...
          </div>
        )}

        {/* 只有在沒有外部資料且內部發生錯誤時才顯示錯誤 */}
        {error && !externalPhotos && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#ff4444', padding: '20px' }}>
            ❌ {error}
            <button
              onClick={fetchPhotoHistory}
              style={{
                marginTop: '10px',
                padding: '8px 16px',
                background: '#00ff00',
                color: 'black',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '14px',
                display: 'block',
                margin: '10px auto'
              }}
            >
              🔄 重試
            </button>
          </div>
        )}

        {!loading && displayList.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#888', padding: '20px' }}>
            📭 尚無照片
          </div>
        )}

        {displayList.map((photo, index) => (
          <div
            key={photo.filename || index}
            style={{
              position: 'relative',
              cursor: 'pointer',
              border: '2px solid #00ff00',
              borderRadius: '8px',
              backgroundColor: '#111',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              opacity: deletingPhoto === photo.filename ? 0.5 : 1,
              display: 'flex',
              flexDirection: 'column',
              height: 'fit-content'
            }}
            onClick={() => onPhotoClick && onPhotoClick(`https://backend.simworld.website${photo.url}`)}
            onMouseEnter={(e) => {
              if (deletingPhoto !== photo.filename) {
                e.currentTarget.style.transform = 'scale(1.05)'
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 255, 0, 0.3)'
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <button
              onClick={(e) => handleDeletePhoto(photo.filename, e)}
              disabled={deletingPhoto === photo.filename}
              style={{
                position: 'absolute',
                top: '5px',
                right: '5px',
                background: deletingPhoto === photo.filename ? '#666' : 'rgba(255, 0, 0, 0.8)',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                cursor: deletingPhoto === photo.filename ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
              }}
            >
              {deletingPhoto === photo.filename ? '⏳' : '🗑️'}
            </button>

            <img
              src={`https://backend.simworld.website${photo.url}`}
              alt={photo.filename}
              style={{
                width: '100%',
                height: '140px',
                objectFit: 'cover',
                borderTopLeftRadius: '6px',
                borderTopRightRadius: '6px'
              }}
            />
            
            <div style={{
              padding: '10px',
              minHeight: '60px',
              fontSize: '12px',
              fontWeight: 'bold',
              color: '#ffffff',
              textAlign: 'center',
              borderTop: '2px solid #00ff00',
              backgroundColor: '#1a1a1a',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              fontFamily: 'monospace',
            }}>
              {(() => {
                const ts = photo.timestamp || '';
                const cleanTs = ts.replace(/_/g, '');
                if (cleanTs.length >= 14) {
                   const date = `${cleanTs.substring(0, 4)}/${cleanTs.substring(4, 6)}/${cleanTs.substring(6, 8)}`;
                   const time = `${cleanTs.substring(8, 10)}:${cleanTs.substring(10, 12)}:${cleanTs.substring(12, 14)}`;
                   return (
                     <>
                       <div style={{ color: '#00ff00' }}>{date}</div>
                       <div style={{ color: '#ffaa00' }}>{time}</div>
                     </>
                   );
                }
                return <span>{ts || '未知時間'}</span>;
              })()}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          position: 'absolute',
          top: '-40px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 30px',
          background: 'rgba(0, 0, 0, 0.9)',
          color: '#00ff00',
          border: '2px solid #00ff00',
          borderBottom: 'none',
          borderTopLeftRadius: '10px',
          borderTopRightRadius: '10px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 'bold',
          fontFamily: 'monospace'
        }}
      >
        📸 照片歷史 {isExpanded ? '▼' : '▲'}
      </button>
    </div>
  )
}