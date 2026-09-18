"""HttpEmbeddingAdapter (TRIP-517) — 이 어댑터의 존재 이유 절반은 **거부**다.

적재된 벡터와 다른 모델로 질의하면 검색이 조용히 엉터리가 된다. 서비스가 응답에
`model` 을 실어주는 것만으로는 아무도 안 읽으면 무용이고, 읽고 거부하는 이쪽이
규칙의 강제 지점이다 — 그래서 거부 케이스가 성공 케이스보다 많다.
"""

from __future__ import annotations

import pytest

from trippilot.llm_gateway.adapters.http_embedding import (
    EmbeddingDimMismatch,
    EmbeddingModelMismatch,
    EmbeddingServiceError,
    EmbeddingUnreachable,
    HttpEmbeddingAdapter,
)

_MODEL = "nlpai-lab/KURE-v1"
_DIM = 4  # 테스트 편의 — 계약상 1024지만 검증 로직은 dim 값에 무관하다


class _FakeHttp:
    def __init__(self, response=None, raises: Exception | None = None) -> None:
        self._response = response
        self._raises = raises
        self.calls: list[tuple] = []

    def request_json(self, method, url, *, params=None, body=None, headers=None):
        self.calls.append((method, url, body))
        if self._raises is not None:
            raise self._raises
        return self._response


def _ok(count: int = 1, model: str = _MODEL, dim: int = _DIM) -> dict:
    return {"vectors": [[0.5] * dim for _ in range(count)], "dim": dim, "model": model}


def _adapter(http) -> HttpEmbeddingAdapter:
    return HttpEmbeddingAdapter(http, "http://ai-embedding:8100", model=_MODEL, dim=_DIM)


# ── 정상 ────────────────────────────────────────────────────────────
def test_embed_batch_returns_vectors_and_posts_once() -> None:
    """배치는 **한 번의 호출**이다 — N 회로 나가면 컨테이너 왕복이 N 배가 된다."""
    http = _FakeHttp(_ok(3))
    vectors = _adapter(http).embed_batch(["가", "나", "다"])
    assert len(vectors) == 3 and all(len(v) == _DIM for v in vectors)
    assert len(http.calls) == 1
    method, url, body = http.calls[0]
    assert (method, url) == ("POST", "http://ai-embedding:8100/embed")
    assert body == {"texts": ["가", "나", "다"]}


def test_embed_single_delegates_to_batch() -> None:
    http = _FakeHttp(_ok(1))
    assert _adapter(http).embed("가") == (0.5,) * _DIM


def test_empty_input_does_not_call_the_service() -> None:
    http = _FakeHttp(_ok(0))
    assert _adapter(http).embed_batch([]) == ()
    assert http.calls == []


def test_base_url_trailing_slash_is_normalized() -> None:
    http = _FakeHttp(_ok(1))
    HttpEmbeddingAdapter(http, "http://x:8100/", model=_MODEL, dim=_DIM).embed("가")
    assert http.calls[0][1] == "http://x:8100/embed"


# ── 거부 ────────────────────────────────────────────────────────────
def test_model_mismatch_is_rejected_and_not_retryable() -> None:
    """**가장 위험한 케이스** — 차원이 같고 모델만 다르면 아무 검사도 안 걸린다.

    벡터 길이도 개수도 맞아서 통과해 버리고, 검색 순위만 조용히 무의미해진다.
    재시도해도 같은 답이 오므로 재시도 가치가 없다.
    """
    http = _FakeHttp(_ok(1, model="intfloat/multilingual-e5-large"))
    with pytest.raises(EmbeddingModelMismatch) as e:
        _adapter(http).embed("가")
    assert not e.value.retryable
    assert "재적재" in str(e.value)  # 사람이 할 조치를 메시지에 담는다


def test_declared_dim_mismatch_is_rejected() -> None:
    http = _FakeHttp(_ok(1, dim=768))
    with pytest.raises(EmbeddingDimMismatch):
        _adapter(http).embed("가")


def test_vector_length_mismatch_is_rejected_even_if_declared_dim_is_right() -> None:
    """선언 dim 과 실제 벡터 길이가 다를 수 있다 — 둘 다 본다 (BR-AF-09)."""
    http = _FakeHttp({"vectors": [[0.1, 0.2]], "dim": _DIM, "model": _MODEL})
    with pytest.raises(EmbeddingDimMismatch, match="BR-AF-09"):
        _adapter(http).embed("가")


def test_count_mismatch_is_rejected() -> None:
    """개수가 어긋나면 어느 텍스트의 벡터인지 알 수 없다 — 조용히 쓰면 안 된다."""
    http = _FakeHttp(_ok(2))
    with pytest.raises(EmbeddingServiceError):
        _adapter(http).embed_batch(["가", "나", "다"])


def test_transport_failure_is_retryable() -> None:
    """연결 실패는 일시적이다 — 모델 불일치(영구적)와 사유를 갈라야 운영이 판단한다."""
    http = _FakeHttp(raises=OSError("connection refused"))
    with pytest.raises(EmbeddingUnreachable) as e:
        _adapter(http).embed("가")
    assert e.value.retryable


def test_non_mapping_response_is_transport_failure() -> None:
    http = _FakeHttp("<html>502 Bad Gateway</html>")
    with pytest.raises(EmbeddingUnreachable):
        _adapter(http).embed("가")


def test_never_returns_zero_vectors_on_failure() -> None:
    """**0벡터를 돌려주면 그게 조용한 엉터리다.** 모든 실패는 예외로 드러난다.

    호출측(`_safe_retrieve`)이 잡아 노트로 남기고 규칙 랭킹으로 강등한다(INV-4).
    여기서 뭔가를 지어내면 오염된 벡터가 검색 결과로 둔갑한다.
    """
    for http in (_FakeHttp(raises=OSError("x")), _FakeHttp(_ok(1, model="other"))):
        with pytest.raises(EmbeddingServiceError):
            _adapter(http).embed("가")


# ── 조립 검증 ────────────────────────────────────────────────────────
@pytest.mark.parametrize("kwargs", [{"base_url": ""}, {"model": ""}])
def test_assembly_requires_base_url_and_model(kwargs: dict) -> None:
    """`model` 에 기본값을 주면 대조가 형식적이 된다 — 조립하는 쪽이 명시하게 강제."""
    args = {"base_url": "http://x", "model": _MODEL} | kwargs
    with pytest.raises(ValueError):
        HttpEmbeddingAdapter(_FakeHttp(_ok()), args["base_url"], model=args["model"])
