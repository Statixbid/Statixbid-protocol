import sys, struct, glob, os, json
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

root = sys.argv[1]
out = {}
for folder in ("brand", "reference"):
    for p in sorted(glob.glob(os.path.join(root, folder, "*"))):
        b = open(p, "rb").read()
        info = {"bytes": len(b), "magic": b[:8].hex()}
        if b[:8] == b"\x89PNG\r\n\x1a\n":
            w, h, bd, ct = struct.unpack(">IIBB", b[16:26])
            info.update(format="PNG", IHDR={"w": w, "h": h, "bitdepth": bd, "colortype": ct})
        elif b[:3] == b"\xff\xd8\xff":
            info["format"] = "JPEG"
        im = Image.open(p)
        info["mode"] = im.mode
        rgba = np.array(im.convert("RGBA"))
        a = rgba[..., 3]
        hist = np.bincount(a.ravel(), minlength=256)
        info["alpha"] = {"min": int(a.min()), "max": int(a.max()),
                         "transparent": int(hist[0]), "opaque": int(hist[255]),
                         "partial": int(a.size - hist[0] - hist[255])}
        rgb = rgba[..., :3]
        tr = a == 0
        info["pure_black_in_transparent"] = int(((rgb.sum(-1) == 0) & tr).sum())
        flat = rgb.reshape(-1, 3)
        step = max(1, len(flat) // 60000)
        samp = flat[::step].astype(float)
        km = KMeans(n_clusters=6, n_init=4, random_state=1).fit(samp)
        counts = np.bincount(km.labels_, minlength=6)
        pal = []
        for i in np.argsort(-counts):
            c = km.cluster_centers_[i]
            d = ((rgb.astype(float) - c) ** 2).sum(-1)
            if (~tr).any(): d = np.where(tr, 1e18, d)
            y, x = np.unravel_index(np.argmin(d), d.shape)
            r, g, bb = (int(v) for v in rgb[y, x])
            pal.append({"share": round(counts[i] / counts.sum(), 4), "hex": "#%02x%02x%02x" % (r, g, bb), "at": [int(x), int(y)]})
        info["kmeans_snapped"] = pal
        out[os.path.relpath(p, root)] = {**info, "size": im.size}
print(json.dumps(out, indent=1))
