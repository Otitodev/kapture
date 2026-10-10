import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Kapture',
    description: 'Free local-first screenshots and screen recording. Captures stay on your device until you choose to export.',
    permissions: ['activeTab', 'scripting', 'storage', 'offscreen', 'unlimitedStorage', 'debugger', 'tabCapture'],
    action: {
      default_title: 'Kapture',
      default_icon: {
        16: 'icon/icon-16.png',
        32: 'icon/icon-32.png',
      },
    },
    icons: {
      16: 'icon/icon-16.png',
      32: 'icon/icon-32.png',
      48: 'icon/icon-48.png',
      128: 'icon/icon-128.png',
    },
    // Chrome allows at most four suggested shortcuts. Single-element capture has none by default.
    commands: {
      'capture-visible': {
        suggested_key: { default: 'Ctrl+Shift+1', mac: 'Command+Shift+1' },
        description: 'Capture the visible area',
      },
      'capture-region': {
        suggested_key: { default: 'Ctrl+Shift+2', mac: 'Command+Shift+2' },
        description: 'Capture a selected region',
      },
      'capture-fullpage': {
        suggested_key: { default: 'Ctrl+Shift+3', mac: 'Command+Shift+3' },
        description: 'Capture the full page',
      },
      'record-tab': {
        suggested_key: { default: 'Ctrl+Shift+5', mac: 'Command+Shift+5' },
        description: 'Record this tab',
      },
    },
  },
});
