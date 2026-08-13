#!/usr/bin/env python3
# 生成 PWA 图标：深空底 + 机甲六边形 + 星芒
import numpy as np
from PIL import Image, ImageDraw

def make(size, path):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 背景：径向渐变深空
    y, x = np.mgrid[0:size, 0:size].astype(float)
    cx = cy = (size - 1) / 2
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (size * 0.72)
    r = np.clip(r, 0, 1)
    bg = np.zeros((size, size, 4), dtype=np.uint8)
    c1 = np.array([10, 10, 40]); c2 = np.array([30, 16, 70]); c3 = np.array([80, 12, 60])
    for i in range(size):
        t = r[i]
        col = np.where(t[:, None] < 0.5,
                       c1 + (c2 - c1) * (t[:, None] / 0.5),
                       c2 + (c3 - c2) * ((t[:, None] - 0.5) / 0.5))
        bg[i, :, :3] = col.astype(np.uint8)
        bg[i, :, 3] = 255
    img = Image.fromarray(bg, "RGBA")
    d = ImageDraw.Draw(img)
    # 六边形
    n = 6
    R = size * 0.40
    pts = [(cx + R * np.cos(2 * np.pi * i / n - np.pi / 2),
            cy + R * np.sin(2 * np.pi * i / n - np.pi / 2)) for i in range(n)]
    d.polygon(pts, outline=(0, 245, 255, 255), width=max(2, size // 64))
    pts2 = [(cx + R * 0.82 * np.cos(2 * np.pi * i / n - np.pi / 2),
             cy + R * 0.82 * np.sin(2 * np.pi * i / n - np.pi / 2)) for i in range(n)]
    d.polygon(pts2, outline=(255, 46, 147, 220), width=max(1, size // 96))
    # 星芒（五角星）
    r1, r2 = size * 0.21, size * 0.085
    sp = []
    for i in range(10):
        rr = r1 if i % 2 == 0 else r2
        a = -np.pi / 2 + i * np.pi / 5
        sp.append((cx + rr * np.cos(a), cy + rr * np.sin(a)))
    d.polygon(sp, fill=(0, 245, 255, 255))
    img.save(path, "PNG")
    print("saved", path, img.size)

make(512, r"C:\Users\17319\Documents\ChatGPT\APP\anime-workbench\app\icons\icon-512.png")
make(192, r"C:\Users\17319\Documents\ChatGPT\APP\anime-workbench\app\icons\icon-192.png")
