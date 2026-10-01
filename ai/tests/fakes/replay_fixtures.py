"""기록·재생 픽스처 — §6 CI 게이트의 토대 (intent-matching-design §6, D37 "CI 실 호출 0").

**왜 필요한가.** 의도 라우터의 2·3차는 LLM 이고 1차는 1024차원 임베딩 모델이다. CI 는 외부 호출이
0이어야 하고(D37) KURE-v1(약 1GB)을 올릴 수도 없다. 그래서 **실 응답을 한 번 기록해 두고 CI 는 재생만**
한다 — 평가셋 정확도 회귀를 자동으로 잡는 유일한 길이다.

**재생의 규율: 없으면 실패한다.** 찾지 못한 키에 대해 그럴듯한 값을 만들어 내면 게이트가 거짓말을 한다
(fake 임베딩은 의미 유사도가 없어 1차가 통째로 무의미해지고, fake LLM 응답은 2·3차 판정을 뒤집는다).
`ReplayMissError` 를 던져 **"기록을 다시 떠야 한다"를 시끄럽게** 만든다.

⚠️ **던지는 것만으로는 부족하다.** `GatewayFacade` 는 벤더 예외를 포함해 **모든 예외를 폴백 신호로**
바꾼다(BR-U4-02) — 옳은 설계지만, 그 때문에 기록 미스가 조용한 FALLBACK 으로 바뀌어 "정확도가 떨어졌다"
로만 보인다. 실측: 배정 모델을 잘못 재구성했더니 86/87 이 64/87 로 떨어졌는데 원인 표시는 없었다.
그래서 미스를 **세어 노출한다**(`misses`). 게이트는 정확도보다 **미스를 먼저** 본다 — 둘은 처방이 다르다
("기록을 다시 뜬다" vs "변경을 되돌린다").

**그래서 프롬프트를 한 글자 바꾸면 CI 가 깨진다.** 이것이 결함이 아니라 목적이다 — 프롬프트·모델·뱅크
변경은 기록 갱신을 강제하고, 갱신된 기록이 곧 리뷰 대상이 된다(§6 "몰래 바뀜" 차단).

**형식은 표준 라이브러리만 쓴다.** CI 의존성에 numpy 가 없다(`pyproject.toml`). 벡터는 fp16(`struct` 의
`'e'`)으로 좁혀 base64 로 싣는다 — 저장 fp16·로드 fp32 는 임베딩 정밀도 결정과 같은 방침이고,
1024차원 한 줄이 약 2.7KB 라 jsonl 한 줄 = 문장 하나가 되어 diff 로 읽힌다.
"""

from __future__ import annotations

import base64
import hashlib
import json
import struct
from collections.abc import Sequence
from pathlib import Path

from trippilot.ports.llm_port import LlmRequest, LlmResponse

EMBEDDINGS_FILE = "embeddings.jsonl"
LLM_FILE = "llm.jsonl"
META_FILE = "meta.json"


class ReplayMissError(RuntimeError):
    """기록에 없는 입력 — 조용히 다른 값을 돌려주지 않는다.

    보통 원인은 하나다: 뱅크·평가셋·프롬프트·모델 중 무언가가 기록 이후에 바뀌었다.
    해법도 하나다 — 기록을 다시 뜬다(`scripts/trace_intents.py --record`).
    """


def pack_vector(vec: Sequence[float]) -> str:
    """fp32 시퀀스 → fp16 바이트 → base64. 1024차원이 약 2.7KB."""
    return base64.b64encode(struct.pack(f"<{len(vec)}e", *vec)).decode("ascii")


def unpack_vector(blob: str) -> tuple[float, ...]:
    """base64 → fp16 바이트 → fp32 튜플 (포트 계약이 float 이라 넓혀 돌려준다)."""
    raw = base64.b64decode(blob)
    return struct.unpack(f"<{len(raw) // 2}e", raw)


