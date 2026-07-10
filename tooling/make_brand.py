"""Generate simple, thematic Pachisi brand icons: a gold cruciform (the board itself) on a dark
rounded tile. No font dependencies. Run: python tooling/make_brand.py"""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "assets" / "brand"
OUT.mkdir(parents=True, exist_ok=True)

BG = (18, 10, 6)
CLOTH = (58, 36, 19)
GOLD = (232, 182, 74)
CHARKONI = (240, 200, 98)
ARMS = [(229, 72, 77), (70, 199, 106), (232, 194, 74), (139, 123, 240)]  # S, E, N, W


def rr(d, box, r, **kw):
    d.rounded_rectangle(box, radius=r, **kw)


def render(size):
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(S * 0.06)
    rr(d, [pad, pad, S - pad, S - pad], int(S * 0.16), fill=BG, outline=GOLD, width=max(2, S // 90))

    # cruciform: 3-wide arms over a 5x5 conceptual grid centred in the tile
    inner = S - 2 * pad
    g = inner / 5.0
    ox = oy = pad
    def cellbox(r, c, m=0.0):
        x0 = ox + (c + m) * g; y0 = oy + (r + m) * g
        x1 = ox + (c + 1 - m) * g; y1 = oy + (r + 1 - m) * g
        return [x0, y0, x1, y1]

    # the plus: vertical bar (cols 2) rows 0..4, horizontal bar (rows 2) cols 0..4
    rad = int(g * 0.18)
    rr(d, [ox + 2 * g, oy, ox + 3 * g, oy + 5 * g], rad, fill=CLOTH)
    rr(d, [ox, oy + 2 * g, ox + 5 * g, oy + 3 * g], rad, fill=CLOTH)

    # arm home-lane tints (the middle strip of each arm) in the four seat colours
    lw = g * 0.34
    cx = ox + 2.5 * g
    cy = oy + 2.5 * g
    # South (down), North (up)
    d.rectangle([cx - lw / 2, cy, cx + lw / 2, oy + 5 * g], fill=ARMS[0])
    d.rectangle([cx - lw / 2, oy, cx + lw / 2, cy], fill=ARMS[2])
    # East (right), West (left)
    d.rectangle([cx, cy - lw / 2, ox + 5 * g, cy + lw / 2], fill=ARMS[1])
    d.rectangle([ox, cy - lw / 2, cx, cy + lw / 2], fill=ARMS[3])

    # grid lines on the cross for a woven look
    line = max(1, S // 200)
    for i in range(6):
        d.line([ox + 2 * g, oy + i * g, ox + 3 * g, oy + i * g], fill=(201, 151, 58, 90), width=line)
        d.line([ox + i * g, oy + 2 * g, ox + i * g, oy + 3 * g], fill=(201, 151, 58, 90), width=line)
    d.line([ox + 2 * g, oy, ox + 2 * g, oy + 5 * g], fill=(201, 151, 58, 120), width=line)
    d.line([ox + 3 * g, oy, ox + 3 * g, oy + 5 * g], fill=(201, 151, 58, 120), width=line)
    d.line([ox, oy + 2 * g, ox + 5 * g, oy + 2 * g], fill=(201, 151, 58, 120), width=line)
    d.line([ox, oy + 3 * g, ox + 5 * g, oy + 3 * g], fill=(201, 151, 58, 120), width=line)

    # Charkoni centre
    rr(d, cellbox(2, 2, 0.16), int(g * 0.12), fill=CHARKONI)
    # four castle pips at the arm tips
    tip = g * 0.28
    for (r, c) in [(0.5, 2.5), (2.5, 0.5), (2.5, 4.5), (4.5, 2.5)]:
        x = ox + c * g; y = oy + r * g
        d.ellipse([x - tip / 2, y - tip / 2, x + tip / 2, y + tip / 2], fill=GOLD)

    return img.resize((size, size), Image.LANCZOS)


targets = {"icon-512.png": 512, "icon-192.png": 192, "apple-touch-icon.png": 180, "favicon.png": 48}
for name, size in targets.items():
    render(size).save(OUT / name)
    print("wrote", name, size)
