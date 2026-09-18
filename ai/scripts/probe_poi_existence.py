"""실재 검증 표본 실측 — 배제 정책을 켤 근거를 만든다 (TRIP-683).

`KakaoExistenceAdapter` 를 **이미 아는 답**에 돌려 오탐률을 잰다. 지도 검색에
안 나오는 것을 후보에서 배제하려면, 먼저 "멀쩡한 가게가 얼마나 안 나오는가"를
알아야 한다. 모르고 켜면 문 연 가게를 일정에서 빼게 된다.

## 표본을 어떻게 고르나

정답이 있는 두 무리를 쓴다 — 근거는 `ai/data/poi_business_status.json`
(지자체 인허가 대조 결과, 주소·상호가 모두 일치한 건만 실려 있다):

- **영업 중**(`state == "OPEN"`) → 검색에 **나와야** 정상.
  안 나오면 **오탐**(false negative) — 배제 정책이 멀쩡한 가게를 버리는 비율.
- **폐업**(`state == "CLOSED"`) → 검색에 **안 나와야** 정상.
  나오면 **미검출**(false positive) — 배제 정책이 놓치는 비율.

카테고리는 FOOD·CAFE 뿐이다(인허가 데이터가 식품위생업소라서). 나머지
카테고리의 오탐률은 이 표본으로 답할 수 없다 — 결론을 확장하지 말 것.

## 왜 지역 분포를 같이 보나

`pool_builder` ⑤ 주석의 전례(TRIP-326 · PR #104) 때문이다. 팀이 영업시간 없는
POI 배제를 넣었다가 **"희소 지역에서 후보가 사라진다"** 는 이유로 순위 강등으로
후퇴했다. 전국 평균 오탐률이 낮아도 특정 지역에서 몰리면 같은 일이 난다.

    uv run python scripts/probe_poi_existence.py --sample 200 --out probe.json
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Mapping

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from trippilot.domain.common import GeoPoint, PoiId  # noqa: E402
from trippilot.poi_curation.adapters.kakao_existence import (  # noqa: E402
    KakaoExistenceAdapter,
)
from trippilot.ports.place_existence_port import (  # noqa: E402
    ExistenceQuery,
    ExistenceStatus,
)

_AI = Path(__file__).resolve().parents[1]
_POIS = _AI / "data" / "collected_pois.json"
_STATUS = _AI / "data" / "poi_business_status.json"


class UrllibHttp:
    """표준 라이브러리 GET. 실측 전용 — 테스트에서는 쓰지 않는다(실 호출 0)."""

    def __init__(self, timeout_sec: float = 5.0) -> None:
        self._timeout = timeout_sec

    def get_json(
        self, url: str, headers: Mapping[str, str], params: Mapping[str, str]
    ) -> object:
        req = urllib.request.Request(
            f"{url}?{urllib.parse.urlencode(params)}", headers=dict(headers)
        )
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))


def _load_sample(n: int, seed: int) -> tuple[list, list]:
    """(영업중 표본, 폐업 표본). 정답이 있는 것만 — 미판정은 표본에서 뺀다."""
    status = json.loads(_STATUS.read_text(encoding="utf-8")).get("status", {})
    pois = json.loads(_POIS.read_text(encoding="utf-8"))["proposals"]

    open_pool, closed_pool = [], []
    for p in pois:
        if p["poi"]["category"] not in ("FOOD", "CAFE"):
            continue
        st = status.get(p.get("provenance", {}).get("content_id", ""))
        if not st:
            continue                      # 미판정 — 정답이 없어 표본이 못 된다
        (open_pool if st.get("state") == "OPEN" else closed_pool).append(p)

    rng = random.Random(seed)
    rng.shuffle(open_pool)
    rng.shuffle(closed_pool)
    # 폐업은 모집단 자체가 작다(210건) — 있는 만큼 다 쓴다.
    return open_pool[:n], closed_pool[:n]


def _region(p: dict) -> str:
    return p.get("region") or "?"


def _verify(adapter: KakaoExistenceAdapter, pois: list) -> dict[str, str]:
    if not pois:
        return {}
    queries = tuple(
        ExistenceQuery(
            poi_id=PoiId(p["poi"]["poi_id"]),
            name=p["poi"]["name"],
            coord=GeoPoint(p["poi"]["coord"]["lat"], p["poi"]["coord"]["lng"]),
        )
        for p in pois
    )
    # 실측이라 마감을 넉넉히 준다 — 런타임 예산과 다르다.
    verdicts = adapter.verify(queries, deadline_ms=10 * 60 * 1000)
    return {str(v.poi_id): v.status.value for v in verdicts}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=200, help="무리별 표본 크기")
    ap.add_argument("--seed", type=int, default=20260912)
    ap.add_argument("--radius", type=int, default=300)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    key = os.environ.get("KAKAO_REST_API_KEY", "").strip()
    if not key:
        print("[probe] KAKAO_REST_API_KEY 없음 — 중단", file=sys.stderr)
        return 1

    open_s, closed_s = _load_sample(args.sample, args.seed)
    print(f"[probe] 표본 — 영업중 {len(open_s)} · 폐업 {len(closed_s)} "
          f"· 반경 {args.radius}m", file=sys.stderr)

    adapter = KakaoExistenceAdapter(
        UrllibHttp(), key,
        max_calls=len(open_s) + len(closed_s) + 10,
        monotonic_ms=lambda: int(time.monotonic() * 1000),
        radius_m=args.radius,
    )
    open_r = _verify(adapter, open_s)
    closed_r = _verify(adapter, closed_s)

    oc = Counter(open_r.values())
    cc = Counter(closed_r.values())
    n_open = sum(oc.values()) or 1
    n_closed = sum(cc.values()) or 1

    miss = oc[ExistenceStatus.NOT_FOUND.value]        # 영업중인데 못 찾음 = 오탐
    caught = cc[ExistenceStatus.NOT_FOUND.value]      # 폐업이고 못 찾음 = 적중

    print(f"\n[probe] 영업 중 {n_open}건")
    for k, v in oc.most_common():
        print(f"    {k:12} {v:5}  ({v/n_open*100:5.1f}%)")
    print(f"  → 오탐률 {miss/n_open*100:.1f}%  "
          f"(배제 정책이 멀쩡한 가게를 버리는 비율)")

    print(f"\n[probe] 폐업 {n_closed}건")
    for k, v in cc.most_common():
        print(f"    {k:12} {v:5}  ({v/n_closed*100:5.1f}%)")
    print(f"  → 적중률 {caught/n_closed*100:.1f}%  "
          f"(배제 정책이 잡아내는 비율)")

    # 지역 쏠림 — 전국 평균이 낮아도 한 지역에 몰리면 그 지역 후보가 사라진다
    by_region: Counter[str] = Counter()
    region_total: Counter[str] = Counter()
    for p in open_s:
        r = _region(p)
        region_total[r] += 1
        if open_r.get(p["poi"]["poi_id"]) == ExistenceStatus.NOT_FOUND.value:
            by_region[r] += 1
    worst = sorted(
        ((r, by_region[r], t) for r, t in region_total.items() if t >= 5),
        key=lambda x: -x[1] / x[2],
    )[:8]
    if worst:
        print("\n[probe] 오탐이 몰린 지역 (표본 5건 이상)")
        for r, m, t in worst:
            print(f"    {r:12} {m:3}/{t:3}  ({m/t*100:5.1f}%)")

    print(f"\n[probe] 호출 {adapter.calls_used}건", file=sys.stderr)

    if args.out:
        args.out.write_text(json.dumps({
            "radius_m": args.radius, "seed": args.seed,
            "open": {"n": n_open, "counts": dict(oc),
                     "false_negative_rate": miss / n_open},
            "closed": {"n": n_closed, "counts": dict(cc),
                       "detection_rate": caught / n_closed},
            "by_region": {r: {"miss": by_region[r], "total": t}
                          for r, t in region_total.items()},
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[probe] {args.out} 기록", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
