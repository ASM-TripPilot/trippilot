"""LOCALDATA 업태 '기타' 중 **빈 자리에 들어갈 것만** LLM 으로 가려낸다 (TRIP-1282).

## 왜 LLM 인가

'기타' 는 영업 중 103,100곳으로 배제 덩어리 중 제일 크다. 상호를 전수로 훑어도 **72.9% 는
가릴 수 없었고**(2026-10-14 실측), 원본의 `위생업태명`·`전통업소주된음식` 칸도 답이 아니다 —
`위생업태명` 은 103,095곳이 똑같이 '기타'로, 업태 칸의 복사본이다. 규칙으로 더 갈 데가 없다.

규칙을 넓히는 길은 이미 막혀 있다: `localdata._NOT_A_MEAL_STOP` 주석이 적어 두었듯
`학교`·`회사`·`CC` 를 그냥 걸면 육식사관학교·주식회사○○·씨씨엘치킨이 같이 죽는다. 반대로
골프장 부속 식당은 상호에 표지가 없고 **주소에만** 있는데(`… 라비에벨 컨트리클럽`), 주소로
걸면 리조트 안의 일반 식당까지 죽는다. 이 구분이 정확히 LLM 이 규칙보다 나은 자리다.

## 전수를 태우지 않는다 — 420곳이다

10.3만을 다 태울 이유가 없다. 수집기는 **식당 공백 앵커 둘레 2km 에서 앵커당 12곳**만 쓰므로,
'기타'가 들어갈 수 있는 곳은 채택 업태로 채우고 **남은 자리**뿐이다. 그 자리를 실제로 계산하면
앵커 2,983곳 중 자리가 남은 곳 1,030, 그중 '기타'가 닿는 곳 492 → **대상 420곳**(TourAPI 중복
3곳은 게이트가 먼저 뺀다). 전수 대비 0.4% 다.

**밀어내지 않는다**(`localdata.fill_near`) — 자리가 꽉 찬 앵커는 건너뛰므로 확신이 덜한 '기타'가
확실한 한식집을 밀어낼 길이 없다. 사용자 지시 "보충만"(2026-10-14).

## 판정은 보수적이다

프롬프트가 요구하는 것은 "식당인가"가 아니라 **"여행자가 걸어 들어가 끼니를 먹을 수 있는가"** 다.
애매하면 기각 — 넣어서 틀리면 일정에 엉뚱한 곳이 들어가지만, 빼서 틀리면 후보가 한 곳 주는 것뿐이다.
LLM 이 추정한 업태를 같이 받아 적는다(`guess`). 사람이 눈으로 훑을 때 그게 판정 근거가 된다.

산출은 **판정 파일**이고 그 자체로는 아무 데도 안 들어간다(`data/localdata_etc_verdicts.json`).
`collect_localdata.py` 가 이 파일을 읽어 accept 된 것만 '기타' 풀에 넣는다 — 파일이 없으면
종전과 완전히 같다. 월 1회 재수집 때 LLM 을 다시 태우지 않으려고 판정을 파일로 굳힌다.

    cd ai
    uv run --with pyproj --env-file /Users/…/trippilot/.env \
        python scripts/classify_localdata_etc.py ~/dev/trippilot/restaurant_data/식품_일반음식점.csv
    # 다시 태우지 않고 대상만 세어 보기
    … python scripts/classify_localdata_etc.py <csv> --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

_AI = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_AI))
sys.path.insert(0, str(_AI / "src"))
sys.path.insert(0, str(_AI / "scripts"))

from trippilot.domain.common import GeoPoint  # noqa: E402
from trippilot.domain.poi import PoiCategory  # noqa: E402
from trippilot.domain.prompt import PromptRef  # noqa: E402
from trippilot.ports.llm_port import LlmRequest  # noqa: E402
from trippilot.poi_curation.sourcing.localdata import (  # noqa: E402
    PER_ANCHOR,
    PICK_RADIUS_KM,
    SourcingCandidate,
    fill_near,
    gap_anchors,
    gate_against_tourapi,
    shared_tourapi_candidates,
    to_candidate,
)

_OUT = _AI / "data" / "localdata_etc_verdicts.json"
_POIS = _AI / "data" / "collected_pois.json"
_MIGRATION = _AI.parent / "backend/app/src/main/resources/db/migration"

# 프롬프트 — **기각 쪽으로 기운 판정**을 요구한다. 넣어서 틀리면 일정에 엉뚱한 곳이 들어가고,
# 빼서 틀리면 후보가 한 곳 줄 뿐이다. 비용이 같지 않으니 문턱도 같지 않다.
_PROMPT = """\
너는 여행 일정에 넣을 식당을 고르는 심사자다. 아래는 한국 지방행정 인허가 대장의
'일반음식점' 중 업태가 '기타'로만 적혀 있어 정체를 알 수 없는 업소들이다.
상호와 주소만 보고 각 업소를 판정하라.

