---
name: product-demo-video
description: Create polished short product demo or store promo videos from product screenshots, screen recordings, a repository, and optional visual references. Use for a new promo or a substantial restyle, not for simple trimming or captions.
---

# Product Demo Video

Make a finished, reviewable video that shows the product doing what the copy claims. A reference sets a visual direction; it is not footage, music, or branding to copy.

## Shape the video

- Inspect the product, available footage, destination, and any reference. Confirm only missing decisions that materially change the result. Default to 16:9, 20–40 seconds, readable without sound, unless the destination suggests otherwise.
- Write a short beat list: hook, three to six product proof points, and a closing action. Give each scene one claim and one matching visual. Check claims against the actual product.
- Choose a visual system from [styles.md](references/styles.md), or derive one from the user's reference. Keep type, color, framing, motion, and transitions coherent. Different styles should change layout and motion, not just colors.

## Gather and prepare assets

- Prefer real product UI and actual interactions. Capture with the app, browser automation, or existing recordings when available; use illustrations only when a real screen would not explain the point.
- Crop away idle time, expose the meaningful action, and make small UI legible at final resolution. Keep a source-to-scene map so the edit remains replaceable.
- Use original audio or media with verified rights for the intended promotional use. Check the actual license before using catalog or “no copyright” music.

## Build and deliver

- Reuse an existing video project and the editor or renderer already chosen by the user or project. For a new code-driven project with no chosen renderer, default to Remotion; choose another tool when the work calls for it. Keep scene content separate from design tokens and reusable motion components.
- Animate from timeline frame values so seeking and rendering are deterministic. Use a shared scene model for text, visual asset, color/style, duration, and entrance timing. Respect safe margins and avoid unsupported claims or fake UI states.
- Render the requested format, inspect a contact sheet and representative frames at full size, and verify duration, dimensions, and audio. Fix visible timing, legibility, and asset problems before delivery. Include the final file and editable source location.
