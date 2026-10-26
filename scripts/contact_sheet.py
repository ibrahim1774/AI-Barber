#!/usr/bin/env python3
"""contact_sheet.py raw.mp4 start end step out.png : labelled thumbnails (seconds) for choosing cut points.
Uses the same fps=30 normalisation as make_tutorial_video.py, so the labels match its segment times."""
import subprocess, sys, os, tempfile, glob
from PIL import Image, ImageDraw
raw, a, b, step, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
d = tempfile.mkdtemp(prefix="cs-")
every = max(1, round(step * 30))
first = round(a * 30)
last = round(b * 30)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw, "-vf",
                f"fps=30,select='between(n,{first},{last})*not(mod(n-{first},{every}))',scale=150:326", "-vsync", "0",
                os.path.join(d, "%04d.png")], check=True)
files = sorted(glob.glob(os.path.join(d, "*.png")))
tw, th, cols = 150, 326, 10
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tw, rows * th), (40, 40, 40))
dr = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(Image.open(f), (x, y))
    dr.rectangle([x, y, x + 52, y + 16], fill=(200, 0, 0))
    dr.text((x + 3, y + 2), f"{a + i * every / 30:g}", fill=(255, 255, 255))
sheet.save(out)
