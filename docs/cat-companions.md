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

The original free-roam `za-catroam.js` (and the older `za-cat2d.js` / `za-cat3d.js`) were removed on 2026-11-03; they had not been loaded for a long time. The pair lane and the fullscreen follow-up below replaced them.

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

## Motion-state review — 2026-10-18

The fullscreen controller now synchronizes the renderer's reduced-motion state on each draw, so starting with reduced motion and later disabling it restores idle and grooming animation as well as movement. Frozen sampling preserves each actor's stored clock instead of resetting the visible pose. The standalone lane supplies actor clocks and indices, preserving blinking and paw-play when fullscreen modules are unavailable. Regression tests cover all three cases.

## 寫實影片模式（選項 C）— 2026-11-09

兩隻貓（白貓、狸花）改用 AI 生成、去背的短影片來畫；舊的精靈圖（`za-white-actions.webp`／`za-tabby-actions.webp`、companion 圖、原白貓照片）全部保留，當作備援。只改畫面，不碰持股、交易、報價、登入或任何計算。

### 檔案與載入

- `za-catvideo.js`：純函式核心 `window.__zaCatVideoCore`（`shouldUseVideo`、`clipFor`、`planLoads`、`shouldRun`、`frameDue`、`nextClip`、`flipFor`、`placement`）＋瀏覽器繪製器。片段清單內嵌在檔案裡（`.assetsignore` 不發布 `*.json`），測試會比對它和 `za-cats/za-cat-clips.json` 完全一致。
- 載入順序：`za-cat.js?v=17` → `za-catphoto.js?v=17` → `za-catspace.js` → `za-catpair.js?v=8` → `za-catlife.js?v=9` → `za-catvideo.js?v=1`。開了「減少動態效果」時 `za-catphoto.js` 根本不載 `za-catvideo.js`，所以不會下載任何 mp4；之後關掉減少動態效果才補載。其他條件（WebGL、省流量、記憶體、手動開關、先前失敗）由 `za-catvideo.js` 在建立任何 `<video>` 之前判斷，不符合就什麼都不做。
- 影片路徑 `/za-cats/za-<貓>-<動作>.mp4?v=1`。

### 片段（每段 24fps，H.264「上下疊」去背：上半＝已乘透明度的彩色，下半＝灰階透明度）

`寬×高` 是半張畫面（mp4 實際是 寬 × 2高），括號是檔案大小（bytes）。

| 動作 | 播放 | 長度 | 白貓 | 狸花 | 影片中朝向 |
| --- | --- | --- | --- | --- | --- |
| idle | 循環 | 4 秒 | 188×278（20,094） | 284×268（43,298） | left |
| look | 循環 | 4 秒 | 214×270（28,568） | 232×264（56,075） | left |
| groom | 循環 | 4 秒 | 212×266（41,626） | 234×268（69,193） | left |
| play | 循環 | 4 秒 | 202×284（35,176） | 326×338（81,814） | left |
| react | 循環 | 3 秒 | 188×284（19,436） | 286×268（42,102） | left |
| walk | 循環 | 3 秒 | 348×204（63,876） | 386×206（92,235） | right |
| trot | 循環 | 2 秒 | 352×206（44,220） | 378×208（59,850） | right |
| liedown | 一次 | 4.042 秒 | 246×280（42,379） | 316×276（69,106） | left |
| sleep | 循環 | 4 秒 | 236×166（15,053） | 308×168（44,013） | left |
| wake | 一次 | 4.042 秒 | 276×284（46,404） | 322×278（70,959） | left |

20 段合計 985,477 bytes。一開始只載兩隻貓的 idle＋walk（219,503 bytes），其他第一次用到才載。

