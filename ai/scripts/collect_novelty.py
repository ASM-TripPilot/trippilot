"""수집 신규율 진단 — "왜 새 데이터가 안 늘었나"를 산출물로 답한다 (TRIP-348).

이 배치의 실패 모드는 빨간불이 아니라 **초록불인 채 제자리걸음**이다. 실제로
8/14~8/18 닷새를 성공으로 끝내면서 신규 POI 3건만 늘었고, 아무도 몰랐다.
성공/실패만으로는 안 보이니 **신규율**을 재고, 낮으면 원인 후보와 처방을
그 자리에서 같이 낸다 — 다음 사람이 로그를 뒤지지 않도록.

    uv run python scripts/collect_novelty.py \\
        --prev-state collect_state.prev.json --output collected_pois.json

`--prev-state` 는 **이번 실행이 시작하기 전의** 상태다(워크플로 복원 직후 사본).
그게 있어야 "이번에 처음 본 POI"를 셀 수 있다 — 실행 후 상태에는 이번 제안이
이미 색인에 들어가 있어 구분이 안 된다.

제안 하나는 셋 중 하나다:
  - **신규**   기제안 색인에 없던 content_id
  - **갱신**   색인에 있고 modified_time 이 달라진 것 (TourAPI 원본이 바뀜 — 정상)
  - **반복**   색인에 있고 modified_time 도 같은 것 (스킵됐어야 하는데 다시 실렸다)

신규율이 임계(기본 50%) 미만이면 원인 후보를 **증거와 함께** 나열한다. 진단은
실패로 만들지 않는다(::warning::) — 지역을 완주한 뒤의 재순회처럼 신규율이
정당하게 낮은 국면이 있고, 진짜 회귀는 워크플로의 이어가기 검증이 이미 빨간불로
잡는다. 여기 몫은 "낮다"가 아니라 **"낮은 이유와 다음 수"**를 남기는 것이다.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

# 지역 코드 → 이름 (진단 문구용). collect_pois.py 의 AREA_NAMES 와 같은 어휘.
AREA_NAMES = {
    "1": "서울", "2": "인천", "3": "대전", "4": "대구", "5": "광주", "6": "부산",
    "7": "울산", "8": "세종", "31": "경기", "32": "강원", "33": "충북",
    "34": "충남", "35": "경북", "36": "전북", "37": "전남", "38": "경남",
    "39": "제주",
}


@dataclass(frozen=True)
class Novelty:
    """제안을 신규·갱신·반복으로 가른 결과."""

    new: int
    refreshed: int
    repeated: int
    prev_index_size: int

    @property
    def total(self) -> int:
        return self.new + self.refreshed + self.repeated

    @property
    def rate(self) -> float:
        """신규율 — 제안이 0건이면 0.0 (나눌 게 없으면 '새 것도 없다')."""
        return self.new / self.total if self.total else 0.0


def classify(doc: dict, prev_state: dict | None) -> Novelty:
    prev_index: dict[str, str | None] = (prev_state or {}).get("proposed", {})
    new = refreshed = repeated = 0
    for p in doc.get("proposals", []):
        prov = p.get("provenance") or {}
        cid = prov.get("content_id")
        if cid is None or cid not in prev_index:
            new += 1
        elif prev_index[cid] != prov.get("modified_time"):
            refreshed += 1
        else:
            repeated += 1
    return Novelty(new, refreshed, repeated, len(prev_index))


def diagnose(doc: dict, prev_state: dict | None, nov: Novelty) -> list[tuple[str, str]]:
    """신규율이 낮은 원인 후보 → [(증거, 처방)]. 해당하는 것만, 확실한 순으로."""
    stats = doc.get("stats", {})
    findings: list[tuple[str, str]] = []

    if nov.prev_index_size == 0:
        findings.append((
            "이전 상태의 기제안 색인이 비어 있다 — 이번 실행은 비교 기준 없이 돌았다.",
            "최초 실행이 아니라면 상태 복원이 실패한 것이다. `collect-state` 브랜치 tip 에 "
            "`collect_state.json` 이 있는지 확인한다 (브랜치를 공유하는 다른 워크플로가 "
            "트리를 덮어쓰면 사라진다).",
        ))

    if nov.repeated > 0:
        findings.append((
            f"색인에 있고 modified_time 도 같은 제안이 {nov.repeated}건 다시 실렸다 — "
            "목록 단계 스킵이 안 먹었다.",
            "상태의 `proposed` 색인이 로드됐는지, content_id 키 타입이 문자열로 "
            "일관되는지 확인한다. 스킵이 죽으면 상세 호출까지 다시 나가 쿼터가 두 배로 든다.",
        ))

    per_area = stats.get("per_area") or {}
    starved = [a for a, row in per_area.items() if row.get("calls", 0) <= 3]
    if stats.get("budget_exhausted") and starved:
        names = ", ".join(f"{a} {AREA_NAMES.get(a, '')}".strip() for a in starved[:6])
        more = f" 외 {len(starved) - 6}곳" if len(starved) > 6 else ""
        findings.append((
            f"호출 예산이 앞 지역에서 소진돼 {len(starved)}개 지역이 3콜 이하로 굶었다 "
            f"({names}{more}).",
            "굶은 지역은 매 실행 같은 자리에 머문다. ①키 한도를 실제로 합산하고 있는지 "
            "확인(키링이 다음 키로 넘어간 뒤 403 이면 그 키는 예산에 안 보태진다) "
            "②`TOURAPI_AREA_CODES` 로 하루 대상 지역을 좁혀 **완주**시키고 다음날 "
            "라운드로빈으로 넘긴다 — 얇게 17곳보다 두껍게 3~4곳이 신규를 더 만든다.",
        ))

    failures = stats.get("page_failures", 0)
    if failures >= 10:
        findings.append((
            f"목록 페이지 실패가 {failures}건이다 — 호출은 썼는데 아무것도 못 받았다.",
            "런 로그에서 상태 코드를 본다. 403 이 연속이면 키 한도 소진이거나 그 키가 "
            "해당 오퍼레이션에 승인되지 않은 것이다 (data.go.kr 콘솔에서 활용 신청 상태 확인). "
            "실패한 페이지는 커서가 넘어가지 않아 다음 실행도 같은 자리에서 막힌다.",
        ))

    cursors = (prev_state or {}).get("cursors") or {}
    done = [f"{a} {AREA_NAMES.get(a, '')}".strip()
            for a, kinds in cursors.items()
            if kinds and all(k.get("completed") for k in kinds.values())]
    if done:
        findings.append((
            f"완주한 지역이 {len(done)}곳이다 ({', '.join(done[:6])}"
            f"{' 외' if len(done) > 6 else ''}) — 이 지역들은 재순회 중이라 "
            "원본이 바뀌지 않는 한 신규가 안 나온다.",
            "신규를 늘리려면 **대상을 넓힌다**: 미수집 지역을 `TOURAPI_AREA_CODES` 앞으로 "
            "돌리거나, `TOURAPI_CONTENT_TYPES` 에 타입을 더한다 "
            "(현재 12 관광지·14 문화시설·39 음식점 — 예: 15 축제공연행사·28 레포츠·32 숙박). "
            "완주 지역의 재순회 자체는 색인 스킵으로 싸게 돌므로 끄지 않아도 된다.",
        ))

    drops = stats.get("gate_drops") or {}
    dropped = sum(drops.values())
    listed = stats.get("listed", 0)
    if dropped and listed and dropped / listed >= 0.2:
        detail = ", ".join(f"`{k}` {v}건" for k, v in sorted(drops.items()))
        findings.append((
            f"목록 {listed}건 중 {dropped}건({dropped / listed:.0%})이 수집 게이트에서 "
            f"떨어졌다 — {detail}.",
            "드롭 사유가 한쪽에 쏠렸으면 게이트 기준이 그 지역·타입과 안 맞는 것이다. "
            "`existence_out_of_service_region` 이 많으면 좌표계·bbox 를, "
            "`schema_missing_*` 가 많으면 그 contentTypeId 의 필수 필드 가정을 다시 본다. "
            "드롭 자체는 INV-1 을 지키는 동작이니 기준을 낮추는 쪽으로 먼저 손대지 않는다.",
        ))

    if not findings:
        findings.append((
            "알려진 원인 패턴에 걸리는 게 없다.",
            "커서·색인·예산·게이트 모두 정상 범위인데 신규율만 낮다면 대상 지역이 "
            "이미 포화됐을 가능성이 높다. 지역·타입 확장을 검토한다.",
        ))
    return findings


def stall_check(doc: dict, nov: Novelty) -> str | None:
    """제자리걸음(커서·색인이 안 먹는 회귀)인가 → 사유 문구, 아니면 None.

    "스킵 0건"만으로 판정하면 **미수집 지역을 처음 훑을 때 오탐**이 난다 —
    실제로 강원(32) 100건 전부가 신규인 실행이 회귀로 오인돼 빨간불이 났다.
    회귀의 본질은 스킵이 없다는 게 아니라 **아무 진척이 없다**는 것이다:
    신규도 없고 스킵도 없으면서 목록은 받아왔다면 같은 자리를 다시 긁은 것이다.
    """
    if nov.prev_index_size == 0:
        return None                     # 비교 기준 없음 — 복원 실패는 복원 스텝이 잡는다
    if nov.repeated > 0:
        return (f"기제안 색인에 있고 modified_time 도 같은 제안이 {nov.repeated}건 "
                f"다시 실렸다 — 목록 단계 스킵이 안 먹었다 (TRIP-348 회귀).")
    listed = doc.get("stats", {}).get("listed", 0)
    skipped = doc.get("stats", {}).get("skipped_unchanged", 0)
    if listed > 0 and nov.new == 0 and skipped == 0:
        return (f"목록 {listed}건을 받아왔는데 신규 0건 · 스킵 0건이다 — "
                f"커서·색인이 안 먹고 같은 자리를 다시 긁었다 (TRIP-348 회귀).")
    return None


def report(doc: dict, prev_state: dict | None, threshold: float,
           fail_if_stalled: bool = False) -> int:
    nov = classify(doc, prev_state)
    areas = doc.get("area_codes") or [doc.get("area_code")]
    print("## 수집 신규율")
    print()
    print(f"- 지역 `{','.join(str(a) for a in areas if a)}` · "
          f"수집 시각 {doc.get('collected_at', '?')}")
    print(f"- 이전 기제안 색인 {nov.prev_index_size}건")
    print()
    print("| 구분 | 건수 | 비율 |")
    print("|---|---|---|")
    for label, count in (("**신규**", nov.new), ("갱신 (원본 변경)", nov.refreshed),
                         ("반복 (스킵됐어야)", nov.repeated)):
        share = f"{count / nov.total:.0%}" if nov.total else "—"
        print(f"| {label} | {count} | {share} |")
    print(f"| 합계 (등록 제안) | {nov.total} | |")
    print()

    stalled = stall_check(doc, nov)
    if stalled and fail_if_stalled:
        print(f"> [!CAUTION]")
        print(f"> **제자리걸음** — {stalled}")
        print()
        print("### 원인 후보와 처방")
        print()
        for i, (evidence, remedy) in enumerate(diagnose(doc, prev_state, nov), 1):
            print(f"{i}. **{evidence}**")
            print(f"   - → {remedy}")
            print()
        print(f"::error::{stalled} 잡 서머리의 '원인 후보와 처방' 참조.", file=sys.stderr)
        return 1

    if nov.rate >= threshold:
        print(f"신규율 **{nov.rate:.0%}** — 임계 {threshold:.0%} 이상. 진단 생략.")
        return 0

    print(f"> [!WARNING]")
    print(f"> 신규율 **{nov.rate:.0%}** — 임계 {threshold:.0%} 미만. "
          f"제안 {nov.total}건 중 새로 본 POI 는 {nov.new}건뿐이다.")
    print()
    print("### 원인 후보와 처방")
    print()
    for i, (evidence, remedy) in enumerate(diagnose(doc, prev_state, nov), 1):
        print(f"{i}. **{evidence}**")
        print(f"   - → {remedy}")
        print()
    # 워크플로 주석 — 잡 서머리를 안 열어도 런 목록에서 보인다
    print(f"::warning::수집 신규율 {nov.rate:.0%} (신규 {nov.new}/{nov.total}건) — "
          f"임계 {threshold:.0%} 미만. 잡 서머리의 '원인 후보와 처방' 참조.",
          file=sys.stderr)
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", required=True, help="collected_pois.json 경로")
    parser.add_argument("--prev-state", help="이번 실행 **전**의 collect_state.json 사본")
    parser.add_argument("--threshold", type=float, default=0.5,
                        help="신규율 임계 (기본 0.5 — 미만이면 원인 진단)")
    parser.add_argument("--fail-if-stalled", action="store_true",
                        help="제자리걸음(신규 0 · 스킵 0 · 반복 있음)이면 exit 1 — "
                             "워크플로 게이트용. 신규율이 낮기만 한 것은 실패가 아니다.")
    args = parser.parse_args(argv)

    doc = json.loads(Path(args.output).read_text(encoding="utf-8"))
    prev_state = None
    if args.prev_state and Path(args.prev_state).exists():
        try:
            prev_state = json.loads(Path(args.prev_state).read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            # 손상된 이전 상태는 "색인 없음"과 같은 결론으로 수렴한다 — 진단이 그걸 짚는다
            print(f"[novelty] 이전 상태를 읽지 못했다 ({e}) — 색인 없이 진단한다",
                  file=sys.stderr)
    return report(doc, prev_state, args.threshold, args.fail_if_stalled)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
