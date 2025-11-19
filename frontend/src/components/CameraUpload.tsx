import React, { useRef, useState } from 'react';

interface CameraUploadProps {
  onUploadSuccess?: (filename: string) => void;
  currentPosition?: { lat: number; lon: number; altitude?: number | null } | null; // ✅ 新增
}

const CameraUpload: React.FC<CameraUploadProps> = ({ 
  onUploadSuccess,
  currentPosition // ✅ 新增
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);

    setUploading(true);
    setMessage('📤 上傳中...');

    const formData = new FormData();
    formData.append('photo', file);
    
    // ✅ 加入 GPS 座標
    if (currentPosition) {
      formData.append('latitude', currentPosition.lat.toString());
      formData.append('longitude', currentPosition.lon.toString());
      if (currentPosition.altitude !== null && currentPosition.altitude !== undefined) {
        formData.append('altitude', currentPosition.altitude.toString());
      }
      console.log('📍 上傳照片時的 GPS 座標:', currentPosition);
    } else {
      console.warn('⚠️ 無法取得 GPS 座標');
    }

    try {
      const response = await fetch('https://backend.simworld.website/api/upload-photo', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setMessage(`✅ 上傳成功: ${data.filename}`);
        console.log('照片已上傳:', data);
        onUploadSuccess?.(data.filename);
      } else {
        const errorData = await response.json();
        setMessage(`❌ 上傳失敗: ${errorData.error || '未知錯誤'}`);
      }
    } catch (error) {
      console.error('上傳錯誤:', error);
      setMessage('❌ 上傳錯誤，請檢查網路連接');
    } finally {
      setUploading(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '0px',
      right: '0px',
      zIndex: 1001,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px'
    }}>
      {preview && (
        <img
          src={preview}
          alt="Preview"
          style={{
            maxWidth: '150px',
            maxHeight: '150px',
            borderRadius: '10px',
            marginBottom: '10px',
            border: '2px solid #00ff00',
            boxShadow: '0 4px 8px rgba(0, 255, 0, 0.3)'
          }}
        />
      )}
      
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleCapture}
        style={{ display: 'none' }}
      />
      
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        style={{
          width: '60px',
          height: '60px',
          fontSize: '28px',
          backgroundColor: uploading ? '#666' : '#000',
          color: '#00ff00',
          border: '3px solid #00ff00',
          borderRadius: '50%',
          cursor: uploading ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 8px rgba(0, 255, 0, 0.3)',
          transition: 'all 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        onMouseEnter={(e) => {
          if (!uploading) {
            e.currentTarget.style.transform = 'scale(1.1)'
            e.currentTarget.style.boxShadow = '0 6px 12px rgba(0, 255, 0, 0.5)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 255, 0, 0.3)'
        }}
      >
        {uploading ? '⏳' : '📸'}
      </button>
      
      {/* ✅ 顯示當前 GPS 狀態 */}
      {currentPosition && (
        <div style={{
          fontSize: '10px',
          color: '#00ff00',
          fontFamily: 'monospace',
          textAlign: 'center',
          maxWidth: '150px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          📍 GPS: {currentPosition.lat.toFixed(4)}, {currentPosition.lon.toFixed(4)}
        </div>
      )}
      
      {message && (
        <div style={{
          padding: '8px 16px',
          backgroundColor: message.includes('✅') 
            ? 'rgba(0, 255, 0, 0.2)' 
            : 'rgba(255, 0, 0, 0.2)',
          color: message.includes('✅') ? '#00ff00' : '#ff4444',
          border: message.includes('✅') 
            ? '1px solid #00ff00' 
            : '1px solid #ff4444',
          borderRadius: '5px',
          fontSize: '12px',
          maxWidth: '200px',
          textAlign: 'center',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {message}
        </div>
      )}
    </div>
  );
};

export default CameraUpload;