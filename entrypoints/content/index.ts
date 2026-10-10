import { onMessage } from '@/lib/messages';
import { startRegionSelect } from './region';
import { startElementPicker } from './element';
import { showRecordBar } from './record';

export default defineContentScript({
  // Packaged for explicit injection after a user starts an in-page capture.
  // Avoids a persistent content script and broad host permissions.
  registration: 'runtime',
  matches: [],
  runAt: 'document_idle',
  main() {
    onMessage('content', {
      'ping:content': ({ from }) => ({ pong: true, handler: 'content', from, at: Date.now() }),
      'region:start': () => {
        startRegionSelect();
        return { ok: true };
      },
      'element:start': () => {
        startElementPicker();
        return { ok: true };
      },
      'record:show': () => {
        showRecordBar();
        return { ok: true };
      },
    });
  },
});
