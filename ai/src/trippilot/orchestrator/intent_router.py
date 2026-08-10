"""IntentRouter — 3단 의도 매칭 + 결정론 폴백 (intent-matching-design.md §2, TRIP-242).

```
[0] 전처리(정규화) → 빈 문자열이면 즉시 폴백
[1] 질문뱅크 임베딩 top-k (LLM 0회)
      top1 ≥ T_high ∧ top1·top2 의도 일치 → CONFIDENT
      top1 ≥ T_mid                        → 2차 (AMBIGUOUS)
      그 외                                → 3차 (UNKNOWN)
[2] LLM 유사질문 N개 생성 → 원문 포함 재매칭 → 유사도 가중 투표
      최다 득표율 ≥ vote_ratio → VOTED / 미달 → 3차
[3] LLM 직접 분류 (라벨 closed-set 강제)
      성공 → LLM_DIRECT / 실패 → FALLBACK
```

**경계**: LLM 호출은 전부 C1 `GatewayFacade` 경유 (직접 LlmPort import 금지, L-3 취지).
게이트웨이는 게이트 1개당 인스턴스 1개라 feature별로 따로 주입받는다
(`intent_gateway` = feature INTENT, `paraphrase_gateway` = feature PARAPHRASE).
미주입이면 해당 단계는 건너뛰고 다음 단계/폴백으로 — 배선이 덜 된 상태에서도 라우터는 동작한다.

**INV-1**: 라벨은 항상 `Intent` enum 안 — 뱅크 payload의 라벨도 재검증하고,
closed-set 밖 라벨이 실린 엔트리는 매칭에서 제외한다 (뱅크 오염 방어).

**INV-4**: `route`는 예외를 밖으로 던지지 않는다. 어떤 실패든 폴백 `IntentMatch`로 수렴하고,
`reason`에 어느 단계에서 왜 떨어졌는지가 남는다 (침묵 실패 금지).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from trippilot.c1.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.domain.intent import (
    ROUTABLE_INTENTS,
    Intent,
    IntentDraft,
    IntentMatch,
    MatchRoute,
)
from trippilot.domain.llm import LlmFeature
from trippilot.orchestrator.question_bank import BANK_COLLECTION
from trippilot.ports.embedding_port import EmbeddingPort
from trippilot.ports.vector_store_port import VectorStorePort

# 전처리에서 제거하는 유니코드 카테고리: 이모지·기호변형자·서식제어·제어문자 (§2 [0. 전처리])
_STRIP_CATEGORIES = frozenset({"So", "Sk", "Cf", "Cc", "Cs", "Co"})
_REGEX_PREFIX = "regex:"
# 3차 프롬프트에 실을 closed-set 라벨 목록 (INV-1 — 모델이 고를 수 있는 값 자체를 한정)
_CLOSED_SET_LABELS = ", ".join(sorted(i.value for i in ROUTABLE_INTENTS))


@dataclass(frozen=True, slots=True)
class IntentRouterConfig:
    """판정 파라미터 (intent-matching-design §5 초기값 — 하드코딩 금지, 평가셋으로 튜닝)."""

    top_k: int = 5  # k
    t_high: float = 0.88  # 1차 즉시 확정 임계
    t_mid: float = 0.75  # 2차 진입 하한
    n_paraphrase: int = 3  # 유사 질문 생성 수
    vote_ratio: float = 0.60  # 가중 투표 확정 임계
    collection: str = BANK_COLLECTION
    llm_direct_confidence: float = 0.5  # 3차 산출물에 confidence가 없을 때의 값

    def __post_init__(self) -> None:
        if self.top_k < 1:
            raise ValueError("top_k ≥ 1")
        if not 0.0 <= self.t_mid <= self.t_high <= 1.0:
            raise ValueError("0 ≤ T_mid ≤ T_high ≤ 1 이어야 함")
        if self.n_paraphrase < 1:
            raise ValueError("n_paraphrase ≥ 1")
        if not 0.0 < self.vote_ratio <= 1.0:
            raise ValueError("vote_ratio ∈ (0, 1]")
        if not 0.0 <= self.llm_direct_confidence <= 1.0:
            raise ValueError("llm_direct_confidence ∈ [0, 1]")


def normalize(utterance: str) -> str:
    """전처리 — NFKC 정규화 + 이모지·제어문자 제거 + 공백 정리 (§2 [0]).

    오타 경량 교정은 사전이 필요해 본 유닛 범위 밖 (후속).
    """
    text = unicodedata.normalize("NFKC", utterance)
    kept = "".join(ch for ch in text if unicodedata.category(ch) not in _STRIP_CATEGORIES)
    return " ".join(kept.split())


@dataclass(frozen=True, slots=True)
class _Hit:
    """뱅크 매칭 1건 — closed-set 검증을 통과한 히트만 존재한다."""

    intent: Intent
    score: float
    entry_id: str
    slot_pattern: Mapping


def _fallback(reason: str) -> IntentMatch:
    """결정론 폴백 — 항상 같은 라벨·같은 형태. 사유는 반드시 싣는다 (INV-4)."""
    return IntentMatch(
        intent=Intent.OUT_OF_SCOPE,
        slots={},
        confidence=0.0,
        match_route=MatchRoute.FALLBACK,
        reason=reason,
    )


class IntentRouter:
    def __init__(
        self,
        embedding: EmbeddingPort,
        store: VectorStorePort,
        *,
        intent_gateway: GatewayFacade | None = None,
        paraphrase_gateway: GatewayFacade | None = None,
        config: IntentRouterConfig | None = None,
    ) -> None:
        self._embedding = embedding
        self._store = store
        self._intent_gateway = intent_gateway
        self._paraphrase_gateway = paraphrase_gateway
        self._cfg = config or IntentRouterConfig()

    # ── 공개 API ────────────────────────────────────────────────────────

    def route(self, utterance: str, trace_id: TraceId, now: datetime) -> IntentMatch:
        """자연어 → 의도·슬롯·신뢰도·매칭경로. 예외를 던지지 않는다 (INV-4)."""
        try:
            return self._route(utterance, trace_id, now)
        except Exception as e:  # 임베딩·스토어·게이트웨이 어디가 터져도 폴백으로 수렴
            return _fallback(f"router_error: {type(e).__name__}: {e}")

    # ── 3단 파이프라인 ──────────────────────────────────────────────────

    def _route(self, utterance: str, trace_id: TraceId, now: datetime) -> IntentMatch:
        text = normalize(utterance)
        if not text:
            return _fallback("empty_utterance")

        hits = self._match_bank(text)
        if not hits:
            return self._llm_direct(text, "bank_miss", trace_id, now)

        top = hits[0]
        agree = len(hits) == 1 or hits[1].intent is top.intent  # top2 없으면 혼재도 없다
        if top.score >= self._cfg.t_high and agree:
            return IntentMatch(
                intent=top.intent,
                slots=_extract_slots(text, top.slot_pattern),
                confidence=_clamp(top.score),
                match_route=MatchRoute.CONFIDENT,
            )
        if top.score >= self._cfg.t_mid:
            voted, why = self._vote(text, trace_id, now)
            if voted is not None:
                return voted
            return self._llm_direct(text, f"ambiguous → {why}", trace_id, now)
        return self._llm_direct(text, f"below_t_mid({top.score:.3f})", trace_id, now)

    # 1차 — 질문뱅크 임베딩 매칭 (LLM 0회)
    def _match_bank(self, text: str) -> tuple[_Hit, ...]:
        vector = self._embedding.embed(text)
        raw_hits = self._store.search(self._cfg.collection, vector, self._cfg.top_k)
        hits: list[_Hit] = []
        for hit in raw_hits:  # 스토어가 이미 score 내림차순 — 필터링은 순서를 보존한다
            payload = hit.payload if isinstance(hit.payload, Mapping) else {}
            intent = _payload_intent(payload)
            if intent is None:  # 뱅크 오염 방어 (INV-1) — closed-set 밖 라벨은 매칭 대상 아님
                continue
            pattern = payload.get("slot_pattern")
            hits.append(
                _Hit(
                    intent=intent,
                    score=hit.score,
                    entry_id=hit.item_id,
                    slot_pattern=pattern if isinstance(pattern, Mapping) else {},
                )
            )
        return tuple(hits)

    # 2차 — 유사질문 생성 + 재매칭 가중 투표 (AMBIGUOUS 전용)
    def _vote(
        self, text: str, trace_id: TraceId, now: datetime
    ) -> tuple[IntentMatch | None, str]:
        variants, why = self._paraphrase(text, trace_id, now)
        if variants is None:
            return None, why
        weights: dict[Intent, float] = {}
        best: dict[Intent, _Hit] = {}
        for query in (text, *variants):
            hits = self._match_bank(query)
            if not hits:
                continue
            top = hits[0]
            score = max(top.score, 0.0)  # 음수 코사인은 0 취급 — 득표율을 [0,1]로 유지
            weights[top.intent] = weights.get(top.intent, 0.0) + score
            if top.intent not in best or top.score > best[top.intent].score:
                best[top.intent] = top
        total = sum(weights.values())
        if total <= 0.0:
            return None, "vote_no_weight"
        # 동점은 라벨 사전순 — 같은 입력이면 항상 같은 승자 (결정론)
        winner, weight = min(weights.items(), key=lambda kv: (-kv[1], kv[0].value))
        ratio = weight / total
        if ratio < self._cfg.vote_ratio:
            return None, f"vote_ratio({ratio:.3f})"
        return (
            IntentMatch(
                intent=winner,
                slots=_extract_slots(text, best[winner].slot_pattern),
                confidence=_clamp(ratio),
                match_route=MatchRoute.VOTED,
            ),
            "",
        )

    def _paraphrase(
        self, text: str, trace_id: TraceId, now: datetime
    ) -> tuple[tuple[str, ...] | None, str]:
        if self._paraphrase_gateway is None:
            return None, "paraphrase_gateway_absent"
        try:
            result = self._paraphrase_gateway.call(
                LlmFeature.PARAPHRASE,
                {"utterance": text, "count": str(self._cfg.n_paraphrase)},
                None,
                trace_id,
                now,
            )
        except Exception as e:  # 설정 버그(프롬프트 미등록 등)도 라우팅을 죽이지 않는다
            return None, f"paraphrase_error: {type(e).__name__}: {e}"
        if result.is_fallback:
            return None, f"paraphrase_fallback: {result.error}"
        value = result.value
        if not isinstance(value, (tuple, list)) or not all(isinstance(v, str) for v in value):
            return None, "paraphrase_bad_shape"
        variants = tuple(v for v in (normalize(str(x)) for x in value) if v)
        if not variants:
            return None, "paraphrase_empty"
        return variants[: self._cfg.n_paraphrase], ""

    # 3차 — LLM 직접 분류 (UNKNOWN / 투표 실패)
    def _llm_direct(
        self, text: str, escalated_from: str, trace_id: TraceId, now: datetime
    ) -> IntentMatch:
        draft, why = self._classify(text, trace_id, now)
        if draft is None:
            return _fallback(f"{escalated_from} → {why}")
        confidence = (
            draft.confidence
            if draft.confidence is not None
            else self._cfg.llm_direct_confidence
        )
        return IntentMatch(
            intent=draft.intent,
            slots=dict(draft.slots),  # 3차는 슬롯을 함께 추출한다 (§2 [슬롯 추출])
            confidence=_clamp(confidence),
            match_route=MatchRoute.LLM_DIRECT,
            reason=f"escalated: {escalated_from}",
        )

    def _classify(
        self, text: str, trace_id: TraceId, now: datetime
    ) -> tuple[IntentDraft | None, str]:
        if self._intent_gateway is None:
            return None, "intent_gateway_absent"
        try:
            result = self._intent_gateway.call(
                LlmFeature.INTENT,
                {"utterance": text, "intents": _CLOSED_SET_LABELS},
                None,
                trace_id,
                now,
            )
        except Exception as e:
            return None, f"intent_error: {type(e).__name__}: {e}"
        if result.is_fallback:
            return None, f"intent_fallback: {result.error}"
        draft = result.value
        if not isinstance(draft, IntentDraft):
            return None, "intent_bad_shape"
        if draft.intent not in ROUTABLE_INTENTS:  # OUT_OF_SCOPE 분류 = 폴백 경로 (§5)
            return None, f"intent_not_routable({draft.intent.value})"
        return draft, ""


def _payload_intent(payload: Mapping) -> Intent | None:
    label = payload.get("intent")
    try:
        intent = Intent(label)
    except ValueError:
        return None
    return intent if intent in ROUTABLE_INTENTS else None


def _extract_slots(text: str, slot_pattern: Mapping) -> dict:
    """매칭된 대표 질문의 슬롯 패턴으로 규칙 추출 (§2 [슬롯 추출], §3.1 slot_pattern).

    지원 형식은 `"regex:<정규식>"` 1종. 형식이 다르거나 정규식이 깨졌으면 그 슬롯만 건너뛴다 —
    슬롯 추출 실패가 라우팅 자체를 죽이면 안 된다(의도는 이미 확정됐다).
    seed 뱅크에는 아직 slot_pattern이 없어 현재는 대부분 빈 dict가 나온다.
    """
    slots: dict = {}
    for name, rule in sorted(slot_pattern.items(), key=lambda kv: str(kv[0])):
        if not isinstance(name, str) or not isinstance(rule, str):
            continue
        if not rule.startswith(_REGEX_PREFIX):
            continue
        try:
            found = re.search(rule[len(_REGEX_PREFIX) :], text)
        except re.error:
            continue
        if found is not None:
            slots[name] = found.group(0)
    return slots


def _clamp(value: float) -> float:
    """부동소수 오차로 [0,1]을 살짝 벗어난 코사인·득표율을 경계로 되돌린다."""
    return min(1.0, max(0.0, float(value)))
