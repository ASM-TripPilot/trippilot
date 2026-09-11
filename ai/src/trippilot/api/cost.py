"""LLM 호출 비용 집계 — **소비 측** (domain/observability.py: "단가는 소비 측, 도메인엔 안 둠").

도메인의 `LlmCallRecord` 는 토큰 수와 지연만 싣는다. 단가는 벤더·계약·시점의 함수라
도메인 불변식이 아니고, 코드에 박으면 가격이 바뀔 때마다 배포가 필요하다. 그래서
여기서 **설정으로** 읽는다 (BR-U4-08 "model_id 는 항상 설정값"과 같은 취지):

    TRIPPILOT_LLM_PRICE_FILE=/etc/trippilot/llm-prices.json   (우선)
    TRIPPILOT_LLM_PRICES='{"currency": "USD", "models": {...}}'   (인라인 JSON)

형식 — 단가는 **100만 토큰당**, 통화는 운영자 소유(계산에 안 쓰이고 그대로 실린다):

    {
      "currency": "USD",
      "models": {
        "claude-haiku-4-5": {"input": 1.0,  "output": 5.0},
        "gpt-5.6-sol":      {"input": 1.25, "output": 10.0}
      }
    }

키는 `LlmCallRecord.model_id` 와 **정확히 같은 문자열**이다 — 그 값은 `C1Config`
(model_ids·feature_models·retry_models)가 준 이름이라 단가표도 같은 이름으로 적으면
된다. 접두어 매칭 같은 건 하지 않는다: 날짜 접미가 붙은 모델을 뭉뚱그리면 어느
단가로 셌는지 사후에 알 수 없다.

**지어내지 않는다** (INV-4 취지 — 침묵 금지):
- 단가 미설정 → 집계 자체가 꺼진다(`from_env()` 가 None). "비용 0" 이 아니라 "모름".
- 단가표에 없는 model_id → `call_cost: null` + `unpriced_calls` 증가. 0 으로 세면
  "공짜로 돌았다"는 거짓이 합계에 그대로 섞인다.
- 설정이 깨졌으면 조용히 무시하지 않고 예외로 **기동 실패** (MiddlewareSettings 동형).

요청당 집계: `trace_id` 별 누계. 이 계층은 요청 종료를 모르므로 종료 이벤트 대신
**호출마다 누계를 함께 싣는다** — 한 trace_id 의 마지막 `llm_cost` 줄이 그 요청의 총액이다.

# ponytail: 프로세스 로컬 dict 누계(단일 컨테이너 전제 — preference_cache 와 같은 한계).
# 다중 인스턴스로 가면 누계는 로그 수집 쪽에서 trace_id 로 합치는 것이 맞다.
"""

from __future__ import annotations

import json
import os
from collections import OrderedDict
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from trippilot.domain.observability import LlmCallRecord

PRICE_FILE_ENV = "TRIPPILOT_LLM_PRICE_FILE"
PRICES_ENV = "TRIPPILOT_LLM_PRICES"

_PER_TOKENS = 1_000_000  # 단가 기준 단위 — 두 벤더 공시가 모두 100만 토큰당이다
_DEFAULT_CURRENCY = "USD"
_MAX_TRACES = 1024  # 누계 보관 상한 — 초과 시 오래된 trace 부터 버린다(LRU)


class PriceConfigError(ValueError):
    """단가 설정 형식 오류 — 데이터/설정 버그라 폴백 대상이 아니다(기동 실패)."""


@dataclass(frozen=True, slots=True)
class ModelPrices:
    """model_id → (입력 단가, 출력 단가). 단가는 100만 토큰당."""

    currency: str
    per_million: Mapping[str, tuple[float, float]]

    def cost(self, model_id: str, input_tokens: int, output_tokens: int) -> float | None:
        """단가표에 없는 모델은 None — 0 이 아니다(모르는 것과 공짜는 다르다)."""
        price = self.per_million.get(model_id)
        if price is None:
            return None
        return (input_tokens * price[0] + output_tokens * price[1]) / _PER_TOKENS


