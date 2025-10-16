import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

/* eslint-disable */
// @ts-ignore
const nodeProcess = process;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    
    server: {
      host: '0.0.0.0',       // 允許外部訪問
      port: parseInt(env.VITE_PORT) || 5173,
      strictPort: true,      // 一定用 5173，不要跳 port
      hmr: {
        clientPort: 5173,
      },
      allowedHosts: [
        'frontend.simworld.website',  // ✅ Cloudflare 前端
        'backend.simworld.website',   // ✅ Cloudflare 後端 API
        '.ngrok-free.app',            // ✅ 保留 ngrok 測試
        '.ngrok-free.dev'             // ✅ 保留 ngrok 測試
      ],
      proxy: {
        '/api': {
          target: 'http://simworld_backend:8000',
          changeOrigin: true,
          secure: false,
        },
        '/socket.io': {
          target: 'http://simworld_backend:8000',
          changeOrigin: true,
          ws: true,
        },
        '/rendered_images': {
          target: 'http://simworld_backend:8000',
          changeOrigin: true,
          secure: false,
        },
        '/static': {
          target: 'http://simworld_backend:8000',
          changeOrigin: true,
          secure: false,
        },
      },
    },

    preview: {
      host: '0.0.0.0',
      port: parseInt(env.VITE_PORT) || 5173,
    },

    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            charts: ['chart.js', 'echarts', 'react-chartjs-2', 'echarts-for-react'],
            visualization: ['d3', '@react-three/fiber', '@react-three/drei'],
          },
        },
      },
    },
  }
})
