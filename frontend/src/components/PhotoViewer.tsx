import { useState, useEffect } from 'react'

interface PhotoViewerProps {
  photoUrl: string | null
  onClose: () => void
  autoCloseTime?: number // 自動關閉時間（毫秒），預設 10 秒
}

export default function PhotoViewer({ 
  photoUrl, 
  onClose, 
  autoCloseTime = 10000 
}: PhotoViewerProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [remainingTime, setRemainingTime] = useState(autoCloseTime / 1000)
  const [imageLoaded, setImageLoaded] = useState(false)

  useEffect(() => {
    if (photoUrl) {
      setIsVisible(true)
      setImageLoaded(false)
      setRemainingTime(autoCloseTime / 1000)
      
      console.log('📸 顯示照片彈窗:', photoUrl)
      
      const closeTimer = setTimeout(() => {
        console.log('⏰ 照片彈窗自動關閉')
        handleClose()
      }, autoCloseTime)

      const countdownInterval = setInterval(() => {
        setRemainingTime((prev) => {
          const newTime = prev - 1
          return newTime > 0 ? newTime : 0
        })
      }, 1000)

      return () => {
        clearTimeout(closeTimer)
        clearInterval(countdownInterval)
      }
    }
  }, [photoUrl, autoCloseTime])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && photoUrl) {
        console.log('⌨️ 按下 ESC 鍵關閉照片彈窗')
        handleClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [photoUrl])

  const handleClose = () => {
    console.log('❌ 關閉照片彈窗')
    setIsVisible(false)
    setTimeout(onClose, 300)
  }

  if (!photoUrl) return null

  const fullPhotoUrl = photoUrl.startsWith('http') 
    ? photoUrl 
    : `https://backend.simworld.website${photoUrl}`

  const progressPercentage = (remainingTime / (autoCloseTime / 1000)) * 100

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
      onClick={handleClose}
    >
      <div
        style={{
          position: 'relative',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(20px)',
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 頂部控制欄 */}
        <div style={{
          width: '100%',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 10px',
        }}>
          {/* 左側標題 */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'linear-gradient(135deg, rgba(0, 255, 0, 0.15) 0%, rgba(0, 200, 0, 0.1) 100%)',
            padding: '12px 20px',
            borderRadius: '12px',
            border: '1px solid rgba(0, 255, 0, 0.3)',
            boxShadow: '0 4px 20px rgba(0, 255, 0, 0.15)',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              background: 'linear-gradient(135deg, #00ff00 0%, #00cc00 100%)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
              boxShadow: '0 2px 10px rgba(0, 255, 0, 0.3)',
            }}>
              📸
            </div>
            <div>
              <div style={{ 
                color: '#00ff00', 
                fontWeight: 'bold', 
                fontSize: '16px',
                fontFamily: 'monospace',
                letterSpacing: '0.5px',
              }}>
                新照片已上傳
              </div>
              <div style={{
                color: '#888',
                fontSize: '12px',
                fontFamily: 'monospace',
                marginTop: '2px',
              }}>
                {remainingTime <= 3 ? '⚠️ 即將關閉' : '🖱️ 點擊背景或按 ESC 關閉'}
              </div>
            </div>
          </div>

          {/* 右側關閉按鈕 */}
          <button
            onClick={handleClose}
            style={{
              width: '50px',
              height: '50px',
              background: 'linear-gradient(135deg, rgba(255, 0, 0, 0.8) 0%, rgba(200, 0, 0, 0.8) 100%)',
              border: '1px solid rgba(255, 0, 0, 0.5)',
              borderRadius: '12px',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease',
              boxShadow: '0 4px 15px rgba(255, 0, 0, 0.2)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 0, 0, 1) 0%, rgba(220, 0, 0, 1) 100%)'
              e.currentTarget.style.transform = 'scale(1.1) rotate(90deg)'
              e.currentTarget.style.boxShadow = '0 6px 25px rgba(255, 0, 0, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 0, 0, 0.8) 0%, rgba(200, 0, 0, 0.8) 100%)'
              e.currentTarget.style.transform = 'scale(1) rotate(0deg)'
              e.currentTarget.style.boxShadow = '0 4px 15px rgba(255, 0, 0, 0.2)'
            }}
            title="關閉 (ESC)"
          >
            ✕
          </button>
        </div>

        {/* 照片容器 */}
        <div style={{
          position: 'relative',
          backgroundColor: '#000',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: `
            0 0 0 1px rgba(0, 255, 0, 0.3),
            0 10px 40px rgba(0, 255, 0, 0.2),
            0 20px 80px rgba(0, 255, 0, 0.1)
          `,
          border: '2px solid rgba(0, 255, 0, 0.4)',
          maxWidth: '100%',
          maxHeight: '75vh',
        }}>
          {!imageLoaded && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#00ff00',
              fontSize: '18px',
              fontFamily: 'monospace',
            }}>
              ⏳ 載入中...
            </div>
          )}
          <img
            src={fullPhotoUrl}
            alt="Uploaded Photo"
            onLoad={() => setImageLoaded(true)}
            style={{
              maxWidth: '100%',
              maxHeight: '75vh',
              objectFit: 'contain',
              display: 'block',
              opacity: imageLoaded ? 1 : 0,
              transition: 'opacity 0.3s ease',
            }}
          />
        </div>

        {/* 底部資訊欄 */}
        <div style={{
          width: '100%',
          marginTop: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          {/* 進度條 */}
          <div style={{
            width: '100%',
            height: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '2px',
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              width: `${progressPercentage}%`,
              height: '100%',
              background: remainingTime <= 3 
                ? 'linear-gradient(90deg, #ff4444 0%, #ff0000 100%)'
                : 'linear-gradient(90deg, #00ff00 0%, #00cc00 100%)',
              transition: 'width 1s linear',
              boxShadow: remainingTime <= 3
                ? '0 0 10px rgba(255, 0, 0, 0.5)'
                : '0 0 10px rgba(0, 255, 0, 0.5)',
            }} />
          </div>

          {/* 倒數計時 */}
          <div style={{
            textAlign: 'center',
            color: remainingTime <= 3 ? '#ff4444' : '#00ff00',
            fontSize: '14px',
            fontFamily: 'monospace',
            fontWeight: 'bold',
            textShadow: remainingTime <= 3 
              ? '0 0 10px rgba(255, 0, 0, 0.5)' 
              : '0 0 10px rgba(0, 255, 0, 0.5)',
          }}>
            ⏱️ {remainingTime} 秒後自動關閉
          </div>
        </div>
      </div>
    </div>
  )
}