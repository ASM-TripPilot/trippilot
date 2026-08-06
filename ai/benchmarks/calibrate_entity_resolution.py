"""U3-03 — 엔티티 해소 임계 캘리브레이션 하네스 (TRIP-252, business-rules §3).

임계 초기값(AUTO ≥ 0.85 / CONFIRM ≥ 0.60)은 remote config 주입값이고
캘리브레이션은 후속 과제다. 실데이터가 없는 현 단계의 산출물은 하네스:
라벨 케이스셋(entity_resolution_cases.py)에 임계 (auto, confirm) 격자를 스윕해
오자동병합(false-AUTO)·과잉확인(불필요 CONFIRM)·미해소를 표로 낸다.

- 완전 결정론: fuzzy_match 공개 API만 사용, 난수 0 — 같은 입력 → 같은 표.
- 임계 초기값은 여기서 바꾸지 않는다 — 실데이터 확보 후 이 하네스로 재평가.

실행: cd ai && uv run python -m benchmarks.calibrate_entity_resolution

판정 어휘 (케이스 라벨 × resolver 판정):
  auto_ok       AUTO가 정답 POI      — 최선
  false_auto    AUTO가 오답/다른 장소 — 오자동병합 (최악, 조용히 틀림)
  over_confirm  정답인데 CONFIRM     — 불필요 확인 (마찰 비용)
  confirm_guard 오답/부재에 CONFIRM  — 방어적 확인 (사용자 기각, 허용)
  miss          정답 있는데 UNRESOLVED — 미해소 (웹 소싱 낭비)
  unresolved_ok 정답 없고 UNRESOLVED — 올바른 위임
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import NamedTuple, Sequence

from trippilot.domain.common import GeoPoint, PoiId
from trippilot.domain.m7 import MatchDecision
from trippilot.domain.poi import DataQuality, OpenHour, Poi, PoiCategory, PoiSource
from trippilot.m7.config import M7Config
from trippilot.m7.entity_resolver import fuzzy_match

from benchmarks.data.entity_resolution_cases import CASES, ResolutionCase

# 스윕 격자 — 초기값 (0.85, 0.60) 포함 (config.py match_auto/match_confirm)
AUTO_GRID = (0.70, 0.75, 0.80, 0.85, 0.90, 0.95)
CONFIRM_GRID = (0.50, 0.55, 0.60, 0.65, 0.70)
BASELINE_AUTO, BASELINE_CONFIRM = 0.85, 0.60

_COORD = GeoPoint(37.751, 128.876)          # 매칭에 무관한 고정 좌표
_HOURS = (OpenHour(0, 540, 1260),)


def _to_poi(poi_id: str, name: str) -> Poi:
    """이름 매칭만 보는 하네스 — 나머지 속성은 유효한 고정값."""
    return Poi(PoiId(poi_id), name, PoiCategory.ETC, _COORD, _HOURS,
               None, None, DataQuality.FULL, PoiSource.SEED, None)


@dataclass(frozen=True, slots=True)
class CaseOutcome:
    case_id: str
    decision: MatchDecision
    matched_poi_id: str | None
    confidence: float
    verdict: str


def judge(case: ResolutionCase, auto: float, confirm: float) -> CaseOutcome:
    """케이스 1건을 주어진 임계로 판정 — resolver 공개 API만 사용."""
    pois = [_to_poi(pid, name) for pid, name in case.pool]
    cfg = M7Config(match_auto=auto, match_confirm=confirm)
    m = fuzzy_match(case.query, pois, cfg)
    matched = str(m.poi_id) if m.poi_id is not None else None
    if m.decision is MatchDecision.AUTO:
        verdict = "auto_ok" if matched == case.gold_poi_id else "false_auto"
    elif m.decision is MatchDecision.CONFIRM:
        verdict = "over_confirm" if matched == case.gold_poi_id else "confirm_guard"
    else:
        verdict = "unresolved_ok" if case.gold_poi_id is None else "miss"
    return CaseOutcome(case.case_id, m.decision, matched, m.confidence, verdict)


class SweepRow(NamedTuple):
    auto: float
    confirm: float
    auto_ok: int
    false_auto: int
    over_confirm: int
    confirm_guard: int
    miss: int
    unresolved_ok: int

    def miss_rate(self, n_same: int) -> float:
        """미해소율 — 동일-장소(gold 있음) 케이스 중 UNRESOLVED 비율."""
        return self.miss / n_same if n_same else 0.0


def evaluate(cases: Sequence[ResolutionCase], auto: float, confirm: float) -> SweepRow:
    counts = Counter(judge(c, auto, confirm).verdict for c in cases)
    return SweepRow(auto, confirm,
                    counts["auto_ok"], counts["false_auto"],
                    counts["over_confirm"], counts["confirm_guard"],
                    counts["miss"], counts["unresolved_ok"])


def sweep(cases: Sequence[ResolutionCase],
          autos: Sequence[float] = AUTO_GRID,
          confirms: Sequence[float] = CONFIRM_GRID) -> tuple[SweepRow, ...]:
    """격자 스윕 — confirm ≤ auto 조합만 (M7Config 정합 조건)."""
    return tuple(evaluate(cases, a, c)
                 for a in autos for c in confirms if c <= a)


class DecisionCounts(NamedTuple):
    auto: int
    confirm: int
    unresolved: int


def decision_counts(cases: Sequence[ResolutionCase],
                    auto: float, confirm: float) -> DecisionCounts:
    """판정 분포 (PBT 단조성 검증용)."""
    counts = Counter(judge(c, auto, confirm).decision for c in cases)
    return DecisionCounts(counts[MatchDecision.AUTO],
                          counts[MatchDecision.CONFIRM],
                          counts[MatchDecision.UNRESOLVED])


def format_baseline_detail(cases: Sequence[ResolutionCase]) -> str:
    lines = [f"케이스별 판정 — 초기 임계 (auto={BASELINE_AUTO}, confirm={BASELINE_CONFIRM})",
             f"{'케이스':<5} {'유사도':>6} {'판정':<10} {'평가':<13} 비고",
             "-" * 78]
    for case in cases:
        o = judge(case, BASELINE_AUTO, BASELINE_CONFIRM)
        lines.append(f"{o.case_id:<5} {o.confidence:>6.3f} "
                     f"{o.decision.value:<10} {o.verdict:<13} {case.note}")
    return "\n".join(lines)


def format_sweep_table(rows: Sequence[SweepRow], n_same: int) -> str:
    lines = ["임계 격자 스윕 (◀ = 현행 초기값)",
             f"{'auto':>5} {'confirm':>7} | {'오자동병합':>5} {'과잉확인':>4} "
             f"{'미해소':>3} {'미해소율':>6} | {'정상AUTO':>4} {'방어CONFIRM':>6} {'정상미해소':>5}",
             "-" * 78]
    for r in rows:
        mark = " ◀" if (r.auto, r.confirm) == (BASELINE_AUTO, BASELINE_CONFIRM) else ""
        lines.append(f"{r.auto:>5.2f} {r.confirm:>7.2f} | {r.false_auto:>7} {r.over_confirm:>6} "
                     f"{r.miss:>5} {r.miss_rate(n_same):>7.0%} | {r.auto_ok:>7} "
                     f"{r.confirm_guard:>9} {r.unresolved_ok:>7}{mark}")
    return "\n".join(lines)


if __name__ == "__main__":
    n_same = sum(1 for c in CASES if c.gold_poi_id is not None)
    n_diff = len(CASES) - n_same
    print(f"라벨 케이스셋: 총 {len(CASES)}건 — 동일 장소 변형 {n_same} · 다른 장소 {n_diff}\n")
    print(format_baseline_detail(CASES))
    print()
    print(format_sweep_table(sweep(CASES), n_same))
    print("-" * 78)
    same = sweep(CASES) == sweep(CASES)
    print(f"결정론(2회 스윕 동일 표): {'✅' if same else '❌'}")
