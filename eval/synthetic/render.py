"""Renders eval/synthetic/html/*.html to PNG (clean) and a phone-photo style JPEG.

Needs Python with playwright, pillow and numpy. Only run when the synthetic set changes;
the images are committed so CI does not need a browser.
"""
import glob, os, random
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(HERE, 'images', 'clean'), exist_ok=True)
os.makedirs(os.path.join(HERE, 'images', 'photo'), exist_ok=True)
files = sorted(glob.glob(os.path.join(HERE, 'html', '*.html')))
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 600, 'height': 800}, device_scale_factor=1.25)
    for f in files:
        rid = os.path.basename(f)[:-5]
        pg.goto('file://' + f)
        pg.locator('#r').screenshot(path=os.path.join(HERE, 'images', 'clean', rid + '.png'))
    b.close()

for f in sorted(glob.glob(os.path.join(HERE, 'images', 'clean', '*.png'))):
    rid = os.path.basename(f)[:-4]
    rnd = random.Random(rid)
    im = Image.open(f).convert('RGB')
    w, h = im.size
    arr = np.asarray(im).astype(np.float32) * (np.array([248, 244, 234], dtype=np.float32) / 255.0)
    im = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    pad = 60
    bg = Image.new('RGB', (w + 2 * pad, h + 2 * pad), (70, 74, 80))
    bg.paste(im, (pad, pad))
    bg = bg.rotate(rnd.uniform(-2, 2), resample=Image.BICUBIC, fillcolor=(70, 74, 80))
    a = np.asarray(bg).astype(np.float32)
    H, W = a.shape[:2]
    yy = np.linspace(0, 1, H)[:, None]
    xx = np.linspace(0, 1, W)[None, :]
    light = 0.86 + 0.16 * np.exp(-((xx - 0.5) ** 2 + (yy - rnd.uniform(.2, .6)) ** 2) / 0.35)
    a = a * light[..., None] + np.random.default_rng(rnd.randrange(2 ** 32)).normal(0, 6, a.shape)
    out = Image.fromarray(a.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    ImageEnhance.Contrast(out).enhance(0.9).save(os.path.join(HERE, 'images', 'photo', rid + '.jpg'), quality=72)
print('rendered', len(files))