- **用 Blob 播放（iOS）**：Cloudflare Workers 靜態檔不支援 HTTP Range（永遠回 200 整個檔），而 iOS Safari 不播放沒有 206 的 `<video src>`。所以每段影片先 `fetch(url, {credentials:'same-origin'})` 整段下載，轉成 Blob，用 `URL.createObjectURL` 當 `src`（blob: 不需要 Range）。每段只下載一次、留在記憶體重複用；teardown／退回精靈圖時全部 `revokeObjectURL`。下載失敗或非 2xx → 跟影片錯誤一樣退回精靈圖。blob 還沒到之前不呼叫 `play()`；設定 src 後重新套用播放速度（載入流程會把 `playbackRate` 重設成 `defaultPlaybackRate`）。

### 狀態 → 片段

walk→walk；run／chase→trot（原本會用跑步的地方改用小跑）；hop／jump／pounce／respond／play／invite→play；groom→groom；settle→liedown（播完接 sleep）；sleep→sleep；wake→wake（播完接 idle）；react／tap→react；observe／sit／look→依貓自己的時鐘每 9 秒在 idle 與 look 之間輪流（兩隻錯開）；其他→idle。一次性片段以 1.6 倍速播放（約 2.5 秒），配合狀態機原本的趴下／起身時間；被走路打斷會立刻換。位置、路線、速度完全沿用 `za-catlife.js`／`za-catpair.js`，只換畫出來的圖。

### 繪製

- 每隻貓一張 WebGL 畫布（`premultipliedAlpha:true`，混色 ONE／ONE_MINUS_SRC_ALPHA），放在原本的貓按鈕裡，位置仍只靠原本的 CSS transform；畫布比貓框大（2.4×1.5 倍），走路的長身體不會被切到。坐著的貓（影片中約 250px 高）畫成框高的 0.8 倍，腳掌對齊精靈圖的地面線（框的 152/160）。影片朝向與貓的朝向不同時左右鏡像。
- 沒有新的 requestAnimationFrame：只在原本的小貓迴圈（最多 30fps）呼叫 `rt.render()` 時畫；影片畫得出來就把精靈圖畫布設為 `visibility:hidden`，否則照舊畫精靈圖。
- `<video>` 一律 `muted`、`playsinline`（在設 src 前設好），放在畫面外 1×1、透明的容器裡。任何影片都不設 `autoplay`：只有在可以執行（`shouldRun`）時由 `playSafe()` 呼叫 `play()`；`pauseSafe()` 一律呼叫 `pause()`（還沒開始播也一樣），所以暫停或收起時載入完成也不會自己開始播。
- 解碼上限（`videoPlan`）：每隻貓同時只有一支在播（正在顯示或即將顯示的那段）；預載的下一段（趴下→睡覺、睡覺→醒來、醒來→坐著、其他→走路／坐著）只載不播；其他片段一律 `removeAttribute('src')`＋`load()` 釋放。每隻貓最多 2 支、兩隻合計最多 4 支 `<video>`。換片段時畫面先停在 WebGL 貼圖的最後一格，等新片段第一格出來，不會閃回精靈圖。
- 全螢幕模式裡某隻貓因為沒有安全空位而藏起來時，那隻貓的影片全部暫停；兩隻都藏起來就連迴圈一起停（`za-catlife.js` 的 `running()`），之後畫面重新量測／relayout 有空位時再恢復。
- WebGL 資源（貼圖、緩衝、程式、著色器）由同一個 `disposeGL()` 釋放，並用 `WEBGL_lose_context` 交還 context：teardown、退回精靈圖、切到減少動態效果、初始化失敗，以及決定不用影片時探測用的畫布都會呼叫。

### 什麼時候用精靈圖（退回）

`shouldUseVideo`：減少動態效果 → 不用（`reduced-motion`）；沒有 WebGL → 不用；`localStorage['za-cat-video']='off'` → 不用；`'on'` → 強制使用（仍然受減少動態效果與 WebGL 限制）；這個分頁先前失敗過（`sessionStorage['za-cat-video-failed']='1'`）→ 不用；省流量（Save-Data）→ 不用；`navigator.deviceMemory` < 4 → 不用；其他 → 用影片。

