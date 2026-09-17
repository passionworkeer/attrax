"""Upload validation for POST /scan-multipart (previously untested).

`_validate_image_upload` / `_validate_pdf_upload` are the only thing standing
between an arbitrary multipart body and the scan pipeline: they enforce size,
declared content type, and — crucially — the magic-byte prefix, because a
client controls `content_type` freely. Nothing exercised them before: the
endpoint had no test at all, so a regression that dropped (say) the WebP
RIFF check, or that let the 10 MB image cap drift, would have shipped silently.

These call the validators directly instead of posting to /scan-multipart:
the endpoint has no secret gate and runs the full vision→generate→verify
pipeline, which would make a validation test depend on the LLM.
"""
from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from starlette.datastructures import Headers, UploadFile  # noqa: E402

from rag_service.main import (  # noqa: E402
    _ALLOWED_IMAGE_TYPES,
    _MAX_IMAGE_SIZE_BYTES,
    _MAX_PDF_SIZE_BYTES,
    _build_scan_request_from_multipart,
    _parse_markets,
    _validate_image_upload,
    _validate_pdf_upload,
)

JPEG = b"\xff\xd8\xff\xe0" + b"jpeg-body"
PNG = b"\x89PNG\r\n\x1a\n" + b"png-body"
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"webp-body"
PDF = b"%PDF-1.7\n" + b"pdf-body"


