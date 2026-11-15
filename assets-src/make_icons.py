"""Iconos de la extensión y del dashboard a partir de la marca de ResellPilot (etiqueta + ala de avión).

Uso: python assets-src/make_icons.py
Dibuja la misma forma que `apps/dashboard/src/components/Logo.tsx` (viewBox 32x32) a 16x su tamaño y la
reduce con antialias. Escribe apps/extension/public/icons/icon-{16,32,48,128}.png.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "extension" / "public" / "icons"
SCALE = 16
GREEN = (31, 92, 70, 255)
PINK = (229, 86, 111, 255)
PAPER = (244, 239, 230, 255)


def p(x: float, y: float) -> tuple[float, float]:
    return (x * SCALE, y * SCALE)


def draw_mark(size: int = 32) -> Image.Image:
    big = Image.new("RGBA", (size * SCALE, size * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    # Fondo redondeado de papel, para que el icono se lea en barras claras y oscuras.
    draw.rounded_rectangle([p(0, 0), p(32, 32)], radius=8 * SCALE, fill=PAPER)
    # Etiqueta (casa invertida con esquinas suaves).
    tag = [p(6, 11.2), p(15.1, 3.6), p(16.9, 3.6), p(26, 11.2), p(26, 27), p(24, 29), p(8, 29), p(6, 27)]
    draw.polygon(tag, fill=GREEN)
    # Agujero de la etiqueta.
    cx, cy, r = 16, 10.4, 2.1
    draw.ellipse([p(cx - r, cy - r), p(cx + r, cy + r)], fill=PAPER)
    # Ala de avión de papel.
    draw.polygon([p(10.2, 20.6), p(22.4, 15), p(17.5, 26.3), p(15.6, 21.8)], fill=PINK)
    draw.line([p(15.6, 21.8), p(22.4, 15)], fill=PAPER, width=int(1.1 * SCALE))
    return big


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    mark = draw_mark()
    for size in (16, 32, 48, 128):
        mark.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
        print(f"icon-{size}.png")
    # Ilustración del panel lateral (la misma que usa el dashboard).
    art = ROOT / "apps" / "dashboard" / "public" / "illustrations" / "extension.png"
    if art.exists():
        shutil.copyfile(art, OUT.parent / "panel.png")
        print("panel.png")


if __name__ == "__main__":
    main()