**판정 기준 — "여행자가 걸어 들어가 끼니를 먹을 수 있는 일반 식당인가?"**

accept: 누구나 들어가 밥을 먹을 수 있는 보통의 식당·음식점(한식·중식·양식·분식·치킨·피자 등).
        체인 지점도 포함한다.

reject: 아래 중 하나라도 해당하면 기각한다.
  - 카페·디저트·베이커리·아이스크림 전문 (끼니가 아니다)
  - 술집·호프·바·주점 (끼니가 아니다)
  - 골프장·리조트·스키장 안의 식당 (그늘집·클럽하우스·대식당 등, 이용객만 들어간다)
      ※ 주소에 '컨트리클럽'·'CC'·'리조트'·'골프'가 있으면 거의 이것이다
  - 회사·공장·학교·병원·관공서·연수원의 구내식당 (상호가 법인명·기관명이면 의심하라)
  - 호텔·펜션·콘도 부속 식당, 룸서비스, 조식당
  - 장례식장·예식장 식당
  - 배달·포장·출장 전용, 매점·판매점·휴게소
  - 상호만으로는 식당인지 아닌지 판단이 서지 않는 것 (**애매하면 반드시 reject**)

**중요**: 확신이 서는 것만 accept 하라. 애매하면 reject 가 정답이다.
모르는 상호를 식당일 것이라고 추측하지 마라.

각 줄에 대해 아래 형식의 JSON 객체 하나씩, 입력과 같은 순서로, 한 줄에 하나씩 출력하라.
설명·머리말·코드블록 표시를 붙이지 마라.

{{"ref": "<입력의 ref 그대로>", "verdict": "accept"|"reject", "guess": "<추정 업태 2~6자>", "why": "<15자 이내 사유>"}}

