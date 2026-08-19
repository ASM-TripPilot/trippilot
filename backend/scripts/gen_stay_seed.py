#!/usr/bin/env python3
"""숙소 정본 시드 생성 — LOCALDATA 숙박업 인허가 대장(csv) → R__seed_stay.sql

원본: 행정안전부 지방행정인허가데이터(LOCALDATA) 「숙박업」
      https://file.localdata.go.kr/file/lodgings/info  (브라우저로 접근 — curl 은 403)
      CP949 · 37컬럼 · 폐업 포함 전수

사용법:
    python3 backend/scripts/gen_stay_seed.py <문화_숙박업.csv>

**좌표계가 위경도가 아니다.** `좌표정보(X/Y)` 는 EPSG:5174(중부원점 TM)다. 변환 없이 쓰면
서울 업소가 위도 198575 로 들어간다. 검증: 서울 종로 업소 → 37.569/126.985 (실좌표 일치).

pyproj 가 필요하다:  python3 -m venv .venv && .venv/bin/pip install pyproj
"""
import csv
import re
import sys
import collections
from pathlib import Path

# 여행 숙소로 내보내지 않을 업태. 영업중 31,152 중 17,763(57%)이 여기 해당한다 —
# 그대로 탐색 화면에 쏟으면 여행 앱이 아니라 숙박업소 대장이 된다.
EXCLUDED_TYPES = {"여관업", "여인숙업"}

# 업태구분명 → 우리 stayType. 원본 어휘를 그대로 쓰지 않는 이유는 화면에 나가는 말이기 때문이다.
STAY_TYPE = {
    "관광호텔": "호텔",
    "일반호텔": "호텔",
    "휴양콘도미니엄업": "리조트",
    "숙박업(생활)": "생활숙박",
    "숙박업 기타": "기타",
}

# 대한민국 영역 상자(RegionLocator 와 같은 값) — 변환이 틀어졌을 때 조용히 통과하지 않게.
LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX = 32.9, 38.7, 124.5, 132.0


def load_catalog(seed_path: Path):
    """행정구역 카탈로그 시드에서 이름→코드 표를 만든다. 주소의 시도·시군구를 코드로 옮기는 데 쓴다."""
    text = seed_path.read_text(encoding="utf-8")
    rows = re.findall(
        r"\('(\d+)', '([^']+)', '(\d+)', '([^']+)', '(SIDO|SIGUNGU)', (?:true|false)\)", text
    )
    sido = {name: code for code, name, _, _, level in rows if level == "SIDO"}
    sigungu = collections.defaultdict(dict)
    for code, name, sido_code, _, level in rows:
        if level == "SIGUNGU":
            sigungu[sido_code][name] = code
    return sido, sigungu


def resolve(address: str, sido: dict, sigungu: dict):
    """주소 → (region_code, 표시용 지역명). 시군구를 못 찾으면 시도까지만 내려간다.

    **못 정하면 None 이다** — 지어낸 코드가 들어가면 그 지역 숙소 목록에 엉뚱한 곳이 섞인다.
    """
    parts = address.split()
    if not parts:
        return None, None
    sido_code = sido.get(parts[0])
    if sido_code is None:
        return None, None
    under = sigungu.get(sido_code, {})
    two = " ".join(parts[1:3]) if len(parts) >= 3 else None
    if two and two in under:
        return under[two], two
    if len(parts) >= 2 and parts[1] in under:
        return under[parts[1]], parts[1]
    return sido_code, parts[0]


def main(path: str) -> int:
    src = Path(path)
    if not src.is_file():
        print(f"원본을 찾지 못했습니다: {src}", file=sys.stderr)
        return 2
    try:
        from pyproj import Transformer
    except ImportError:
        print("pyproj 가 필요합니다: python3 -m venv .venv && .venv/bin/pip install pyproj", file=sys.stderr)
        return 2

    root = Path(__file__).resolve().parents[1]
    sido, sigungu = load_catalog(root / "app/src/main/resources/db/migration/R__seed_region_catalog.sql")
    to_wgs84 = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True)

    rows, dropped = [], collections.Counter()
    with open(src, encoding="cp949", errors="replace") as f:
        for row in csv.DictReader(f):
            if not (row.get("영업상태명") or "").startswith("영업"):
                dropped["폐업"] += 1
                continue
            raw_type = (row.get("업태구분명") or "").strip()
            if raw_type in EXCLUDED_TYPES:
                dropped["제외업태"] += 1
                continue
            x = (row.get("좌표정보(X)") or "").strip()
            if not x:
                dropped["좌표없음"] += 1
                continue
            lng, lat = to_wgs84.transform(float(x), float(row["좌표정보(Y)"]))
            if not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
                dropped["영역밖"] += 1
                continue
            address = (row.get("도로명주소") or row.get("지번주소") or "").strip()
            code, region = resolve(address, sido, sigungu)
            if code is None:
                dropped["지역미해결"] += 1
                continue
            name = (row.get("사업장명") or "").strip()
            ext_id = (row.get("관리번호") or "").strip()
            if not name or not ext_id:
                dropped["식별불가"] += 1
                continue
            rows.append((ext_id, name, lat, lng, region, code, STAY_TYPE.get(raw_type, "기타")))

    # 같은 관리번호가 두 번 오면 뒤엣것만 — PK 충돌로 시드 전체가 실패하는 것을 막는다.
    deduped = {r[0]: r for r in rows}
    dropped["문서내중복"] = len(rows) - len(deduped)

    def esc(v: str) -> str:
        return v.replace("'", "''")

    out = [
        "-- R__ 반복 시드 — 숙소 정본. **생성물이다. 손으로 고치지 마라.**",
        "-- 원본: 행정안전부 LOCALDATA 「숙박업」 / 생성: backend/scripts/gen_stay_seed.py",
        f"-- 수록 {len(deduped):,}곳 · 여관업·여인숙업 제외 · 좌표 EPSG:5174→WGS84 변환",
        "--",
        "-- amenities 는 비어 있다 — LOCALDATA 가 편의시설을 주지 않는다. '없음'이 아니라 '모름'이라",
        "-- 응답이 그 사실을 따로 알린다(필터가 조용히 0건을 내지 않도록).",
        "",
        "INSERT INTO stay (external_source, external_id, name, lat, lng, region, region_code, stay_type) VALUES",
    ]
    out.append(",\n".join(
        f"  ('LOCALDATA', '{esc(i)}', '{esc(n)}', {lat:.6f}, {lng:.6f}, '{esc(r)}', '{c}', '{t}')"
        for i, n, lat, lng, r, c, t in sorted(deduped.values())
    ))
    out.append("ON CONFLICT (external_source, external_id) DO UPDATE SET")
    out.append("  name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,")
    out.append("  region = EXCLUDED.region, region_code = EXCLUDED.region_code,")
    out.append("  stay_type = EXCLUDED.stay_type, updated_at = now();")
    out.append("")

    dest = root / "app/src/main/resources/db/migration/R__seed_stay.sql"
    dest.write_text("\n".join(out), encoding="utf-8")
    print(f"생성: {dest}  ({len(deduped):,}곳)")
    print("  제외:", dict(dropped))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
