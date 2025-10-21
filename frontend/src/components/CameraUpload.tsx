import React, { useRef, useState } from 'react';

interface CameraUploadProps {
  onUploadSuccess?: (filename: string) => void;
}

const CameraUpload: React.FC<CameraUploadProps> = ({ onUploadSuccess }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(null); // 照片預覽

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 照片預覽
    const previewUrl = URL.createObjectURL(file);
    setPreview(previewUrl);

    setUploading(true);
    setMessage('📤 上傳中...');

    const formData = new FormData();
    formData.append('photo', file);

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
      // 3秒後清除訊息
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '10px'
    }}>
      {/* 照片預覽 */}
      {preview && (
        <img
          src={preview}
          alt="Preview"
          style={{
            maxWidth: '100%',
            maxHeight: '200px',
            borderRadius: '10px',
            marginBottom: '10px',
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
          padding: '15px 30px',
          fontSize: '18px',
          fontWeight: 'bold',
          backgroundColor: uploading ? '#cccccc' : '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '50px',
          cursor: uploading ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          transition: 'all 0.3s ease',
        }}
      >
        {uploading ? '⏳ 上傳中...' : '📷 拍照並上傳'}
      </button>
      {message && (
        <div style={{
          padding: '10px 20px',
          backgroundColor: message.includes('✅') ? '#4CAF50' : '#f44336',
          color: 'white',
          borderRadius: '5px',
          fontSize: '14px',
          maxWidth: '300px',
          textAlign: 'center',
        }}>
          {message}
        </div>
      )}
    </div>
  );
};

export default CameraUpload;