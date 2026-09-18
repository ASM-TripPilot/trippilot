"""수집 POI → 학습 시나리오 JSON. 런북 §1 의 입력을 만든다.

`build_dataset.py` 가 `--scenarios` 로 받는 파일을 손으로 쓰지 않기 위한 도구다.
지명·카테고리는 실제 수집본(`ai/collected_pois.db`)에서 뽑는다 — 지어낸 지명으로
학습하면 학생이 실제로 받을 분포와 어긋난다.

**`other_names` 는 워커의 `ReminderCopyWorker._context` 를 그대로 불러 만든다.**
직접 "다른 날 이름 전부"로 채우면 안 된다: 서빙은 오늘 장소의 부분 문자열인
이름을 forbidden 에서 빼는데(한라산 ⊂ 한라산 1100고지), 그 규칙이 여기 없으면
학습 데이터만 더 엄한 기준으로 걸러져 분포가 갈린다.

사용:
    uv run python scripts/finetune_reminder/make_scenarios.py \
        --db collected_pois.db --out scenarios.json --trips 200 --seed 42
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from trippilot.llm_gateway.workers.reminder_copy import (  # noqa: E402
    ReminderCopyItem,
    ReminderCopyWorker,
)

# 문구가 20/60자 안에 들어가야 하므로 지나치게 긴 이름은 학습 분포에서 뺀다
# (드롭될 것이 뻔한 샘플로 교사 호출을 태우지 않는다).
_MAX_NAME_LEN = 14
_BASE_DATE = date(2026, 4, 1)


def load_places(db: Path) -> dict[str, list[tuple[str, str]]]:
    """지역 → [(이름, 카테고리)]. 이름 중복·빈 값·과장 길이는 버린다."""
    conn = sqlite3.connect(db)
    by_region: dict[str, list[tuple[str, str]]] = defaultdict(list)
    seen: set[tuple[str, str]] = set()
    for name, category, sido, region in conn.execute(
        "SELECT name, category, sido, region FROM proposal"
    ):
        if not name or not sido:
            continue
        name = name.strip()
        if not name or len(name) > _MAX_NAME_LEN:
            continue
        key = (sido, name)
        if key in seen:
            continue
        seen.add(key)
        by_region[region or sido].append((name, (category or "").strip()))
    conn.close()
    return {r: v for r, v in by_region.items() if len(v) >= 8}


# 한글 라벨 → 경계 코드. 동료 세션이 주는 표본은 사람이 읽는 라벨로 오는데,
# 워커는 코드를 받아 다시 한글로 바꾼다 — 라벨을 그대로 넣으면 "모르는 코드"가 되어
# 카테고리가 통째로 빠진 채 학습된다.
_LABEL_TO_CODE = {
    "맛집": "FOOD", "카페": "CAFE", "명소": "SIGHT", "야경": "NIGHT_VIEW",
    "자연": "NATURE", "문화": "CULTURE", "액티비티": "ACTIVITY", "쇼핑": "SHOPPING",
}

# 여행 문구에 쓸 곳이 아닌 것들. Overture 의 shopping 축에 편의점·통신사 대리점이
# 섞여 들어온다(출처 세션이 고치는 중이지만 표본에는 남아 있다). 학습에 넣으면
# 학생이 "오늘은 GS25 에 들르세요" 를 배운다.
_NOT_A_DESTINATION = re.compile(
    r"CU |GS25|세븐일레븐|7-?ELEVEN|이마트24|미니스톱|편의점|T world|올레샵|텔레콤"
)


def load_places_csv(path: Path, region: str = "제주") -> dict[str, list[tuple[str, str]]]:
    """`name,category(한글 라벨),source` CSV → 지역 → [(이름, 코드)].

    긴 이름을 DB 경로와 같은 기준으로 자르고, 목적지가 아닌 것을 걷어낸다.
    """
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("name") or "").strip()
            code = _LABEL_TO_CODE.get((row.get("category") or "").strip())
            if not name or not code or name in seen:
                continue
            if len(name) > _MAX_NAME_LEN or _NOT_A_DESTINATION.search(name):
                continue
            seen.add(name)
            out.append((name, code))
    return {region: out} if len(out) >= 8 else {}


def weighted_regions(by_region: dict[str, list[tuple[str, str]]]) -> list[str]:
    """지역 목록 — CSV 모드는 한 지역이라 그대로다(DB 모드와 호출부를 맞추는 용도)."""
    return sorted(by_region)


def build_trip(rng: random.Random, region: str, places: list[tuple[str, str]]) -> list[dict]:
    """여행 1건 → 그 여행의 시나리오들(당일 아침 N건 + 하루 전 1건)."""
    days = rng.randint(2, 4)
    picked = rng.sample(places, min(len(places), days * rng.randint(2, 4)))
    per_day = max(2, len(picked) // days)
    day_slots = [picked[i * per_day : (i + 1) * per_day] for i in range(days)]
    day_slots = [d for d in day_slots if d]
    if len(day_slots) < 2:
        return []

    start = _BASE_DATE + timedelta(days=rng.randint(0, 300))
    trip_title = f"{region} {len(day_slots)}일 여행"

    items = tuple(
        ReminderCopyItem(
            schedule_key=f"day_{i + 1}",
            kind="TRIP_DAY",
            date_label=(start + timedelta(days=i)).isoformat(),
            slot_names=tuple(n for n, _ in slots),
            slot_categories=tuple(c for _, c in slots),
        )
        for i, slots in enumerate(day_slots)
    )

    out: list[dict] = []
    for i, item in enumerate(items):
        ctx = ReminderCopyWorker._context(items, i)  # 서빙과 같은 forbidden 산출
        out.append(
            {
                "schedule_key": item.schedule_key,
                "kind": item.kind,
                "date": item.date_label,
                "trip_title": trip_title,
                "slot_names": list(item.slot_names),
                "slot_categories": list(item.slot_categories),
                "other_names": list(ctx.forbidden),
            }
        )
    # 하루 전 알림은 첫날 일정을 재료로 쓴다 — 종류만 다르고 대조 집합은 같다.
    pre = dict(out[0])
    pre["schedule_key"] = "pre"
    pre["kind"] = "TRIP_PRE"
    pre["date"] = (start - timedelta(days=1)).isoformat()
    out.append(pre)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="collected_pois.db", help="수집 POI SQLite")
    parser.add_argument("--csv", help="표본 CSV(name,category,source) — 주면 DB 대신 이걸 쓴다")
    parser.add_argument(
        "--boost", default="",
        help="쉼표로 구분한 한글 라벨 — 매 여행에 최소 1곳씩 넣는다(희소 라벨 보강용)",
    )
    parser.add_argument("--out", required=True, help="출력 시나리오 JSON")
    parser.add_argument("--trips", type=int, default=200, help="만들 여행 수")
    parser.add_argument("--seed", type=int, default=42, help="재현용 시드")
    args = parser.parse_args()

    if args.csv:
        csv_path = Path(args.csv)
        if not csv_path.exists():
            print(f"표본 CSV 없음: {csv_path}", file=sys.stderr)
            return 2
        by_region = load_places_csv(csv_path)
    else:
        db = Path(args.db)
        if not db.exists():
            print(f"수집 DB 없음: {db}", file=sys.stderr)
            return 2
        by_region = load_places(db)
    if not by_region:
        print("쓸 수 있는 지역이 없다 (지역당 8곳 이상 필요)", file=sys.stderr)
        return 2

    rng = random.Random(args.seed)
    regions = sorted(by_region)
    scenarios: list[dict] = []
    boost_codes = [
        _LABEL_TO_CODE[b.strip()] for b in args.boost.split(",") if b.strip() in _LABEL_TO_CODE
    ]
    for _ in range(args.trips):
        region = rng.choice(regions)
        pool = by_region[region]
        if boost_codes:
            # 희소 라벨을 앞에 놓아 build_trip 의 표본 추출에 반드시 걸리게 한다.
            rare = [p for p in pool if p[1] in boost_codes]
            if rare:
                pool = rng.sample(rare, min(2, len(rare))) + rng.sample(pool, min(len(pool), 10))
        scenarios.extend(build_trip(rng, region, pool))

    Path(args.out).write_text(
        json.dumps(scenarios, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    kinds = defaultdict(int)
    for s in scenarios:
        kinds[s["kind"]] += 1
    print(
        f"지역 {len(regions)}개 · 여행 {args.trips}건 → 시나리오 {len(scenarios)}건 "
        f"(TRIP_DAY {kinds['TRIP_DAY']} · TRIP_PRE {kinds['TRIP_PRE']}) → {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
