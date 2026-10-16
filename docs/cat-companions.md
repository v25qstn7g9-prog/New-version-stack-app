# White cat and tabby companion preview

This change adds a visual-only, bounded companion area below the existing header content. It does not read or write holdings, transactions, portfolio storage, account details, or financial settings. Existing white-cat mood and tap semantics remain available.

## Assets and behavior

- The two new atlases are AI-generated photographic poses, not recorded cat videos. They approximate a walk cycle; anatomical differences between frames remain a visual limitation.
- The original user's white-cat photo and footage atlas remain unchanged. The still photo is the fallback if the new white atlas fails.
- New assets: `za-white-companion.webp` (76,836 bytes), `za-tabby-companion.webp` (96,024 bytes). Both RGBA WebP, 640 × 640, 4 × 4 cells, 160px cell dimensions, ground baseline at y=152 within each cell.
- Row-major cells 0–7 walk left, 8 seated left, 9 head lowered, 10 loaf, 11 asleep, 12 look left, 13 look right, 14 paw raised, 15 paw down. Source poses were generated with image_gen and cropped/padded using one shared scale, then encoded as WebP quality 85.
- Generation brief: consistent adult brown/grey striped tabby and matching white cat, photographic cutouts, transparent background, eight side-profile walking poses, seated/head-lowered/loaf/sleep poses, and gentle paw-play poses. No replacement or deletion of the original white-cat source assets.
- Approach → play → follow/chase in each direction → settle → sleep → wake. Cats keep a fixed ground line and personal space; no squash-through flips or whole-image grooming rotations. Direction changes happen during stopped poses.
- Reduced motion displays a stationary pair. The pause button stops motion. Background tabs and offscreen pet areas stop their animation loop. No per-frame layout scan; rendering is capped at 30fps, drawing two 160px canvases.

## Verification and review

Run `npm test` for the application tests, including pure pair-state simulation and lifecycle regressions. Run `node scripts/preview-cat-pair.mjs /tmp/cat-pair-preview.html` to generate a standalone offline preview with the exact production scripts and embedded images. The preview contains no account data and makes no financial calls.

Original `za-catroam.js` is retained for historical compatibility and tests but is no longer loaded. Its former free-roam behavior is intentionally replaced by the pair's reserved lane.

Physical iPhone/Safari behavior and subjective animation quality require review before production deployment. No production deployment is part of this change.
