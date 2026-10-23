#!/usr/bin/env python3
"""Contact sheet: sheet.py <out.png> <img1> <img2> ... (3 across, 560px wide each)"""
import sys
from PIL import Image, ImageDraw
out, files = sys.argv[1], sys.argv[2:]
W = 560; ims = []
for f in files:
    im = Image.open(f).convert('RGB'); h = int(im.height * W / im.width); ims.append((f, im.resize((W, h))))
cols = 3; rows = (len(ims) + cols - 1) // cols
H = max(i.height for _, i in ims)
sheet = Image.new('RGB', (cols * W, rows * (H + 24)), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for n, (f, im) in enumerate(ims):
    x, y = (n % cols) * W, (n // cols) * (H + 24)
    d.text((x + 4, y + 6), f.rsplit('/', 1)[-1], fill=(255, 255, 0)); sheet.paste(im, (x, y + 24))
sheet.save(out)
