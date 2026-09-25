#!/usr/bin/env python3
"""숙소 정본 시드 생성 — LOCALDATA 숙박업 인허가 대장(csv) → R__seed_stay.sql

원본: 행정안전부 지방행정인허가데이터(LOCALDATA) 「숙박업」
      https://file.localdata.go.kr/file/lodgings/info
      CP949 · 37컬럼 · 폐업 포함 전수

**받는 것은 사람 몫이다 — 다만 "curl 로는 안 된다"는 이유 때문은 아니다.**
종전 주석이 "curl 은 403" 이라고만 적어 두어 자동화가 불가능한 것처럼 읽혔는데,
403 은 그냥 User-Agent 차단이다(2026-09-23 실측):

    기본 curl                 → 403
    브라우저 UA + Referer     → 200

진짜 걸림돌은 그다음이다. 200 으로 오는 것은 **안내 페이지(HTML)** 이고 파일이 아니다.
내려받기 링크가 정적 `href` 로 있지 않고 JS 가 만든다 — `/file/lodgings/{download,csv,zip,…}`
을 찔러봐도 전부 Spring 기본 500(catch-all)이라 경로 추측으로는 닿지 않는다.

자동화하려면 정식 경로인 **LOCALDATA 변동분 OpenAPI**(`auth_key`·`lastModTsBgn/End`·
`pageIndex/pageSize`)를 쓴다. 인증키 발급이 선행이고, 생성기 입력이 CSV 에서 API 응답으로
바뀌는 작업이다. 월 1회 갱신에 드는 수고(≈15분)를 생각하면 아직 값이 안 맞아 미뤘다 —
주기를 올려야 할 이유가 생기면 그때 한다.

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


# 실재하는 국번만. **화이트리스트여야 한다** — "0 으로 시작하고 자릿수가 맞으면 통과"로 두면
# 원본의 깨진 값이 `069-3564-9718` 같은 **멀쩡해 보이는 가짜**가 되어 형식 검사를 통과한다(실측 2건).
AREA_CODES = {
    "02",                                                   # 서울(유일한 2자리)
    "031", "032", "033", "041", "042", "043", "044",
    "051", "052", "053", "054", "055", "061", "062", "063", "064",
    "070",                                                  # 인터넷전화
    "010",                                                  # 이동전화
}
# **`011`·`016`~`019` 는 일부러 뺐다.** 2G 종료로 끊긴 번호라 통과시키면 안 걸리는 번호를
# 내보내게 된다 — 060 을 버리는 것과 같은 이유다(현재 원본에는 0건이라 지금 바뀌는 값은 없다).
#
# 안심번호는 국번이 **4자리다**. 3자리로 끊으면 `0507-456-0364` 가 `050-7456-0364` 로 나간다 —
# 숫자열은 같아서 전화는 걸리지만 화면에 틀린 번호가 보인다(실측 4건).
RELAY_PREFIXES = {"0502", "0503", "0504", "0505", "0506", "0507", "0508"}


def normalize_phone(raw: str):
    """원본 전화번호 → 표시형 `02-2267-7474`. 못 믿을 값은 **None 이다**.

    원본이 하이픈 없는 숫자열로 온다(`0222677474`). 그대로 화면에 내보내면 읽히지도 않고
    `tel:` 링크로도 안 예쁘다.

    **버리는 쪽이 기본이다.** 틀린 번호로 전화를 걸게 하느니 번호를 안 주는 편이 낫다
    (NULL = "모름"). 두 갈래로 버린다:

    - **선두 0 이 없는 값**(실측 66건) — 원본이 어딘가에서 수치로 취급돼 앞의 0 이 날아갔다.
      `21717000` 처럼 8자리인데, 서울 `02` 인지 `021` 인지 복원하려면 추측해야 한다.
    - **실재하지 않는 국번**(실측 2건) — `069…`·`060…`. 특히 060 은 정보이용료 번호라
      눌리면 사용자에게 요금이 붙는다.

    남는 7~8자리는 뒤 4자리를 기준으로 가른다 — `02|743|1450` · `02|2267|7474` · `070|8869|6165`.
    """
    digits = re.sub(r"\D", "", raw or "")
    if digits[:4] in RELAY_PREFIXES:
        area = digits[:4]
    elif digits[:3] in AREA_CODES or digits[:2] == "02":
        area = "02" if digits[:2] == "02" else digits[:3]
    else:
        return None
    rest = digits[len(area):]
    if len(rest) not in (7, 8):
        return None
    exchange = rest[:-4]

    # **유선 국번은 0·1 로 시작하지 않는다.** 이 검사가 없으면 원본의 깨진 값이 형식만 맞는
    # 가짜로 통과한다(실측 35건):
    #   - `02-0773-8803` (18건) — 0 으로 시작하는 국번은 존재하지 않는다. 원본에 0 이 하나 더
    #     붙었는지 지역번호가 잘못 붙었는지 알 수 없어 **복원하지 않고 버린다.**
    #   - `02-1644-xxxx` (17건) — 15xx·16xx·18xx 전국대표번호에 지역번호가 잘못 붙은 것이다.
    #     대표번호는 지역번호 없이 8자리로 건다. 앞을 떼면 `1644-xxxx` 로 살릴 수 있지만
    #     **표시 모양이 하나 더 늘어** 화면·검사가 둘을 알아야 한다. 0.2% 를 위해 치를 값이
    #     아니라고 보고 NULL 로 둔다(살리려면 별도 티켓).
    # 이동전화(010)·인터넷전화(070)·안심번호(050X)는 이 규칙을 따르지 않으므로 제외한다.
    if area not in RELAY_PREFIXES and area not in ("010", "070") and exchange[0] in "01":
        return None

    return f"{area}-{exchange}-{rest[-4:]}"


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
    # **새 칸을 여기 빠뜨리면 기존 DB 는 영원히 비어 있다.** 정본 행이 이미 있는 환경에서는 재실행이
    # 전부 이 충돌 경로를 탄다 — INSERT 절만 고치면 빌드는 초록인데 값이 안 들어온다.
    out.append("ON CONFLICT (external_source, external_id) DO UPDATE SET")
    out.append("  name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng,")
    out.append("  region = EXCLUDED.region, region_code = EXCLUDED.region_code,")
    out.append("  stay_type = EXCLUDED.stay_type, address = EXCLUDED.address,")
    out.append("  phone = EXCLUDED.phone, rooms = EXCLUDED.rooms, updated_at = now();")
    out.append("")
    # **폐업한 곳을 지운다.** upsert 만으로는 사라진 행이 정본에 영원히 남는다 — 2026-09-22 원본
    # 갱신에서 21곳이 빠졌는데, 그대로 두면 없어진 숙소가 계속 검색에 뜨고 이제는 **전화번호까지
    # 달려 있어** 사용자가 문 닫은 곳에 전화를 건다.
    #
    # 판정은 `updated_at` 으로 한다. Flyway 는 스크립트 하나를 한 트랜잭션에서 돌리고 `now()` 는
    # 트랜잭션 시작 시각으로 고정되므로, 위 upsert 가 건드린 행은 **정확히** `updated_at = now()` 다.
    # 그보다 이전이면 이번 원본에 없던 행이다. 빈 DB 에서는 전부 같은 값이라 한 건도 안 지운다.
    #
    # `stay` 를 참조하는 FK 는 없다. 저장한 숙소(`saved_stay`)는 이름·좌표 사본을 따로 갖는다 —
    # "외부 조회 불가해져도 사용 가능"이 정본의 설계다(U1 domain-entities §2).
    out.append("-- 이번 원본에 없는 행 = 폐업. 위 upsert 가 건드리지 않은 것만 남는다.")
    out.append("DELETE FROM stay WHERE external_source = 'LOCALDATA' AND updated_at < now();")
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