def upload(data: bytes, content_type: str, filename: str = "f.bin") -> UploadFile:
    return UploadFile(
        io.BytesIO(data),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


class TestImageValidation:
    def test_accepts_every_allowed_type(self):
        assert _ALLOWED_IMAGE_TYPES == {"image/jpeg", "image/png", "image/webp"}
        for data, ctype in ((JPEG, "image/jpeg"), (PNG, "image/png"), (WEBP, "image/webp")):
            _validate_image_upload(upload(data, ctype, "ok.img"), data)  # no raise

    def test_rejects_oversized_image(self):
        big = b"\xff\xd8\xff" + b"x" * _MAX_IMAGE_SIZE_BYTES
        with pytest.raises(HTTPException) as exc:
            _validate_image_upload(upload(big, "image/jpeg"), big)
        assert exc.value.status_code == 413
        assert exc.value.detail == "Image too large"

    def test_exactly_at_the_cap_is_allowed(self):
        # Off-by-one guard: the check is `>`, so the cap itself must pass.
        at_cap = b"\xff\xd8\xff" + b"x" * (_MAX_IMAGE_SIZE_BYTES - 3)
        assert len(at_cap) == _MAX_IMAGE_SIZE_BYTES
        _validate_image_upload(upload(at_cap, "image/jpeg"), at_cap)

    def test_rejects_declared_type_outside_allowlist(self):
        with pytest.raises(HTTPException) as exc:
            _validate_image_upload(upload(b"GIF89a", "image/gif", "a.gif"), b"GIF89a")
        assert exc.value.status_code == 400
        assert exc.value.detail == "Unsupported image type"

    def test_rejects_jpeg_bytes_mislabelled_as_png(self):
        # The extension and content type both claim PNG; the bytes are JPEG.
        with pytest.raises(HTTPException) as exc:
            _validate_image_upload(upload(JPEG, "image/png", "a.png"), JPEG)
        assert exc.value.detail == "Invalid image content"

    def test_rejects_each_type_when_magic_is_wrong(self):
        cases = [
            (b"not-an-image", "image/jpeg"),
            (b"not-a-png", "image/png"),
            (b"not-a-webp", "image/webp"),
        ]
        for data, ctype in cases:
            with pytest.raises(HTTPException) as exc:
                _validate_image_upload(upload(data, ctype), data)
            assert exc.value.status_code == 400

    def test_webp_requires_both_riff_and_webp_marker(self):
        # RIFF alone (e.g. a WAV) must not pass as WebP.
        wav = b"RIFF\x00\x00\x00\x00WAVE" + b"audio"
        with pytest.raises(HTTPException):
            _validate_image_upload(upload(wav, "image/webp"), wav)
        # WEBP marker alone must not pass either.
        truncated = b"WEBP" + b"\x00" * 12
        with pytest.raises(HTTPException):
            _validate_image_upload(upload(truncated, "image/webp"), truncated)


class TestPdfValidation:
    def test_accepts_pdf_content_type(self):
        _validate_pdf_upload(upload(PDF, "application/pdf", "d.pdf"), PDF)

    def test_accepts_pdf_extension_without_content_type(self):
        # The content-type check is an OR with the .pdf filename check.
        _validate_pdf_upload(upload(PDF, "application/octet-stream", "d.pdf"), PDF)

    def test_rejects_non_pdf_with_neither_signal(self):
        with pytest.raises(HTTPException) as exc:
            _validate_pdf_upload(upload(PDF, "text/plain", "notes.txt"), PDF)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Unsupported PDF type"

    def test_rejects_missing_magic_even_with_pdf_extension(self):
        with pytest.raises(HTTPException) as exc:
            _validate_pdf_upload(upload(b"not really a pdf", "application/pdf", "d.pdf"), b"nope")
        assert exc.value.detail == "Invalid PDF content"

    def test_rejects_oversized_pdf(self):
        big = b"%PDF" + b"x" * _MAX_PDF_SIZE_BYTES
        with pytest.raises(HTTPException) as exc:
            _validate_pdf_upload(upload(big, "application/pdf", "d.pdf"), big)
        assert exc.value.status_code == 413
        assert exc.value.detail == "PDF too large"


class TestParseMarkets:
    """Pins the *actual* contract of `_parse_markets`, including its sharp edge.

    It prefers a JSON array and otherwise splits on commas, falling back to
    `["EU"]` only when nothing survives that. So the fallback is narrower than
    it looks:

        ""      -> ["EU"]          (empty split -> falsy -> default)
        "EU,US" -> ["EU", "US"]
        "[]"    -> []              (valid empty JSON array is returned as-is)
        "abc"   -> ["abc"]         (unparseable text becomes a one-item list)
        "{}"    -> ["{}"]          (valid JSON, but not a list -> split path)

    That matters because the legacy /scan and /scan-multipart endpoints have
    no market allow-list of their own, so junk is not rejected here — it just
    resolves no KB anchors downstream. The live v1 path is unaffected:
    rag_service/api/v1.py validates markets against ALLOWED_MARKETS and the
    BFF validates against lib/types.ts MARKET_IDS before forwarding.

    These tests describe the behaviour rather than endorsing it; they exist so
    that tightening the fallback later is a deliberate, visible change.
    """

    def test_parses_json_array(self):
        assert _parse_markets('["EU", "US"]') == ["EU", "US"]

    def test_falls_back_to_comma_separated(self):
        assert _parse_markets("EU,US") == ["EU", "US"]

    def test_drops_blank_entries(self):
        assert _parse_markets('["EU", "", "  ", "US"]') == ["EU", "US"]

    def test_empty_string_defaults_to_eu(self):
        assert _parse_markets("") == ["EU"]

    def test_valid_empty_json_array_is_returned_as_is(self):
        # NOT ["EU"] — the falsy-fallback only covers the split path.
        assert _parse_markets("[]") == []

    def test_unparseable_text_is_not_sanitised(self):
        # Documented sharp edge: no allow-list check happens on this path.
        assert _parse_markets("not json") == ["not json"]

    def test_valid_json_non_list_falls_through_to_split(self):
        assert _parse_markets("{}") == ["{}"]


class TestBuildScanRequestFromMultipart:
    async def test_encodes_images_and_parses_fields(self):
        img = JPEG
        req = await _build_scan_request_from_multipart(
            query="is this compliant?",
            product="charger",
            category="electronics",
            markets='["EU","US"]',
            documents='[{"name": "spec", "url": "https://example.com"}]',
            images=[upload(img, "image/jpeg", "front.jpg")],
            pdfs=[],
        )
        assert req.query == "is this compliant?"
        assert req.markets == ["EU", "US"]
        assert req.documents == [{"name": "spec", "url": "https://example.com"}]
        assert len(req.images) == 1
        assert req.images[0]["mime_type"] == "image/jpeg"
        assert req.images[0]["name"] == "front.jpg"
        assert base64.b64decode(req.images[0]["buffer"]) == img
        assert req.pdfs == []

    async def test_includes_pdfs_with_base64_body(self):
        req = await _build_scan_request_from_multipart(
            query="q",
            product="p",
            category="electronics",
            markets="EU",
            documents="[]",
            images=[],
            pdfs=[upload(PDF, "application/pdf", "manual.pdf")],
        )
        assert len(req.pdfs) == 1
        assert req.pdfs[0]["name"] == "manual.pdf"
        assert base64.b64decode(req.pdfs[0]["buffer"]) == PDF

    async def test_rejects_invalid_image_before_returning(self):
        with pytest.raises(HTTPException):
            await _build_scan_request_from_multipart(
                query="q",
                product="p",
                category="electronics",
                markets="EU",
                documents="[]",
                images=[upload(b"not-an-image", "image/jpeg", "bad.jpg")],
                pdfs=[],
            )

    async def test_rejects_invalid_pdf_before_returning(self):
        with pytest.raises(HTTPException):
            await _build_scan_request_from_multipart(
                query="q",
                product="p",
                category="electronics",
                markets="EU",
                documents="[]",
                images=[],
                pdfs=[upload(b"not-a-pdf", "application/pdf", "bad.pdf")],
            )

    async def test_malformed_documents_json_is_not_fatal(self):
        req = await _build_scan_request_from_multipart(
            query="q",
            product="p",
            category="electronics",
            markets="EU",
            documents="{not json",
            images=[],
            pdfs=[],
        )
        assert req.documents == []

    async def test_non_dict_document_entries_are_dropped(self):
        req = await _build_scan_request_from_multipart(
            query="q",
            product="p",
            category="electronics",
            markets="EU",
            documents='[{"ok": true}, "string", 42, null]',
            images=[],
            pdfs=[],
        )
        assert req.documents == [{"ok": True}]
