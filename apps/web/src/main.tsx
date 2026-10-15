/**
 * 应用入口 —— React 19 createRoot + Provider 树。
 *
 * Provider 树（由外到内）：
 *   StrictMode → AuthProvider（cookie 会话 + 业务档案）→ BrowserRouter
 *   → TooltipProvider（shadcn tooltip 全局）→ Toaster（sonner 全局 toast）→ App
 *
 * 迁移要点（对照旧 main.tsx）：
 *  - 旧：FluentProvider webLightTheme（固定浅色）→ 移除，改用 TW3 + shadcn CSS 变量主题。
 *  - 旧：Fluent Toaster → sonner Toaster。
 *  - i18n 副作用导入初始化。
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/hooks/useAuth';
import App from './App';
import './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <TooltipProvider>
          <App />
          <Toaster richColors position="top-center" />
        </TooltipProvider>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);
