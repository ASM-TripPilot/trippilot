"""장소 입장료 수집 — `content_id → {won, raw}` (TRIP-902 후속).

## 무엇을 만드나

`ai/data/place_fees.json`. 키는 **`content_id`**(= 백엔드 `sourceRef` = `Poi.source_ref`)라
런타임 후보에 조인해 붙일 수 있다. 백엔드 스키마를 건드리지 않는다 — `PoiInternalController`
의 `sourceRef` 주석이 "정본이 아니라 **조인 키**를 넘긴다"고 설계해 둔 그 용도다.

`avg_cost` 에는 넣지 않는다. 카테고리별 유료 중앙값이 5,000~16,500 으로 세 배 범위라
전역 임계 한 벌(`budget_limit`)로는 표현이 안 되고, 커버리지가 카테고리에 정렬돼
100%/0% 라 `budget_fit` 이 **설계되지 않은 카테고리 가중치**가 되어 버린다.

## `won` 세 값은 다른 뜻이다 — 합치지 마라

    0      측정된 무료
    정수    성인 1인 입장료
    null   **봤는데 못 읽었다** (`공연 별로 상이함`)
    키 없음  볼 것이 없었다 (요금 필드 자체가 없음)

`null` 과 키 부재를 합치면 파서를 고칠 근거가 사라진다. `raw` 를 남기는 이유도 같다 —
파서를 고치면 **재수집 없이 재파싱**할 수 있다(영업시간에서 실제로 겪은 일이다).

## 어디서 오나 (실측, 2026-09-22)

    타입 12 관광지    detailInfo2  → infoname `입 장 료`·`입장료`   값확보 71.5%
    타입 14 문화시설  detailIntro2 → `usefee`                     값확보 66.0%

28(레포츠)은 넣지 않는다 — `이용요금`이 93% 차 있지만 **1박 사이트 요금**이라 방문
비용이 아니다. 38·39 는 요금 필드가 아예 없다(두 엔드포인트 전 필드 확인).

    uv run python scripts/collect_place_fees.py --doc data/collected_pois.json \
        --out data/place_fees.json --max-calls 1200

## ⚠️ 하루 총합은 이 스크립트가 못 지킨다

`--max-calls` 는 **이번 실행**만 센다. 같은 날 프로브·앞선 수집이 얼마나 썼는지는
모른다. 실측(2026-09-23): 프로브 990 + 수집 2,800 + 재시도 1,800 = **5,590콜** 을
하루에 태워 계정이 429 로 막혔고, 두 실행이 통째로 버려졌다.

키 3개 기준 하루 3,000 이 상한이므로 **하루 한 번, 2,000 이하**로 돌린다. 같은 날
프로브를 돌렸으면 그만큼 뺀다. 이어가기가 있으니 여러 날에 나누는 비용은 0 이다.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

_BASE = "https://apis.data.go.kr/B551011/KorService2"
_OK = "0000"

# 타입 → (엔드포인트, 읽을 필드). 12 는 반복정보라 infoname 으로 찾는다.
_SOURCE: dict[str, tuple[str, tuple[str, ...]]] = {
    "12": ("detailInfo2", ("입 장 료", "입장료")),
    "14": ("detailIntro2", ("usefee",)),
}

# ── 파싱 ────────────────────────────────────────────────────────
# `원` 이 붙은 수만 금액으로 읽는다 — `어른 (25~64세) 1,000원` 의 나이,
# `20인 이상` 의 인원을 배제하려면 이 조건이 필요하다.
_AMOUNT = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+)\s*원")
# 성인 요금 라벨. 라벨과 금액 사이에 12자까지 허용한다.
# `관람료`·`입장료`·`개인` 은 **명시적 입장료 표지**다 — 이게 있으면 같은 기록에
# 체험비가 섞여 있어도 그 금액이 입장료다(실측: `관람료 5,000원` 이 같은 기록의
# `나무곤충만들기 6,000원` 때문에 통째로 버려졌다). `개인` 은 `[개인]/[단체]` 대비에서
# 개인가를 집는다 — 문서 순서상 개인이 먼저라 단체가를 집지 않는다.
_ADULT = re.compile(
    r"(성인|어른|일반|대인|관람료|입장료|관람권|개인)"
    r"[^\d]{0,12}(\d{1,3}(?:,\d{3})+|\d+)\s*원")
# 금액이 없는 괄호는 걷어낸다 — `성인 (20~65세) 12,000원` 처럼 **라벨과 금액 사이에
# 나이·기간이 끼면** 위 정규식이 금액에 닿지 못한다(실측 5건).
_PAREN_NO_WON = re.compile(r"\([^)원]*\)")
# 단체가는 대표값이 아니다 — 개인가보다 싸다.
_GROUP_HEAD = re.compile(r"\[\s*단체")
# 입장료가 아닌 요금. ⚠️ `반\s*\d` 에는 반드시 `(?<!일)` — 없으면 **`일반 9,000원`** 의
# "반"을 강좌명(`서예반 90,000원`)으로 읽어 진짜 입장료를 버린다(실측 21건).
# `대당`·`1대` 는 **단위가 다르다** — 인당 입장료가 아니라 차량당이라 4인이면
# 1/4 이다(실측: `차량 1대당 23,000원`). 파싱 실패가 아니라 단위 불일치이므로
# 대관료·수강료와 같은 계열로 둔다.
_NOT_ADMISSION = re.compile(
    r"대관|강좌|수강|과목|체험비|체험 ?활동|만들기|\d+박|숙박|회원|회비|"
    r"(?<!일)반\s*\d|강습|대당|\d+대\s*(?:당|기준)")
# 1박 단위 요금 — 방문 1회 비용이 아니다.
_OVERNIGHT = re.compile(r"캠핑|야영|글램핑|오토캠|카라반|휴양림|펜션|민박")
_FREE_ONLY = frozenset({"무료", "무료입장", "없음", "전액무료"})


def _clean(raw: str) -> str:
    text = re.sub(r"<[^>]+>", " ", raw).replace("\xa0", " ")
    return _PAREN_NO_WON.sub(" ", text)


def parse_fee(raw: str) -> int | None:
    """원문 → 성인 1인 입장료(원). 무료는 0, 못 읽으면 None — **지어내지 않는다**.

    입장료가 아닌 금액(대관료·수강료·1박)은 None 이다. "그 장소가 무료"라는 뜻이
    아니라 "입장료를 못 찾았다"는 뜻이라 0 으로 읽으면 안 된다.
    """
    text = _clean(raw)
    head = text[: m.start()] if (m := _GROUP_HEAD.search(text)) else text
    amounts = [int(a.replace(",", ""))
               for a in _AMOUNT.findall(head)] or [int(a.replace(",", ""))
                                                   for a in _AMOUNT.findall(text)]
    if amounts:
        if _OVERNIGHT.search(text):
            return None
        # **라벨을 먼저 본다.** 한 기록에 입장료와 체험비가 같이 오는 경우가 있어
        # (`관람료 5,000원` + `나무곤충만들기 6,000원`), 비입장료 표지를 먼저 보면
        # 멀쩡한 입장료까지 통째로 버린다. 명시적 표지가 있으면 그게 이긴다.
        if (hit := _ADULT.search(head)) is not None:
            return int(hit.group(2).replace(",", ""))
        if _NOT_ADMISSION.search(head):
            return None
        # 라벨이 없으면 개인가 최댓값 — `5,000원 (녹차 1잔 제공)` 처럼 나이 구분이
        # 아예 없는 단일 요금제가 있다. 라벨을 요구하면 이것들이 통째로 빠진다.
        return max(amounts)
    stripped = re.sub(r"[\s※\-\[\]()]", "", text)
    if stripped in _FREE_ONLY or (not amounts and "무료" in text and stripped):
        return 0
    return None


# ── 수집 ────────────────────────────────────────────────────────
class _KeyDead(Exception):
    """이 키로는 앞으로도 안 된다 — 퇴출하고 다음 키로. 일시 장애와 구분한다."""


# data.go.kr 공통 에러코드: 20 접근거부 · 22 한도초과 · 30 미등록 · 31 기한만료.
# HTTP 403 도 같은 뜻이다(`TourApiAdapter` 와 같은 판정 — 그쪽이 정본이다).
_KEY_DEAD_CODES = frozenset({"20", "22", "30", "31"})


def _get(endpoint: str, params: dict[str, str], key: str) -> list[dict]:
    q = urllib.parse.urlencode({
        "serviceKey": key, "MobileOS": "ETC", "MobileApp": "TripPilot",
        "_type": "json", **params})
    try:
        with urllib.request.urlopen(f"{_BASE}/{endpoint}?{q}", timeout=10.0) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 403:
            raise _KeyDead(f"HTTP 403 — 키 소진/거부") from e
        raise
    resp = body.get("response", {})
    if (code := (resp.get("header") or {}).get("resultCode")) != _OK:
        if str(code) in _KEY_DEAD_CODES:
            raise _KeyDead(f"resultCode={code}")
        raise RuntimeError((resp.get("header") or {}).get("resultMsg"))
    items = (resp.get("body") or {}).get("items") or {}
    if not isinstance(items, dict):
        return []
    got = items.get("item") or []
    return got if isinstance(got, list) else [got]


def _raw_fee(endpoint: str, fields: tuple[str, ...], items: list[dict]) -> str | None:
    """응답에서 요금 원문 1건. 없으면 None (= 키를 만들지 않는다)."""
    if endpoint == "detailInfo2":
        for it in items:                       # 반복정보: infoname 이 곧 필드명
            if str(it.get("infoname") or "").strip() in fields:
                if (v := str(it.get("infotext") or "").strip()):
                    return v
        return None
    first = items[0] if items and isinstance(items[0], dict) else {}
    for f in fields:
        if (v := str(first.get(f) or "").strip()):
            return v
    return None


def _targets(doc: dict) -> list[tuple[str, str]]:
    """(content_id, content_type_id) — 요금이 있는 타입만, 문서 순서 보존."""
    out = []
    for p in doc.get("proposals", []):
        pr = p.get("provenance") or {}
        cid, kind = pr.get("content_id"), pr.get("content_type_id")
        if cid and kind in _SOURCE:
            out.append((str(cid), str(kind)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max-calls", type=int, default=1200,
                    help="**이번 실행의** 호출 상한. 이 값은 같은 날 앞선 실행을 모른다 — "
                         "하루 총합이 한도(키 수 × 1,000)를 넘지 않게 부르는 쪽이 지켜야 한다")
    ap.add_argument("--max-failure-rate", type=float, default=0.05)
    args = ap.parse_args()

    keys = [k for k in (os.environ.get(n, "").strip()
                        for n in ("TOUR_API_KEY", "TOUR_API_KEY2", "TOUR_API_KEY3")) if k]
    if not keys:
        print("[fee] TOUR_API_KEY 없음 — 중단", file=sys.stderr)
        return 1

    doc = json.loads(args.doc.read_text(encoding="utf-8"))
    # 이어가기 — 이미 받은 것은 다시 부르지 않는다. 여러 날에 걸쳐 나눠 받는다.
    prev: dict = json.loads(args.out.read_text(encoding="utf-8")) if args.out.exists() else {}
    fees: dict[str, dict] = dict(prev.get("fees") or {})
    targets = _targets(doc)
    todo = [(cid, kind) for cid, kind in targets if cid not in fees]

    print(f"[fee] 대상 {len(todo):,}건 (기수집 {len(fees):,}건 건너뜀) · "
          f"이번 상한 {args.max_calls:,}콜", file=sys.stderr)

    calls = failures = key_idx = done = 0   # done=처리한 POI · calls=HTTP 호출
    stat: Counter[str] = Counter()
    fail_kind: Counter[str] = Counter()
    fail_at: list[int] = []                 # 실패한 호출 번호 — 모양으로 원인이 갈린다
    for cid, kind in todo:
        if calls >= args.max_calls:
            print(f"[fee] 상한 도달 — {len(todo) - done:,}건 남김 (다음 실행이 이어간다)",
                  file=sys.stderr)
            break
        endpoint, fields = _SOURCE[kind]
        # **키는 죽을 때까지 쓰고 그때 넘어간다.** 호출 수로 미리 나누면 안 된다 —
        # 프로세스가 매번 처음 키부터 시작하므로 하루에 여러 번 돌리면 **첫 키에만
        # 몰려** 일일 한도를 넘는다(실측: 403 이 898건, 실패율 32.4% 로 실행 전체가
        # 버려졌다). `TourApiAdapter` 가 같은 이유로 퇴출 방식을 쓴다 — 그쪽이 정본이다.
        items = None
        while key_idx < len(keys):
            calls += 1
            try:
                items = _get(endpoint, {"contentId": cid, "contentTypeId": kind},
                             keys[key_idx])
                break
            except _KeyDead as e:
                print(f"[fee] 키 #{key_idx + 1} 퇴출 ({e}) — 다음 키로", file=sys.stderr)
                key_idx += 1
            except Exception as e:                  # noqa: BLE001 — 개별 실패는 넘긴다
                failures += 1
                fail_kind[type(e).__name__ if not isinstance(e, urllib.error.HTTPError)
                          else f"HTTP {e.code}"] += 1
                fail_at.append(calls)
                print(f"[fee] {endpoint} {cid}: {e}", file=sys.stderr)
                break
        if key_idx >= len(keys):
            print(f"[fee] 키 전부 소진 — {len(todo) - done:,}건 남김 "
                  f"(다음 실행이 이어간다)", file=sys.stderr)
            break
        done += 1
        if items is None:
            continue
        raw = _raw_fee(endpoint, fields, items)
        if raw is None:
            stat["필드 없음"] += 1                   # 키를 만들지 않는다 — 볼 것이 없었다
            continue
        won = parse_fee(raw)
        fees[cid] = {"won": won, "raw": raw}
        stat["무료" if won == 0 else "유료" if won else "불명"] += 1
        if calls % 200 == 0:
            time.sleep(1)                           # 벤더 배려 — 한도는 계정 단위다

    rate = failures / calls if calls else 0.0
    print(f"\n[fee] 처리 {done:,}건 · 호출 {calls:,} · 실패 {failures:,} "
          f"({rate * 100:.1f}%) · 산 키 {len(keys) - key_idx}/{len(keys)}", file=sys.stderr)
    for k, v in stat.most_common():
        print(f"    {k:10} {v:,}", file=sys.stderr)
    # 실패를 삼키고 초록으로 끝내지 않는다 — 실패한 호출은 "값이 없다"와 구분되지 않아
    # 커버리지를 조용히 끌어내린다(2026-09-19 실측: 429 로 절반이 죽은 실행이 초록이었다).
    if failures:
        # **실패의 모양이 원인을 가른다.** 한 덩어리로 몰려 있으면 특정 키가 죽은
        # 것이고(회전이 그 키에 배정한 구간 전체가 실패한다), 흩어져 있으면 속도
        # 제한이나 망 문제다. 실측: 403 898건이 정확히 한 키 슬롯(900)이었는데
        # "동시 실행·일일 한도"만 안내해 엉뚱한 곳을 보게 했다.
        span = fail_at[-1] - fail_at[0] + 1
        # **HTTP 코드가 모양보다 앞선다.** 속도 제한도 연속으로 보이므로 모양만으로
        # 판정하면 429 를 "키가 죽었다"로 읽는다 — 실측에서 실제로 그렇게 찍혔다.
        # 코드가 말해 주면 그걸 쓰고, 안 말해 줄 때만 모양으로 좁힌다.
        top = fail_kind.most_common(1)[0][0] if fail_kind else ""
        if top == "HTTP 429":
            shape = "속도 제한 — 간격을 늘리거나 상한을 낮춰라"
        elif top == "HTTP 403":
            shape = ("연속 — 특정 키가 죽었거나 그 계정 한도 소진"
                     if span <= failures * 1.2 else "산발 403 — 계정 단위 스로틀 가능성")
        else:
            shape = ("연속 — 한 구간에 몰렸다" if span <= failures * 1.2
                     else "산발 — 망 문제 가능성")
        print(f"    실패 내역: "
              + " · ".join(f"{k} {v:,}" for k, v in fail_kind.most_common())
              + f"\n    실패 구간: {fail_at[0]:,}~{fail_at[-1]:,}번째 호출 "
                f"({span:,}칸에 {failures:,}건) — {shape}", file=sys.stderr)
    if rate > args.max_failure_rate:
        print(f"[fee] 실패율 {rate * 100:.1f}% > {args.max_failure_rate * 100:.0f}% — "
              f"산출물을 쓰지 않는다. **위 실패 내역·구간을 먼저 보라** — "
              f"HTTP 403 이 연속이면 키 문제, 429 면 속도, 흩어진 타임아웃이면 망이다.",
              file=sys.stderr)
        return 2

    args.out.write_text(json.dumps({
        "source": "tourapi:detailInfo2+detailIntro2",
        "fetched_at": time.strftime("%Y-%m-%d"),
        # 수집 모수 — 읽는 쪽이 `len(fees) / attempted` 로 커버리지를 **파일만 보고**
        # 계산한다. 이게 없으면 반쪽 파일인지 알 방법이 소비 측에 없고, 그렇다고
        # 소비 측에 "몇 건 이상이어야 한다"는 임계를 두면 근거 없는 상수가 하나 는다.
        "attempted": len(targets),
        "fees": fees,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    remaining = len(todo) - done
    print(f"[fee] {args.out} 기록 — 누적 {len(fees):,}건 · 남은 대상 {max(0, remaining):,}건",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
