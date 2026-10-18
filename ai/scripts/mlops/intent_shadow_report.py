"""섀도 측정 집계 — `intent_shadow` 로그 줄 → 마크다운 (assistant-orchestrator FD BLM §9.3 · DE §5 · spec SC-006 · T027).

stdin: AI 파드 로그(`aws-dev-logs.yml` component=ai pattern=intent_shadow → `ai.filtered.log`) 또는 `sed -n 's/.*intent_shadow //p'`
로 JSON 만 남긴 줄. 어느 쪽이든 먹는다 — 줄 안의 `intent_shadow {json}` 을 `ShadowRecord.from_dict` 로 읽고,
`intent_shadow_skipped {json}` 은 사유별 분모로, `intent_shadow_error` 는 섀도 실패 수로 센다. 깨진 줄은 세고 넘어간다.

집계기를 새로 만들지 않는다 — 줄마다 `Sample(label=Intent(service.intent), match=IntentMatch(shadow…), latency_ms=shadow.latency_ms)`
를 만들어 `intent_eval.score()`/`format_report()` 에 넣는다: correct=일치 수 · confusions=불일치 쌍(경계 3종 표시) · routes=섀도 경로
비중 · unrefused_fallbacks=섀도 인프라 실패(일치로 세지 않는다) · p95_ms=섀도 지연. **라벨이 없으므로 '정확도'는 일치율로 읽는다**
(서비스 판정이 라벨 자리). 덧붙이는 열: 섀도 LLM 호출 합(겹침 시 상한값 — BLM §9.1), skip 수·사유, `meta` 단일성(섞였으면 경고).
**최소 2회 측정**(`ai/data/README.md`) 뒤에만 판정한다. 로그에 발화 원문이 없으므로 `Sample.utterance` 는 빈 문자열이다(SEC-U8-06).

실행: `sed -n 's/.*intent_shadow //p' ai.filtered.log | uv run python scripts/mlops/intent_shadow_report.py`
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field

from trippilot.domain.intent import Intent, IntentMatch, MatchRoute
from trippilot.orchestrator.intent_eval import Sample, format_report, score
from trippilot.orchestrator.shadow_probe import ShadowRecord, ShadowSide

_RECORD = "intent_shadow {"
_SKIPPED = "intent_shadow_skipped {"
_ERROR = "intent_shadow_error {"


# 배포 smoke 의 도우미 한 턴(deploy/eks/runtime_smoke.report_ai_dialogue — request_id·trace_id 가 `smoke-…`)은 같은 발화를
# 배포마다 되풀이하므로 측정에서 뺀다. 뺀 수는 `smoke_skipped` 로 따로 보인다.
_SMOKE_TRACE_PREFIX = "smoke-"


@dataclass
class Parsed:
    records: list[ShadowRecord] = field(default_factory=list)
    skips: Counter = field(default_factory=Counter)  # why → 건수
    errors: int = 0
    malformed: int = 0
    smoke_skipped: int = 0


def _json_after(line: str, marker: str) -> dict:
    return json.loads(line[line.index(marker) + len(marker) - 1:])


def _match(side: ShadowSide) -> IntentMatch:
    return IntentMatch(Intent(side.intent), {}, side.confidence, MatchRoute(side.route), side.reason)


def parse(lines: Iterable[str]) -> Parsed:
    out = Parsed()
    for line in lines:
        try:
            if _SKIPPED in line:
                out.skips[str(_json_after(line, _SKIPPED).get("why", "?"))] += 1
            elif _ERROR in line:
                out.errors += 1
            elif _RECORD in line:
                record = ShadowRecord.from_dict(_json_after(line, _RECORD))
                _match(record.shadow)  # 변환 불가(enum 밖 값 등)면 여기서 던져 깨진 줄로 센다
                if str(record.trace_id).startswith(_SMOKE_TRACE_PREFIX):
                    out.smoke_skipped += 1
                    continue
                out.records.append(record)
        except Exception:  # noqa: BLE001 — 한 줄이 깨졌다고 집계가 죽지 않는다
            out.malformed += 1
    return out


def samples(records: Iterable[ShadowRecord]) -> list[Sample]:
    return [
        Sample(label=Intent(r.service.intent), utterance="", match=_match(r.shadow), latency_ms=float(r.shadow.latency_ms))
        for r in records
    ]


def render(parsed: Parsed) -> str:
    report = score(samples(parsed.records))
    n = report.total
    skips = sum(parsed.skips.values())
    skip_detail = f" ({', '.join(f'{why} {k}' for why, k in sorted(parsed.skips.items()))})" if parsed.skips else ""
    meta_kinds = {json.dumps(dict(r.meta), sort_keys=True, ensure_ascii=False) for r in parsed.records}
    lines = [
        "## 의도 섀도 측정 — 서비스(LLM 직접 분류) vs 섀도(3단 뱅크 라우터)",
        "",
        "> 라벨이 없다 — 아래 '정확도'는 서비스 판정을 라벨 자리에 놓은 **일치율**이고, 불일치가 곧 섀도의 오답은 아니다. "
        "**최소 2회 측정** 뒤에만 좋다/나쁘다를 말한다(ai/data/README.md — 실행마다 ±1 흔들린다).",
        "",
        f"intent_shadow 줄 {n} · skip {skips}{skip_detail} · 섀도 실패 {parsed.errors} · 깨진 줄 {parsed.malformed}"
        f" · 배포 smoke 제외 {parsed.smoke_skipped}",
        f"일치율 {report.correct}/{n} = {report.accuracy:.1%} · 섀도 LLM 호출 합 {sum(r.shadow.llm_calls for r in parsed.records)}"
        " (풀 겹침 시 상한값 — 건별 귀속은 llm_cost 의 `:shadow` 접미로)",
        "",
        "```",
        format_report(report),
        "```",
    ]
    if len(meta_kinds) > 1:
        lines += ["", f"⚠ meta {len(meta_kinds)}종이 섞였다 — 조건(뱅크·임계·프롬프트 판본)이 바뀐 전후 기록은 한 집계에 넣지 않는다(DE §5)."]
    elif meta_kinds:
        lines += ["", f"측정 조건: `{next(iter(meta_kinds))}`"]
    return "\n".join(lines)


if __name__ == "__main__":
    print(render(parse(sys.stdin)))
