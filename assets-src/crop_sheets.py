"""Recorta las hojas de ilustraciones de Google Flow (4 x 2) en piezas sueltas para el dashboard.

Uso: python assets-src/crop_sheets.py
Lee assets-src/flow/sheet*.jpg y escribe apps/dashboard/public/illustrations/<nombre>.png.

Cada pieza se busca por contenido (no por rejilla fija): se detectan los píxeles de tinta (lo que se
aleja del color del papel), se separan por columnas y filas vacías y se recorta con margen. El fondo
crema se vuelve transparente para que las piezas sirvan en tema claro y oscuro.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-src" / "flow"
OUT = ROOT / "apps" / "dashboard" / "public" / "illustrations"

NAMES = {
    "sheet1.jpg": ["dinero", "anuncios", "notificaciones", "oportunidades", "tendencias", "inventario", "ajustes", "logo"],
    "sheet2.jpg": ["vacio-anuncios", "vacio-notificaciones", "vacio-oportunidades", "extension", "informe", "resumen-diario", "texto-anuncio", "bajada-precio"],
}

SIZE = 320  # lado del cuadrado de salida, en px
INK_THRESHOLD = 38  # distancia mínima al color del papel para contar como tinta


def paper_color(image: Image.Image) -> tuple[int, int, int]:
    """Color del papel: la mediana de los bordes de la hoja."""
    width, height = image.size
    samples = [image.getpixel((x, y)) for x in range(0, width, 8) for y in (2, height - 3)]
    samples += [image.getpixel((x, y)) for y in range(0, height, 8) for x in (2, width - 3)]
    return tuple(sorted(channel)[len(channel) // 2] for channel in zip(*samples))  # type: ignore[return-value]


def ink_mask(image: Image.Image, paper: tuple[int, int, int]) -> Image.Image:
    """Máscara L: 255 donde hay tinta. Se suaviza para que el grano del riso no parta las piezas."""
    mask = Image.new("L", image.size)
    src = image.load()
    dst = mask.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b = src[x, y]
            distance = abs(r - paper[0]) + abs(g - paper[1]) + abs(b - paper[2])
            dst[x, y] = 255 if distance > INK_THRESHOLD else 0
    return mask.filter(ImageFilter.MaxFilter(9))


def spans(profile: list[int], count: int, min_gap: int) -> list[tuple[int, int]]:
    """Tramos con tinta a lo largo de un eje; se queda con los `count` más grandes."""
    runs: list[tuple[int, int]] = []
    start = None
    gap = 0
    for index, value in enumerate(profile):
        if value > 0:
            if start is None:
                start = index
            gap = 0
            end = index
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                runs.append((start, end))
                start = None
    if start is not None:
        runs.append((start, end))
    runs.sort(key=lambda run: run[1] - run[0], reverse=True)
    return sorted(runs[:count])


def transparent(tile: Image.Image, paper: tuple[int, int, int]) -> Image.Image:
    """Papel → transparente, con borde suave según la distancia al color del papel."""
    rgba = tile.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            distance = abs(r - paper[0]) + abs(g - paper[1]) + abs(b - paper[2])
            alpha = max(0, min(255, int((distance - 18) * 255 / 60)))
            pixels[x, y] = (r, g, b, alpha)
    return rgba


def crop_sheet(path: Path, names: list[str]) -> None:
    image = Image.open(path).convert("RGB")
    paper = paper_color(image)
    mask = ink_mask(image, paper)
    width, height = image.size
    pixels = mask.load()

    rows = spans([sum(1 for x in range(width) if pixels[x, y]) for y in range(height)], 2, 12)
    for row_index, (top, bottom) in enumerate(rows):
        columns = spans([sum(1 for y in range(top, bottom + 1) if pixels[x, y]) for x in range(width)], 4, 12)
        for column_index, (left, right) in enumerate(columns):
            name = names[row_index * 4 + column_index]
            side = max(right - left, bottom - top) + 24
            cx, cy = (left + right) // 2, (top + bottom) // 2
            box = (cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2)
            tile = Image.new("RGB", (side, side), paper)
            tile.paste(image.crop(box), (0, 0))
            out = transparent(tile, paper).resize((SIZE, SIZE), Image.LANCZOS)
            out.save(OUT / f"{name}.png", optimize=True)
            print(f"{path.name} -> {name}.png ({right - left}x{bottom - top})")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for file, names in NAMES.items():
        path = SRC / file
        if path.exists():
            crop_sheet(path, names)
        else:
            print(f"falta {path}")


if __name__ == "__main__":
    main()
