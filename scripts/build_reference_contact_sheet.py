from pathlib import Path
import sys
from PIL import Image, ImageDraw


source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".qa/reference-video")
files = sorted(source.glob("frame-*.png"))
columns = int(sys.argv[2]) if len(sys.argv) > 2 else 8
rows = (len(files) + columns - 1) // columns
cell_width = 220
cell_height = 514
sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "#121817")
draw = ImageDraw.Draw(sheet)

for index, path in enumerate(files):
    image = Image.open(path).convert("RGB")
    image.thumbnail((cell_width, 480), Image.Resampling.LANCZOS)
    x = (index % columns) * cell_width
    y = (index // columns) * cell_height
    sheet.paste(image, (x + (cell_width - image.width) // 2, y))
    draw.text((x + 7, y + 487), path.stem, fill="#f7f1e5")

sheet.save(source / "contact-sheet.png", optimize=True)
