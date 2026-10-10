import { browser } from 'wxt/browser';
import type { CaptureResult, RegionInput, RegionResult } from './capture';

export type Target = 'background' | 'offscreen' | 'content';

export interface PingResponse {
  pong: true;
  handler: Target;
  from: string;
  at: number;
}

/** Every message in the extension: its destination, request payload and response. */
export interface MessageMap {
  ping: { target: 'background'; req: { from: string }; res: PingResponse };
  'ping:offscreen': { target: 'offscreen'; req: { from: string }; res: PingResponse };
  'ping:content': { target: 'content'; req: { from: string }; res: PingResponse };
  'offscreen:ping-via-background': { target: 'background'; req: { from: string }; res: PingResponse };
  'capture:visible': { target: 'background'; req: Record<string, never>; res: CaptureResult };
  'capture:fullpage': { target: 'background'; req: Record<string, never>; res: CaptureResult };
  'capture:delayed': { target: 'background'; req: { delayMs: number }; res: CaptureResult };
  /** Popup or shortcut asks the background to open the region overlay on the active tab. */
  'region:begin': { target: 'background'; req: Record<string, never>; res: { ok: boolean; error?: string } };
  /** Background tells the page's content script to show the overlay. */
  'region:start': { target: 'content'; req: Record<string, never>; res: { ok: true } };
  /** Content script asks the background to capture, crop and save the chosen region. */
  'capture:region': { target: 'background'; req: RegionInput; res: RegionResult };
  'capture:open': { target: 'background'; req: { id: string }; res: { ok: true } };
  /** Popup asks the background to start the element picker on the active tab. */
  'element:begin': { target: 'background'; req: Record<string, never>; res: { ok: boolean; error?: string } };
  /** Background tells the page's content script to start the element picker. */
  'element:start': { target: 'content'; req: Record<string, never>; res: { ok: true } };
  /** Popup asks the background to start recording ('tab' = tabCapture, 'screen' = display media). */
  'recording:start': { target: 'background'; req: { mode?: 'tab' | 'screen'; mic?: boolean }; res: { ok: boolean; error?: string } };
  /** Popup or the in-page bar asks the background to stop recording. */
  'recording:stop': { target: 'background'; req: Record<string, never>; res: { ok: boolean; id?: string; error?: string } };
  /** Popup or the in-page bar asks to cancel (discard) the active recording. */
  'recording:cancel': { target: 'background'; req: Record<string, never>; res: { ok: boolean; error?: string } };
  /** Whether a recording is currently active. */
  'recording:status': { target: 'background'; req: Record<string, never>; res: { recording: boolean } };
  /** Background tells the offscreen document to start the MediaRecorder. */
  'record:begin': { target: 'offscreen'; req: { streamId: string | null; mode?: 'tab' | 'screen' | 'synthetic'; mic?: boolean; title?: string; url?: string }; res: { ok: boolean; error?: string } };
  /** Background asks the offscreen document to stop and save the clip. */
  'record:stop': { target: 'offscreen'; req: Record<string, never>; res: { ok: boolean; id?: string; mime?: string; bytes?: number; chunks?: number; error?: string } };
  /** Offscreen reports a finished recording (explicit stop, length cap, or source-ended). Background clears the flag and opens it. */
  'record:finished': { target: 'background'; req: { id: string }; res: { ok: true } };
  /** Background asks the offscreen document to discard the recording. */
  'record:cancel': { target: 'offscreen'; req: Record<string, never>; res: { ok: boolean; error?: string } };
  /** Telemetry-free self-check: offscreen records a generated clip and saves it. */
  'record:synthetic': { target: 'offscreen'; req: { mic?: boolean; title?: string; url?: string }; res: { ok: boolean; id?: string; mime?: string; bytes?: number; chunks?: number; error?: string } };
  'recording:synthetic': { target: 'background'; req: { mic?: boolean; title?: string; url?: string }; res: { ok: boolean; id?: string; mime?: string; bytes?: number; chunks?: number; error?: string } };
  /** Background tells the page to show the in-page recording control bar. */
  'record:show': { target: 'content'; req: Record<string, never>; res: { ok: true } };
}

export type MessageType = keyof MessageMap;
type Req<T extends MessageType> = MessageMap[T]['req'];
type Res<T extends MessageType> = MessageMap[T]['res'];

interface Envelope<T extends MessageType = MessageType> {
  kapture: true;
  type: T;
  target: Target;
  payload: Req<T>;
}

const TARGETS: { [K in MessageType]: MessageMap[K]['target'] } = {
  ping: 'background',
  'ping:offscreen': 'offscreen',
  'ping:content': 'content',
  'offscreen:ping-via-background': 'background',
  'capture:visible': 'background',
  'capture:fullpage': 'background',
  'capture:delayed': 'background',
  'region:begin': 'background',
  'region:start': 'content',
  'capture:region': 'background',
  'capture:open': 'background',
  'element:begin': 'background',
  'element:start': 'content',
  'recording:start': 'background',
  'recording:stop': 'background',
  'recording:cancel': 'background',
  'recording:status': 'background',
  'record:begin': 'offscreen',
  'record:stop': 'offscreen',
  'record:finished': 'background',
  'record:cancel': 'offscreen',
  'record:show': 'content',
  'record:synthetic': 'offscreen',
  'recording:synthetic': 'background',
};

export async function sendMessage<T extends MessageType>(
  type: T,
  payload: Req<T>,
  opts: { tabId?: number } = {},
): Promise<Res<T>> {
  const envelope: Envelope<T> = { kapture: true, type, target: TARGETS[type], payload };
  const response =
    opts.tabId !== undefined
      ? await browser.tabs.sendMessage(opts.tabId, envelope)
      : await browser.runtime.sendMessage(envelope);
  if (response && typeof response === 'object' && 'error' in response) {
    throw new Error(String((response as { error: unknown }).error));
  }
  return response as Res<T>;
}

type Handlers<G extends Target> = {
  [K in MessageType as MessageMap[K]['target'] extends G ? K : never]?: (
    payload: Req<K>,
    sender: Browser.runtime.MessageSender,
  ) => Res<K> | Promise<Res<K>>;
};

/**
 * Registers handlers for messages addressed to `target`. Messages for other
 * targets are ignored so only the intended context answers.
 */
export function onMessage<G extends Target>(target: G, handlers: Handlers<G>): void {
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const msg = raw as Partial<Envelope> | undefined;
    if (!msg?.kapture || msg.target !== target || !msg.type) return;
    const handler = (handlers as Record<string, ((p: unknown, s: typeof sender) => unknown) | undefined>)[msg.type];
    if (!handler) return;
    Promise.resolve(handler(msg.payload, sender)).then(sendResponse, (err) =>
      sendResponse({ error: String(err) }),
    );
    return true; // keep the channel open for the async response
  });
}
