#!/usr/bin/env python3
# scripts/generate_icons.py
# Run: pip install pillow && python scripts/generate_icons.py

from PIL import Image, ImageDraw
import os

os.makedirs('icons', exist_ok=True)

BG  = (13, 13, 13)       # --on1 / #0D0D0D
DOT = (155, 202, 242)    # --c1  / #9BCAF2

for size in [16, 48, 128]:
    img  = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    r    = int(size * 0.18)

    # Rounded dark background
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)

    # Blue dot accent (top-left area)
    dr = int(size * 0.14)
    cx = int(size * 0.30)
    cy = int(size * 0.32)
    draw.ellipse([cx - dr, cy - dr, cx + dr, cy + dr], fill=DOT)

    img.save(f'icons/icon{size}.png', 'PNG')
    print(f'✅ icons/icon{size}.png ({size}x{size})')

print('\nDone! Run from your extension root directory.')
