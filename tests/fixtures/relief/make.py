"""Height-map test pictures for tests/cam-relief.test.ts, written with Pillow and ImageMagick
(independent of our readers). Run from this folder: python3 make.py. Each file holds a pattern
the test recomputes: g8 = (7x + 13y) mod 256, g16 = (1031x + 2053y) mod 65536, f = 2.5 + 0.1x - 0.05y."""
import subprocess
import numpy as np
from PIL import Image

W, H = 40, 30
y, x = np.mgrid[0:H, 0:W]
g8 = ((7 * x + 13 * y) % 256).astype(np.uint8)
g16 = ((1031 * x + 2053 * y) % 65536).astype(np.uint16)
f32 = (2.5 + 0.1 * x - 0.05 * y).astype(np.float32)

Image.fromarray(g8, 'L').save('gray8.png')
Image.fromarray(g16.astype(np.uint16)).save('gray16.png')  # mode I;16
rgb = np.dstack([g8, (g8.astype(int) * 3 % 256).astype(np.uint8), (g8.astype(int) * 5 % 256).astype(np.uint8)])
Image.fromarray(rgb, 'RGB').save('rgb.png')
alpha = np.where((x < 5) & (y < 5), 0, 255).astype(np.uint8)
Image.fromarray(np.dstack([g8, alpha]), 'LA').save('gray-alpha.png')
pal = Image.fromarray(g8, 'L').convert('P', palette=Image.Palette.ADAPTIVE, colors=256)
pal.save('palette.png')
Image.fromarray(g8, 'L').save('gray8-lzw.tif', compression='tiff_lzw')
Image.fromarray(g16.astype(np.uint16)).save('gray16-lzw.tif', compression='tiff_lzw')
Image.fromarray(g16.astype(np.uint16)).save('gray16-deflate.tif', compression='tiff_adobe_deflate')
Image.fromarray(g8, 'L').save('gray8-packbits.tif', compression='packbits')
Image.fromarray(g8, 'L').save('gray8.tif')
Image.fromarray(f32, 'F').save('float32.tif')
Image.fromarray(rgb, 'RGB').save('rgb-lzw.tif', compression='tiff_lzw')
# ImageMagick: interlaced PNG, tiled TIFF, big-endian TIFF with a predictor
subprocess.run(['convert', 'gray8.png', '-interlace', 'PNG', '-define', 'png:color-type=0', '-define', 'png:bit-depth=8', 'gray8-interlaced.png'], check=True)
subprocess.run(['convert', 'gray16.png', '-define', 'tiff:tile-geometry=16x16', '-compress', 'Zip', 'gray16-tiled.tif'], check=True)
subprocess.run(['convert', 'gray16.png', '-endian', 'MSB', '-compress', 'LZW', '-define', 'tiff:predictor=2', 'gray16-msb-pred.tif'], check=True)
