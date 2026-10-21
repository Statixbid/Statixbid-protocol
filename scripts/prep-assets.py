import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage

root = sys.argv[1]
out = os.path.join(root, "src", "assets")
os.makedirs(out, exist_ok=True)
report = json.load(open(os.path.join(root, "scripts", "asset-report.json")))

LOGO = os.path.join(root, "brand", "LOGO STATIX PNG...png")
im = Image.open(LOGO)
assert im.mode == "RGBA"
a = np.array(im)[..., 3]

# wordmark bbox from alpha
ys, xs = np.where(a > 8)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
pad = 24
box = (max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad))
crop = im.crop(box)

# transparent regions are pure black rgb: resize premultiplied (RGBa) so no dark fringe appears
def resize_premul(img, w):
    h = round(img.height * w / img.width)
    pm = img.convert("RGBa").resize((w, h), Image.LANCZOS)
    return pm.convert("RGBA")

resize_premul(crop, 640).save(os.path.join(out, "logo-640.png"), optimize=True)
resize_premul(crop, 1280).save(os.path.join(out, "logo-1280.png"), optimize=True)
print("wordmark bbox", box)

# favicon: trace the real alpha pixel grid of the first glyph (the "s")
mask = a > 128
core = ndimage.binary_erosion(mask, iterations=9)
lab, n = ndimage.label(core)
objs = ndimage.find_objects(lab)
order = sorted(range(n), key=lambda i: objs[i][1].start)
lid = order[0] + 1   # leftmost eroded component is the "s"
grown = ndimage.binary_dilation(lab == lid, iterations=10) & mask
yy, xx = np.where(grown)
gy0, gy1, gx0, gx1 = yy.min(), yy.max() + 1, xx.min(), xx.max() + 1
glyph_rgba = np.array(im.crop((gx0, gy0, gx1, gy1)))
glyph_rgba[..., 3] = np.where(grown[gy0:gy1, gx0:gx1], glyph_rgba[..., 3], 0)
glyph = glyph_rgba
gh, gw = glyph.shape[:2]
side = max(gh, gw)
G = 64   # sample grid, drawn at half-pixel units in a 32 viewBox
inner = 40  # glyph occupies 40 of 64 cells, centred
scale = inner / side
tw, th = max(1, round(gw * scale)), max(1, round(gh * scale))
small = Image.fromarray(glyph).convert("RGBa").resize((tw, th), Image.LANCZOS).convert("RGBA")
sa = np.array(small)[..., 3] > 110
grid = np.zeros((G, G), bool)
oy, ox = (G - th) // 2, (G - tw) // 2
grid[oy:oy + th, ox:ox + tw] = sa

# palette values come from the asset report (snapped pixels), never typed freehand
def pick(fname, idx):
    return report[fname]["kmeans_snapped"][idx]["hex"]
KEY = [k for k in report if k.endswith("PNG...png")][0]
WHITE = pick(KEY, 1)   # #fefdfe @ (728,886)
BLUE = pick(KEY, 4)    # #2430fa @ (1452,1066)

# merge horizontal runs, then vertical stacks of identical runs, into rects
runs = {}
for y in range(G):
    x = 0
    while x < G:
        if grid[y, x]:
            s = x
            while x < G and grid[y, x]: x += 1
            runs[(y, s, x)] = 1
        else:
            x += 1
rects, used = [], set()
for (y, s, e) in sorted(runs):
    if (y, s, e) in used: continue
    h = 1
    while (y + h, s, e) in runs:
        used.add((y + h, s, e)); h += 1
    rects.append((s, y, e - s, h))
f = lambda v: ("%g" % (v / 2))
d = "".join("M%s %sh%sv%sh-%sz" % (f(x), f(y), f(w), f(h), f(w)) for x, y, w, h in rects)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">'
       '<rect width="32" height="32" rx="7" fill="%s"/><path fill="%s" d="%s"/></svg>' % (BLUE, WHITE, d))
assert "--" not in svg
open(os.path.join(out, "favicon.svg"), "w").write(svg)
print("favicon rects", len(rects), "bytes", len(svg))

# apple touch icon from the same grid
S = 180
ic = Image.new("RGBA", (S, S), (0, 0, 0, 0))
from PIL import ImageDraw
dr = ImageDraw.Draw(ic)
hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
dr.rectangle((0, 0, S, S), fill=hexrgb(BLUE))
c = S / G
for x, y, w, h in rects:
    dr.rectangle((x * c, y * c, (x + w) * c - 1, (y + h) * c - 1), fill=hexrgb(WHITE))
ic.convert("RGB").save(os.path.join(out, "apple-touch-icon.png"))

# frames from the reference slides
for i in range(1, 6):
    s = Image.open(os.path.join(root, "reference", "STATIX %d.jpg.jpeg" % i)).convert("RGB")
    s.resize((1280, 720), Image.LANCZOS).save(os.path.join(out, "frame-%d.jpg" % i), quality=80, optimize=True, progressive=True)
# social card 1200x630 from slide 1
s = Image.open(os.path.join(root, "reference", "STATIX 1.jpg.jpeg")).convert("RGB")
w, h = s.size
ch = round(w * 630 / 1200)
top = (h - ch) // 2
s.crop((0, top, w, top + ch)).resize((1200, 630), Image.LANCZOS).save(os.path.join(out, "og.jpg"), quality=84, optimize=True)
json.dump({"white": WHITE, "blue": BLUE}, open(os.path.join(root, "scripts", "favicon-colors.json"), "w"))
