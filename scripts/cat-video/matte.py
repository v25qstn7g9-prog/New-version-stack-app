#!/usr/bin/env python3
"""Chroma-key AI-generated cat clips into stacked-alpha H.264 MP4s.

Usage: python3 scripts/cat-video/matte.py <raw_dir> <out_dir>
Raw clips: <raw_dir>/<cat>-<action>.mp4 on a flat chroma-green background.
Output: <out_dir>/za-<cat>-<action>.mp4 (top half colour premultiplied by
alpha, bottom half alpha as grey) and <out_dir>/za-cat-clips.json.
Needs: ffmpeg (libx264), numpy, scipy, pillow. Open-source only.
"""
import json, os, subprocess, sys
import numpy as np
from scipy import ndimage

CATS = ['white', 'tabby']
# action: (loop, family) ; family decides relative body scale
ACTIONS = {
    'idle': (True, 'sit'), 'look': (True, 'sit'), 'groom': (True, 'sit'),
    'play': (True, 'sit'), 'react': (True, 'sit'), 'walk': (True, 'stand'),
    'trot': (True, 'stand'), 'liedown': (False, 'sit'), 'sleep': (True, 'sit'),
    'wake': (False, 'sit'),
}
SRC = 480          # every raw clip is normalised to 480x480 first
SIT_HEIGHT = 250   # output pixel height of the seated cat
STAND_RATIO = 0.74 # standing ear-to-paw height relative to seated height
FPS = 24
T0, T1 = 35, 105   # greenness (G - max(R,B)) ramp: <=T0 opaque, >=T1 clear


def read(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={SRC}:{SRC}:flags=lanczos,fps={FPS}',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, SRC, SRC, 3).astype(np.float32)


def matte(v):
    border = np.concatenate([v[0, :6].reshape(-1, 3), v[0, -6:].reshape(-1, 3), v[0, :, :6].reshape(-1, 3), v[0, :, -6:].reshape(-1, 3)])
    bg = np.median(border, 0)
    d = v[..., 1] - np.maximum(v[..., 0], v[..., 2])
    a = np.clip((T1 - d) / (T1 - T0), 0, 1)
    out_a = np.zeros_like(a)
    for i in range(len(v)):
        lab, n = ndimage.label(a[i] > 0.5)
        if n == 0:
            continue
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        keep = lab == (int(np.argmax(sizes)) + 1)
        keep = ndimage.binary_fill_holes(keep)
        keep = ndimage.binary_dilation(keep, iterations=3)
        out_a[i] = np.where(keep, a[i], 0)
    out_a[out_a < 0.03] = 0
    am = out_a[..., None]
    fg = (v - (1 - am) * bg) / np.maximum(am, 0.08)
    fg = np.clip(fg, 0, 255)
    fg[..., 1] = np.minimum(fg[..., 1], np.maximum(fg[..., 0], fg[..., 2]) + 4)  # despill
    return fg, out_a


def height_of(a0):
    ys = np.where((a0 > 0.5).any(1))[0]
    return ys.max() - ys.min() + 1


def main(raw_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    manifest = {'version': 1, 'fps': FPS, 'cats': {}}
    for cat in CATS:
        sit_h = height_of(matte(read(f'{raw_dir}/{cat}-idle.mp4')[:1])[1][0])
        stand_h = height_of(matte(read(f'{raw_dir}/{cat}-walk.mp4')[:1])[1][0])
        scale = {'sit': SIT_HEIGHT / sit_h, 'stand': SIT_HEIGHT * STAND_RATIO / stand_h}
        manifest['cats'][cat] = {}
        for action, (loop, fam) in ACTIONS.items():
            v = read(f'{raw_dir}/{cat}-{action}.mp4')
            if loop and len(v) > 2:
                v = v[:-1]  # first == last frame; drop the duplicate so the loop does not stutter
            fg, a = matte(v)
            s = scale[fam]
            size = int(round(SRC * s / 2)) * 2
            union = (a > 0.02).any(0)
            ys, xs = np.where(union)
            pad = int(6 / s)
            x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, SRC - 1)
            y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, SRC - 1)
            # convert crop to output pixels, even sizes
            ox0, oy0 = int(x0 * s) // 2 * 2, int(y0 * s) // 2 * 2
            ow = min(((int(np.ceil(x1 * s)) - ox0) + 1) // 2 * 2 + 2, size - ox0)
            oh = min(((int(np.ceil(y1 * s)) - oy0) + 1) // 2 * 2 + 2, size - oy0)
            ow, oh = ow // 2 * 2, oh // 2 * 2
            prem = (fg * a[..., None]).astype(np.uint8)
            alpha = (a * 255).astype(np.uint8)
            stacked = np.concatenate([prem, np.repeat(alpha[..., None], 3, -1)], 1)  # (n, 2*SRC, SRC, 3)
            name = f'za-{cat}-{action}.mp4'
            path = f'{out_dir}/{name}'
            vf = (f'split[a][b];[a]crop={SRC}:{SRC}:0:0,scale={size}:{size}:flags=lanczos,crop={ow}:{oh}:{ox0}:{oy0}[t];'
                  f'[b]crop={SRC}:{SRC}:0:{SRC},scale={size}:{size}:flags=lanczos,crop={ow}:{oh}:{ox0}:{oy0}[m];[t][m]vstack')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{SRC}x{2*SRC}', '-r', str(FPS),
                            '-i', '-', '-filter_complex', vf, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '30',
                            '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-g', str(FPS * 2), '-movflags', '+faststart', '-an', path],
                           input=stacked.tobytes(), check=True)
            a0 = a[0]
            ys0, xs0 = np.where(a0 > 0.5)
            ground = float(ys0.max() * s - oy0)
            anchor = float(np.median(xs0) * s - ox0)
            manifest['cats'][cat][action] = {
                'src': name, 'w': ow, 'h': oh, 'frames': int(len(v)), 'duration': round(len(v) / FPS, 3),
                'loop': loop, 'anchorX': round(anchor, 1), 'groundY': round(ground, 1), 'facing': 'right' if fam == 'stand' else 'left',
                'bytes': os.path.getsize(path),
            }
            print(cat, action, ow, oh, len(v), os.path.getsize(path), flush=True)
    with open(f'{out_dir}/za-cat-clips.json', 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
