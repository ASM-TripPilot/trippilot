"""섀도 측정 집계기 `scripts/mlops/intent_shadow_report.py` (assistant-orchestrator T027 · BLM §9.3 · spec SC-006).

로그 줄은 손으로 흉내 내지 않는다 — 실물 `ShadowRecord.to_json()` 이 찍는 줄을 그대로 먹인다(거울은 실물과 같아야 한다).
증명하는 것: ① `intent_shadow {json}` 줄만 골라 `intent_eval.score` 로 일치율·경로 비중·p95·불일치 쌍을 낸다(새 집계기 없음)
② `intent_shadow_skipped` 는 사유별 분모로 센다 ③ 섀도 LLM 호출 합 ④ `meta` 가 한 값이 아니면 경고 ⑤ 머리말 "최소 2회 측정"
⑥ 깨진 줄은 세고 넘어간다(집계가 통째로 죽지 않는다) ⑦ 서비스가 거절(OUT_OF_SCOPE)한 턴은 섀도의 거절 폴백을 일치로 센다.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
from pathlib import Path

from trippilot.domain.intent import Intent, IntentMatch, MatchRoute
from trippilot.orchestrator.shadow_probe import ShadowRecord, ShadowSide

_spec = importlib.util.spec_from_file_location(
    "intent_shadow_report", Path(__file__).resolve().parents[2] / "scripts" / "mlops" / "intent_shadow_report.py"
)
report = importlib.util.module_from_spec(_spec)
sys.modules["intent_shadow_report"] = report
_spec.loader.exec_module(report)

_META = {"bank_sha": "f1104f0b83d0", "t_high": 0.82, "t_mid": 0.75, "vote_ratio": 0.8, "intent_margin": 0.02,
         "intent_prompt": "prompts/dialogue_intent.yaml@0.1.0", "shadow_prompt": "prompts/intent.yaml@0.2.0"}


def _side(match: IntentMatch, *, llm_calls: int, latency_ms: int, keep_reason: bool = True) -> ShadowSide:
    return ShadowSide.from_match(match, llm_calls=llm_calls, latency_ms=latency_ms, keep_reason=keep_reason)


def _line(trace_id: str, service: IntentMatch, shadow: IntentMatch, *, shadow_calls: int, shadow_ms: int,
          meta: dict = _META) -> str:
    record = ShadowRecord(
        trace_id=trace_id, turn_index=3,
        service=_side(service, llm_calls=1, latency_ms=1650, keep_reason=False),
        shadow=_side(shadow, llm_calls=shadow_calls, latency_ms=shadow_ms),
        utterance_chars=11, utterance_sha12="3f9a3f9a3f9a", meta=meta,
    )
    # 실제 파드 로그 모양 — 로거 접두 뒤에 `intent_shadow {json}` (aws-dev-logs 의 pattern 이 거르는 줄)
    return f"2026-10-18 09:00:00,000 INFO trippilot.intent.shadow intent_shadow {record.to_json()}"


_W = IntentMatch(Intent.GET_WEATHER, {}, 0.9, MatchRoute.LLM_DIRECT)
_W_BANK = IntentMatch(Intent.GET_WEATHER, {}, 0.91, MatchRoute.CONFIDENT)
_NEXT = IntentMatch(Intent.GET_NEXT_SLOT, {}, 0.88, MatchRoute.LLM_DIRECT)
_REFUSED = IntentMatch(Intent.OUT_OF_SCOPE, {}, 0.0, MatchRoute.FALLBACK, reason="intent_fallback: not_classifiable: null")
_INFRA = IntentMatch(Intent.OUT_OF_SCOPE, {}, 0.0, MatchRoute.FALLBACK, reason="intent_fallback: timeout: 2.5s")

_LINES = (
    _line("r-1", _W, _W_BANK, shadow_calls=0, shadow_ms=38),  # 일치 — 뱅크 1차(LLM 0)
    _line("r-2", _NEXT, _W, shadow_calls=1, shadow_ms=1200),  # 불일치 쌍 GET_NEXT_SLOT → GET_WEATHER
    _line("r-3", _REFUSED, _REFUSED, shadow_calls=1, shadow_ms=900),  # 둘 다 거절 — 일치로 센다
    '2026-10-18 09:00:01,000 INFO trippilot.intent.shadow intent_shadow_skipped {"event":"intent_shadow_skipped","trace_id":"r-4","why":"saturated"}',
    '2026-10-18 09:00:02,000 INFO trippilot.wiring http_request {"event":"http_request","path":"/health"}',  # 무관한 줄
    "intent_shadow {not json at all",  # 깨진 줄 — 세고 넘어간다
)


def _run(lines=_LINES) -> str:
    return report.render(report.parse(io.StringIO("\n".join(lines) + "\n")))


def test_report_scores_agreement_routes_p95_and_confusions_from_real_log_lines() -> None:
    out = _run()
    assert "최소 2회 측정" in out  # 머리말 규약(ai/data/README.md — 실행마다 ±1 흔들린다)
    assert "일치율 2/3" in out  # 라벨이 없으므로 정확도가 아니라 일치율 — 거절 ↔ 거절도 일치
    assert "CONFIDENT 1" in out and "LLM_DIRECT 1" in out and "FALLBACK 1" in out  # 섀도 경로 비중
    assert "p95 1200ms" in out  # 섀도 지연 p95 (정렬 ceil(0.95·3)−1 = 두 번째)
    assert "GET_NEXT_SLOT → GET_WEATHER ×1" in out  # 불일치 쌍
    assert "섀도 LLM 호출 합 2" in out
    assert "skip 1" in out and "saturated 1" in out  # 분모
    assert "깨진 줄 1" in out
    assert "⚠" not in out  # meta 가 한 값


def test_mixed_measurement_conditions_are_flagged() -> None:
    other = {**_META, "bank_sha": "deadbeef0000"}
    out = _run((_LINES[0], _line("r-9", _W, _W_BANK, shadow_calls=0, shadow_ms=40, meta=other)))
    assert "⚠" in out and "meta 2종" in out  # 조건이 다른 기록은 한 집계에 섞이면 안 된다


def test_shadow_infra_failure_is_not_counted_as_agreement() -> None:
    out = _run((_line("r-7", _W, _INFRA, shadow_calls=1, shadow_ms=2500),))
    assert "일치율 0/1" in out and "비거절 폴백 1" in out  # 장애를 일치로 세면 비율이 부풀려진다(intent_eval 규칙)


def test_empty_input_renders_without_crashing() -> None:
    out = _run(())
    assert "intent_shadow 줄 0" in out and "최소 2회 측정" in out


def test_samples_mirror_the_eval_shape() -> None:
    parsed = report.parse(io.StringIO(_LINES[0] + "\n"))
    (sample,) = report.samples(parsed.records)
    assert sample.label is Intent.GET_WEATHER and sample.match.match_route is MatchRoute.CONFIDENT
    assert sample.latency_ms == 38 and sample.utterance == ""  # 원문은 로그에 없다 — 빈 문자열(SEC-U8-06)
    assert json.loads(_LINES[0].split("intent_shadow ", 1)[1])["agree"] is True


def test_deploy_smoke_turns_are_left_out_of_the_measurement() -> None:
    """배포 smoke 의 도우미 한 턴(trace_id `smoke-…`)은 배포마다 같은 발화라 측정에서 빼고, 뺀 수는 따로 보인다."""
    smoke = _line("smoke-0123456789ab", _NEXT, _W, shadow_calls=1, shadow_ms=900)
    parsed = report.parse([*_LINES, smoke])
    assert [r.trace_id for r in parsed.records] == ["r-1", "r-2", "r-3"]
    assert parsed.smoke_skipped == 1
    assert "배포 smoke 제외 1" in report.render(parsed)
