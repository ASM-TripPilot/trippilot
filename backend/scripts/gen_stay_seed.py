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

    # **행정구는 상위 시로 접는다.** `수원시 장안구`(41111)를 그대로 두면 사용자가 고를 수 있는
    # `수원시`(41110)로 조회할 때 접두사가 안 맞아 **0건**이 된다 — 41111 은 41110 으로 시작하지 않는다.
    # POI 쪽 `RegionResolver` 가 같은 규칙을 쓴다. 둘이 갈리면 같은 주소가 다른 코드로 저장된다.
    if two and two in under:
        code = under[two]
        parent = under.get(parts[1]) if len(parts) >= 2 else None
        if parent is not None:
            return parent, parts[1]
        return code, two
    if len(parts) >= 2 and parts[1] in under:
        return under[parts[1]], parts[1]
    return sido_code, parts[0]


def normalize_phone(raw: str):
    """원본 전화번호 → 표시형 `02-1670-8876`. 못 믿을 값은 **None 이다**.

    원본이 하이픈 없는 숫자열로 온다(`0216708876`). 그대로 화면에 내보내면 읽히지도 않고
    `tel:` 링크로도 안 예쁘다.

    **선두 0 이 없는 값은 버린다**(실측 66건). 원본이 어딘가에서 수치로 취급돼 앞의 0 이
    날아간 행들인데 — `21717000` 처럼 8자리다 — 서울 `02` 인지 `021` 인지 복원하려면 추측해야
    한다. 틀린 번호로 전화를 걸게 하느니 번호를 안 주는 편이 낫다(NULL = "모름").

    지역번호는 서울만 2자리고 나머지는 3자리다(070·010 포함). 남는 7~8자리를 뒤 4자리 기준으로
    가른다 — `02|743|1450` · `02|1670|8876` · `070|8869|6165`.
    """
    digits = re.sub(r"\D", "", raw or "")
    if not digits.startswith("0"):
        return None
    area = "02" if digits.startswith("02") else digits[:3]
    rest = digits[len(area):]
    if len(rest) not in (7, 8):
        return None
    return f"{area}-{rest[:-4]}-{rest[-4:]}"


def room_count(row: dict):
    """양실+한실 → 객실 수. 둘 다 비면 **None 이다**(0 이 아니다).

    0 을 그대로 넣으면 "객실 0개인 숙소"가 화면에 나간다 — 미기재와 구분이 안 된다(실측 59건).
    DB 의 `ck_stay_rooms_positive` 가 이 규칙을 생성기 바깥에서 한 번 더 지킨다.
    """
    def n(key: str) -> int:
        v = (row.get(key) or "").strip()
        return int(v) if v.isdigit() else 0

    total = n("양실수") + n("한실수")
    return total or None


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
            rows.append((
                ext_id, name, lat, lng, region, code, STAY_TYPE.get(raw_type, "기타"),
                address, normalize_phone(row.get("전화번호")), room_count(row),
            ))

    # 같은 관리번호가 두 번 오면 뒤엣것만 — PK 충돌로 시드 전체가 실패하는 것을 막는다.
    deduped = {r[0]: r for r in rows}
    dropped["문서내중복"] = len(rows) - len(deduped)

    def esc(v: str) -> str:
        return v.replace("'", "''")

    def lit(v) -> str:
        """NULL 과 빈 문자열을 가른다 — `''` 로 넣으면 '모름'이 '빈 값'이 되어 화면이 구분을 잃는다."""
        if v is None:
            return "NULL"
        return str(v) if isinstance(v, int) else f"'{esc(v)}'"

    vals = sorted(deduped.values())
    n_all = len(vals)
    have = {  # 채움률을 파일 머리에 박는다 — 원본이 바뀌면 재생성 diff 에서 바로 보인다.
        "주소": sum(1 for v in vals if v[7]),
        "전화": sum(1 for v in vals if v[8]),
        "객실": sum(1 for v in vals if v[9]),
    }

    out = [
        "-- R__ 반복 시드 — 숙소 정본. **생성물이다. 손으로 고치지 마라.**",
        "-- 원본: 행정안전부 LOCALDATA 「숙박업」 / 생성: backend/scripts/gen_stay_seed.py",
        f"-- 수록 {n_all:,}곳 · 여관업·여인숙업 제외 · 좌표 EPSG:5174→WGS84 변환",
        "--",
        "-- amenities 는 비어 있다 — LOCALDATA 가 편의시설을 주지 않는다. '없음'이 아니라 '모름'이라",
        "-- 응답이 그 사실을 따로 알린다(필터가 조용히 0건을 내지 않도록).",
        "--",
        "-- address·phone·rooms 는 칸마다 채움률이 다르고 **NULL 이 '모름'을 뜻한다**:",
        "--   " + " · ".join(f"{k} {v:,} ({v / n_all * 100:.1f}%)" for k, v in have.items()),
        "",
        "INSERT INTO stay (external_source, external_id, name, lat, lng, region, region_code,"
        " stay_type, address, phone, rooms) VALUES",
    ]
    out.append(",\n".join(
        f"  ('LOCALDATA', '{esc(i)}', '{esc(n)}', {lat:.6f}, {lng:.6f}, '{esc(r)}', '{c}', '{t}',"
        f" {lit(addr)}, {lit(tel)}, {lit(rooms)})"
        for i, n, lat, lng, r, c, t, addr, tel, rooms in vals
    ))
    # **새 칸을 여기 빠뜨리면 기존 DB 는 영원히 비어 있다.** 정본 12,782행이 이미 있으므로 재실행은
    # 전부 이 충돌 경로를 탄다 — INSERT 절만 고치면 빌드는 초록인데 값이 안 들어온다.
    out.append("ON CONFLICT (external_source, external_id) DO UPDATE SET")
    out.append("  name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,")
    out.append("  region = EXCLUDED.region, region_code = EXCLUDED.region_code,")
    out.append("  stay_type = EXCLUDED.stay_type, address = EXCLUDED.address,")
    out.append("  phone = EXCLUDED.phone, rooms = EXCLUDED.rooms, updated_at = now();")
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
