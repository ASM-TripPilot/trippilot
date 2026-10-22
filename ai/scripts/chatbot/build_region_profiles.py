"""지역 성격표 — 도우미 지역 추천(RECOMMEND_REGION)이 읽는 `data/region_profiles.json` 을 공유본에서 만든다.

지역 = `domain/region_centers` 의 표 이름(닫힌 집합, INV-1). 각 지역 중심에서 반경 R(표 반경의 2배, 8~15km) 안의 등록 장소를
종류별로 세어, 전국 비율 대비 배수(lift)로 적는다 — "자연이 전국 평균보다 2.5배 많다"가 그 지역의 성격이다.
- **관광공사(TOURAPI) 출처만 센다.** 카카오·공공데이터(맛집·카페·술집)는 서울·부산·제주 같은 몇 곳만 깊게 모아서, 섞으면
  지역 성격이 아니라 수집 범위가 보인다(첫 계산에서 서울·홍대·성수가 술집·미술로, 지방이 전부 자연·문화로 갈렸다).
- **표본이 적으면 전국 평균 쪽으로 당긴다**(사전 강도 k=200, 베이즈 축소). 야경은 전국 39곳뿐이라 +1 보정만으로는 한 곳만
  있어도 20배가 나왔다.
- 관광공사에 거의 없는 종류(미술 28·술집 3·야경 19곳 — 전국 100곳 미만)는 배수를 1.0(모름)으로 적는다 — 한두 곳으로 12배가 났다.

실행(ai/ 에서, 공유본이 바뀌면 다시 돌려 커밋한다):
    python scripts/chatbot/build_region_profiles.py
"""

from __future__ import annotations

import json
import math
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

from trippilot.domain.region_centers import _CENTERS  # noqa: E402 — 표 이름·좌표의 정본

SRC, OUT = ROOT / "data/collected_pois.json", ROOT / "data/region_profiles.json"
_PRIOR = 200  # 베이즈 축소 강도 — 지역 n 이 이만큼이면 관측과 전국 평균을 반씩 믿는다
_MIN_NATIONAL = 100  # 전국에 이보다 적은 종류는 배수를 말하지 않는다


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = map(lambda p: (math.radians(p[0]), math.radians(p[1])), (a, b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def build() -> dict:
    proposals = json.loads(SRC.read_text(encoding="utf-8"))["proposals"]
    rows = [(p["poi"]["category"], (p["poi"]["coord"]["lat"], p["poi"]["coord"]["lng"]))
            for p in proposals if p.get("source") == "TOURAPI" and p["poi"].get("coord") and p["poi"].get("category") != "STAY"]
    national = Counter(c for c, _ in rows)
    total = sum(national.values())
    out = {}
    for name, (lat, lng, km) in _CENTERS.items():
        radius = min(max(km * 2, 8.0), 15.0)
        counts = Counter(c for c, xy in rows if _km((lat, lng), xy) <= radius)
        n = sum(counts.values())
        if n < 30:  # 너무 적으면 성격을 말할 수 없다 — 표에 넣지 않는다(지어내지 않는다)
            continue
        lift = {c: (round((counts[c] + _PRIOR * national[c] / total) / (n + _PRIOR) / (national[c] / total), 2)
                    if national[c] >= _MIN_NATIONAL else 1.0) for c in sorted(national)}
        out[name] = {"n": n, "radius_km": radius, "lift": lift, "count": {c: counts[c] for c in sorted(counts)}}
    return {"source": "data/collected_pois.json (TOURAPI 만)", "prior": _PRIOR, "national": dict(sorted(national.items())),
            "regions": out}


if __name__ == "__main__":
    data = build()
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(data['regions'])} regions → {OUT}")
