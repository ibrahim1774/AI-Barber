#!/usr/bin/env python3
"""Cuts a raw simulator recording into a short tutorial clip with animated pointers and captions.

Usage: make_tutorial_video.py spec.json
spec: {"raw": "in.mp4", "out": "out.mp4", "w": 576, "h": 1252,
       "segments": [[start, end, speed], ...],        # raw-time ranges (after fps=30 normalisation), played at `speed`
       "patches": [{"seg": 0, "src": [x0, y0, x1, y1], "from": [x, y]}],   # hide a region by copying clean pixels (fractions of the app frame)
       "overlays": [{"seg": 0, "a": 0.0, "b": 2.0,   # shown from a to b seconds into output segment `seg`
                     "text": "Tap the Store tab",     # caption, always in the caption band under the app
                     "arrow": [x, y, "up|down|left|right"],  # pointer aimed at the UI element centred at (x, y); "off": px centre->edge; bobs toward it
                     "ripple": true,                   # tap ripple on the target
                     "rect": [x0, y0, x1, y1], "label": "..",   # solid patch with text (hide the local test address)
                     "label_text": [x, y, "Prime Barber", size]}]}  # white label with shadow (replaces an app name)
Coordinates are fractions of the APP frame; the app is scaled to ~92% of the height and a 100 px caption band is added
below it so captions never cover UI. (`t0`/`t1` on the output timeline are still accepted instead of seg/a/b.)
Pillow-drawn overlays (the local ffmpeg has no drawtext), ffmpeg H.264 encode.
"""
import json, subprocess, sys, tempfile, os, math
from PIL import Image, ImageDraw, ImageFont

AMBER = (245, 158, 11, 255)
DARK = (20, 20, 20, 240)
BG = "0x0b0b0b"
BAND = 100          # caption band height (px at 576x1252)
NF, FPS = 9, 10     # animation loop: 9 frames at 10 fps

def font(size):
    for p in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def geom(spec):
    W, H = spec["w"], spec["h"]
    ah = H - BAND
    aw = round(W * ah / H)
    aw -= aw % 2
    return W, H, aw, ah, (W - aw) // 2

def draw_frame(spec, o, k, path):
    W, H, aw, ah, ax = geom(spec)
    S = 2
    im = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    mp = lambda x, y: ((ax + x * aw) * S, y * ah * S)
    ph = k / NF  # animation phase 0..1
    if o.get("rect"):
        x0, y0, x1, y1 = o["rect"]
        (a, b), (c, e) = mp(x0, y0), mp(x1, y1)
        d.rectangle([a, b, c, e], fill=tuple(o.get("color", [20, 20, 20])) + (255,))
        if o.get("label"):
            d.text((a + 8 * S, b + 3 * S), o["label"], font=font(22 * S), fill=AMBER)
    if o.get("label_text"):
        x, y, t, sz = o["label_text"]
        f = font(sz * S)
        cx, cy = mp(x, y)
        tw = d.textlength(t, font=f)
        d.text((cx - tw / 2 + 1 * S, cy - sz * S / 2 + 1 * S), t, font=f, fill=(0, 0, 0, 130))
        d.text((cx - tw / 2, cy - sz * S / 2), t, font=f, fill=(255, 255, 255, 255))
    if o.get("arrow"):
        x, y, direction = o["arrow"]
        tx, ty = mp(x, y)   # (x, y) is the CENTRE of the target element; "off" = px from the centre to the element's edge
        vec = {"up": (0, 1), "down": (0, -1), "left": (1, 0), "right": (-1, 0)}[direction]
        gap = (o.get("off", 0) + 14 + 14 * (0.5 - 0.5 * math.cos(2 * math.pi * ph))) * S   # bobs toward the target
        tx, ty = tx + vec[0] * gap, ty + vec[1] * gap
        L, shaft, head, head_len = 120 * S, 20 * S, 46 * S, 50 * S
        px, py = -vec[1], vec[0]
        pt = lambda a, b: (tx + vec[0] * a + px * b, ty + vec[1] * a + py * b)
        poly = [pt(0, 0), pt(head_len, head), pt(head_len, shaft / 2 + 4 * S), pt(L, shaft / 2 + 4 * S),
                pt(L, -shaft / 2 - 4 * S), pt(head_len, -shaft / 2 - 4 * S), pt(head_len, -head)]
        d.polygon(poly, fill=AMBER)
        d.line(poly + [poly[0]], fill=(0, 0, 0, 255), width=3 * S)
    if o.get("ripple") and o.get("arrow"):
        x, y, _ = o["arrow"]
        cx, cy = mp(x, y)
        r = (10 + 50 * ph) * S
        alpha = int(255 * (1 - ph))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(245, 158, 11, alpha), width=5 * S)
        d.ellipse([cx - 9 * S, cy - 9 * S, cx + 9 * S, cy + 9 * S], fill=(245, 158, 11, 200))
    text = o.get("text")
    if text:
        size = 34
        f = font(size * S)
        while d.textlength(text, font=f) > (W - 90) * S and size > 20:
            size -= 2
            f = font(size * S)
        tw = d.textlength(text, font=f)
        pad = 20 * S
        bh = size * S + 2 * 14 * S
        bw = tw + 2 * pad
        bx = (W * S - bw) / 2
        by = ((H - BAND) + (BAND - bh / S) / 2) * S
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh / 2, fill=DARK, outline=AMBER, width=3 * S)
        d.text((bx + pad, by + 14 * S - size * S * 0.12), text, font=f, fill=(255, 255, 255, 255))
    im.resize((W, H), Image.LANCZOS).save(path)