def parse_prices(raw: object) -> ModelPrices:
    """파싱된 JSON → ModelPrices. 형식 위반은 전부 PriceConfigError."""
    if not isinstance(raw, Mapping):
        raise PriceConfigError(f"루트가 객체가 아님 ({type(raw).__name__})")
    currency = raw.get("currency", _DEFAULT_CURRENCY)
    if not isinstance(currency, str) or not currency.strip():
        raise PriceConfigError(f"currency 는 비어있지 않은 문자열: {currency!r}")
    models = raw.get("models")
    if not isinstance(models, Mapping) or not models:
        raise PriceConfigError("models 가 비어있거나 객체가 아님")
    table: dict[str, tuple[float, float]] = {}
    for model_id, entry in models.items():
        if not isinstance(model_id, str) or not model_id:
            raise PriceConfigError(f"model_id 가 문자열이 아님: {model_id!r}")
        if not isinstance(entry, Mapping):
            raise PriceConfigError(f"{model_id}: 단가가 객체가 아님")
        prices = []
        for key in ("input", "output"):
            value = entry.get(key)
            # bool 은 int 의 하위형 — True 를 단가 1 로 읽으면 오타가 조용히 통과한다
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise PriceConfigError(f"{model_id}.{key}: 숫자 필요 (got {value!r})")
            if value < 0:
                raise PriceConfigError(f"{model_id}.{key}: 음수 단가 {value}")
            prices.append(float(value))
        table[model_id] = (prices[0], prices[1])
    return ModelPrices(currency=currency.strip(), per_million=table)


def load_prices(env: Mapping[str, str] | None = None) -> ModelPrices | None:
    """env → 단가표. 둘 다 미설정(빈 문자열 포함)이면 None = 집계 비활성."""
    source = os.environ if env is None else env
    path = source.get(PRICE_FILE_ENV) or None
    if path is not None:
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except OSError as e:
            raise PriceConfigError(f"{PRICE_FILE_ENV}={path} 읽기 실패: {e}") from e
        except ValueError as e:
            raise PriceConfigError(f"{PRICE_FILE_ENV}={path} JSON 파싱 실패: {e}") from e
        return parse_prices(raw)
    inline = source.get(PRICES_ENV) or None
    if inline is None:
        return None
    try:
        return parse_prices(json.loads(inline))
    except ValueError as e:
        raise PriceConfigError(f"{PRICES_ENV} 해석 실패: {e}") from e


class CostLedger:
    """LlmCallRecord → 호출 비용 + trace_id 별 누계."""

    def __init__(self, prices: ModelPrices, *, max_traces: int = _MAX_TRACES) -> None:
        if max_traces < 1:
            raise ValueError("max_traces ≥ 1")
        self._prices = prices
        self._max = max_traces
        # trace_id → (누계, 단가 미상 호출 수). OrderedDict = LRU.
        self._totals: OrderedDict[str, tuple[float, int]] = OrderedDict()

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "CostLedger | None":
        """단가 미설정이면 None — 호출측은 그때 비용 줄을 아예 남기지 않는다."""
        prices = load_prices(env)
        return None if prices is None else cls(prices)

    def add(self, record: LlmCallRecord) -> dict:
        """호출 1건 반영 → 로그로 실을 집계 항목.

        `call_cost` null 은 단가표에 없는 모델이라는 뜻이고, 그 경우
        `unpriced_calls` 가 오른다 — `request_cost` 는 그만큼 **하한**이다.
        실패한 호출(success=False)도 토큰을 썼으면 그대로 센다.
        """
        call_cost = self._prices.cost(
            record.model_id, record.input_tokens, record.output_tokens
        )
        key = str(record.trace_id)
        total, unpriced = self._totals.get(key, (0.0, 0))
        total += call_cost or 0.0
        unpriced += 1 if call_cost is None else 0
        self._totals[key] = (total, unpriced)
        self._totals.move_to_end(key)
        while len(self._totals) > self._max:
            self._totals.popitem(last=False)
        return {
            "event": "llm_cost",
            "trace_id": key,
            "feature": record.feature,
            "model_id": record.model_id,
            "success": record.success,
            "input_tokens": record.input_tokens,
            "output_tokens": record.output_tokens,
            "latency_ms": record.latency_ms,
            "currency": self._prices.currency,
            "call_cost": call_cost,
            "request_cost": total,
            "unpriced_calls": unpriced,
        }
