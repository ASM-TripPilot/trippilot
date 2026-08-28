"""LlmPort 멀티모달 seam — 이미지 파트·동의 타입 강제·미지원 강등 (TRIP-595).

U6 Reflect FD §6.1 A안(후미 기본값 필드)의 조건 "기존 텍스트 호출 전부 무영향"을
여기서 못박고, Phase 2 파이프라인이 얹힐 세 가지 전제를 고정한다:

  ① 이미지 없는 요청은 종전과 **같은 와이어 모양**(문자열 input) — 회귀 0
  ② 이미지 있는 요청만 멀티파트로 변환 (data URL, 실측 형식 2026-08-25)
  ③ 못 받는 어댑터는 **명시 실패**(LlmUnsupportedError) — 조용히 텍스트만 보내면
     사용자는 사진을 본 회고라고 믿는다 (INV-4 침묵 금지의 이미지판)

동의 게이트는 타입으로 강제된다 — 미동의 VisionInput은 인스턴스가 될 수 없다(VIS-P1).
실 API 호출 0 (D37) — 어댑터 검증은 SDK 대역으로 한다.
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.adapters.openai_adapter import _responses_input
from trippilot.domain.prompt import PromptRef
from trippilot.domain.reflection import (
    PhotoConsent,
    PhotoId,
    PhotoRef,
    VisionInput,
)
from trippilot.ports.llm_port import (
    IMAGE_MEDIA_TYPES,
    LlmImagePart,
    LlmRequest,
    LlmUnsupportedError,
)

from tests.fakes.fake_llm import TextOnlyLlm, VisionSpyLlm

_NOW = datetime(2026, 8, 28, 9, 0, tzinfo=timezone.utc)
_REF = PromptRef(prompt_id="p", version="0.1.0", feature="REFLECTION_TEMPLATE")
_PNG = b"\x89PNG\r\n\x1a\n fake bytes"


def _request(images: tuple = ()) -> LlmRequest:
    return LlmRequest(
        model_id="m", prompt="본문", prompt_ref=_REF,
        max_tokens=100, temperature=1.0, images=images,
    )


# ── ① 기존 호출 무영향 ──────────────────────────────────


def test_default_is_empty_and_wire_shape_unchanged() -> None:
    """images 미지정 = 빈 튜플, responses 입력은 종전처럼 **문자열 그대로**."""
    request = _request()
    assert request.images == ()
    assert _responses_input(request) == "본문"


# ── ② 이미지 변환 ───────────────────────────────────────


def test_images_become_multipart_data_urls() -> None:
    part = LlmImagePart(media_type="image/png", data=_PNG)
    payload = _responses_input(_request((part, part)))

    assert isinstance(payload, list) and payload[0]["role"] == "user"
    content = payload[0]["content"]
    assert content[0] == {"type": "input_text", "text": "본문"}
    assert [c["type"] for c in content[1:]] == ["input_image", "input_image"]
    expected = "data:image/png;base64," + base64.b64encode(_PNG).decode()
    assert all(c["image_url"] == expected for c in content[1:])


@given(media_type=st.sampled_from(sorted(IMAGE_MEDIA_TYPES)),
       data=st.binary(min_size=1, max_size=64))
@settings(max_examples=40, deadline=None)
def test_data_url_roundtrips_bytes(media_type: str, data: bytes) -> None:
    """어떤 바이트든 data URL에서 원본이 복원된다 — 손실·이중 인코딩 없음."""
    payload = _responses_input(_request((LlmImagePart(media_type=media_type, data=data),)))
    url = payload[0]["content"][1]["image_url"]
    prefix, encoded = url.split(",", 1)
    assert prefix == f"data:{media_type};base64"
    assert base64.b64decode(encoded) == data


def test_unsupported_media_type_and_empty_bytes_rejected_at_construction() -> None:
    """잘못된 이미지는 벤더까지 가지 않고 생성 시점에 막힌다."""
    with pytest.raises(ValueError, match="media_type"):
        LlmImagePart(media_type="image/gif", data=_PNG)
    with pytest.raises(ValueError, match="빈 이미지"):
        LlmImagePart(media_type="image/png", data=b"")


# ── ③ 미지원 어댑터 강등 신호 ────────────────────────────


def test_text_only_adapter_raises_instead_of_dropping_images() -> None:
    """이미지를 못 받으면 **명시 실패** — 텍스트만 조용히 보내지 않는다."""
    adapter = TextOnlyLlm()
    assert adapter.invoke(_request()).raw_text == "{}"  # 텍스트는 정상
    with pytest.raises(LlmUnsupportedError):
        adapter.invoke(_request((LlmImagePart(media_type="image/png", data=_PNG),)))


# ── 동의 게이트 (VIS-P1 전제) ────────────────────────────


def _consent(granted: bool = True, ref: str = "consent-1") -> PhotoConsent:
    return PhotoConsent(granted=granted, consent_ref=ref, granted_at=_NOW)


@given(granted=st.booleans(), ref=st.sampled_from(["", "   ", "consent-1"]))
@settings(max_examples=20, deadline=None)
def test_vision_input_exists_only_with_valid_consent(granted: bool, ref: str) -> None:
    """미동의·증빙 없음 조합에서는 **인스턴스 생성 자체가 불가** —
    '동의 없이는 이미지가 실리지 않는다'가 코드 경로가 아니라 타입으로 성립한다."""
    photos = (PhotoRef(photo_id=PhotoId("ph-1")),)
    if granted and ref.strip():
        assert VisionInput(photos=photos, consent=_consent(granted, ref)).photos == photos
    else:
        with pytest.raises(ValueError):
            VisionInput(photos=photos, consent=_consent(granted, ref))


def test_vision_spy_records_images_actually_sent() -> None:
    """스파이가 실제 전송 이미지를 관측한다 — 상위 파이프라인의 VIS-P1 검증 도구."""
    spy = VisionSpyLlm(canned="{}")
    spy.invoke(_request())
    spy.invoke(_request((LlmImagePart(media_type="image/jpeg", data=_PNG),)))
    assert spy.seen_images[0] == ()
    assert len(spy.seen_images[1]) == 1


def test_photo_ref_and_consent_roundtrip_and_tz_guard() -> None:
    photo = PhotoRef(photo_id=PhotoId("ph-1"), taken_at=_NOW)
    assert PhotoRef.from_dict(photo.to_dict()) == photo
    consent = _consent()
    assert PhotoConsent.from_dict(consent.to_dict()) == consent
    with pytest.raises(ValueError, match="tz-aware"):
        PhotoRef(photo_id=PhotoId("ph-1"), taken_at=datetime(2026, 8, 28))
