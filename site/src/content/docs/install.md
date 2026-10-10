---
title: Install Kapture from GitHub
description: Build and load the free Kapture Chrome extension from its public GitHub source while Chrome Web Store review is pending.
---

Kapture is a free, local-first Chrome extension for screenshots, screen recording, annotation, and an on-device library. Its Chrome Web Store listing is under review. For now, install it from the [public GitHub source](https://github.com/Otitodev/kapture).

## What you need

- Desktop Google Chrome.
- [Node.js 22](https://nodejs.org/en/download) and [pnpm](https://pnpm.io/installation).
- [Git](https://git-scm.com/downloads), or download and extract the repository's source ZIP from GitHub.

## Build the extension

Open a terminal and run:

```bash
git clone https://github.com/Otitodev/kapture.git
cd kapture
pnpm install --frozen-lockfile
pnpm build
```

If you downloaded the source ZIP, open a terminal in the extracted `kapture` folder and run the last two commands. The build creates `.output/chrome-mv3/`.

## Load it in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the `.output/chrome-mv3/` folder inside `kapture`.
4. Pin Kapture from Chrome's extensions menu, then click its icon or use a [capture shortcut](/docs/capture-modes/).

To update, pull the latest GitHub source, run `pnpm install --frozen-lockfile` and `pnpm build` again, then select **Reload** on Kapture's card in `chrome://extensions`.

Your captures stay in your browser profile. Kapture does not upload them; see the [privacy details](/docs/privacy/). Chrome restricts captures on internal pages such as `chrome://` and the Chrome Web Store.
