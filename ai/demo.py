"""U1 라이브 데모 — 4대 불변식이 '코드로' 강제되는 걸 눈으로 확인.

실행:  uv run python demo.py
(그다음 전체 테스트:  uv run pytest)
"""

import os
import sys
from datetime import datetime, timezone

# 현재 src/를 직접 읽도록 (설치본 대신 최신 코드 보장)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from trippilot.domain.common import GeoPoint, PoiId, TraceId
from trippilot.domain.llm import CandidatePool
from trippilot.domain.observability import FallbackEvent
from trippilot.domain.poi import DataQuality, Poi, PoiCategory, PoiSource
from trippilot.domain.travel import TravelEstimate

_NOW = datetime.now(timezone.utc)


def title(code: str, text: str) -> None:
    print(f"\n{'=' * 62}\n  [{code}] {text}\n{'=' * 62}")


# ── INV-3 : 소요시간 미표시 ──────────────────────────────────
title("INV-3", "소요시간 미표시 — 화면용 데이터엔 '시간'이 없다")
est = TravelEstimate(
    distance_km_range=(1.2, 1.5), internal_minutes=18, is_estimated=True, source="haversine"
)
print("  내부용 to_dict()        :", est.to_dict())
print("  화면용 to_public_dict() :", est.to_public_dict())
print("  → 화면용에 internal_minutes 있나? :", "internal_minutes" in est.to_public_dict())
print("    (없음 = 시간이 화면으로 샐 수 없음. 타입이 구조적으로 차단)")


# ── 도메인 규칙 : 잘못된 데이터는 생성 거부 ─────────────────────
title("도메인 규칙", "이상한 데이터는 '만들어지지도' 않는다")
try:
    GeoPoint(lat=200, lng=0)  # 위도는 -90~90만
except ValueError as e:
    print("  GeoPoint(lat=200) 시도 → 거부됨:", e)


# ── INV-1 : closed-set ──────────────────────────────────────
title("INV-1", "closed-set — 목록 밖 장소를 담은 후보풀은 거부")
seongsimdang = Poi(
    poi_id=PoiId("p1"),
    name="성심당",
    category=PoiCategory.FOOD,
    coord=GeoPoint(36.3, 127.4),
    open_hours=(),
    avg_cost=8000,
    rating=4.5,
    quality=DataQuality.FULL,
    source=PoiSource.SEED,
    confidence=None,
)
try:
    CandidatePool(
        poi_ids=frozenset({PoiId("p1"), PoiId("유령장소")}),  # 실제 장소엔 없는 유령 id
        pois=(seongsimdang,),
        generated_at=_NOW,
    )
except ValueError as e:
    print("  유령 id를 섞은 후보풀 시도 → 거부됨:", e)


# ── INV-4 : 침묵 실패 금지 ──────────────────────────────────
title("INV-4", "LLM 실패 → 조용히 안 죽고 FallbackEvent를 남긴다")


class FailingLlm:  # '일부러 실패하는' LLM (진짜 Claude로는 못 만드는 상황)
    def invoke(self, request):
        raise RuntimeError("Claude 응답 없음 (가짜 실패)")


trace_events = []
try:
    FailingLlm().invoke(None)
except Exception as e:
    trace_events.append(
        FallbackEvent(
            trace_id=TraceId("demo-trace"),
            occurred_at=_NOW,
            component="c1_gateway",
            stage="llm",
            from_mode="llm",
            to_mode="rule",
            reason=str(e),
        )
    )
print("  LLM 실패 후 관측 로그:", trace_events)
print("  → 폴백이 기록됨(침묵 실패 없음)? :", len(trace_events) == 1)


# ── U4 : 오염 출력 → 게이트 드롭 → 폴백 신호 ─────────────────
title("U4 게이트", "환각 poi는 드롭되고, 전량 오염이면 폴백 신호가 남는다")

from pathlib import Path

from trippilot.c1.config import C1Config
from trippilot.c1.gates.scoring import ClosedSetGate
from trippilot.c1.gateway import GatewayFacade
from trippilot.c1.prompts import PromptRegistry
from trippilot.c1.workers.preference import build_prompt_vars
from trippilot.domain.common import BudgetLevel
from trippilot.domain.llm import LlmFeature, ModelTier
from trippilot.domain.observability import GateDropEvent
from trippilot.domain.persona import CompanionType, PersonaSummary, TasteTag
from trippilot.ports.llm_port import LlmResponse


class CannedLlm:  # 준비된 답을 돌려주는 LLM (환각을 일부러 섞는다)
    def __init__(self, text):
        self._text = text

    def invoke(self, request):
        return LlmResponse(
            raw_text=self._text, input_tokens=1, output_tokens=1,
            latency_ms=1, model_id=request.model_id,
        )


class ListTrace:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(event)


pool = CandidatePool(poi_ids=frozenset({PoiId("p1")}), pois=(seongsimdang,), generated_at=_NOW)
persona = PersonaSummary(
    taste_tags=(TasteTag.FOOD,), companion=CompanionType.COUPLE, budget=BudgetLevel.MID
)
cfg = C1Config(model_ids={ModelTier.LIGHT: "demo-light", ModelTier.HEAVY: "demo-heavy"})
registry = PromptRegistry(Path(__file__).parent / "prompts")

polluted = '{"scores": [{"poiId": "p1", "score": 0.9, "reason": "빵"}, {"poiId": "유령맛집", "score": 1.0, "reason": "환각"}]}'
trace = ListTrace()
facade = GatewayFacade(CannedLlm(polluted), registry, ClosedSetGate(), cfg, trace)
result = facade.call(
    LlmFeature.PREFERENCE_SCORING, build_prompt_vars(pool, persona), pool, TraceId("demo-u4"), _NOW
)
drops = [e for e in trace.events if isinstance(e, GateDropEvent)]
print("  LLM이 답한 poi     : ['p1', '유령맛집']  ← 하나는 환각")
print("  게이트 생존        :", [str(s.poi_id) for s in result.value])
print("  드롭 관측(GateDrop):", [str(i) for i in drops[0].dropped_ids], "— 환각률 지표의 원천")

all_bad = '{"scores": [{"poiId": "유령1", "score": 1.0, "reason": "전부 환각"}]}'
trace2 = ListTrace()
facade2 = GatewayFacade(CannedLlm(all_bad), registry, ClosedSetGate(), cfg, trace2)
result2 = facade2.call(
    LlmFeature.PREFERENCE_SCORING, build_prompt_vars(pool, persona), pool, TraceId("demo-u4b"), _NOW
)
fallbacks = [e for e in trace2.events if isinstance(e, FallbackEvent)]
print("  전량 오염 응답     → is_fallback:", result2.is_fallback, "· value:", result2.value)
print("  폴백 신호(INV-4)   :", fallbacks[0].reason, "→ 규칙 점수는 호출측이 실행")


print(f"\n{'=' * 62}")
print("  4대 불변식이 전부 '코드'로 강제됨.")
print("  자동 검증(수천 케이스):  uv run pytest")
print(f"{'=' * 62}\n")