執行中只要發生下列任何一件，就立刻改回精靈圖，這個分頁剩下的時間都不再試（記在 `sessionStorage`）：WebGL 建立失敗或遺失、任何 video `error`、`play()` 被拒絕（例如 iPhone 低耗電模式擋自動播放；`pause()` 打斷 `play()` 的 AbortError 不算）、影片畫面無法上傳成貼圖、或在實際執行中 4 秒內等不到第一格（背景分頁的時間不算）。

### 暫停與省電

分頁在背景、按「收起小貓」、按「暫停小貓」、標題列小貓區不在畫面上 → 原本的迴圈停止，同時暫停所有影片（`rt.video.sleep()`）；回來時恢復同一個迴圈與目前片段。中途打開「減少動態效果」→ 暫停並釋放所有影片，交回不動的精靈圖；關掉時再嘗試影片。

### 標題列循環變得比較有活力（兩種模式都適用）

`za-catpair.js` 的循環改成：打招呼 3 → 靠近 4 → 玩 4 → 往右追 5 → 轉身 1.5 → 往左追 6 → 理毛 5（白貓理毛、狸花看）→ 東張西望 4（白貓觀察、狸花先歪頭再理毛）→ 趴下 3 → 睡 12 → 醒 3 秒。一輪 50.5 秒，睡覺從 34 秒（佔 54%）降到 12 秒（約 24%）。

### 全螢幕的貓可以點

覆蓋層仍然 `pointer-events:none`；只有貓自己的框在沒蓋到受保護按鈕（`za-catspace` 的 forbid 區）、沒暫停、沒收起、不是減少動態效果時加上 `za-cat-tappable`（`pointer-events:auto`）。點下去：睡著／正在趴下 → 叫醒；坐著 → 輪流歪頭（react）與理毛（groom）；走路中不理。白貓原本的心情點擊反應（泡泡、哈氣、長按呼嚕）照舊；按鈕仍是 `tabIndex=-1`、`aria-hidden`。

### 素材流程

`scripts/cat-video/matte.py <raw_dir> <out_dir>`：把綠幕背景的 AI 生成片段（每段先統一成 480×480、24fps）用綠色程度去背，裁切、統一縮放（坐姿 250px 高、站姿相對 0.74），輸出上下疊的 H.264 mp4 與 `za-cat-clips.json`（含 anchorX／groundY／facing／bytes）。需要 ffmpeg（libx264）、numpy、scipy、pillow。

### 預覽與測試

- `node scripts/preview-cat-video.mjs --serve 8787` → 開 `http://127.0.0.1:8787/?force=video`（或 `?force=sprite`；`&demo=walk` 等可直接顯示某個動作）。下方按鈕可以逐一強制每個動作；每按一次都從頭播（「趴下→睡」先完整播趴下再交給睡覺、「醒來」先完整播醒來再交給坐著），方便截圖。也可以 `node scripts/preview-cat-video.mjs out.html` 寫成檔案（影片以相對路徑指到 `za-cats/`），但瀏覽器不允許從 file:// 的影片做 WebGL 貼圖，所以直接開檔會自動退回精靈圖。只用本機檔案，沒有帳戶資料、不連網。
- `tests/catvideo.test.mjs`：開關條件、片段對應、延遲載入、暫停／背景／收起、減少動態效果中途切換、各種失敗退回、一次性片段交棒、30fps 上限、新的循環時間。

### 尚未驗證

真的 iPhone／Android 上的 FPS、耗電、發熱、低耗電模式與記憶體表現都還沒測；也還沒有在真實瀏覽器裡截圖比對影片版和精靈圖版的貓大小與腳的位置（只有計算與模擬測試）。走路影片的步伐速度沒有跟實際移動距離同步，可能看得到一點滑步。
