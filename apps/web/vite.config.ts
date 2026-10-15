import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// ⚠ Vite 8 的 configLoader:'native'（未来默认）不支持 __dirname → 用 import.meta.dirname（P0 spike 验证）
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 业务 API
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      // auth SDK 登录链（/auth/password/login、/auth/refresh、/auth/logout）
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      // storage 图片代理下载（/files/<objectKey>）
      '/files': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    // app-kit standalone adapter 缺省 assetsDir=dist/client，故产物输出到 dist/client
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
