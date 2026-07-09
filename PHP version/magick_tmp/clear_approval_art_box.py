import argparse
import sys

try:
    from pypdf import PdfReader, PdfWriter, PageObject
    from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject
except Exception as exc:
    sys.stderr.write('Could not import pypdf: %s\n' % exc)
    sys.exit(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--box', required=True)
    args = parser.parse_args()

    try:
        x, y, w, h = [float(part.strip()) for part in args.box.split(',')]
    except Exception:
        sys.stderr.write('Invalid art box. Expected x,y,width,height.\n')
        sys.exit(3)

    # Add a tiny bleed inside the approval art box so old artwork edges do not show.
    # This still stays inside the same artwork area used by Create Approval.
    bleed = 1.0
    x = x - bleed
    y = y - bleed
    w = w + (bleed * 2)
    h = h + (bleed * 2)

    reader = PdfReader(args.base)
    writer = PdfWriter()

    for index, page in enumerate(reader.pages):
        if index == 0:
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            overlay = PageObject.create_blank_page(width=page_width, height=page_height)
            stream = DecodedStreamObject()
            stream.set_data((
                'q\n'
                '1 1 1 rg\n'
                '1 1 1 RG\n'
                f'{x:.3f} {y:.3f} {w:.3f} {h:.3f} re\n'
                'f\n'
                'Q\n'
            ).encode('utf-8'))
            overlay[NameObject('/Contents')] = stream
            overlay[NameObject('/Resources')] = DictionaryObject()

            page.merge_page(overlay)

        writer.add_page(page)

    with open(args.out, 'wb') as handle:
        writer.write(handle)


if __name__ == '__main__':
    main()