def main():
    spec = json.load(open(sys.argv[1]))
    W, H, aw, ah, ax = geom(spec)
    tmp = tempfile.mkdtemp(prefix="tutvid-")
    inputs = ["-i", spec["raw"]]
    parts, labels, starts, t = [], [], [], 0.0
    for i, (a, b, sp) in enumerate(spec["segments"]):
        parts.append(f"[0:v]fps=30,trim=start={a}:end={b},setpts=(PTS-STARTPTS)/{sp},scale={aw}:{ah}:flags=lanczos,"
                     f"pad={W}:{H}:{ax}:0:color={BG}[s{i}]")
        labels.append(f"[s{i}]")
        starts.append(t)
        t += (b - a) / sp
    parts.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=0[base]")
    cur = "base"
    n_in = 1
    for j, p in enumerate(spec.get("patches", [])):
        x0, y0, x1, y1 = p["src"]
        fx, fy = p["from"]
        if "seg" in p:
            t0 = starts[p["seg"]]
            e = p.get("seg_to", p["seg"]) + 1
            t1 = starts[e] if e < len(starts) else t
        else:
            t0, t1 = p.get("t0", 0), p.get("t1", 99)
        cw, chh = round((x1 - x0) * aw) // 2 * 2, round((y1 - y0) * ah) // 2 * 2   # even sizes (4:2:0)
        # feathered mask so the patch blends into the background instead of showing a box
        m = Image.new("L", (cw, chh), 0)
        md = ImageDraw.Draw(m)
        fe = min(10, chh // 3)
        for q in range(fe):
            v = int(255 * (q + 1) / fe)
            md.rectangle([q, q, cw - 1 - q, chh - 1 - q], fill=v)
        mp_ = os.path.join(tmp, f"mask{j}.png")
        m.save(mp_)
        inputs += ["-loop", "1", "-i", mp_]
        mi = n_in
        n_in += 1
        parts.append(f"[{cur}]split[pa{j}][pb{j}];[pb{j}]crop={cw}:{chh}:{round(ax + fx * aw) // 2 * 2}:{round(fy * ah) // 2 * 2},format=rgba[pc{j}];"
                     f"[{mi}:v]format=gray[mk{j}];[pc{j}][mk{j}]alphamerge[pe{j}];"
                     f"[pa{j}][pe{j}]overlay={round(ax + x0 * aw) // 2 * 2}:{round(y0 * ah) // 2 * 2}:enable='between(t,{t0:.3f},{t1:.3f})':shortest=1[pd{j}]")
        cur = f"pd{j}"
    for j, o in enumerate(spec["overlays"]):
        if "seg" in o:
            t0, t1 = starts[o["seg"]] + o["a"], starts[o["seg"]] + o["b"]
        else:
            t0, t1 = o["t0"], o["t1"]
        if o.get("arrow"):
            for k in range(NF):
                draw_frame(spec, o, k, os.path.join(tmp, f"o{j}_{k:02d}.png"))
            inputs += ["-stream_loop", "-1", "-framerate", str(FPS), "-i", os.path.join(tmp, f"o{j}_%02d.png")]
        else:
            p = os.path.join(tmp, f"o{j}.png")
            draw_frame(spec, o, 0, p)
            inputs += ["-loop", "1", "-i", p]
        parts.append(f"[{cur}][{n_in}:v]overlay=0:0:enable='between(t,{t0:.3f},{t1:.3f})':shortest=1[v{j}]")
        cur = f"v{j}"
        n_in += 1
    cmd = ["ffmpeg", "-y", "-v", "error"] + inputs + ["-filter_complex", ";".join(parts), "-map", f"[{cur}]",
           "-c:v", "libx264", "-preset", "slow", "-crf", str(spec.get("crf", 30)), "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", "-an", "-t", f"{min(t, spec.get('max', 15)):.3f}", spec["out"]]
    subprocess.run(cmd, check=True)
    print(spec["out"], f"{t:.1f}s")

main()
