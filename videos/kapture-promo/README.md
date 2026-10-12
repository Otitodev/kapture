# Kapture product demo

A 24-second, 1280×720 Remotion promo built from the repository's store screenshots and animated UI walkthrough. It is silent and uses on-screen text so it can play without audio.

`KaptureColorPromo` is a 27.5-second alternate cut inspired by the bright colors, large highlighted text, and animated product cards of the supplied reference video. It includes a real Kapture region-selection capture, Kapture UI screenshots, and an original synthesized score; no reference footage or audio is included.

On Windows, run `npm.cmd install` in this folder, then `npm.cmd run studio` to preview or `npm.cmd run render` to recreate `renders/kapture-promo.mp4`. The render script uses the standard Chrome installation path; change `--browser-executable` if Chrome is elsewhere.

Run `npm.cmd run score` to regenerate the alternate cut's music, then `npm.cmd run render:color` to recreate `renders/kapture-color-promo.mp4`. The real region-selection take is `public/region-live.mp4`.

The UI stills and `demo.gif` for the original cut come from `design/store/`. The source files there are unchanged. The colorful cut uses the real browser capture in `region-live.mp4` for its region-selection scene.