입력:
{rows}
"""


def _targets(csv_path: Path, per_anchor: int) -> list[SourcingCandidate]:
    """수집기와 **같은 계산**으로 빈 자리에 들어갈 '기타'만 — 여기가 LLM 배치 크기를 정한다."""
    from pyproj import Transformer

    import collect_localdata as C

    to_wgs84 = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True).transform
    adopted: list[SourcingCandidate] = []
    etc: list[SourcingCandidate] = []
    with csv_path.open(encoding="cp949", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            got = to_candidate(row, to_wgs84)
            if not isinstance(got, str):
                adopted.append(got)
                continue
            got = to_candidate(row, to_wgs84, adopted=frozenset({"기타"}))
            if not isinstance(got, str):
                etc.append(got)
    print(f"[기타] 채택 업태 풀 {len(adopted):,} · '기타' 풀 {len(etc):,}", file=sys.stderr)

    tour = shared_tourapi_candidates(json.loads(_POIS.read_text(encoding="utf-8")))
    food = [GeoPoint(c.lat, c.lng) for c in tour if c.category is PoiCategory.FOOD]
    stays = C.load_stays(_MIGRATION / "R__seed_stay.sql")
    regions = C.load_regions(_MIGRATION / "R__seed_region_catalog.sql")
    gaps = gap_anchors([p for p, _ in stays], food) + \
        gap_anchors(C.region_centers(stays, regions), food)

    fill = fill_near(gaps, adopted, etc, radius_km=PICK_RADIUS_KM, per_anchor=per_anchor)
    # TourAPI 와 같은 가게는 LLM 에 태울 이유가 없다 — 중복은 애초에 안 넣는다(사용자 지시).
    outcome = gate_against_tourapi(tour, fill)
    print(f"[기타] 공백 앵커 {len(gaps):,} → 빈 자리 후보 {len(fill):,} "
          f"→ 게이트 뒤 {len(outcome.passed):,} (TourAPI 병합 {outcome.merged})", file=sys.stderr)
    return [p.candidate for p in outcome.passed]


def _ask(llm, model: str, batch: list[SourcingCandidate], timeout: float) -> dict[str, dict]:
    """한 배치 판정. 깨진 줄은 **조용히 버리지 않고** 비워 둔다 — 미판정은 미채택이다."""
    rows = "\n".join(
        json.dumps({"ref": c.source_ref, "name": c.name, "addr": c.address}, ensure_ascii=False)
        for c in batch
    )
    res = llm.invoke(LlmRequest(
        model_id=model,
        prompt=_PROMPT.format(rows=rows),
        prompt_ref=PromptRef(prompt_id="scripts/classify_localdata_etc.py",
                             version="1", feature="LOCALDATA_ETC_TRIAGE"),
        max_tokens=180 * len(batch) + 500,
        timeout_sec=timeout,
    ))
    out: dict[str, dict] = {}
    for line in res.raw_text.splitlines():
        line = line.strip().strip("`")
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        ref, verdict = obj.get("ref"), obj.get("verdict")
        if isinstance(ref, str) and verdict in ("accept", "reject"):
            out[ref] = {"verdict": verdict,
                        "guess": str(obj.get("guess") or "")[:12],
                        "why": str(obj.get("why") or "")[:30]}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="LOCALDATA '기타' 빈자리 보충 — LLM 판정")
    ap.add_argument("csv", type=Path, help="전국일반음식점표준데이터 CSV (cp949)")
    ap.add_argument("--out", type=Path, default=_OUT)
    ap.add_argument("--per-anchor", type=int, default=PER_ANCHOR)
    ap.add_argument("--batch", type=int, default=40, help="한 호출에 묶는 수 (기본 40)")
    ap.add_argument("--model", default=os.environ.get("ETC_TRIAGE_MODEL", "claude-sonnet-5"),
                    help="판정 모델. 420곳이라 호출이 10여 번뿐이다 — 싼 모델을 쓸 자리가 아니다")
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--dry-run", action="store_true", help="대상만 세고 LLM 을 안 부른다")
    args = ap.parse_args()

    if not args.csv.is_file():
        print(f"[기타] 원본을 찾지 못했습니다: {args.csv}", file=sys.stderr)
        return 2

    targets = _targets(args.csv, args.per_anchor)
    if not targets:
        print("[기타] 대상 0곳 — 빈 자리가 없다", file=sys.stderr)
        return 0
    if args.dry_run:
        for c in targets[:30]:
            print(f"    {c.name[:30]:32} {(c.address or '')[:44]}")
        print(f"[기타] --dry-run · 대상 {len(targets):,}곳 (LLM 미호출)", file=sys.stderr)
        return 0

    from smoke_llm import _build_adapter

    llm, default_model = _build_adapter()
    model = args.model or default_model

    # **이어가기** — 이미 판정된 것은 다시 묻지 않는다. 크레딧이 중간에 떨어지거나(2026-10-14
    # 실제로 그랬다) 월 1회 재수집으로 대상이 늘어도, 기존 판정은 그대로 남는다.
    verdicts: dict[str, dict] = {}
    if args.out.exists():
        prev = json.loads(args.out.read_text(encoding="utf-8"))
        verdicts = dict(prev.get("verdicts") or {})
        print(f"[기타] 기존 판정 {len(verdicts):,}건 이어받음", file=sys.stderr)
    todo = [c for c in targets if c.source_ref not in verdicts]
    print(f"[기타] 판정 시작 — 남은 {len(todo):,}곳 / 배치 {args.batch} / 모델 {model}", file=sys.stderr)

    for i in range(0, len(todo), args.batch):
        batch = todo[i:i + args.batch]
        try:
            got = _ask(llm, model, batch, args.timeout)
        except Exception as e:                        # noqa: BLE001
            print(f"[기타] 배치 {i // args.batch + 1} 실패: {e}", file=sys.stderr)
            continue
        missing = [c.source_ref for c in batch if c.source_ref not in got]
        if missing:
            # 빠진 것은 미채택으로 남는다 — 조용히 통과시키지 않는다
            print(f"[기타] 배치 {i // args.batch + 1}: 응답에 없는 {len(missing)}곳은 미판정(=미채택)",
                  file=sys.stderr)
        for c in batch:
            if (v := got.get(c.source_ref)) is not None:
                # 모델을 건마다 적는다 — 크레딧이 떨어져 다른 제공자로 이어 붙이면
                # 어느 판정이 어느 모델 것인지 나중에 알 수 없다(2026-10-14 실제 상황).
                verdicts[c.source_ref] = v | {"name": c.name, "address": c.address, "model": model}
        done = min(i + args.batch, len(todo))
        print(f"[기타] {done:,}/{len(todo):,}", file=sys.stderr)

    stat = Counter(v["verdict"] for v in verdicts.values())
    accepted = sorted(r for r, v in verdicts.items() if v["verdict"] == "accept")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "source": "llm:localdata_etc_triage/1",
        "models": sorted({v.get("model", "?") for v in verdicts.values()}),
        "decided_at": datetime.now(UTC).strftime("%Y-%m-%d"),
        "attempted": len(targets),
        "stats": {**stat, "미판정": len(targets) - len(verdicts)},
        "accepted_refs": accepted,
        "verdicts": {r: verdicts[r] for r in sorted(verdicts)},
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n[기타] 대상 {len(targets):,} → accept {stat['accept']:,} · reject {stat['reject']:,} "
          f"· 미판정 {len(targets) - len(verdicts):,}", file=sys.stderr)
    print(f"[기타] {args.out} 기록", file=sys.stderr)
    print("\n[기타] accept 전수 — 눈으로 확인하라:", file=sys.stderr)
    for r in accepted:
        v = verdicts[r]
        print(f"    {v['name'][:28]:30} [{v['guess']:8}] {(v['address'] or '')[:40]}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
