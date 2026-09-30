"""Student evidence screenshots for review cases (upload, validate, store, serve).

Safety model (uploads are untrusted bytes from students):
  * Accept only PNG / JPEG / WebP, decided by decoding with Pillow, never by the
    filename or the client-sent Content-Type.
  * Re-encode every image through Pillow before saving, which drops all metadata
    (EXIF, GPS location from phone photos, embedded profiles, trailing data).
  * Store under EVIDENCE_IMAGE_DIR, outside the release tree, with an opaque
    uuid filename so a student can't choose a path or overwrite anything.
  * Enforce per-file size, per-review count, and max pixel dimensions. The pixel
    limits are checked from the header, before any pixel data is decoded, so a
    tiny decompression-bomb file never gets expanded in memory.
"""
from __future__ import annotations

import io
import os
import uuid
from dataclasses import dataclass
from typing import Optional

MAX_BYTES = int(os.getenv("EVIDENCE_IMAGE_MAX_BYTES", str(5 * 1024 * 1024)))  # 5 MiB
MAX_PER_REVIEW = int(os.getenv("EVIDENCE_IMAGE_MAX_PER_REVIEW", "5"))
MAX_DIMENSION = int(os.getenv("EVIDENCE_IMAGE_MAX_DIMENSION", "4000"))  # px, each side
MAX_PIXELS = int(os.getenv("EVIDENCE_IMAGE_MAX_PIXELS", str(4000 * 4000)))  # total, whatever the sides
DEFAULT_DIR = "/home/llms_admin/cyberrange-data/review_images"

# Pillow format -> (our content type, on-disk extension). The set here is the
# whole allowlist; anything Pillow decodes as another format is rejected.
_ALLOWED = {
    "PNG": ("image/png", "png"),
    "JPEG": ("image/jpeg", "jpg"),
    "WEBP": ("image/webp", "webp"),
}


class ImageRejected(Exception):
    """Upload failed validation. Message is safe to show the student."""


@dataclass
class SavedImage:
    stored_name: str
    content_type: str
    byte_size: int
    width: int
    height: int


def image_dir() -> str:
    d = os.getenv("EVIDENCE_IMAGE_DIR", DEFAULT_DIR)
    os.makedirs(d, mode=0o750, exist_ok=True)
    return d


def path_for(stored_name: str) -> str:
    """Absolute path for a stored file, guarding against path traversal."""
    d = image_dir()
    p = os.path.normpath(os.path.join(d, stored_name))
    if os.path.dirname(p) != os.path.normpath(d):
        raise ImageRejected("invalid image name")
    return p


def validate_and_store(raw: bytes) -> SavedImage:
    """Validate raw upload bytes and write a re-encoded copy. Raises ImageRejected."""
    if not raw:
        raise ImageRejected("empty file")
    if len(raw) > MAX_BYTES:
        raise ImageRejected(f"image is larger than {MAX_BYTES // (1024 * 1024)} MB")

    # Import here so a missing Pillow doesn't break module import at API startup;
    # the route surfaces it as a clear 503 instead.
    from PIL import Image, UnidentifiedImageError

    try:
        probe = Image.open(io.BytesIO(raw))  # parses the header only
        fmt = probe.format
        # Reject on size before verify()/load() touch any pixel data.
        if probe.width > MAX_DIMENSION or probe.height > MAX_DIMENSION:
            raise ImageRejected(f"image is larger than {MAX_DIMENSION}px on a side")
        if probe.width * probe.height > MAX_PIXELS:
            raise ImageRejected("image has too many pixels")
        probe.verify()  # detects truncated / malformed data
    except Image.DecompressionBombError:
        # Pillow's own hard limit, raised by open() itself; it isn't an OSError.
        raise ImageRejected("image has too many pixels")
    except (UnidentifiedImageError, OSError, ValueError):
        raise ImageRejected("file is not a valid PNG, JPEG, or WebP image")

    if fmt not in _ALLOWED:
        raise ImageRejected("only PNG, JPEG, and WebP images are allowed")
    content_type, ext = _ALLOWED[fmt]

    # verify() leaves the image unusable; reopen to re-encode. Same bytes, so the
    # size checked above still holds.
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (OSError, ValueError, Image.DecompressionBombError):
        raise ImageRejected("image could not be read")
    width, height = img.width, img.height

    # Re-encode with no metadata. Pasting the pixels into a fresh image copies
    # no EXIF/GPS/ICC/comment chunks (img.info is left behind entirely).
    clean = Image.new(img.mode, img.size)
    if img.palette is not None:
        # paste() copies only palette indices and a fresh "P" image starts with a
        # default palette, so carry the real palette across (plus tRNS
        # transparency, which is pixel data, not metadata) or every color changes.
        # Kept as a palette image: converting to RGB can double the file size.
        clean.putpalette(img.getpalette(img.palette.mode), img.palette.mode)
        if "transparency" in img.info:
            clean.info["transparency"] = img.info["transparency"]
    clean.paste(img)
    buf = io.BytesIO()
    save_fmt = "JPEG" if fmt == "JPEG" else fmt
    if save_fmt == "JPEG" and clean.mode not in ("RGB", "L"):
        clean = clean.convert("RGB")
    clean.save(buf, format=save_fmt)
    out = buf.getvalue()
    if len(out) > MAX_BYTES:
        raise ImageRejected("image is too large after processing")

    stored_name = f"{uuid.uuid4().hex}.{ext}"
    dest = path_for(stored_name)
    # Exclusive create: uuid collision (practically impossible) never overwrites.
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(out)
    except Exception:
        try:
            os.unlink(dest)
        except OSError:
            pass
        raise
    return SavedImage(stored_name, content_type, len(out), width, height)


def delete_file(stored_name: str) -> None:
    try:
        os.unlink(path_for(stored_name))
    except (OSError, ImageRejected):
        pass


def read_file(stored_name: str) -> Optional[bytes]:
    try:
        with open(path_for(stored_name), "rb") as f:
            return f.read()
    except (OSError, ImageRejected):
        return None
