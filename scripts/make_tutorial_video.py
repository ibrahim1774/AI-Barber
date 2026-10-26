#!/usr/bin/env python3
"""Cuts a raw simulator recording into a short tutorial clip with arrows and captions.

Usage: make_tutorial_video.py spec.json
spec: {"raw": "in.mp4", "out": "out.mp4", "w": 576, "h": 1252,
       "segments": [[start, end, speed], ...],              # raw-time ranges, played at `speed`
       "overlays": [{"t0": 0, "t1": 3, "text": "Tap any text", "arrow": [x, y, "up|down|left|right"]}]}
Overlay times are on the OUTPUT timeline; x, y are fractions of the frame (the arrow tip).
Pillow-drawn overlays, ffmpeg H.264 encode (the local ffmpeg has no drawtext).
"""
import json, subprocess, sys, tempfile, os
from PIL import Image, ImageDraw, ImageFont

AMBER = (245, 158, 11, 255)
DARK = (20, 20, 20, 235)

def font(size):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def overlay_png(spec, o, path):
    W, H = spec["w"], spec["h"]
    S = 2  # draw at 2x then downsample for smooth edges
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if o.get("rect"):  # a solid patch (optionally with text) to hide the local test address in Settings
        x0, y0, x1, y1 = o["rect"]
        d.rectangle([x0 * W * S, y0 * H * S, x1 * W * S, y1 * H * S], fill=tuple(o.get("color", [20, 20, 20])) + (255,))
        if o.get("label"):
            d.text((x0 * W * S + 8 * S, y0 * H * S + 4 * S), o["label"], font=font(24 * S), fill=(245, 158, 11, 255))
    if o.get("arrow"):
        x, y, direction = o["arrow"]
        tx, ty = x * W * S, y * H * S
        L, shaft, head = 150 * S, 22 * S, 54 * S  # length, shaft half... width, head half-width
        vec = {"up": (0, 1), "down": (0, -1), "left": (1, 0), "right": (-1, 0)}[direction]  # direction of the tail from the tip
        # build an arrow pointing at the tip, tail along `vec`
        px, py = -vec[1], vec[0]
        def pt(a, b):  # a along tail, b perpendicular
            return (tx + vec[0] * a + px * b, ty + vec[1] * a + py * b)
        head_len = 60 * S
        poly = [pt(0, 0), pt(head_len, head), pt(head_len, shaft / 2 + 6 * S), pt(L, shaft / 2 + 6 * S), pt(L, -shaft / 2 - 6 * S), pt(head_len, -shaft / 2 - 6 * S), pt(head_len, -head)]
        d.polygon(poly, fill=AMBER, outline=(0, 0, 0, 255))
        d.line(poly + [poly[0]], fill=(0, 0, 0, 255), width=3 * S)
    if o.get("ring"):
        x, y, r = o["ring"]
        cx, cy, r = x * W * S, y * H * S, r * W * S
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=AMBER, width=7 * S)
    text = o.get("text")
    if text:
        f = font(34 * S)
        tw = d.textlength(text, font=f)
        pad = 22 * S
        bw, bh = tw + 2 * pad, 34 * S + 2 * pad
        bx = (W * S - bw) / 2
        by = (o.get("cap_y", 0.07)) * H * S
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh / 2, fill=DARK, outline=AMBER, width=3 * S)
        d.text((bx + pad, by + pad - 4 * S), text, font=f, fill=(255, 255, 255, 255))
    im.resize((W, H), Image.LANCZOS).save(path)

def main():
    spec = json.load(open(sys.argv[1]))
    W, H = spec["w"], spec["h"]
    tmp = tempfile.mkdtemp(prefix="tutvid-")
    inputs = ["-i", spec["raw"]]
    parts, labels = [], []
    for i, (a, b, sp) in enumerate(spec["segments"]):
        parts.append(f"[0:v]fps=30,trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{sp},scale={W}:{H}:flags=lanczos[s{i}]")
        labels.append(f"[s{i}]")
    parts.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=0[base]")
    cur = "base"
    for j, o in enumerate(spec["overlays"]):
        p = os.path.join(tmp, f"o{j}.png")
        overlay_png(spec, o, p)
        inputs += ["-loop", "1", "-i", p]
        parts.append(f"[{cur}][{j + 1}:v]overlay=0:0:enable='between(t,{o['t0']},{o['t1']})':shortest=1[v{j}]")
        cur = f"v{j}"
    cmd = ["ffmpeg", "-y", "-v", "error"] + inputs + ["-filter_complex", ";".join(parts), "-map", f"[{cur}]",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(spec.get("crf", 30)), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "-t", str(spec.get("max", 15)), spec["out"]]
    subprocess.run(cmd, check=True)

main()
