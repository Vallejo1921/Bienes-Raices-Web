#!/usr/bin/env python3
"""Genera los assets web de ADAHRA desde el logo oficial.

Uso:
    python3 scripts/generate-assets.py

El JPEG original nunca se modifica. Los recortes conservan el fondo negro
del arte metálico: la web lo presenta sobre paneles negros deliberados para
que no aparezca un rectángulo accidental.

Requiere Pillow (sólo en tiempo de generación; no es dependencia runtime).
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "WhatsApp Image 2026-10-28 at 5.25.50 PM.jpeg"
ASSETS = ROOT / "assets"

# Recortes medidos sobre el original 1254x1254 (coordenadas inclusivas).
FULL_CROP = (104, 123, 1159, 1140)   # skyline + ADAHRA + BIENES RAÍCES
MARK_CROP = (313, 120, 903, 666)     # monograma A/A con skyline
FAVICON_CROP = (335, 120, 881, 666)  # cuadrado centrado en el monograma

FULL_MAX = 800
MARK_MAX = 320
FAVICON_SIZE = 64

TARGETS = {
    "adahra-logo-full.webp": 150 * 1024,
    "adahra-mark.webp": 60 * 1024,
    "favicon.png": 12 * 1024,
}


def fail(message: str) -> None:
    print(f"generate-assets: {message}", file=sys.stderr)
    raise SystemExit(1)


def fit(image: Image.Image, longest: int) -> Image.Image:
    width, height = image.size
    scale = min(1.0, longest / max(width, height))
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def main() -> None:
    if not SOURCE.is_file():
        fail(f"no existe el logo original: {SOURCE.name}")

    original = Image.open(SOURCE).convert("RGB")
    if original.size != (1254, 1254):
        fail(f"el logo cambió de tamaño ({original.size}); revisa los recortes antes de regenerar")

    ASSETS.mkdir(parents=True, exist_ok=True)

    full = fit(original.crop(FULL_CROP), FULL_MAX)
    full.save(ASSETS / "adahra-logo-full.webp", "WEBP", quality=88, method=6)

    mark = fit(original.crop(MARK_CROP), MARK_MAX)
    mark.save(ASSETS / "adahra-mark.webp", "WEBP", quality=90, method=6)

    favicon = original.crop(FAVICON_CROP).resize(
        (FAVICON_SIZE, FAVICON_SIZE), Image.Resampling.LANCZOS
    )
    favicon.save(ASSETS / "favicon.png", "PNG", optimize=True)

    for name, limit in TARGETS.items():
        path = ASSETS / name
        if not path.is_file():
            fail(f"no se generó {name}")
        size = path.stat().st_size
        if size > limit:
            fail(f"{name} pesa {size} B y supera el objetivo de {limit} B")
        print(f"generate-assets: {name} · {size} B")


if __name__ == "__main__":
    main()
