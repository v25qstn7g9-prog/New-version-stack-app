# White cat and tabby companion

The initial merged version added a visual-only, bounded companion area below the existing header content. It does not read or write holdings, transactions, portfolio storage, account details, or financial settings. Existing white-cat mood and tap semantics remain available.

## Initial lane version: assets and behavior

- The two new atlases are AI-generated photographic poses, not recorded cat videos. They approximate a walk cycle; anatomical differences between frames remain a visual limitation.
- The original user's white-cat photo and footage atlas remain unchanged. The still photo is the fallback if the new white atlas fails.
- New assets: `za-white-companion.webp` (76,836 bytes), `za-tabby-companion.webp` (96,024 bytes). Both RGBA WebP, 640 × 640, 4 × 4 cells, 160px cell dimensions, ground baseline at y=152 within each cell.
- Row-major cells 0–7 walk left, 8 seated left, 9 head lowered, 10 loaf, 11 asleep, 12 look left, 13 look right, 14 paw raised, 15 paw down. Source poses were generated with image_gen and cropped/padded using one shared scale, then encoded as WebP quality 85.
- Generation brief: consistent adult brown/grey striped tabby and matching white cat, photographic cutouts, transparent background, eight side-profile walking poses, seated/head-lowered/loaf/sleep poses, and gentle paw-play poses. No replacement or deletion of the original white-cat source assets.
- Approach → play → follow/chase in each direction → settle → sleep → wake. Cats keep a fixed ground line and personal space; no squash-through flips or whole-image grooming rotations. Direction changes happen during stopped poses.
- Reduced motion displays a stationary pair. The pause button stops motion. Background tabs and offscreen pet areas stop their animation loop. No per-frame layout scan; rendering is capped at 30fps, drawing two 160px canvases.

## Verification and review

Run `npm test` for the application tests, including pure pair-state simulation and lifecycle regressions. Run `node scripts/preview-cat-pair.mjs /tmp/cat-pair-preview.html` to generate a standalone offline preview with the exact production scripts and embedded images. The preview contains no account data and makes no financial calls.

Original `za-catroam.js` is retained for historical compatibility and tests but is no longer loaded. Its former free-roam behavior was replaced by the initial pair lane; the follow-up below supersedes that reserved lane.

Physical iPhone/Safari behavior and subjective animation quality require review before production deployment. The fullscreen follow-up requires separate review and merge approval.

## Fullscreen-only follow-up

This review slice reuses only the two existing companion atlases. Additional generated action assets are deferred. `za-catspace.js` provides conservative footprint and curved-path routing; `za-catlife.js` drives independent routes, speed, gait phase, wait duration and activity timing. White rests longer; tabby explores more. Both can initiate play and settle beside one another. The current walking frames are reused for cross-region movement; there are no new anatomically distinct run/jump sequences in this slice. Vertical relocation can still look like sprite sliding. No realism percentage is claimed.

The viewport overlay is click-through. Pause, hide and wake remain explicit header controls. Controls and visible text/media rectangles are protected, while blank card areas remain traversable. Disconnected or crowded layouts may limit roaming; no legal space means cats hide. Scroll, resize, visual viewport offsets and relevant DOM layout changes trigger safe remeasurement. Reduced motion and background tabs stop animation. Original white-cat assets and portfolio functionality are unchanged.

Verification: earlier full expanded-version suite passed513/513 before final additions. Final fullscreen-only cat tests are run separately and reported in the PR. Another full-suite run was blocked on an existing TWSE outbound request and was not retried. Initial merged baseline had485 passing tests. Synthetic390×844 tests demonstrate top/middle/bottom coverage without crossing protected rectangles; this is not actual mobile/browser verification. Cloud DevTools mobile emulation was blocked by organization policy. iPhone/Safari remains untested. Synthetic200-obstacle review benchmark: target search4.4ms, initialization6.2ms, worst step4.5ms over1,200 steps; not a device FPS measurement.

Run `node scripts/preview-cat-pair.mjs /tmp/cat-fullscreen-preview.html` for an offline exact-code preview without account data. Review and explicit merge approval are required before production changes.

## Natural motion update — 2026-10-18

The existing pair renderer now prefers `za-white-actions.webp` and `za-tabby-actions.webp`. Each is a 1280 × 1280 RGBA WebP with an 8 × 8 grid of 160px cells. The two additional downloads total 467,228 bytes; the earlier companion sheets remain as fallback when an enhanced image is unavailable. Original photographs and recorded-footage assets are retained.

| Cells | Action | Playback |
| --- | --- | --- |
| 0–7 | Walking | Advances with actual ground distance |
| 8–15 | Short run | Separate limb poses and longer stride |
| 16–23 | Jump | Crouch, push-off, extended/tucked flight, landing |
| 24–31 | Seated observation | Sparse blinks, ear/head attention |
| 32–39 | Self-grooming | Slow paw-to-face sequence |
| 40–47 | Settling | Standing through sitting to sleeping loaf |
| 48–55 | Waking | Head lift, stretch and standing recovery |
| 56–63 | Paw play | Crouch, reach and return |

These are generated photographic poses, not filmed cats or skeletal animation. The original white-cat photo and tabby companion supplied character references. White was generated against chroma green for clean extraction. Asset preparation extracts complete connected silhouettes across nominal grid edges, applies a common scale and ground baseline, and encodes WebP. The generated stretch spans one extra nominal cell: cell 53 holds the complete cell-52 stretch rather than cutting through the body. Thus each atlas has 64 playback slots, with one held stretch beat. Some generated anatomical variation remains, especially in rapid posture changes.

`samplePose` selects the enhanced frames independently for each actor. Tiny local chest/tail patches animate resting poses while paws stay fixed. A short crossfade softens stationary changes; moving feet never crossfade. Actors stand before departure, turn while stationary, groom independently, and rest for different durations. White rests longer; tabby explores more. A bounded detour search prevents repeatedly choosing an obstructed straight route. Pausing, reduced motion, hidden tabs and fallback behavior retain the existing controls.

An endpoint-rounding regression in `za-catspace.js` was also fixed: subtraction of the last segment could reset an actor to that segment's start. Exact and overdue route completion now hold the landing endpoint.

`node scripts/preview-cat-pair.mjs <output.html>` creates a self-contained, offline preview with natural-life mode and action demonstration buttons. Demonstration mode enlarges the two cats on separate rows for inspection; normal application size and roaming remain unchanged. The preview uses the actual sampler and renderer. Browser checks use Chromium mobile viewports; this is not physical iPhone/Safari verification. The approved natural-motion changes use the repository's normal automatic deployment workflow.
