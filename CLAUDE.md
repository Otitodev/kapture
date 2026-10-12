# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the repository guidelines (structure, conventions, privacy rules, PR expectations) and applies here in full. This file adds commands and the architecture that spans files.

## Commands

pnpm workspace (root extension + `site/` Astro app). Node 22 in CI.

```bash
pnpm install                 # also runs `wxt prepare` (generates .wxt types)
pnpm dev                     # WXT dev server with HMR (dev:edge for Edge)
pnpm compile                 # tsc --noEmit — run before tests
pnpm test                    # Vitest (tests/unit/**/*.test.ts, node env, fake-indexeddb)
pnpm exec vitest run tests/unit/db.test.ts          # single file
pnpm exec vitest run -t "name fragment"             # single test by name
pnpm build                   # -> .output/chrome-mv3/
pnpm test:e2e                # Playwright against the unpacked build; build first (workers: 1)
pnpm exec playwright test -g "name fragment"        # single e2e test
pnpm build:all               # extension + site
pnpm --filter kapture-site dev|check|build
```

CI (`.github/workflows/ci.yml`): compile → test → build → Playwright (under xvfb). No linter/formatter exists.

## Architecture

**Typed message bus (`lib/messages.ts`).** All cross-context communication goes through `sendMessage(type, payload, {tabId?})` and `onMessage(target, handlers)`. `MessageMap` is the single source of truth: each entry declares `target` (`background | offscreen | content | popup`), request and response types, and `TARGETS` must list every type too (compile error otherwise). Messages are envelopes with `kapture: true`; each context's `onMessage` ignores envelopes for other targets. Handler errors are returned as `{ error }` and re-thrown by `sendMessage`, so callers `catch` rather than check a flag. Fire-and-forget pushes such as `capture:progress` (background → popup) are expected to fail when no popup is open.

**Background (`entrypoints/background.ts`) is an orchestrator, stateless by design.** Every capture entry point (popup message or keyboard command) funnels through the same `*AndOpen` helpers: check `requireCaptureDisclosure()` (opens the popup consent tab on first use), capture via `lib/capture.ts`, then open the editor tab with `editorUrl(id)`. Content scripts are injected lazily via `scripting.executeScript` when the first message to a tab fails (pages that predate the extension). Shortcut failures have no popup, so `runShortcutCommand` stores the error (`lib/lastError.ts`), sets a badge, and tries `action.openPopup()`.

**Recording spans three contexts.** Background gets a `tabCapture` stream ID (or none for screen mode), ensures the offscreen document (`lib/offscreen.ts`), and sends `record:begin`. The offscreen document owns the `MediaRecorder` and all mutable recording state, writes chunks to IndexedDB (`chunks` store), assembles the clip, and reports `record:finished` (also fired on the length cap or source ending), which is the single place the background clears the flag and opens the editor. The "is recording" flag is persisted in `storage.local` (`RECORDING_FLAG_KEY`) because the service worker can't hold it; the content script shows the in-page stop/discard bar (`record:show`).

**Storage (`lib/db.ts`).** IndexedDB via `idb`: `captures` (blob + metadata + `annotations` JSON + optional `folder`) and `chunks` (in-progress recording pieces keyed by session). Everything — popup, editor, library — reads captures from here; nothing leaves the device unless exported.

**Capture pipeline (`lib/capture.ts`, `lib/region.ts`).** Visible/full-page/delayed/region/element captures share this module; full-page stitches scrolled slices and reports `FullPageCaptureProgress`. Region and element selection run in the content script (`entrypoints/content/region.ts`, `element.ts`, UI in Shadow DOM) and send the chosen rect back via `capture:region`.

**UI pages** (`popup`, `editor`, `library`, `options`) are React 19 apps sharing `components/ui/` and Tailwind v4 tokens from `assets/tailwind.css`; the editor's annotation model lives in `lib/editor.ts`. Manifest, permissions, and the four suggested shortcuts (Chrome's maximum) are in `wxt.config.ts`.

## Notes

- `AGENT_READY_EVIDENCE_PLAN.md` describes planned (unshipped) agent/MCP features; don't treat it as existing behavior.
- E2E and CI use the built extension, so token/style changes should be verified with both `pnpm build` and `pnpm --filter kapture-site build`.
