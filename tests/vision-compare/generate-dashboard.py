"""Generate a realistic Meraki license dashboard screenshot for vision API testing."""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 700, 680
img = Image.new('RGB', (W, H), '#FFFFFF')
draw = ImageDraw.Draw(img)

# Try to get a clean font
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
    font_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    font_header = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
except:
    font = ImageFont.load_default()
    font_bold = font
    font_sm = font
    font_header = font

# Colors
GRAY_BG = '#F7F7F7'
GRAY_BORDER = '#E0E0E0'
GRAY_TEXT = '#666666'
BLACK = '#333333'
GREEN = '#4CAF50'
WHITE = '#FFFFFF'

y = 20

# Header section - License info
info_rows = [
    ("License status", None, "Ok"),
    ("License model", None, "Co-termination"),
    ("License expiration", None, "May 18, 2026 (40 days from now)"),
    ("MX Product Edition", None, "Advanced Security"),
    ("MR Product Edition", None, "Enterprise"),
]

for label, _, value in info_rows:
    draw.text((30, y), label, fill=GRAY_TEXT, font=font)
    if value == "Ok":
        # Green badge
        draw.rounded_rectangle([240, y-2, 272, y+18], radius=3, fill=GREEN)
        draw.text((247, y), "Ok", fill=WHITE, font=font_bold)
    else:
        draw.text((240, y), value, fill=BLACK, font=font)
    y += 28

y += 15

# Table header
table_top = y
draw.rectangle([30, y, W-30, y+35], fill='#FAFAFA')
draw.line([(30, y+35), (W-30, y+35)], fill=GRAY_BORDER, width=1)
draw.text((50, y+8), "License limit", fill=GRAY_TEXT, font=font_header)
draw.text((350, y+8), "License limit", fill=GRAY_TEXT, font=font_header)
draw.text((510, y+8), "Current device count", fill=GRAY_TEXT, font=font_header)
y += 36

# License rows
licenses = [
    ("MG51/MG51E", "1", "1"),
    ("MR Enterprise", "2", "2"),
    ("MS220-8P", "2", "2"),
    ("MT", "5 free", "0"),
    ("MX60", "1", "1"),
    ("MX60W", "1", "1"),
    ("MX64W", "1", "1"),
    ("MX65", "1", "1"),
    ("MX65W", "1", "1"),
    ("MX75", "1", "1"),
    ("Z1", "1", "1"),
    ("Z4", "1", "1"),
]

for i, (name, limit, count) in enumerate(licenses):
    row_bg = '#FFFFFF' if i % 2 == 0 else '#FAFAFA'
    draw.rectangle([30, y, W-30, y+32], fill=row_bg)
    draw.line([(30, y+32), (W-30, y+32)], fill=GRAY_BORDER, width=1)
    draw.text((50, y+8), name, fill=BLACK, font=font)
    draw.text((390, y+8), limit, fill=BLACK, font=font)
    draw.text((570, y+8), count, fill=BLACK, font=font)
    y += 33

# Border around table
draw.rectangle([30, table_top, W-30, y], outline=GRAY_BORDER, width=1)

out_path = os.path.join(os.path.dirname(__file__), 'test-dashboard.png')
img.save(out_path, 'PNG')
print(f"Saved: {out_path} ({os.path.getsize(out_path)} bytes)")
