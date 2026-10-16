"""Plain test pattern frames: a black ground, a large timecode and small ticks. No words, objects or brand.
Usage: fixture-art.py OUTPUT_DIR REVISION PORTRAIT  ->  OUTPUT_DIR/f00.png ... f11.png (one frame per second)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out, revision, portrait = Path(sys.argv[1]), sys.argv[2] == 'true', sys.argv[3] == 'true'
out.mkdir(parents=True, exist_ok=True)
w, h = (720, 1280) if portrait else (1280, 720)
font_paths = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
font_path = next((p for p in font_paths if Path(p).exists()), None)
def font(size):
    return ImageFont.truetype(font_path, size) if font_path else ImageFont.load_default(size=size)

DIGITS = '#3cc4d4' if revision else '#ffffff'  # the revised version differs only by the digit color
SECONDS = 12
size = int(min(w, h) * (.26 if portrait else .3))
f = font(size)
margin = int(w * .1)
for second in range(SECONDS):
    im = Image.new('RGB', (w, h), '#000000')
    d = ImageDraw.Draw(im)
    label = f'0:{second:02d}'
    box = d.textbbox((0, 0), label, font=f)
    d.text(((w - (box[2] - box[0])) / 2 - box[0], h * .42 - (box[3] - box[1]) / 2 - box[1]), label, font=f, fill=DIGITS)
    # Small ticks: one per second, a longer one every five seconds, the current second brighter.
    y = int(h * .66)
    span = w - margin * 2
    for i in range(SECONDS + 1):
        x = margin + span * i / SECONDS
        tall = 18 if i % 5 == 0 else 10
        d.line((x, y, x, y + tall), fill='#ffffff' if i == second else '#5b6366', width=2 if i == second else 1)
    im.save(out / f'f{second:02d}.png')
