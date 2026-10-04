"""공유본 휴무 백필 — 수집 때 반영된 주간 휴무를 원문 칸에 정형 문구로 되살린다 (TRIP-1226).

수집은 휴무 원문(restdate류)까지 읽어 `poi.open_hours` 를 만드는데, 백엔드로 가는 원문 칸
(`opening_hours_raw` → `poi.opening_hours varchar(200)`)에는 영업 원문만 실렸다. AI 는 런타임에
그 칸을 다시 파싱하므로(`backend_poi_db`) 휴무가 사라져 **휴무일에도 영업**으로 읽혔다.
앞으로의 수집분은 파이프라인이 휴무 원문을 함께 싣는다(`mapping.join_opening_hours_raw`).

기수집분은 재수집 없이 고친다 — 공유본에 휴무 원문은 없지만 **휴무를 반영한 파싱 결과**는
`open_hours` 에 남아 있다. 그것과 원문 재파싱(휴무 미반영)의 차이가 **요일 단위로 빠진 날**이면
파서가 읽는 정형 문구(`매주 월요일`)를 합성해 붙인다. 붙인 원문을 다시 파싱해 저장본과 **같을
때만** 쓰고(전수 검증), 다르면 붙이지 않고 사유별로 센다.

되살리지 못하는 것: 병합 재파싱(`merge_pois_docs.reparse_open_hours`)이 채운 `open_hours` 는
처음부터 휴무 없이 읽힌 것이라 차이가 안 보인다 — 재수집으로만 고쳐진다.

멱등: 붙인 원문은 재파싱이 저장본과 같아지므로 다시 돌리면 "차이 없음"이다.

사용법:
    cd ai
    uv run python scripts/backfill_rest_days.py                 # 집계만 (파일 안 바꿈)
    uv run python scripts/backfill_rest_days.py --write         # data/collected_pois.json 갱신
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.domain.poi import OpenHour  # noqa: E402
from trippilot.poi_curation.sourcing.mapping import (  # noqa: E402
    join_opening_hours_raw,
    parse_opening_hours_raw,
    split_opening_hours_raw,
)

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data" / "collected_pois.json"

RESTORED = "restored"
# 붙이지 않은 사유 — 보고용 설명. "same"·"no_raw" 는 고칠 것이 없는 경우다.
OUTCOMES: dict[str, str] = {
    "no_raw": "원문 없음",
    "same": "차이 없음 (휴무 없음·이미 붙음·병합 재파싱분)",
    "stored_empty": "저장본은 빈칸인데 원문은 읽힘",
    "reparse_empty": "원문 재파싱이 빈칸 (절단된 원문 등)",
    "window_differs": "영업 창이 다름 (수집 뒤 파서가 바뀜)",
    "not_weekly": "차이가 요일 단위 휴무로 설명되지 않음",
    "verify_failed": "합성 후 재파싱이 저장본과 다름 (200자 절단 등)",
}
_DAY_NAMES = "월화수목금토일"  # OpenHour.day_of_week 0=월


def rest_phrase(days: set[int]) -> str:
    """휴무 요일 → 파서가 읽는 정형 문구. {0, 2} → `매주 월요일, 수요일`."""
    return "매주 " + ", ".join(f"{_DAY_NAMES[d]}요일" for d in sorted(days))


def backfill_one(p: dict) -> str:
    """제안 하나에 휴무 문구를 붙인다. 붙였으면 RESTORED, 아니면 OUTCOMES 의 키."""
    raw = p.get("opening_hours_raw")
    if not raw:
        return "no_raw"
    stored = tuple(OpenHour.from_dict(h) for h in (p.get("poi") or {}).get("open_hours") or ())
    week = parse_opening_hours_raw(raw)
    if week == stored:
        return "same"
    if not stored:
        return "stored_empty"
    if not week:
        return "reparse_empty"
    if {(h.open_min, h.close_min) for h in stored} != {(h.open_min, h.close_min) for h in week}:
        return "window_differs"
    open_days = {h.day_of_week for h in stored}
    week_days = {h.day_of_week for h in week}
    # 저장본이 재파싱의 진부분집합(요일만 빠짐)이어야 휴무로 설명된다. 이미 휴무 문구가
    # 있는데도 다르면 덧붙이지 않는다 — 두 문구가 섞이면 원문이 거짓말을 한다.
    if not open_days < week_days or split_opening_hours_raw(raw)[1] is not None:
        return "not_weekly"
    joined = join_opening_hours_raw(raw, rest_phrase(week_days - open_days))
    if parse_opening_hours_raw(joined) != stored:
        return "verify_failed"
    p["opening_hours_raw"] = joined
    return RESTORED


def backfill(proposals: list[dict]) -> tuple[Counter, Counter]:
    """전수 백필. (붙인 건 카테고리별, 결과별 건수)를 돌려준다."""
    restored: Counter = Counter()
    outcomes: Counter = Counter()
    for p in proposals:
        outcome = backfill_one(p)
        outcomes[outcome] += 1
        if outcome == RESTORED:
            restored[(p.get("poi") or {}).get("category")] += 1
    return restored, outcomes


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("path", nargs="?", default=str(DEFAULT_PATH), help="collected_pois.json 경로")
    parser.add_argument("--write", action="store_true", help="결과를 같은 파일에 쓴다 (생략 시 집계만)")
    args = parser.parse_args(argv)

    path = Path(args.path)
    doc = json.loads(path.read_text(encoding="utf-8"))
    restored, outcomes = backfill(doc["proposals"])

    detail = " · ".join(f"{c} {n}" for c, n in restored.most_common())
    print(f"[backfill] 휴무 문구 붙임 {sum(restored.values())}건 ({detail or '-'})", file=sys.stderr)
    for key, label in OUTCOMES.items():
        if outcomes[key]:
            print(f"[backfill]   {key:<15} {outcomes[key]:>6}  {label}", file=sys.stderr)
    if args.write and restored:
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[backfill] 저장 → {path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
