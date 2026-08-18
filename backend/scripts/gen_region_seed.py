#!/usr/bin/env python3
"""행정구역 카탈로그 시드 생성 — 법정동코드 전체자료(txt) → R__seed_region_catalog.sql

**코드를 지어내지 않는다.** 시군구 코드는 사람이 외울 수 없고 하나만 틀려도 그 위에 붙는
POI 매핑(TRIP-359)이 함께 어긋난다. 원본 파일에서만 만든다.

원본: 행정안전부 「법정동코드 전체자료」 (탭 구분 · CP949)
      법정동코드(10자리) / 법정동명 / 폐지여부

사용법:
    python3 backend/scripts/gen_region_seed.py <법정동코드_전체자료.txt>

층 판정은 **코드 패턴이 아니라 이름 토큰 수**로 한다 — 세종특별자치시는 시군구가 없는 단층제라
코드가 3611000000 이고, XX00000000 패턴으로 거르면 통째로 빠진다(실제로 한 번 놓쳤다).
"""
import sys
from pathlib import Path

SRC_NOTE = "행정안전부 법정동코드 전체자료"


def sido_selectable(name: str) -> bool:
    """시도 단위를 목적지로 고를 수 있는가 — 범위가 도시급인 것만.

    도(道)는 범위가 너무 넓어 POI 후보가 흩어진다. 전남광주통합특별시는 이름이 '특별시'지만
    옛 전라남도 전체를 포함하므로 도(道)로 다룬다 — 이름이 아니라 범위로 판단한다.
    """
    if "통합특별시" in name:
        return False
    if name.endswith("도") and "제주" not in name:
        return False
    return True


def short_name(full: str) -> str:
    """표시명 — 시도명을 뺀 마지막 토큰. '경기도 수원시 장안구' → '수원시 장안구'(행정구는 상위를 남긴다)."""
    parts = full.split()
    return parts[0] if len(parts) == 1 else " ".join(parts[1:])


def main(path: str) -> int:
    src = Path(path)
    if not src.is_file():
        print(f"원본을 찾지 못했습니다: {src}", file=sys.stderr)
        return 2

    alive = []
    with open(src, encoding="cp949") as f:
        next(f)
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) >= 3 and cols[2].strip() == "존재":
                alive.append((cols[0].strip(), cols[1].strip()))

    sido, sigungu = [], []
    for code, name in alive:
        tokens = name.split()
        if len(tokens) == 1:
            sido.append((code[:2], name))
        elif len(tokens) in (2, 3) and code[5:] == "00000":
            # 2토큰 = 시군구, 3토큰 = 일반시의 행정구(수원시 장안구). 둘 다 5자리 코드 층이다.
            sigungu.append((code[:5], name, len(tokens) == 2))

    by_sido = {c: n for c, n in sido}
    rows = []
    for code, name in sorted(sido):
        rows.append((code, short_name(name), code, name, "SIDO", sido_selectable(name)))
    for code, full, is_plain in sorted(sigungu):
        sido_code = code[:2]
        rows.append((code, short_name(full), sido_code, by_sido.get(sido_code, full.split()[0]),
                     "SIGUNGU", is_plain))

    # 별칭 — 폐지된 옛 이름으로도 찾게 한다. 통합 개편이 또 오면 여기만 늘린다.
    aliases = [("광주", "12"), ("광주광역시", "12"), ("전남", "12"), ("전라남도", "12")]

    def esc(v: str) -> str:
        return v.replace("'", "''")

    out = [
        f"-- R__ 반복 시드 — 행정구역 카탈로그(TRIP-357). **생성물이다. 손으로 고치지 마라.**",
        f"-- 원본: {SRC_NOTE} / 생성: backend/scripts/gen_region_seed.py",
        f"-- 시도 {len(sido)} · 시군구·행정구 {len(sigungu)} · 선택가능 {sum(1 for r in rows if r[5])}",
        f"--",
        f"-- 멱등: PK 충돌 시 갱신. 커버리지(POI 수)는 여기 없다 — 저장하지 않고 조회 때 센다(V2.25).",
        "",
        "INSERT INTO region (region_code, name, sido_code, sido_name, level, selectable) VALUES",
    ]
    out.append(",\n".join(
        f"  ('{c}', '{esc(n)}', '{sc}', '{esc(sn)}', '{lv}', {str(sel).lower()})"
        for c, n, sc, sn, lv, sel in rows
    ) + "")
    out.append("ON CONFLICT (region_code) DO UPDATE SET")
    out.append("  name = EXCLUDED.name, sido_code = EXCLUDED.sido_code, sido_name = EXCLUDED.sido_name,")
    out.append("  level = EXCLUDED.level, selectable = EXCLUDED.selectable, updated_at = now();")
    out.append("")
    out.append("INSERT INTO region_alias (alias, region_code) VALUES")
    out.append(",\n".join(f"  ('{esc(a)}', '{c}')" for a, c in aliases))
    out.append("ON CONFLICT DO NOTHING;")
    out.append("")

    # **CWD 에 의존하지 않는다.** 리포 루트에서만 도는 상대경로였다가, backend/ 에서 돌리면
    # FileNotFoundError 트레이스백만 뱉고 끝났다 — 어디서 돌려도 같은 파일을 쓴다.
    dest = Path(__file__).resolve().parents[1] / "app/src/main/resources/db/migration/R__seed_region_catalog.sql"
    dest.write_text("\n".join(out), encoding="utf-8")
    print(f"생성: {dest}  (시도 {len(sido)} · 시군구/행정구 {len(sigungu)} · 별칭 {len(aliases)})")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(2)
    raise SystemExit(main(sys.argv[1]))