def llm_key(request: LlmRequest) -> str:
    """LLM 기록 키 — 모델·프롬프트 버전·렌더된 프롬프트 전문을 함께 해싼다.

    셋 중 **무엇이 바뀌어도 키가 달라져야 한다**. 프롬프트 본문만 해싸면 모델 교체가 기록에 안 잡히고,
    버전만 보면 yaml 을 고치고 버전을 안 올린 변경이 통과한다.
    """
    material = f"{request.model_id}\n{request.prompt_ref.prompt_id}@{request.prompt_ref.version}\n{request.prompt}"
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def text_key(text: str) -> str:
    """임베딩 기록 키 — 문장 그대로의 sha256."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"픽스처 없음: {path} — `--record` 로 먼저 기록한다")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class ReplayEmbedding:
    """기록된 벡터만 돌려주는 EmbeddingPort. 없으면 `ReplayMissError`."""

    def __init__(self, fixture_dir: Path) -> None:
        self._vectors: dict[str, tuple[float, ...]] = {}
        for row in _read_jsonl(Path(fixture_dir) / EMBEDDINGS_FILE):
            self._vectors[row["key"]] = unpack_vector(row["vec"])
        if not self._vectors:
            raise ValueError("임베딩 기록이 비어 있다")
        dims = {len(v) for v in self._vectors.values()}
        if len(dims) != 1:
            raise ValueError(f"기록된 벡터 차원이 섞였다: {sorted(dims)}")
        self.dim = dims.pop()
        self.misses: list[str] = []  # 게이트가 정확도보다 먼저 보는 값

    def embed(self, text: str) -> tuple[float, ...]:
        vec = self._vectors.get(text_key(text))
        if vec is None:
            self.misses.append(text)
            raise ReplayMissError(
                f"임베딩 기록에 없는 문장: {text!r} — 뱅크나 평가셋이 바뀌었다면 기록을 다시 뜬다"
            )
        return vec

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        return tuple(self.embed(t) for t in texts)


class ReplayLlm:
    """기록된 응답만 돌려주는 LlmPort. 없으면 `ReplayMissError`.

    `latency_ms` 는 0으로 고정한다 — 재생은 지연을 재는 도구가 아니고, 기록된 실측 지연을 돌려주면
    CI 가 p95 를 "측정"한 것처럼 보이게 된다. 지연은 수동 실행에서만 의미가 있다.
    """

    def __init__(self, fixture_dir: Path) -> None:
        self._responses: dict[str, dict] = {}
        for row in _read_jsonl(Path(fixture_dir) / LLM_FILE):
            self._responses[row["key"]] = row
        if not self._responses:
            raise ValueError("LLM 기록이 비어 있다")
        self.calls: list[str] = []
        self.misses: list[str] = []  # 게이트가 정확도보다 먼저 보는 값

    def invoke(self, request: LlmRequest) -> LlmResponse:
        key = llm_key(request)
        row = self._responses.get(key)
        if row is None:
            detail = (f"feature={request.prompt_ref.feature} model={request.model_id} "
                      f"prompt@{request.prompt_ref.version}")
            self.misses.append(detail)
            raise ReplayMissError(
                f"LLM 기록에 없는 호출: {detail} — "
                "프롬프트·모델·뱅크가 바뀌었다면 기록을 다시 뜬다"
            )
        self.calls.append(key)
        return LlmResponse(
            raw_text=row["response"],
            input_tokens=int(row.get("input_tokens", 0)),
            output_tokens=int(row.get("output_tokens", 0)),
            latency_ms=0,
            model_id=request.model_id,
        )


class RecordingEmbedding:
    """실 임베딩을 감싸 (문장 → 벡터)를 모은다. 기록 실행에서만 쓴다."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.dim = inner.dim
        self.model_id = getattr(inner, "model_id", "?")  # 러너 헤더가 읽는다 — 감싸도 보여야 한다
        self.seen: dict[str, tuple[str, tuple[float, ...]]] = {}

    def embed(self, text: str) -> tuple[float, ...]:
        vec = self._inner.embed(text)
        self.seen[text_key(text)] = (text, tuple(vec))
        return vec

    def embed_batch(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        vectors = self._inner.embed_batch(texts)
        for text, vec in zip(texts, vectors):
            self.seen[text_key(text)] = (text, tuple(vec))
        return vectors

    def rows(self) -> list[dict]:
        return [
            {"key": key, "text": text, "vec": pack_vector(vec)}
            for key, (text, vec) in sorted(self.seen.items(), key=lambda kv: kv[1][0])
        ]


class RecordingLlm:
    """실 LLM 을 감싸 (모델·프롬프트 → 응답)을 모은다. 기록 실행에서만 쓴다."""

    def __init__(self, inner) -> None:
        self._inner = inner
        self.seen: dict[str, dict] = {}

    def invoke(self, request: LlmRequest) -> LlmResponse:
        response = self._inner.invoke(request)
        self.seen[llm_key(request)] = {
            "key": llm_key(request),
            "feature": request.prompt_ref.feature,
            "model": request.model_id,
            "prompt_version": request.prompt_ref.version,
            "response": response.raw_text,
            "input_tokens": response.input_tokens,
            "output_tokens": response.output_tokens,
        }
        return response

    def rows(self) -> list[dict]:
        return [self.seen[k] for k in sorted(self.seen)]


def write_fixtures(fixture_dir: Path, embedding: RecordingEmbedding, llm: RecordingLlm,
                   meta: dict) -> tuple[int, int]:
    """기록을 픽스처 디렉토리에 쓴다. 반환: (임베딩 건수, LLM 건수)."""
    fixture_dir = Path(fixture_dir)
    fixture_dir.mkdir(parents=True, exist_ok=True)
    emb_rows, llm_rows = embedding.rows(), llm.rows()
    (fixture_dir / EMBEDDINGS_FILE).write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in emb_rows), encoding="utf-8")
    (fixture_dir / LLM_FILE).write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in llm_rows), encoding="utf-8")
    (fixture_dir / META_FILE).write_text(
        json.dumps(meta, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return len(emb_rows), len(llm_rows)


def read_meta(fixture_dir: Path) -> dict:
    return json.loads((Path(fixture_dir) / META_FILE).read_text(encoding="utf-8"))
