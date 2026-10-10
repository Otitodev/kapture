# AGENTS.md

## Project

Kapture is a local-first screenshot and screen recording browser extension (Chrome MV3, Edge planned). Built with WXT + React 19 + Tailwind CSS v4 + TypeScript.

## Commands

```bash
pnpm dev              # WXT dev server with HMR
pnpm build            # Production build to .output/
pnpm compile          # Typecheck only (tsc --noEmit)
pnpm test             # Unit tests (vitest run, node environment)
pnpm test:e2e         # E2E tests (Playwright, loads unpacked extension)
```

**Order matters:** `pnpm compile` before `pnpm test`. E2E tests require `pnpm build` first — they load the extension from `.output/chrome-mv3`.

**Single test:** `pnpm test -- --run tests/unit/region.test.ts` or `pnpm test:e2e -- -g "region:"`.

## Landing site (`site/`)

Separate Astro package in the same repo (never under `entrypoints/` — WXT would bundle it into the extension).

```bash
pnpm --filter kapture-site dev    # Astro dev server
pnpm --filter kapture-site build  # Static build to site/dist/
pnpm --filter kapture-site check  # astro check (types)
```

Root shortcuts: `dev:site`, `build:site`, `build:all`. The site imports design tokens from `assets/tailwind.css`, so token edits require rebuilding both. `site/public/` is copied from `design/store/` (favicons, OG image, hero GIF).

## Build system: WXT

This project uses [WXT](https://wxt.dev), not plain Vite. Key implications:

- `pnpm postinstall` runs `wxt prepare`, which generates `.wxt/` types and entrypoint definitions. If you see missing type declarations for `defineBackground`, `defineContentScript`, etc., run `pnpm install` or `npx wxt prepare`.
- Entrypoints live in `entrypoints/` and are auto-discovered by WXT. Each has an `index.html` + `main.ts(x)` pair.
- The `@/` alias resolves to the project root (configured in `.wxt/tsconfig.json`).

## Architecture

- **`entrypoints/background.ts`** — MV3 service worker. Must be stateless (workers sleep). Handles command routing, capture, and message relay.
- **`entrypoints/popup/`** — Quick-action popup (React).
- **`entrypoints/editor/`** — Full-tab capture viewer/editor (React). Opens after capture via `editorUrl(id)`.
- **`entrypoints/options/`** — Settings page (React).
- **`entrypoints/offscreen/`** — Offscreen document for MediaRecorder (Stage 4, not yet implemented).
- **`entrypoints/content/`** — Content scripts injected into web pages. Region-select overlay uses a `<kapture-region>` custom element with Shadow DOM.
- **`lib/`** — Shared code: typed message bus (`messages.ts`), capture logic (`capture.ts`), IndexedDB store (`db.ts`), region math (`region.ts`), filename templates (`filename.ts`), shortcuts (`shortcuts.ts`), theme (`theme.ts`), offscreen helper (`offscreen.ts`).
- **`components/ui/`** — shadcn-style primitives (Button, Icon, MenuRow). Copy from here for new UI.
- **`assets/tailwind.css`** — Design tokens as CSS custom properties, consumed by Tailwind v4 `@theme inline`. Dark-first with light theme via `data-theme` attribute.

## Typed message bus

All cross-context communication goes through `lib/messages.ts`. Messages use a typed envelope: `{ kapture: true, type, target, payload }`. The `MessageMap` interface is the single source of truth — add new messages there, then register handlers with `onMessage(target, handlers)`.

## Testing

- **Unit tests** (`tests/unit/`) run in Node with `fake-indexeddb`. Modules that import `wxt/browser` must be mocked: `vi.mock('wxt/browser', () => ({ browser: {} }))`.
- **E2E tests** (`tests/e2e/`) launch a real Chromium with the unpacked extension. They use `chromium.launchPersistentContext` and interact with extension pages via `chrome-extension://` URLs. Tests are serialized (`workers: 1`) and each closes all pages in `afterEach`.

## Conventions

- **No linter or formatter is configured.** `pnpm compile` (tsc --noEmit) is the only automated check. No CI workflows exist.
- **Design tokens only** — no raw hex or arbitrary pixel values in components. Use the Tailwind utilities (`bg-surface`, `text-fg`, `border-rule`, etc.) or CSS variables (`--k-*`).
- **Shadow DOM isolation** — in-page overlays (region selector, toasts) must use Shadow DOM so host page CSS cannot leak in or out.
- **Restricted pages** — `isCapturableUrl()` in `lib/capture.ts` blocks `chrome://`, `edge://`, `about:`, extension stores, and `view-source:` pages. Check this before attempting capture.
- **Service worker statelessness** — never store mutable state at module scope in `background.ts`. MV3 workers sleep and restart.
