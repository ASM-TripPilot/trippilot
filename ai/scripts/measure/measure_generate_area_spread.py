"""여러 날 생성이 날마다 다른 동네로 가는지 — 실행 중인 AI 에 `/itinerary/generate` 를 보내 날짜별 중심을 잰다.

서울 2박3일이 사흘 모두 을지로 근처로 나온다는 보고(2026-10-20)의 재현·회귀 측정. 앵커는 백엔드가 숙소 없을 때
쓰는 목적지 중심(서울 = 시청 37.5665, 126.9780 — `StubRegionGeocodeAdapter`)이다. 장소 이름·분류는 로컬 DB 에서 읽는다.

    uv run python scripts/measure/measure_generate_area_spread.py [--port 8011] [--days 3] [--taste 카페]

출력: 날짜별 방문 수·중심 좌표·가장 가까운 동네·중심에서 방문지까지 평균 거리, 끝에 날짜 중심 사이 최소 거리.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import time
import urllib.request
from datetime import date, timedelta

CITY_HALL = (37.5665, 126.9780)
# 이름 붙이기용 — 측정 출력에서 "어느 동네"인지 읽으려는 것뿐이다.
LANDMARKS = {
    "을지로·명동": (37.5660, 126.9850), "종로·익선": (37.5720, 126.9890), "북촌·삼청": (37.5826, 126.9830),
    "서촌": (37.5790, 126.9700), "홍대·연남": (37.5560, 126.9230), "연희": (37.5689, 126.9305),
    "이태원·한남": (37.5345, 126.9946), "성수": (37.5446, 127.0557), "강남역": (37.4979, 127.0276),
    "압구정·신사": (37.5240, 127.0270), "잠실": (37.5133, 127.1001), "여의도": (37.5219, 126.9245),
    "용산": (37.5298, 126.9648), "동대문": (37.5710, 127.0095),
}
# 백엔드 `PreferenceSet.ACTIVITIES` 한글 라벨 그대로(domain/persona.py `ACTIVITY_LABELS`).
TASTES = {"카페": {"activities": ["카페"]}, "쇼핑": {"activities": ["쇼핑"]},
          "야경": {"activities": ["야경"]}, "역사": {"activities": ["역사문화", "전시"]}, "": {}}


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    dlat = (a[0] - b[0]) * 111.0
    dlng = (a[1] - b[1]) * 111.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlng)


def lookup(ids: set[str]) -> dict[str, tuple[str, str, float, float]]:
    if not ids:
        return {}
    sql = ("select poi_id, name_ko, category, lat, lng from app.poi where poi_id in ("
           + ",".join(f"'{i}'" for i in ids) + ")")
    out = subprocess.run(["docker", "exec", "trippilot-db", "sh", "-c",
                          f'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -AtF"\t" -c "{sql}"'],
                         capture_output=True, text=True, check=True).stdout
    rows = [line.split("\t") for line in out.splitlines() if line]
    return {r[0]: (r[1], r[2], float(r[3]), float(r[4])) for r in rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8011)
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--taste", default="", choices=sorted(TASTES))
    ap.add_argument("--anchor", default="", help="lat,lng — 기본은 시청(숙소 없음)")
    args = ap.parse_args()
    start = date.today() + timedelta(days=10)
    dates = [start + timedelta(days=i) for i in range(args.days)]
    anchor = tuple(map(float, args.anchor.split(","))) if args.anchor else CITY_HALL
    body = {
        "trip_id": "00000000-0000-4000-8000-0000000a5ea1", "generation_mode": "FULLY_AI",
        "trip_context": {"destinations": ["서울"], "start_date": dates[0].isoformat(),
                         "end_date": dates[-1].isoformat()},
        "time_windows": [{"date": d.isoformat(), "start": "09:00", "end": "21:00"} for d in dates],
        "anchors": [{"date": d.isoformat(), "lat": anchor[0], "lng": anchor[1]} for d in dates],
        "preference_profile": TASTES[args.taste], "fixed_blocks": [], "excluded_poi_ids": [],
        "rejections": [], "include_explanations": False,
        "request_meta": {"request_id": f"spread-{time.time()}", "requested_at": f"{date.today()}T10:00:00+09:00",
                         "deadline_ms": 60000},
    }
    req = urllib.request.Request(f"http://localhost:{args.port}/ai/v1/itinerary/generate",
                                 data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    t0 = time.time()
    res = json.load(urllib.request.urlopen(req, timeout=180))
    info = lookup({s["poi_id"] for d in res["days"] for s in d["slots"]})
    centers = []
    print(f"취향={args.taste or '없음'} 앵커={anchor} {time.time() - t0:.1f}s solve={res.get('solve_mode')}")
    for d in res["days"]:
        pts = [(info[s["poi_id"]][2], info[s["poi_id"]][3]) for s in d["slots"] if s["poi_id"] in info]
        if not pts:
            print(f"  {d['date']}: 방문 0")
            continue
        c = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        centers.append(c)
        near = min(LANDMARKS, key=lambda k: km(c, LANDMARKS[k]))
        spread = sum(km(c, p) for p in pts) / len(pts)
        names = " / ".join(f"{info[s['poi_id']][0][:7]}" for s in d["slots"] if s["poi_id"] in info)
        print(f"  {d['date']}: n={len(pts)} 중심≈{near}({km(c, LANDMARKS[near]):.1f}km) "
              f"시청에서 {km(c, CITY_HALL):.1f}km 퍼짐 {spread:.1f}km | {names}")
    if len(centers) > 1:
        gaps = [km(a, b) for i, a in enumerate(centers) for b in centers[i + 1:]]
        print(f"  날짜 중심 사이 최소 {min(gaps):.1f}km · 최대 {max(gaps):.1f}km")


if __name__ == "__main__":
    main()
