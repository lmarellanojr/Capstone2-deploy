"""Student evidence screenshots: validation/metadata stripping, storage, and the
owner/staff access rules on the review image endpoints. Role boundaries for the
routes are also in test_sec01_rbac_matrix.py."""
from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import db
import evidence_images
from auth import verify_token
from provision_api_fastapi import app


@pytest.fixture(autouse=True)
def _image_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("EVIDENCE_IMAGE_DIR", str(tmp_path / "imgs"))


def _png(size=(40, 30), color=(200, 40, 40), with_exif=False) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_with_gps() -> bytes:
    # A JPEG carrying an EXIF GPS tag; the stored copy must not keep it.
    img = Image.new("RGB", (32, 32), (10, 120, 200))
    exif = img.getexif()
    exif[0x0110] = "SecretCameraModel"  # Model tag, easy to detect if retained
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


# ── validate_and_store ───────────────────────────────────────────────────────

class TestValidateAndStore:
    def test_accepts_png_and_records_dimensions(self):
        saved = evidence_images.validate_and_store(_png((40, 30)))
        assert saved.content_type == "image/png"
        assert (saved.width, saved.height) == (40, 30)
        assert evidence_images.read_file(saved.stored_name) is not None

    def test_strips_metadata_from_jpeg(self):
        saved = evidence_images.validate_and_store(_jpeg_with_gps())
        stored = evidence_images.read_file(saved.stored_name)
        assert b"SecretCameraModel" not in stored
        reopened = Image.open(io.BytesIO(stored))
        assert not dict(reopened.getexif())  # no EXIF survived

    def test_rejects_non_image(self):
        with pytest.raises(evidence_images.ImageRejected):
            evidence_images.validate_and_store(b"#!/bin/sh\nrm -rf /\n")

    def test_rejects_disguised_svg(self):
        with pytest.raises(evidence_images.ImageRejected):
            evidence_images.validate_and_store(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>")

    def test_rejects_oversize(self, monkeypatch):
        monkeypatch.setattr(evidence_images, "MAX_BYTES", 100)
        with pytest.raises(evidence_images.ImageRejected):
            evidence_images.validate_and_store(_png((200, 200)))

    def test_rejects_huge_dimensions(self, monkeypatch):
        monkeypatch.setattr(evidence_images, "MAX_DIMENSION", 20)
        with pytest.raises(evidence_images.ImageRejected):
            evidence_images.validate_and_store(_png((40, 40)))

    def test_stored_name_cannot_escape_dir(self):
        with pytest.raises(evidence_images.ImageRejected):
            evidence_images.path_for("../../etc/passwd")

    def test_palette_png_keeps_colors_and_transparency(self):
        # Re-encoding used to paste palette indices into a fresh "P" image with a
        # default palette: red and green both came back black.
        img = Image.new("P", (4, 1))
        img.putpalette([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
        img.putdata([0, 1, 2, 3])
        buf = io.BytesIO()
        img.save(buf, format="PNG", transparency=3)  # index 3 fully transparent
        saved = evidence_images.validate_and_store(buf.getvalue())
        stored = Image.open(io.BytesIO(evidence_images.read_file(saved.stored_name)))
        assert stored.mode == "P"  # still a palette image, so the file doesn't grow
        original = Image.open(io.BytesIO(buf.getvalue()))
        before = [original.convert("RGBA").getpixel((x, 0)) for x in range(4)]
        after = [stored.convert("RGBA").getpixel((x, 0)) for x in range(4)]
        assert after == before == [(255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255), (255, 255, 255, 0)]

    def test_palette_png_still_loses_its_metadata(self):
        from PIL import PngImagePlugin

        img = Image.new("P", (8, 8))
        img.putpalette([10, 20, 30])
        meta = PngImagePlugin.PngInfo()
        meta.add_text("Comment", "SecretCameraModel")
        buf = io.BytesIO()
        img.save(buf, format="PNG", pnginfo=meta)
        saved = evidence_images.validate_and_store(buf.getvalue())
        assert b"SecretCameraModel" not in evidence_images.read_file(saved.stored_name)

    def test_oversized_image_is_rejected_before_any_pixel_decoding(self, monkeypatch):
        # A 9000x9000 PNG compresses to ~10 KB: well under the byte limit, but
        # hundreds of MB once decoded. The size check must come before load().
        from PIL import ImageFile

        decoded = []
        real_load = ImageFile.ImageFile.load
        monkeypatch.setattr(ImageFile.ImageFile, "load", lambda im: decoded.append(im.size) or real_load(im))
        buf = io.BytesIO()
        Image.new("1", (9000, 9000)).save(buf, format="PNG")
        assert len(buf.getvalue()) < evidence_images.MAX_BYTES
        with pytest.raises(evidence_images.ImageRejected, match="4000px"):
            evidence_images.validate_and_store(buf.getvalue())
        assert decoded == []

    def test_total_pixel_limit(self, monkeypatch):
        monkeypatch.setattr(evidence_images, "MAX_PIXELS", 1000)
        with pytest.raises(evidence_images.ImageRejected, match="too many pixels"):
            evidence_images.validate_and_store(_png((40, 30)))  # 1200 px, both sides small

    def test_pillow_decompression_bomb_error_is_a_clean_rejection(self):
        # Past 2x Image.MAX_IMAGE_PIXELS, Image.open() itself raises
        # DecompressionBombError; it used to escape as a 500.
        buf = io.BytesIO()
        Image.new("1", (14000, 14000)).save(buf, format="PNG")
        with pytest.raises(evidence_images.ImageRejected):
            evidence_images.validate_and_store(buf.getvalue())


# ── endpoints ────────────────────────────────────────────────────────────────

def _as(username, *roles):
    claims = {"preferred_username": username, "realm_access": {"roles": list(roles)}}
    app.dependency_overrides[verify_token] = lambda: claims
    return TestClient(app)


def _make_review(student="alice", scenario=9):
    conn = db.get_db_connection()
    with conn:
        cur = conn.execute(
            "INSERT INTO review_cases (student_id, scenario_id, case_type, report_text, status) "
            "VALUES (?, ?, 'WRITTEN_REPORT', 'r', 'PENDING')",
            (student, scenario),
        )
        rid = cur.lastrowid
    conn.close()
    return rid


def _upload(client, rid, data=None, name="shot.png", ctype="image/png", caption=None):
    files = {"file": (name, data if data is not None else _png(), ctype)}
    form = {"caption": caption} if caption else None
    return client.post(f"/reviews/{rid}/images", files=files, data=form)


def test_owner_upload_list_fetch_delete_roundtrip():
    rid = _make_review("alice")
    owner = _as("alice", "student")
    up = _upload(owner, rid, caption="login page")
    assert up.status_code == 200, up.text
    img = up.json()
    assert img["content_type"] == "image/png" and img["caption"] == "login page"

    lst = owner.get(f"/reviews/{rid}/images").json()
    assert [i["id"] for i in lst["images"]] == [img["id"]]

    got = owner.get(f"/reviews/{rid}/images/{img['id']}")
    assert got.status_code == 200 and got.headers["content-type"] == "image/png"
    assert got.headers["x-content-type-options"] == "nosniff"

    d = owner.delete(f"/reviews/{rid}/images/{img['id']}")
    assert d.status_code == 200
    assert owner.get(f"/reviews/{rid}/images").json()["images"] == []


def test_instructor_can_view_but_not_upload_or_delete():
    rid = _make_review("alice")
    _upload(_as("alice", "student"), rid)
    img_id = _as("alice", "student").get(f"/reviews/{rid}/images").json()["images"][0]["id"]

    staff = _as("bob_instructor", "instructor")
    assert staff.get(f"/reviews/{rid}/images").status_code == 200
    assert staff.get(f"/reviews/{rid}/images/{img_id}").status_code == 200
    # Not the owner -> upload/delete are hidden as 404, not performed.
    assert _upload(staff, rid).status_code == 404
    assert staff.delete(f"/reviews/{rid}/images/{img_id}").status_code == 404


def test_other_student_cannot_see_or_touch():
    rid = _make_review("alice")
    _upload(_as("alice", "student"), rid)
    mallory = _as("mallory", "student")
    assert mallory.get(f"/reviews/{rid}/images").status_code == 404
    assert _upload(mallory, rid).status_code == 404


def test_per_review_limit_enforced(monkeypatch):
    monkeypatch.setattr(evidence_images, "MAX_PER_REVIEW", 2)
    rid = _make_review("alice")
    owner = _as("alice", "student")
    assert _upload(owner, rid).status_code == 200
    assert _upload(owner, rid).status_code == 200
    over = _upload(owner, rid)
    assert over.status_code == 400 and "at most" in over.json()["detail"]


def test_bad_upload_is_rejected_with_reason():
    rid = _make_review("alice")
    r = _upload(_as("alice", "student"), rid, data=b"not an image")
    assert r.status_code == 400
    assert "valid" in r.json()["detail"].lower()
