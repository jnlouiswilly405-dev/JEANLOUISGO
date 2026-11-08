import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionProvider } from '@multigo/app-shell';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider apiBaseUrl={import.meta.env.VITE_API_BASE_URL ?? ''} allowedRoles={['ADMIN']}>
      <App />
    </SessionProvider>
  </StrictMode>,
);
