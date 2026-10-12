# Repository Guidelines

## Project Structure

Kapture is a local-first Chrome extension built with WXT, React 19, TypeScript, and Tailwind CSS v4. Extension entrypoints are in `entrypoints/`: `background.ts` is the stateless MV3 service worker; `content/` contains page overlays; `offscreen/` records media; and `popup/`, `editor/`, `library/`, and `options/` are extension pages. Shared capture, recording, IndexedDB, privacy, and typed messaging code is in `lib/`; shared UI is in `components/ui/`; design tokens are in `assets/tailwind.css`. Tests are in `tests/unit/` and `tests/e2e/`. The Astro landing site and docs are in `site/`, store art in `design/store/`.

## Implemented Features and Boundaries

The extension supports visible, region, full-page, delayed, and element screenshots; an annotation editor; a searchable local library with folders; and tab or screen recording with optional microphone audio. Recordings are limited to five minutes and saved as MP4 when supported, otherwise WebM. Captures stay in browser storage unless exported. The site provides GitHub install instructions and a copyable agent prompt. Agent evidence bundles, diagnostics, MCP integration, and cloud services are planned, not shipped.

## Build, Test, and Site Commands

- `pnpm install` prepares WXT types; use `pnpm install --frozen-lockfile` for clean installs.
- `pnpm dev` runs the extension with hot reload; `pnpm build` creates `.output/chrome-mv3/`.
- `pnpm compile` runs `tsc --noEmit`; `pnpm test` runs Vitest. Compile before unit tests.
- `pnpm test:e2e` runs Playwright against the built extension; build first.
- `pnpm --filter kapture-site dev|check|build` runs the Astro site; `pnpm build:all` builds both.

CI checks extension compile, tests, build, and E2E, plus the site. Check both builds after token changes.

## Code and Privacy Conventions

Follow nearby TypeScript style with two-space indentation. No formatter or linter is configured. Use design tokens such as `bg-surface` and `text-fg`, not raw colors. Isolate injected UI in Shadow DOM. Add cross-context message types to `MessageMap` in `lib/messages.ts` and handlers through `onMessage`. Keep mutable recording state in the offscreen document, never at service-worker module scope. Check `isCapturableUrl()` and preserve the explicit first-capture disclosure. Avoid broad host permissions or sending capture data without an explicit product and privacy review.

## Tests and Pull Requests

Name unit tests `*.test.ts` and browser tests `*.spec.ts`. Unit tests use Vitest and `fake-indexeddb`; mock `wxt/browser` where needed. Playwright tests are serialized and load an unpacked build. Use short, imperative commit subjects. Pull requests should explain behavior, link relevant issues, list checks run, and include screenshots for visible UI changes.

