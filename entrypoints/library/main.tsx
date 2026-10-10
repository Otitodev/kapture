import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { initTheme } from '@/lib/theme';
import { App } from './App';

void initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
