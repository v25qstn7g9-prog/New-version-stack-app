#!/usr/bin/env python3
# 小白貓真實感：從舊雪碧圖（v3）重做 v4。只動影格像素，不碰程式邏輯。
# 1) 走路接縫：最後一格→第一格輪廓差很多（alpha IoU 0.73）。試過裁格／換起點／對齊腳底與重心都改善不到 0.74，
#    所以在 11→0 之間用光流（Farneback，雙向變形再混合）補兩格過渡，走路變 14 格一個循環。
# 2) 去背邊緣：半透明邊的顏色換成最近的實心毛色（去掉影片背景殘色＝亮灰光暈）、alpha<32 清掉、
#    alpha 侵蝕約 1px（混 40% 原 alpha 保住細腳）再輕微柔化、刪掉 <12px 的小碎點。
# 用法：python3 scripts/cat-sprite-realism.py 舊圖.webp 新圖.webp
import sys, json, numpy as np, cv2
from PIL import Image
from scipy import ndimage as nd
src, dst = sys.argv[1], sys.argv[2]
FW, FH, COLS = 112, 140, 12
A = np.array(Image.open(src).convert("RGBA"))
def fr(i): r, c = divmod(i, COLS); return A[r*FH:(r+1)*FH, c*FW:(c+1)*FW].copy()
old = [fr(i) for i in range(93)]
WALK0, WALKN = 61, 12

def warp(img, flow, t):
    h, w = flow.shape[:2]; gx, gy = np.meshgrid(np.arange(w), np.arange(h))
    mx = (gx + flow[..., 0] * t).astype(np.float32); my = (gy + flow[..., 1] * t).astype(np.float32)
    pm = img.astype(np.float32); pm[..., :3] *= pm[..., 3:4] / 255.0   # 預乘後再變形，避免邊緣混到黑色
    out = cv2.remap(pm, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return out
def gray(f): x = f.astype(np.float32); return (x[..., :3].mean(-1) * x[..., 3] / 255.0).astype(np.uint8)
def tween(a, b, t):
    ga, gb = gray(a), gray(b)
    fab = cv2.calcOpticalFlowFarneback(gb, ga, None, 0.5, 4, 15, 5, 7, 1.5, 0)  # b 的每點到 a 哪裡取
    fba = cv2.calcOpticalFlowFarneback(ga, gb, None, 0.5, 4, 15, 5, 7, 1.5, 0)
    wa = warp(a, fab, t)        # a 往 b 走 t
    wb = warp(b, fba, 1 - t)    # b 往 a 退 1-t
    m = wa * (1 - t) + wb * t
    al = m[..., 3:4]; rgb = np.where(al > 0, m[..., :3] * 255.0 / np.maximum(al, 1e-3), 0)
    return np.dstack([np.clip(rgb, 0, 255), np.clip(al[..., 0], 0, 255)]).astype(np.uint8)

walk = old[WALK0:WALK0 + WALKN]
walk = walk + [tween(walk[-1], walk[0], 1 / 3), tween(walk[-1], walk[0], 2 / 3)]
frames = old[:WALK0] + walk + old[WALK0 + WALKN:]

def clean(f):
    f = f.copy(); al = f[..., 3].astype(np.float32)
    core = al >= 240
    if core.any():   # 半透明邊：顏色換成最近的實心毛色（去背景殘色）
        _, (iy, ix) = nd.distance_transform_edt(~core, return_indices=True)
        edge = ~core
        f[..., :3][edge] = f[..., :3][iy[edge], ix[edge]]
    al[al < 32] = 0
    ero = cv2.erode(al, np.ones((3, 3), np.uint8))           # 侵蝕 1px（十字以外也算）
    al = cv2.GaussianBlur(0.4 * al + 0.6 * ero, (3, 3), 0.6)  # 跟原本 alpha 混一點：細細的腳不會被吃掉；再輕微柔化保留抗鋸齒
    al[al < 12] = 0
    lab, n = nd.label(al > 0)
    if n > 1:
        sz = nd.sum(np.ones_like(al), lab, range(1, n + 1))
        for k, s in enumerate(sz, 1):
            if s < 12: al[lab == k] = 0
    f[..., 3] = np.clip(al, 0, 255).astype(np.uint8)
    f[..., :3][f[..., 3] == 0] = 0
    return f
frames = [clean(f) for f in frames]
rows = (len(frames) + COLS - 1) // COLS
out = np.zeros((rows * FH, COLS * FW, 4), np.uint8)
for i, f in enumerate(frames): r, c = divmod(i, COLS); out[r*FH:(r+1)*FH, c*FW:(c+1)*FW] = f
q = int(sys.argv[3]) if len(sys.argv) > 3 else 85
Image.fromarray(out).save(dst, "WEBP", quality=q, alpha_quality=90, method=6, exact=False)
print(json.dumps({"total": len(frames), "rows": rows}))
