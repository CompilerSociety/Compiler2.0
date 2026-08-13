#!/usr/bin/env python3
"""Regenerate web/icons/ from the one source mark, web/assets/images/logo.png.

The committed icons had been produced by hand and every one of them was wrong
in a way that only shows up on a real phone:

  * icon-192 / icon-512   the mark sat off-centre with uneven margins, and the
                          canvas kept the source's transparent background, so
                          launchers that composite onto a dark surface showed a
                          floating green blob instead of the tile.
  * icon-maskable-512     was the square "any" icon pasted onto a green field,
                          which left visible white letterbox bars. Android
                          crops a maskable icon to its own shape, so those bars
                          landed right in the middle of the cut.
  * apple-touch-icon      was transparent; iOS composites that onto BLACK.
  * (missing)             there was no monochrome badge, so notifications
                          passed the full-colour 192 as `badge`. Android
                          reduces a badge to its alpha channel, so a fully
                          opaque square came out as a solid grey block in the
                          status bar.

Everything below is derived from the source instead: crop to the mark's real
bounding box, then centre it on an OPAQUE canvas at a size the platform's own
cropping cannot eat into.

    python scripts/make-icons.py

Needs Pillow. Re-run and commit web/icons/ whenever logo.png changes.
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "web" / "assets" / "images" / "logo.png"
OUT = ROOT / "web" / "icons"

WHITE = (255, 255, 255, 255)

# Fraction of the canvas HEIGHT the mark is scaled to occupy. The mark is
# portrait (roughly 4:5), so height is the binding dimension.
#
# 0.80 for the plain icons: enough margin that the rounded-square crop most
# launchers apply to a non-maskable icon cannot clip the badge's corners.
PLAIN_SCALE = 0.80
# The maskable safe zone is the centre CIRCLE covering 80% of the canvas. A
# w x h rect fits inside a circle only if its diagonal does, so the height that
# survives every mask shape falls out of the mark's own aspect ratio rather
# than a number picked by eye. Derived in maskable_scale() below.
MASKABLE_SAFE_DIAMETER = 0.80
# The badge is drawn at ~24dp. It needs every pixel it can get.
BADGE_SCALE = 0.92


def load_mark() -> Image.Image:
    """The source with its transparent surround trimmed away."""
    im = Image.open(SRC).convert("RGBA")
    box = im.getbbox()  # alpha-based; the source's surround is fully transparent
    if not box:
        raise SystemExit(f"{SRC} appears to be blank")
    return im.crop(box)


def maskable_scale(mark: Image.Image) -> float:
    """Largest height fraction whose bounding box still fits the safe circle."""
    aspect = mark.width / mark.height  # diagonal = height * sqrt(1 + aspect^2)
    return MASKABLE_SAFE_DIAMETER / ((1 + aspect * aspect) ** 0.5)


def fit(mark: Image.Image, canvas: int, scale: float) -> Image.Image:
    """Scale the mark so its height is `scale` of a `canvas`-square icon."""
    h = max(1, round(canvas * scale))
    w = max(1, round(mark.width * h / mark.height))
    return mark.resize((w, h), Image.LANCZOS)


def centre(layer: Image.Image, canvas: int, background) -> Image.Image:
    out = Image.new("RGBA", (canvas, canvas), background)
    out.alpha_composite(layer, ((canvas - layer.width) // 2, (canvas - layer.height) // 2))
    return out


def monochrome(mark: Image.Image) -> Image.Image:
    """White silhouette of the green body, with the "CS" knocked out of it.

    A notification badge is rendered as an alpha mask — colour is discarded —
    so it has to carry its shape in alpha alone. Green pixels become opaque
    white, the white letterforms become holes, and anti-aliased pixels in
    between land somewhere in the middle rather than on a hard edge.
    """
    px = mark.load()
    out = Image.new("RGBA", mark.size, (255, 255, 255, 0))
    dst = out.load()
    for y in range(mark.height):
        for x in range(mark.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            whiteness = min(r, g, b) / 255.0  # 0 for the green body, 1 for the letters
            dst[x, y] = (255, 255, 255, round(a * (1.0 - whiteness)))
    return out


def write(img: Image.Image, name: str, *, keep_alpha: bool) -> None:
    path = OUT / name
    # Flatten the "any"/apple icons to RGB. Leaving an alpha channel on a fully
    # opaque icon is what let iOS treat the corners as black, and it costs
    # bytes on files that are fetched on every install.
    img.convert("RGBA" if keep_alpha else "RGB").save(path, "PNG", optimize=True)
    print(f"  {name:<26} {img.width}x{img.height}")


def main() -> None:
    mark = load_mark()
    print(f"source mark {mark.width}x{mark.height} (from {SRC.name})")
    OUT.mkdir(parents=True, exist_ok=True)

    for size, name in ((192, "icon-192.png"), (512, "icon-512.png")):
        write(centre(fit(mark, size, PLAIN_SCALE), size, WHITE), name, keep_alpha=False)

    safe = maskable_scale(mark)
    print(f"maskable safe-zone height fraction: {safe:.3f}")
    write(centre(fit(mark, 512, safe), 512, WHITE), "icon-maskable-512.png", keep_alpha=False)
    write(centre(fit(mark, 180, PLAIN_SCALE), 180, WHITE), "apple-touch-icon.png", keep_alpha=False)

    badge = monochrome(mark)
    write(
        centre(fit(badge, 96, BADGE_SCALE), 96, (255, 255, 255, 0)),
        "icon-badge-96.png",
        keep_alpha=True,
    )


if __name__ == "__main__":
    main()
