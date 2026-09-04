"""Tile candidate images into one numbered contact sheet, for triage.

Why this exists
---------------
`PLAYBOOK.md` §1.3 has the agent choose images from what `commons.mjs find`
listed. Opening three to five full-size candidates per nameplate in order to
reject most of them is how a photograph pass becomes the most expensive part of
a round: the sibling recipe site measured 321 k tokens for 70 subjects before it
worked this way.

One small sheet is a single read, and comparing candidates side by side is a
better comparison than looking at them one after another anyway.

This is TRIAGE ONLY. The tiles are deliberately too small to show a watermark,
a date stamp, or whether that is the facelift or the pre-facelift car, so the
finalist is still downloaded and inspected at full size before it is used.

Reads a JSON job on stdin, writes the sheet to the given path:

    {"out": "…/sheet.webp", "tiles": [{"label": "01", "bytes_b64": "…"}, …]}

Pillow, not `sharp`: this is authoring-time only, `scripts/data/` never runs in
the build or in CI, and a ~30 MB native npm dependency for a step CI never
executes is not worth it. Python is already an authoring dependency here
(`plan/_tools/`).
"""

import base64
import io
import json
import sys

from PIL import Image, ImageDraw

EDGE = 200
GAP = 8
COLS = 3
BACKGROUND = (28, 28, 26)


def _tile(raw, edge):
    """Square, centre-cropped, so a portrait and a landscape compare fairly."""
    image = Image.open(io.BytesIO(raw))
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side)).resize(
        (edge, edge), Image.LANCZOS
    )


def _number(tile, label):
    """A dark plate with the index, so a pick can be named without ambiguity."""
    draw = ImageDraw.Draw(tile, "RGBA")
    draw.rectangle([(0, 0), (34, 26)], fill=(0, 0, 0, 184))
    draw.text((8, 7), label, fill=(255, 255, 255))
    return tile


def main():
    job = json.load(sys.stdin)
    tiles = job["tiles"]
    if not tiles:
        raise SystemExit("no tiles to draw")

    cols = min(COLS, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    width = cols * EDGE + (cols + 1) * GAP
    height = rows * EDGE + (rows + 1) * GAP

    sheet = Image.new("RGB", (width, height), BACKGROUND)
    drawn = 0
    skipped = []
    for i, entry in enumerate(tiles):
        try:
            tile = _number(_tile(base64.b64decode(entry["bytes_b64"]), EDGE), entry["label"])
        except Exception as error:  # a candidate that will not decode is a result
            skipped.append(f'{entry["label"]}: {error}')
            continue
        sheet.paste(
            tile,
            (GAP + (i % cols) * (EDGE + GAP), GAP + (i // cols) * (EDGE + GAP)),
        )
        drawn += 1

    sheet.save(job["out"], "WEBP", quality=82, method=6)
    json.dump({"drawn": drawn, "skipped": skipped, "out": job["out"]}, sys.stdout)


if __name__ == "__main__":
    main()
