#!/usr/bin/env python3
import argparse
import os
import sys
import tempfile

from pypdf import PdfReader, PdfWriter, Transformation


def parse_box(value):
    parts = [float(p.strip()) for p in value.split(',')]
    if len(parts) != 4:
        raise ValueError('Box must be x,y,width,height')
    return parts


def place_pdf_page(base_pdf, art_pdf, output_pdf, box):
    x, y, box_w, box_h = box

    writer = PdfWriter(clone_from=base_pdf)
    base_page = writer.pages[0]

    art_reader = PdfReader(art_pdf)
    art_page = art_reader.pages[0]

    art_w = float(art_page.mediabox.width)
    art_h = float(art_page.mediabox.height)

    if art_w <= 0 or art_h <= 0:
        raise RuntimeError('Uploaded artwork PDF has an invalid page size.')

    scale = min(box_w / art_w, box_h / art_h)
    placed_w = art_w * scale
    placed_h = art_h * scale
    tx = x + ((box_w - placed_w) / 2)
    ty = y + ((box_h - placed_h) / 2)

    transform = Transformation().scale(scale, scale).translate(tx, ty)
    base_page.merge_transformed_page(art_page, transform, over=True)

    # Preserve form field appearances/editability as much as possible.
    try:
        writer.set_need_appearances_writer(True)
    except Exception:
        pass

    with open(output_pdf, 'wb') as f:
        writer.write(f)


def place_image(base_pdf, image_path, output_pdf, box):
    from PIL import Image
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import ImageReader

    x, y, box_w, box_h = box

    reader = PdfReader(base_pdf)
    page = reader.pages[0]
    page_w = float(page.mediabox.width)
    page_h = float(page.mediabox.height)

    with Image.open(image_path) as img:
        img_w, img_h = img.size

    if img_w <= 0 or img_h <= 0:
        raise RuntimeError('Uploaded artwork image has an invalid size.')

    scale = min(box_w / img_w, box_h / img_h)
    placed_w = img_w * scale
    placed_h = img_h * scale
    tx = x + ((box_w - placed_w) / 2)
    ty = y + ((box_h - placed_h) / 2)

    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
        overlay_pdf = tmp.name

    try:
        c = canvas.Canvas(overlay_pdf, pagesize=(page_w, page_h))
        c.drawImage(ImageReader(image_path), tx, ty, width=placed_w, height=placed_h, preserveAspectRatio=True, mask='auto')
        c.save()

        writer = PdfWriter(clone_from=base_pdf)
        overlay_reader = PdfReader(overlay_pdf)
        writer.pages[0].merge_page(overlay_reader.pages[0], over=True)

        try:
            writer.set_need_appearances_writer(True)
        except Exception:
            pass

        with open(output_pdf, 'wb') as f:
            writer.write(f)
    finally:
        if os.path.exists(overlay_pdf):
            os.unlink(overlay_pdf)


def main():
    parser = argparse.ArgumentParser(description='Place uploaded approval artwork into the blank artwork area of a filled approval PDF.')
    parser.add_argument('--base', required=True, help='Filled approval PDF input path')
    parser.add_argument('--art', required=True, help='Uploaded artwork PDF/JPG/PNG path')
    parser.add_argument('--out', required=True, help='Final approval PDF output path')
    parser.add_argument('--box', default='26,150,740,385', help='Placement box in PDF points: x,y,width,height')
    args = parser.parse_args()

    box = parse_box(args.box)
    ext = os.path.splitext(args.art)[1].lower()

    if ext == '.pdf':
        place_pdf_page(args.base, args.art, args.out, box)
    elif ext in ('.jpg', '.jpeg', '.png'):
        place_image(args.base, args.art, args.out, box)
    else:
        raise RuntimeError('Unsupported artwork type. Use PDF, JPG, JPEG, or PNG.')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
