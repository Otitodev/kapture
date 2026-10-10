import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { initTheme } from '@/lib/theme';

void initTheme();

function Options() {
  return (
    <main className="mx-auto max-w-2xl space-y-3 px-8 py-14">
      <h1 className="text-5xl font-light leading-[48px] tracking-[-0.02em]">settings</h1>
      <p className="text-[18px] leading-7 tracking-[0.01em] text-muted">everything is saved on this device.</p>
      <p className="pt-8 text-muted">filename templates, quality, and shortcuts arrive in a later build.</p>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
