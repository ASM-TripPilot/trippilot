"""HttpEmbeddingAdapter — 별도 임베딩 서비스의 `EmbeddingPort` 구현 (TRIP-517).

모델(KURE-v1, 2.1GB)을 AI 이미지 밖으로 뺀 뒤 그 서비스를 부르는 쪽이다.
와이어: `POST {base_url}/embed {"texts":[...]}` → `{"vectors","dim","model"}`.

HTTP 클라이언트는 주입받는다 — `BackendPoiDb`(TRIP-408)와 같은 seam 이라
본 모듈은 어떤 HTTP 라이브러리도 import 하지 않는다.

## 이 어댑터의 존재 이유 절반은 **거부**다

적재된 벡터와 다른 모델로 질의하면 검색이 **조용히** 엉터리가 된다 — 예외도 로그도
안 나고 순위만 무의미해진다(팀 결정 2026-08-22: "provider 를 바꾸면 전량 재적재").
서비스가 응답에 `model` 을 실어주는 것만으로는 아무도 안 읽으면 무용이고, **읽고
거부하는 이쪽이 규칙의 강제 지점**이다.

실패 사유를 셋으로 가른다 — 재시도 가치가 정반대라 뭉치면 운영이 판단을 못 한다:
- `EmbeddingUnreachable`   연결·타임아웃 — 일시적, 재시도 가치 있음
- `EmbeddingModelMismatch` 응답 model 이 기대와 다름 — **영구적, 재시도 무가치**
- `EmbeddingDimMismatch`   벡터 길이 ≠ dim — BR-AF-09 위반

세 예외 모두 호출측(`PlanBRagPipeline._safe_retrieve`)이 잡아 노트로 남기고 규칙
랭킹으로 강등한다(INV-4). **여기서 0벡터나 빈 결과를 돌려주면 안 된다** — 그게
정확히 "조용한 실패"이고, 오염된 벡터가 검색 결과로 둔갑한다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol


class EmbeddingServiceError(RuntimeError):
    """임베딩 서비스 호출 실패의 공통 조상 — 호출측은 이것만 잡으면 된다."""

    retryable: bool = False


class EmbeddingUnreachable(EmbeddingServiceError):
    """연결 실패·타임아웃·5xx — 상대가 뜨는 중이거나 일시 장애."""

    retryable = True


class EmbeddingModelMismatch(EmbeddingServiceError):
    """응답 model 이 기대와 다르다 — 재적재 없이는 검색이 무의미하다.

    재시도해도 같은 답이 온다. 배포가 어긋난 것이므로 사람이 고쳐야 한다.
    """


class EmbeddingDimMismatch(EmbeddingServiceError):
    """벡터 길이 ≠ dim (BR-AF-09) — 조용히 자르거나 채우면 벡터 공간이 오염된다."""


class HttpJson(Protocol):
    """`poi_curation.adapters.backend_poi_db.HttpJson` 과 **같은 시그니처**다.

    같은 모양으로 맞춰 두면 조립 진입점이 `UrllibJsonClient` 하나를 두 어댑터에
    그대로 쓴다. 여기서 그 클래스를 import 하지는 않는다 — `llm_gateway` 가
    `poi_curation` 을 import 하면 패키지 경계 위반이다.
    """

    def request_json(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, str] | None = None,
        body: object | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> object: ...


class HttpEmbeddingAdapter:
    """EmbeddingPort Protocol 만족."""

    def __init__(
        self,
        http: HttpJson,
        base_url: str,
        *,
        model: str,
        dim: int = 1024,
    ) -> None:
        """`model` 은 **필수**다 — 기본값을 주면 대조가 형식적이 된다.

        조립하는 쪽이 "무슨 모델로 적재했는지"를 명시하게 강제한다. 그 값을 모르면
        애초에 이 어댑터를 안전하게 쓸 수 없다.
        """
        if not base_url:
            raise ValueError("base_url 필수 — 설정 버그는 기동에서 드러난다")
        if not model:
            raise ValueError("model 필수 — 대조할 기대값 없이는 불일치를 못 잡는다")
        self._http = http
        self._base = base_url.rstrip("/")
        self._model = model
        self.dim = dim

    def embed(self, text: str) -> tuple[float, ...]:
        return self.embed_batch([text])[0]

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        if not texts:
            return ()
        payload = self._call(list(texts))
        self._verify(payload, len(texts))
        return tuple(
            tuple(float(x) for x in vector) for vector in payload["vectors"]
        )

    # ── 내부 ────────────────────────────────────────────────────────────
    def _call(self, texts: list[str]) -> Mapping[str, Any]:
        try:
            body = self._http.request_json(
                "POST", f"{self._base}/embed", body={"texts": texts}
            )
        except Exception as e:  # 연결·타임아웃·HTTP 오류를 한 사유로 모은다
            raise EmbeddingUnreachable(f"{type(e).__name__}: {e}") from e
        if not isinstance(body, Mapping):
            raise EmbeddingUnreachable(f"응답이 매핑이 아님: {type(body).__name__}")
        return body

    def _verify(self, payload: Mapping[str, Any], expected_count: int) -> None:
        """모델 → 차원 → 개수 → 길이 순으로 본다.

        모델을 먼저 보는 이유: 모델이 다르면 나머지가 다 맞아도 벡터가 무의미하다.
        차원만 같고 모델이 다른 경우가 **가장 위험하다** — 아무 검사도 안 걸리고
        검색 순위만 조용히 망가진다.
        """
        model = payload.get("model")
        if model != self._model:
            raise EmbeddingModelMismatch(
                f"서비스 모델 {model!r} != 기대 {self._model!r} — "
                "적재 벡터와 공간이 다르다. 모델을 되돌리거나 KB 를 전량 재적재해야 한다"
            )
        dim = payload.get("dim")
        if dim != self.dim:
            raise EmbeddingDimMismatch(f"서비스 dim {dim!r} != 기대 {self.dim}")
        vectors = payload.get("vectors")
        if not isinstance(vectors, Sequence) or len(vectors) != expected_count:
            raise EmbeddingUnreachable(
                f"벡터 개수 불일치: {len(vectors) if isinstance(vectors, Sequence) else '?'}"
                f" != {expected_count}"
            )
        for i, vector in enumerate(vectors):
            if not isinstance(vector, Sequence) or len(vector) != self.dim:
                raise EmbeddingDimMismatch(
                    f"벡터[{i}] 길이 "
                    f"{len(vector) if isinstance(vector, Sequence) else '?'} != {self.dim}"
                    " (BR-AF-09)"
                )
