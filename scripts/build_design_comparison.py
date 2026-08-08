from pathlib import Path
import sys

from PIL import Image, ImageDraw


source_path = Path(sys.argv[1])
implementation_path = Path(sys.argv[2])
output_path = Path(sys.argv[3])
source_label = sys.argv[4] if len(sys.argv) > 4 else "REFERENCE MECHANIC"
implementation_label = sys.argv[5] if len(sys.argv) > 5 else "PEG RUSH IMPLEMENTATION"

source = Image.open(source_path).convert("RGB")
implementation = Image.open(implementation_path).convert("RGB")
target_height = max(source.height, implementation.height)


def normalize(image: Image.Image) -> Image.Image:
    width = round(image.width * target_height / image.height)
    return image.resize((width, target_height), Image.Resampling.LANCZOS)


source = normalize(source)
implementation = normalize(implementation)
gutter = 28
label_height = 44
canvas = Image.new(
    "RGB",
    (source.width + implementation.width + gutter * 3, target_height + label_height + gutter * 2),
    "#162523",
)
draw = ImageDraw.Draw(canvas)
source_x = gutter
implementation_x = source_x + source.width + gutter
image_y = label_height + gutter
draw.text((source_x, 17), source_label, fill="#fffaf1")
draw.text((implementation_x, 17), implementation_label, fill="#fffaf1")
canvas.paste(source, (source_x, image_y))
canvas.paste(implementation, (implementation_x, image_y))
output_path.parent.mkdir(parents=True, exist_ok=True)
canvas.save(output_path, optimize=True)
