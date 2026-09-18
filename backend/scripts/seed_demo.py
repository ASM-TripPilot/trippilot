#!/usr/bin/env python3
"""스프린트3 범위 데모 데이터 시더 — 공개 REST API 로만 만든다.

왜 API 로만 만드나
------------------
SQL 로 직접 넣으면 **앱이 절대 만들 수 없는 상태**가 만들어진다(거점 없는 확정 일정,
기간 밖 배정 …). 그 상태로 화면을 보면 없는 버그를 쫓게 된다. 여기서는 사용자가 누르는 순서
그대로 호출하므로, 시드가 만들어지는 것 자체가 그 경로에 대한 얕은 검증이기도 하다.

예외는 **POI 정본**이다 — 사용자 생성 API 가 없어(수집 게이트 소관) 반복 시드
`R__seed_stub_pois.sql` 이 맡는다. 이 스크립트는 그 POI 를 조회해서 쓴다.

토큰을 왜 인자로 받나
--------------------
JWT 서명 키는 **기동할 때마다 새로 생성**된다(`JwtSecurityConfig.rsaKey`). 즉 밖에서 토큰을
만들 수 없고, 프로세스를 재시작하면 이전 토큰이 죽는다. 그래서 실제 소셜 로그인으로 받은
토큰을 넘겨받는다 — 프론트에서 로그인한 **그 계정에** 데이터가 쌓이므로 화면으로 바로 확인된다.

사용법
------
    # 앱 실행 (로컬 프로필: 소셜 자격증명 필요)
    SPRING_PROFILES_ACTIVE=local ./gradlew bootRun

    # 로그인 후 액세스 토큰을 복사해서
    python3 backend/scripts/seed_demo.py --token "<accessToken>"

    python3 backend/scripts/seed_demo.py --token "$T" --only s2   # 시나리오 하나만
    python3 backend/scripts/seed_demo.py --token "$T" --base-url http://localhost:8080

만들어지는 시나리오
------------------
    s1  거점 확정 + 필수방문지 → **생성 직전**    (h07~h09 진입 지점)
    s2  거점 겹침 **미해소**                      (TRIP-190 해소 시트 · 일정 생성 차단 확인)
    s3  생성 완료(2차까지 폴링)                    (h11 초안 · 리비전)
    s4  확정 완료                                  (h34 읽기전용)
    s5  **여행 중**(오늘 포함) + 방문 실적          (h25 · Plan-B 재계획 진입)
    s6  다도시(제주→부산) 구간 거점                 (US-STAY-07)
    s7  겹침 **해소 후 생성**                        (TRIP-190 결말 · 해소가 앵커에 실리는지)

각 시나리오는 독립된 여행을 만든다 — 하나를 망가뜨려도 나머지를 다시 만들 필요가 없다.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta

DEFAULT_BASE_URL = "http://localhost:8080/api/v1"


class ApiError(RuntimeError):
    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        super().__init__(f"{method} {path} → {status}\n{body}")
        self.status = status


class Api:
    """얇은 HTTP 클라이언트. 실패를 삼키지 않는다 — 시드가 조용히 반쪽만 만들어지면 더 나쁘다."""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None, allow: tuple[int, ...] = ()):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read().decode()
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            if e.code in allow:
                return None
            if e.code == 401:
                raise SystemExit(
                    "401 — 토큰이 만료됐거나 앱이 재시작됐습니다.\n"
                    "  서명 키는 기동마다 새로 생성되므로 재시작 후에는 다시 로그인해 토큰을 받아야 합니다."
                ) from e
            raise ApiError(method, path, e.code, raw) from e
        except urllib.error.URLError as e:
            raise SystemExit(f"앱에 연결하지 못했습니다({self.base_url}): {e.reason}") from e

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body=None, allow=()):
        return self.call("POST", path, body, allow)

    def put(self, path, body=None):
        return self.call("PUT", path, body)


def log(msg: str) -> None:
    print(f"  {msg}", flush=True)


# ───────────────────────── 재료 ─────────────────────────

def pois(api: Api, region: str) -> list[dict]:
    """지역의 ACTIVE POI. 비어 있으면 후보풀이 없다는 뜻이라 여기서 멈춘다 — 빈 일정을 만들어 놓고
    '생성이 이상하다'고 오해하는 편이 훨씬 비싸다(INV-1 closed-set)."""
    # 응답이 `{items, nextCursor}` 객체다(TRIP-503) — 배열이 아니다.
    # 시더는 후보 4건이면 충분해 다음 장을 이어 받지 않는다.
    found = (api.get(f"/places?region={urllib.parse.quote(region)}") or {}).get("items") or []
    if len(found) < 4:
        raise SystemExit(
            f"'{region}' ACTIVE POI 가 {len(found)}건뿐입니다. 후보풀이 비면 일정이 빈 채로 생성됩니다.\n"
            "  R__seed_stub_pois.sql 이 적용됐는지 확인하세요(앱 재기동 시 Flyway 가 반복 시드를 재적용)."
        )
    return found


def make_trip(api: Api, title: str, start: date, end: date, dests: list[tuple[str, int]]) -> str:
    trip = api.post("/trips", {
        "title": title,
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "party": 2,
        "companionType": "친구",
        "budgetTotal": 800000,
        "preferenceSnapshot": {},
        "destinations": [{"seq": i, "region": r, "nights": n} for i, (r, n) in enumerate(dests)],
    })
    return trip["tripId"]


def make_stay(api: Api, name: str, lat: float, lng: float) -> str:
    stay = api.post("/saved-stays", {
        "name": name, "registerRoute": "PIN", "lat": lat, "lng": lng, "coordConfirmed": True,
    })
    return stay["savedStayId"]


def assign(api: Api, trip: str, stay: str, frm: date, to: date) -> None:
    api.post(f"/trips/{trip}/bases", {
        "savedStayId": stay, "dateFrom": frm.isoformat(), "dateTo": to.isoformat(),
    })


def resolve_all(api: Api, trip: str) -> dict:
    """미해결 날짜를 전부 골라 커버리지 차단을 푼다(TRIP-190). 화면의 해소 시트가 하는 일과 같다."""
    cov = api.get(f"/trips/{trip}/coverage")
    for day in cov["days"]:
        if day.get("resolution"):
            continue
        pick = (day.get("candidates") or [None])[0]
        if pick is None:  # 공백일 — 이 여행에 배정된 숙소 중 아무거나
            bases = api.get(f"/trips/{trip}/bases")
            pick = bases[0]["savedStayId"] if bases else None
        if pick is None:
            continue
        cov = api.put(f"/trips/{trip}/coverage/days/{day['date']}", {"savedStayId": pick})
    return cov


def add_must_visits(api: Api, trip: str, places: list[dict], fixed_on: date) -> None:
    api.post(f"/trips/{trip}/must-visits", {"poiId": places[0]["poiId"], "type": "ANYTIME"})
    api.post(f"/trips/{trip}/must-visits", {
        "poiId": places[1]["poiId"], "type": "FIXED",
        "fixedDate": fixed_on.isoformat(), "fixedStart": "12:00", "dwellMin": 90,
    })


def generate_and_wait(api: Api, trip: str) -> dict:
    """생성 후 2차 완료까지 폴링 — 실 클라이언트가 하는 일과 같다(h09·h10)."""
    created = api.post(f"/trips/{trip}/itinerary", {"generationMode": "FULLY_AI"})
    session = created.get("generationSessionId")
    if session:
        log(f"진행 상태 세션 {session[:8]}… (2차 진행 중)")
    for _ in range(120):
        it = api.get(f"/trips/{trip}/itinerary")
        if it["generationState"] in ("COMPLETE", "FAILED"):
            return it
        time.sleep(0.5)  # 고정 대기 대신 상태로 기다린다 — 2차는 비동기라 완료 시점이 비결정적이다
    raise SystemExit("2차 생성이 기한 내 끝나지 않았습니다.")


# ───────────────────────── 시나리오 ─────────────────────────

def s1(api: Api) -> str:
    """생성 직전 — 거점이 확정돼 있고 필수 방문지가 있다."""
    today = date.today()
    start, end = today + timedelta(days=14), today + timedelta(days=17)
    trip = make_trip(api, "[데모] 생성 직전 · 제주 3박", start, end, [("제주", 3)])
    stay = make_stay(api, "[데모] 제주시 시티 호텔", 33.4996, 126.5312)
    assign(api, trip, stay, start, end)
    add_must_visits(api, trip, pois(api, "제주"), start + timedelta(days=1))
    cov = api.get(f"/trips/{trip}/coverage")
    log(f"커버리지 blocked={cov['blocked']} — 생성 버튼만 누르면 되는 상태")
    return trip


def s2(api: Api) -> str:
    """거점 겹침 미해소 — 일정 생성이 막혀 있고 해소 시트를 띄워야 하는 상태(TRIP-190)."""
    today = date.today()
    start, end = today + timedelta(days=21), today + timedelta(days=24)
    trip = make_trip(api, "[데모] 거점 겹침 미해소 · 제주 3박", start, end, [("제주", 3)])
    a = make_stay(api, "[데모] 애월 펜션", 33.4626, 126.3253)
    b = make_stay(api, "[데모] 성산 게스트하우스", 33.4587, 126.9427)
    assign(api, trip, a, start, end)
    assign(api, trip, b, start, end)  # 전 기간 겹침
    cov = api.get(f"/trips/{trip}/coverage")
    unresolved = [d["date"] for d in cov["days"] if not d.get("resolution")]
    log(f"blocked={cov['blocked']} 미해결 {len(unresolved)}일 · 후보 {len(cov['days'][0]['candidates'])}곳")
    return trip


def s3(api: Api) -> str:
    """생성 완료 — 초안 화면·리비전·다른 후보 보기를 볼 수 있다."""
    today = date.today()
    start, end = today + timedelta(days=28), today + timedelta(days=31)
    trip = make_trip(api, "[데모] 생성 완료 · 제주 3박", start, end, [("제주", 3)])
    stay = make_stay(api, "[데모] 중문 비치 호텔", 33.2447, 126.5590)
    assign(api, trip, stay, start, end)
    add_must_visits(api, trip, pois(api, "제주"), start + timedelta(days=1))
    it = generate_and_wait(api, trip)
    placed = sum(len(d["slots"]) for d in it["days"])
    log(f"generationState={it['generationState']} · {len(it['days'])}일 {placed}슬롯 "
        f"· 미배치 필수 {len(it.get('unplacedMustVisits') or [])}건")
    return trip


def s4(api: Api) -> str:
    """확정 완료 — 읽기전용 화면(h34)과 스냅숏 동결을 볼 수 있다."""
    today = date.today()
    start, end = today + timedelta(days=35), today + timedelta(days=37)
    trip = make_trip(api, "[데모] 확정 완료 · 제주 2박", start, end, [("제주", 2)])
    stay = make_stay(api, "[데모] 협재 리조트", 33.3937, 126.2396)
    assign(api, trip, stay, start, end)
    generate_and_wait(api, trip)
    confirmed = api.post(f"/trips/{trip}/itinerary/confirm")
    log(f"status={confirmed['status']} — 확정 후에는 편집·확정이 409")
    return trip


def s5(api: Api) -> str:
    """여행 중 — **오늘이 여행 기간 안**이라 Plan-B·방문 체크 화면이 열린다."""
    today = date.today()
    start, end = today - timedelta(days=1), today + timedelta(days=2)
    trip = make_trip(api, "[데모] 여행 중 · 제주", start, end, [("제주", 3)])
    stay = make_stay(api, "[데모] 동문시장 근처 호텔", 33.5124, 126.5273)
    assign(api, trip, stay, start, end)
    it = generate_and_wait(api, trip)

    # 오늘 자 슬롯 하나를 도착→완료로 남긴다(계획이 아니라 실적 계층).
    todays = next((d for d in it["days"] if d["date"] == today.isoformat()), None)
    if todays and todays["slots"]:
        slot = todays["slots"][0]
        check = api.post(f"/trips/{trip}/visits", {
            "slotKey": f"{today.isoformat()}#{slot['poiId']}",
            "poiId": slot["poiId"], "source": "MANUAL",
        }, allow=(409,))
        if check:
            api.post(f"/trips/{trip}/visits/{check['visitCheckId']}/complete", allow=(409,))
            log("오늘 첫 슬롯 도착·완료 기록")
    # 계획에 없던 곳(즉석 방문) — 계획과 실적이 갈리는 상태를 만든다.
    # 일정에 이미 든 POI 를 고르면 '즉석'이 아니라 그냥 누락된 계획 방문이 되어 버린다.
    planned = {sl["poiId"] for d in it["days"] for sl in d["slots"]}
    extra = next((p for p in pois(api, "제주") if p["poiId"] not in planned), None)
    if extra:
        api.post(f"/trips/{trip}/visits", {"poiId": extra["poiId"], "source": "MANUAL"}, allow=(409,))
    log(f"즉석 방문 1건 · 기간 {start}~{end}(오늘 포함)")
    return trip


def s6(api: Api) -> str:
    """다도시 — 제주 2박 후 부산 2박. 구간별 거점이 날짜로 갈린다(US-STAY-07)."""
    today = date.today()
    start = today + timedelta(days=42)
    mid = start + timedelta(days=2)
    end = start + timedelta(days=4)
    trip = make_trip(api, "[데모] 다도시 · 제주2박+부산2박", start, end, [("제주", 2), ("부산", 2)])
    jeju = make_stay(api, "[데모] 제주 오션 리조트", 33.4996, 126.5312)
    busan = make_stay(api, "[데모] 해운대 호텔", 35.1587, 129.1604)
    assign(api, trip, jeju, start, mid)
    assign(api, trip, busan, mid, end)
    cov = api.get(f"/trips/{trip}/coverage")
    log(f"blocked={cov['blocked']} — 구간이 안 겹치면 전부 AUTO 확정")
    return trip


def s7(api: Api) -> str:
    """겹침을 **풀고 생성까지** — TRIP-190 의 결말. s2 가 막힌 상태라면 여기는 그 탈출구가 실제로
    동작하는지 보여 준다: 해소 → 차단 해제 → 일정 생성. 해소가 앵커에 실리는지도 여기서 드러난다."""
    today = date.today()
    start, end = today + timedelta(days=49), today + timedelta(days=52)
    trip = make_trip(api, "[데모] 겹침 해소 후 생성 · 제주 3박", start, end, [("제주", 3)])
    a = make_stay(api, "[데모] 한담 해안 스테이", 33.4626, 126.3253)
    b = make_stay(api, "[데모] 월정리 스테이", 33.5563, 126.7960)
    assign(api, trip, a, start, end)
    assign(api, trip, b, start, end)  # 전 기간 겹침

    before = api.get(f"/trips/{trip}/coverage")
    cov = resolve_all(api, trip)
    log(f"해소: blocked {before['blocked']} → {cov['blocked']} "
        f"(status 는 OVERLAP 그대로 · resolution=USER_PICK)")

    it = generate_and_wait(api, trip)
    placed = sum(len(d["slots"]) for d in it["days"])
    log(f"generationState={it['generationState']} · {len(it['days'])}일 {placed}슬롯")
    return trip


SCENARIOS = {
    "s1": ("생성 직전(거점 확정 + 필수방문지)", s1),
    "s2": ("거점 겹침 미해소 — 해소 시트", s2),
    "s3": ("생성 완료(2차까지)", s3),
    "s4": ("확정 완료", s4),
    "s5": ("여행 중(오늘 포함) + 방문 실적", s5),
    "s6": ("다도시 구간 거점", s6),
    "s7": ("겹침 해소 후 생성 — TRIP-190 결말", s7),
}


def main() -> int:
    p = argparse.ArgumentParser(description="스프린트3 범위 데모 데이터 시더")
    p.add_argument("--token", required=True, help="로그인해서 받은 액세스 토큰")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    p.add_argument("--only", nargs="*", choices=sorted(SCENARIOS), help="일부 시나리오만")
    args = p.parse_args()

    api = Api(args.base_url, args.token)
    me = api.get("/me")
    print(f"계정 {me.get('accountId', '?')} 에 데모 데이터를 만듭니다 ({args.base_url})\n")

    targets = args.only or sorted(SCENARIOS)
    made, failed = [], []
    for key in targets:
        label, fn = SCENARIOS[key]
        print(f"[{key}] {label}")
        try:
            made.append((key, label, fn(api)))
        except ApiError as e:  # 한 시나리오가 실패해도 나머지는 만든다
            print(f"  실패: {e}\n", file=sys.stderr)
            failed.append((key, str(e)))
        print()

    print("── 만들어진 여행 ──")
    for key, label, trip in made:
        print(f"  {key}  {trip}  {label}")
    if failed:
        print("\n── 실패 ──")
        for key, err in failed:
            print(f"  {key}  {err.splitlines()[0]}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
