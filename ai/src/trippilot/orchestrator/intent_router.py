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

**관측 (TRIP-653)**: 단계 함수마다 LangSmith `@traceable` — `LANGSMITH_TRACING=true` 일 때만
발화 1건 = 트리 1개(1차 top-k 점수 · 2차 유사질문/득표율 · 3차 판정, 루트 metadata 에 임계값
3종)가 전송된다. 미설정이면 데코레이터는 함수를 그대로 통과시킨다(CI 외부 호출 0). 라우터는
아직 엔드포인트에 배선돼 있지 않으므로(TRIP-529) 발화는 `scripts/trace_intents.py` 가 넣어 준다.
트리에는 발화 **원문**과 LLM 변형이 그대로 실린다 — langsmith 는 **dev 그룹**이라 운영
이미지(`uv sync --no-dev`)에는 없고, 그 경우 아래 no-op 대역이 붙어 배포 환경에서는
트레이싱이 구조적으로 불가능하다(TRIP-656 — 발화 유출 가드를 의존성 부재로 보장).
배선 후 운영 관측이 필요해지면 의존성 승격 + 마스킹·샘플링(mlops-llmops-design §1.4)을
함께 결정한다. TracePort 를 대체하는 것이 아니라 튜닝용 병행이다.
"""

from __future__ import annotations

import functools
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

try:
    from langsmith import traceable
except ImportError:  # 운영 이미지(uv sync --no-dev)에는 langsmith 가 없다 (TRIP-656)

    def traceable(*_args, **_kwargs):  # type: ignore[misc] — langsmith.traceable no-op 대역
        """데코레이터 팩토리 계약 + `langsmith_extra` kwarg 흡수만 유지한다.

        흡수가 빠지면 route() 가 넘기는 langsmith_extra 가 `_route()` 로 새어
        TypeError — 계측 도입 리뷰가 지적한 함정. 계측은 개발·튜닝 전용(dev 그룹)이고,
        운영에서는 이 대역 덕에 트레이싱이 구조적으로 불가능하다(발화 유출 가드).
        """

        def _decorate(fn):
            @functools.wraps(fn)
            def _inner(*args, langsmith_extra=None, **kwargs):
                return fn(*args, **kwargs)

            return _inner

        if _args and callable(_args[0]) and not _kwargs:  # 베어 @traceable — 실물과 동형 지원
            return _decorate(_args[0])
        return _decorate

from trippilot.llm_gateway.gateway import GatewayFacade
from trippilot.domain.common import TraceId
from trippilot.orchestrator.arguments import extract_arguments  # noqa: I001
from trippilot.domain.dialogue import specs_of, tool_specs_json
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
# 3차 프롬프트에 실을 closed-set — **라벨 + 그 의도의 인자 스키마** (INV-1: 모델이 고를 수
# 있는 값 자체를 한정). 인자표에서 생성하므로(`tool_specs`) 손으로 적은 사본이 없다.
#
# 종전에는 라벨만 나열하고 슬롯은 의도 무관 3칸(date·category·constraint)을 받았다. 그 이름들은
# 인자표 어디에도 없어 **하류에서 전부 버려졌다** — 1·2차가 `extract_arguments` 로 표에 맞는
# 인자를 내는 동안 3차만 다른 모양을 내고 있었다 (FD §7 · prompts/intent.yaml v0.2.0).
_CLOSED_SET_LABELS = tool_specs_json()


@dataclass(frozen=True, slots=True)
class IntentRouterConfig:
    """판정 파라미터 (intent-matching-design §5 초기값 — 하드코딩 금지, 평가셋으로 튜닝)."""

    top_k: int = 5  # k
    # 1차 즉시 확정 임계. 0.88 → 0.82 (2026-09-02, 라벨 발화 30건 실측 — KURE-v1 기준
    # top1 ≥ 0.80 인 in-scope 발화는 전건 정답, 0.82 전환으로 LLM 호출 -30%·정확도 손실 0.
    # 관측된 최고점 오분류(범위 밖 발화가 뱅크 경계 문장에 0.783)와 여유 0.037 — 뱅크 검수 전 하한.
    t_high: float = 0.82
    t_mid: float = 0.75  # 2차 진입 하한
    # 1차 확정에 요구하는 **타 의도 최근접과의 점수 차이**. 0 이면 "top1 이 1등이기만 하면 확정"
    # 이 되어 동점 경계가 전부 새고, 크게 잡으면 확정이 안 난다. 근거는 §5 주석.
    intent_margin: float = 0.02
    n_paraphrase: int = 3  # 유사 질문 생성 수
    # 가중 투표 확정 임계. 0.60 → 0.80 (2026-09-08, 평가셋 88건 × 운영 배정 실측 — TRIP-678):
    # 득표율 분포가 1.0 / 0.73~0.76 양봉이고, 0.73~0.76 동률대의 투표 정답률은 3/5 인 반면 3차 LLM 은
    # 승격분 전건 정답. 0.80 이면 동률대가 전부 3차로 가 88/88(0.60 은 86/88), 비용은 LLM 호출 +16%.
    vote_ratio: float = 0.80
    collection: str = BANK_COLLECTION
    llm_direct_confidence: float = 0.5  # 3차 산출물에 confidence가 없을 때의 값
    # 전처리 후 받아들이는 발화 길이 상한. **없으면 임의 길이가 그대로 프롬프트에 실린다** —
    # 2·3차가 발화를 재질의·분류 프롬프트에 넣으므로 비용·지연이 입력에 비례하고, 긴 입력은
    # 지시문을 숨길 자리를 준다(프롬프트 인젝션). 실측: 뱅크 485 + 평가셋 87 문장의 최대가
    # 48자, p99 42자다. 500 은 그 열 배이고 백엔드 `replan_session.free_text`(varchar(500))와
    # 같은 값이라 경계 양쪽이 같은 상한을 쓴다. 초과는 **자르지 않고 거절**한다 —
    # 잘라 내면 뜻이 바뀐 발화를 사용자 것인 양 처리하게 된다(INV-4: 조용한 변형 금지).
    max_utterance_chars: int = 500

    def __post_init__(self) -> None:
        if self.top_k < 1:
            raise ValueError("top_k ≥ 1")
        if not 0.0 <= self.t_mid <= self.t_high <= 1.0:
            raise ValueError("0 ≤ T_mid ≤ T_high ≤ 1 이어야 함")
        if not 0.0 <= self.intent_margin <= 1.0:
            raise ValueError("intent_margin ∈ [0, 1]")
        if self.n_paraphrase < 1:
            raise ValueError("n_paraphrase ≥ 1")
        if not 0.0 < self.vote_ratio <= 1.0:
            raise ValueError("vote_ratio ∈ (0, 1]")
        if not 0.0 <= self.llm_direct_confidence <= 1.0:
            raise ValueError("llm_direct_confidence ∈ [0, 1]")
        if self.max_utterance_chars < 1:
            raise ValueError("max_utterance_chars ≥ 1")


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
            return self._route(
                utterance, trace_id, now,
                # 임계값을 루트 run 의 metadata 로 — LangSmith 에서 값별로 트리를 필터·비교한다.
                # 트레이싱이 꺼져 있으면 데코레이터가 이 인자를 삼키고 그대로 통과시킨다.
                langsmith_extra={"metadata": {
                    "t_high": self._cfg.t_high,
                    "t_mid": self._cfg.t_mid,
                    "vote_ratio": self._cfg.vote_ratio,
                    "intent_margin": self._cfg.intent_margin,
                }},
            )
        except Exception as e:  # 임베딩·스토어·게이트웨이 어디가 터져도 폴백으로 수렴
            return _fallback(f"router_error: {type(e).__name__}: {e}")

    # ── 3단 파이프라인 ──────────────────────────────────────────────────

    @traceable(name="intent.route")
    def _route(self, utterance: str, trace_id: TraceId, now: datetime) -> IntentMatch:
        text = normalize(utterance)
        if not text:
            return _fallback("empty_utterance")
        # 길이 상한 — 전처리 **뒤에** 잰다. 공백·제어문자를 잔뜩 섞어 상한을 우회하는 입력이
        # 정규화로 줄어든 뒤의 실제 길이로 판정되게 한다.
        if len(text) > self._cfg.max_utterance_chars:
            return _fallback(
                f"utterance_too_long({len(text)} > {self._cfg.max_utterance_chars})"
            )

        hits = self._match_bank(text)
        if not hits:
            return self._llm_direct(text, "bank_miss", trace_id, now)

        top = hits[0]
        if top.score >= self._cfg.t_high and _separated(hits, self._cfg.intent_margin):
            # 거부 앵커가 이겼다 = "우리 일이 아니다" 를 1차에서 확정한 것 — LLM 0회로 거절한다.
            # 문턱은 CONFIDENT 와 **같은 값**을 쓴다. 규칙을 하나 더 두면 둘이 따로 논다.
            if top.intent is Intent.OUT_OF_SCOPE:
                return _fallback(f"out_of_scope_anchor({top.entry_id}, {top.score:.3f})")
            return IntentMatch(
                intent=top.intent,
                slots=extract_arguments(text, specs_of(top.intent)),
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
    @traceable(name="intent.bank")
    def _match_bank(self, text: str) -> tuple[_Hit, ...]:
        vector = self._embedding.embed(text)
        raw_hits = self._store.search(self._cfg.collection, vector, self._cfg.top_k)
        hits: list[_Hit] = []
        for hit in raw_hits:  # 스토어가 이미 score 내림차순 — 필터링은 순서를 보존한다
            payload = hit.payload if isinstance(hit.payload, Mapping) else {}
            intent = _payload_intent(payload)
            if intent is None:  # 뱅크 오염 방어 (INV-1) — closed-set 밖 라벨은 매칭 대상 아님
                continue
            hits.append(_Hit(intent=intent, score=hit.score, entry_id=hit.item_id))
        return tuple(hits)

    # 2차 — 유사질문 생성 + 재매칭 가중 투표 (AMBIGUOUS 전용)
    @traceable(name="intent.vote")
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
        # 앵커를 뱅크에 실은 순간 **2차도 앵커를 뽑을 수 있게 됐다.** 투표가 "우리 일이 아니다" 로
        # 수렴한 것이니 거절이 맞다 — 그런데 VOTED 로 감싸면 IntentMatch 불변식
        # ("FALLBACK 경로 ⇔ OUT_OF_SCOPE 라벨")을 위반해 ValueError 가 난다.
        # 라우터가 그 예외를 잡아 폴백으로 바꾸므로 **결과는 우연히 맞고 사유만 router_error** 가 된다
        # — 거절 표지가 없어 채점에서 '비거절 폴백'(= 인프라 실패)으로 잡히는 조용한 오염이었다.
        if winner is Intent.OUT_OF_SCOPE:
            return _fallback(f"out_of_scope_anchor(vote {ratio:.3f}, {best[winner].entry_id})"), ""
        return (
            IntentMatch(
                intent=winner,
                slots=extract_arguments(text, specs_of(winner)),
                confidence=_clamp(ratio),
                match_route=MatchRoute.VOTED,
            ),
            "",
        )

    @traceable(name="intent.paraphrase")
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
    @traceable(name="intent.llm_direct")
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
            # 3차는 슬롯을 함께 추출한다 (§2 [슬롯 추출]). 1·2차는 규칙 추출기를 쓰지만
            # 여기는 **이미 LLM 을 부르고 있으므로** 같은 호출에서 받는다 — 비용이 같고,
            # 규칙이 못 뽑는 종류(REGION·PLACE_REF·SLOT_REF·FREE_TEXT)까지 닿는다 (FD §3).
            # 이름·어휘는 게이트가 인자표로 검사해 세 경로의 산출이 같은 모양이 된다.
            slots=dict(draft.slots),
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


def _separated(hits: tuple[_Hit, ...], margin: float) -> bool:
    """1차 확정 조건 — top1 이 **다른 의도의 최근접보다 `margin` 만큼 앞서는가**.

    종전에는 "top2 가 top1 과 같은 의도인가" 를 봤다. 뱅크가 커지면 같은 의도 이웃이 빽빽해지는
    만큼 타 의도 이웃도 가까워져 top2 가 우연히 타 의도인 일이 흔해지고, **밀도가 올라가는데
    확정률은 떨어지는** 역전이 난다. 반대로 top2 가 같은 의도이기만 하면 top3 에 바짝 붙은 타
    의도를 못 봤다. 둘 다 "top2 하나만 본다" 는 데서 온 문제다.

    그래서 순위가 아니라 거리를 본다: 타 의도 중 제일 가까운 것과의 차이가 margin 이상이면 확정.
    top-k 전부가 같은 의도면 경쟁자가 없으니 확정(종전 `len(hits) == 1` 경로를 포함한다).
    동점 근처(차이 ~0)는 의도가 실제로 갈리는 자리이므로 2·3차로 넘긴다.
    """
    top = hits[0]
    rival = next((h.score for h in hits[1:] if h.intent is not top.intent), None)
    return rival is None or (top.score - rival) >= margin


def _payload_intent(payload: Mapping) -> Intent | None:
    label = payload.get("intent")
    try:
        intent = Intent(label)
    except ValueError:
        return None
    # 거부 앵커(OUT_OF_SCOPE)도 매칭 대상이다 — 그것이 앵커의 존재 이유다.
    return intent if (intent in ROUTABLE_INTENTS or intent is Intent.OUT_OF_SCOPE) else None


def _clamp(value: float) -> float:
    """부동소수 오차로 [0,1]을 살짝 벗어난 코사인·득표율을 경계로 되돌린다."""
    return min(1.0, max(0.0, float(value)))
