interface UploadProgressProps {
  progress: number
  isUploading: boolean
  onCancel?: () => void
}

export default function UploadProgress({ progress, isUploading, onCancel }: UploadProgressProps) {
  if (!isUploading) return null

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      background: 'rgba(0, 0, 0, 0.9)',
      padding: '30px',
      borderRadius: '15px',
      border: '2px solid #00ff00',
      zIndex: 2000,
      minWidth: '300px',
      boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)'
    }}>
      <div style={{
        color: '#00ff00',
        fontSize: '18px',
        fontWeight: 'bold',
        marginBottom: '15px',
        textAlign: 'center',
        fontFamily: 'monospace'
      }}>
        {progress >= 100 ? '✅ 上傳完成，處理中...' : '📤 照片上傳中...'}
      </div>

      {/* 進度條背景 */}
      <div style={{
        width: '100%',
        height: '30px',
        background: 'rgba(255, 255, 255, 0.1)',
        borderRadius: '15px',
        overflow: 'hidden',
        border: '1px solid #00ff00',
        marginBottom: '15px'
      }}>
        {/* 進度條 */}
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: progress >= 100 
            ? 'linear-gradient(90deg, #00ff00, #00cc00)' 
            : 'linear-gradient(90deg, #2196F3, #1976D2)',
          transition: 'width 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: '14px',
          fontWeight: 'bold'
        }}>
          {progress.toFixed(0)}%
        </div>
      </div>

      {/* 進度文字 */}
      <div style={{
        color: '#00ff00',
        fontSize: '14px',
        textAlign: 'center',
        marginBottom: '15px',
        fontFamily: 'monospace'
      }}>
        {progress >= 100 
          ? '正在處理照片，請稍候...' 
          : `已上傳 ${progress.toFixed(1)}%`}
      </div>

      {/* 取消按鈕 */}
      {progress < 100 && onCancel && (
        <button
          onClick={onCancel}
          style={{
            width: '100%',
            padding: '10px',
            background: 'rgba(255, 0, 0, 0.8)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold',
            transition: 'background 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 0, 0, 1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 0, 0, 0.8)'
          }}
        >
          ❌ 取消上傳
        </button>
      )}

      {/* 完成後的提示 */}
      {progress >= 100 && (
        <div style={{
          color: '#888',
          fontSize: '12px',
          textAlign: 'center',
          fontFamily: 'monospace',
          marginTop: '10px'
        }}>
          照片將在所有裝置上同步顯示
        </div>
      )}
    </div>
  )
}