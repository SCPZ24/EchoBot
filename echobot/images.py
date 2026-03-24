from __future__ import annotations

import base64
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError


JPEG_CONTENT_TYPE = "image/jpeg"


@dataclass(slots=True)
class ImageBudget:
    max_input_bytes: int = 40 * 1024 * 1024
    max_output_bytes: int = 4 * 1024 * 1024
    max_side: int = 3072
    max_pixels: int = 24_000_000
    start_quality: int = 90
    min_quality: int = 55
    quality_step: int = 10
    resize_step: float = 0.85
    max_resize_attempts: int = 6


@dataclass(slots=True)
class NormalizedImage:
    image_bytes: bytes
    content_type: str
    width: int
    height: int
    quality: int


DEFAULT_IMAGE_BUDGET = ImageBudget()


def normalize_image_bytes(
    image_bytes: bytes,
    *,
    budget: ImageBudget | None = None,
) -> NormalizedImage:
    active_budget = budget or DEFAULT_IMAGE_BUDGET
    _validate_image_bytes(image_bytes, active_budget)

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            source_image = _read_source_image(image)
            normalized_image = ImageOps.exif_transpose(source_image)
            _validate_pixel_budget(normalized_image, active_budget)
            working_image = _resize_to_max_side(
                _convert_image_to_rgb(normalized_image),
                max_side=active_budget.max_side,
            )
            jpeg_bytes, width, height, quality = _compress_to_budget(
                working_image,
                budget=active_budget,
            )
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError) as exc:
        raise ValueError("Unsupported chat image format") from exc

    return NormalizedImage(
        image_bytes=jpeg_bytes,
        content_type=JPEG_CONTENT_TYPE,
        width=width,
        height=height,
        quality=quality,
    )


def image_bytes_to_jpeg_data_url(
    image_bytes: bytes,
    *,
    budget: ImageBudget | None = None,
) -> str:
    normalized = normalize_image_bytes(image_bytes, budget=budget)
    encoded_bytes = base64.b64encode(normalized.image_bytes).decode("ascii")
    return f"data:{normalized.content_type};base64,{encoded_bytes}"


def _validate_image_bytes(image_bytes: bytes, budget: ImageBudget) -> None:
    if not image_bytes:
        raise ValueError("Chat image must not be empty")
    if len(image_bytes) > budget.max_input_bytes:
        raise ValueError(
            "Chat image exceeds the upload size limit "
            f"({len(image_bytes)} bytes > {budget.max_input_bytes} bytes)"
        )


def _read_source_image(image: Image.Image) -> Image.Image:
    if getattr(image, "is_animated", False):
        image.seek(0)
        return image.copy()
    return image


def _validate_pixel_budget(image: Image.Image, budget: ImageBudget) -> None:
    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError("Chat image must have a valid size")
    if width * height > budget.max_pixels:
        raise ValueError(
            "Chat image exceeds the pixel budget "
            f"({width}x{height} > {budget.max_pixels} pixels)"
        )


def _resize_to_max_side(image: Image.Image, *, max_side: int) -> Image.Image:
    width, height = image.size
    longest_side = max(width, height)
    if longest_side <= max_side:
        return image

    scale = max_side / float(longest_side)
    return _resize_image(
        image,
        width=max(1, int(round(width * scale))),
        height=max(1, int(round(height * scale))),
    )


def _compress_to_budget(
    image: Image.Image,
    *,
    budget: ImageBudget,
) -> tuple[bytes, int, int, int]:
    working_image = image

    for _attempt in range(budget.max_resize_attempts + 1):
        for quality in _quality_steps(budget):
            jpeg_bytes = _encode_jpeg(working_image, quality)
            if len(jpeg_bytes) <= budget.max_output_bytes:
                width, height = working_image.size
                return jpeg_bytes, width, height, quality

        next_image = _scale_image(working_image, scale=budget.resize_step)
        if next_image.size == working_image.size:
            break
        working_image = next_image

    raise ValueError(
        "Chat image exceeds the compressed size limit "
        f"({budget.max_output_bytes} bytes)"
    )


def _quality_steps(budget: ImageBudget) -> list[int]:
    start = max(min(budget.start_quality, 100), budget.min_quality)
    values: list[int] = []
    quality = start
    while quality >= budget.min_quality:
        values.append(quality)
        quality -= budget.quality_step
    if values[-1] != budget.min_quality:
        values.append(budget.min_quality)
    return values


def _scale_image(image: Image.Image, *, scale: float) -> Image.Image:
    width, height = image.size
    next_width = max(1, int(round(width * scale)))
    next_height = max(1, int(round(height * scale)))
    return _resize_image(image, width=next_width, height=next_height)


def _resize_image(image: Image.Image, *, width: int, height: int) -> Image.Image:
    if (width, height) == image.size:
        return image
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _encode_jpeg(image: Image.Image, quality: int) -> bytes:
    output_buffer = BytesIO()
    image.save(
        output_buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
    )
    return output_buffer.getvalue()


def _convert_image_to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"}:
        return _flatten_alpha_image(image.convert("RGBA"))

    if image.mode == "P" and "transparency" in image.info:
        return _flatten_alpha_image(image.convert("RGBA"))

    return image.convert("RGB")


def _flatten_alpha_image(image: Image.Image) -> Image.Image:
    background = Image.new("RGB", image.size, (255, 255, 255))
    background.paste(image, mask=image.getchannel("A"))
    return background
