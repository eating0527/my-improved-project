import { useEffect, useState } from 'react'

interface Photo {
  filename: string
  url: string
  timestamp: string
}

interface PhotoHistoryProps {
  onPhotoClick?: (photoUrl: string) => void
  photoDeleteEvent?: { filename: string; timestamp: string } | null
  photoUploadEvent?: { url: string; filename: string; timestamp: string } | null
}

export default function PhotoHistory({ 
  onPhotoClick, 
  photoDeleteEvent,
  photoUploadEvent
}: PhotoHistoryProps) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)

  useEffect(() => {
    fetchPhotoHistory()
  }, [])

  useEffect(() => {
    if (photoUploadEvent) {
      console.log('📸 PhotoHistory 收到上傳事件:', photoUploadEvent)
      
      setPhotos(prevPhotos => {
        const exists = prevPhotos.some(p => p.filename === photoUploadEvent.filename)
        if (exists) {
          console.log('⚠️ 照片已存在，不重複新增:', photoUploadEvent.filename)
          return prevPhotos
        }
        
        const newPhoto: Photo = {
          filename: photoUploadEvent.filename,
          url: photoUploadEvent.url,
          timestamp: photoUploadEvent.timestamp
        }
        
        console.log(`✅ 已將照片新增到列表: ${photoUploadEvent.filename}，總數 ${prevPhotos.length + 1} 張`)
        return [newPhoto, ...prevPhotos]
      })
      
      if (!isExpanded) {
        setIsExpanded(true)
        console.log('📸 自動展開照片歷史記錄')
      }
    }
  }, [photoUploadEvent, isExpanded])

  useEffect(() => {
    if (photoDeleteEvent) {
      console.log('🗑️ PhotoHistory 收到刪除事件:', photoDeleteEvent.filename)
      
      setPhotos(prevPhotos => {
        const newPhotos = prevPhotos.filter(photo => photo.filename !== photoDeleteEvent.filename)
        console.log(`✅ 已從列表中移除照片: ${photoDeleteEvent.filename}，剩餘 ${newPhotos.length} 張`)
        return newPhotos
      })
    }
  }, [photoDeleteEvent])

  const fetchPhotoHistory = async () => {
    try {
      setLoading(true)
      const response = await fetch('https://backend.simworld.website/api/photo-history')
      const data = await response.json()

      if (data.success) {
        setPhotos(data.photos)
        console.log(`✅ 載入照片歷史記錄成功，共 ${data.count} 張照片`)
        if (data.photos.length > 0) {
          console.log('📅 第一張照片的 timestamp:', data.photos[0].timestamp)
        }
      } else {
        setError('無法載入照片歷史記錄')
        console.error('❌ 照片歷史記錄載入失敗:', data.error)
      }
    } catch (err) {
      setError('網路錯誤，無法載入照片')
      console.error('❌ 照片歷史記錄載入錯誤:', err)
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
      console.log('🗑️ 開始刪除照片:', filename)

      const response = await fetch(`https://backend.simworld.website/api/delete-photo/${filename}`, {
        method: 'DELETE'
      })

      const data = await response.json()

      if (data.success) {
        console.log('✅ 照片刪除成功:', filename)
        setPhotos(photos.filter(photo => photo.filename !== filename))
      } else {
        console.error('❌ 照片刪除失敗:', data.error)
        alert(`刪除失敗: ${data.error}`)
      }
    } catch (err) {
      console.error('❌ 刪除照片錯誤:', err)
      alert('刪除失敗，請檢查網路連線')
    } finally {
      setDeletingPhoto(null)
    }
  }

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
      {/* 標題欄 */}
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
          {!loading && <span style={{ fontSize: '14px', color: '#888' }}>({photos.length} 張)</span>}
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

      {/* 照片列表 */}
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
          <div style={{ 
            gridColumn: '1 / -1', 
            textAlign: 'center', 
            color: '#00ff00',
            padding: '20px' 
          }}>
            ⏳ 載入中...
          </div>
        )}

        {error && (
          <div style={{ 
            gridColumn: '1 / -1', 
            textAlign: 'center', 
            color: '#ff4444',
            padding: '20px' 
          }}>
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

        {!loading && !error && photos.length === 0 && (
          <div style={{ 
            gridColumn: '1 / -1', 
            textAlign: 'center', 
            color: '#888',
            padding: '20px' 
          }}>
            📭 尚無照片
          </div>
        )}

        {!loading && !error && photos.map((photo, index) => (
          <div
            key={photo.filename || index}
            style={{
              position: 'relative',
              cursor: 'pointer',
              border: '2px solid #00ff00',
              borderRadius: '8px',
              overflow: 'visible',
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
                transition: 'background 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (deletingPhoto !== photo.filename) {
                  e.currentTarget.style.background = 'rgba(255, 0, 0, 1)'
                }
              }}
              onMouseLeave={(e) => {
                if (deletingPhoto !== photo.filename) {
                  e.currentTarget.style.background = 'rgba(255, 0, 0, 0.8)'
                }
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
                flexShrink: 0,
                borderTopLeftRadius: '6px',
                borderTopRightRadius: '6px'
              }}
            />
            
            {/* ✅ 修正後的時間戳記區域 */}
            <div style={{
              padding: '15px 10px',
              minHeight: '70px',
              fontSize: '13px',
              fontWeight: 'bold',
              color: '#ffffff',
              textAlign: 'center',
              borderTop: '2px solid #00ff00',
              backgroundColor: '#1a1a1a',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              whiteSpace: 'normal',
              fontFamily: 'monospace',
              lineHeight: '1.5',
              boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3)'
            }}>
              {/* ✅ 修正：正確處理底線分隔符 */}
              {(() => {
                const timestamp = photo.timestamp
                if (!timestamp) return <span>未知時間</span>
                
                // ✅ 移除底線，只保留數字
                const cleanTimestamp = timestamp.replace(/_/g, '')
                
                console.log('🕐 原始 timestamp:', timestamp)
                console.log('🕐 清理後 timestamp:', cleanTimestamp)
                
                if (cleanTimestamp.length >= 14) {
                  const date = `${cleanTimestamp.substring(0, 4)}/${cleanTimestamp.substring(4, 6)}/${cleanTimestamp.substring(6, 8)}`
                  const time = `${cleanTimestamp.substring(8, 10)}:${cleanTimestamp.substring(10, 12)}:${cleanTimestamp.substring(12, 14)}`
                  
                  console.log('📅 解析後日期:', date)
                  console.log('🕐 解析後時間:', time)
                  
                  return (
                    <>
                      <div style={{ color: '#00ff00', fontSize: '14px' }}>📅 {date}</div>
                      <div style={{ color: '#ffaa00', fontSize: '12px' }}>🕐 {time}</div>
                    </>
                  )
                }
                
                if (cleanTimestamp.length >= 8) {
                  const date = `${cleanTimestamp.substring(0, 4)}/${cleanTimestamp.substring(4, 6)}/${cleanTimestamp.substring(6, 8)}`
                  return <div style={{ color: '#00ff00' }}>📅 {date}</div>
                }
                
                return <span>未知時間</span>
              })()}
            </div>
          </div>
        ))}
      </div>

      {!loading && !error && (
        <div style={{
          padding: '10px',
          borderTop: '1px solid #00ff00',
          textAlign: 'center'
        }}>
          <button
            onClick={fetchPhotoHistory}
            style={{
              padding: '8px 20px',
              background: '#00ff00',
              color: 'black',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
          >
            🔄 重新整理
          </button>
        </div>
      )}

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