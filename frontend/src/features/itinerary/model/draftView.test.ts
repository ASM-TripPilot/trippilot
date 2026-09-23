import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import {
  buildDraftDayTabs,
  buildDraftPins,
  buildGenerationGauge,
  DRAFT_POLL_INTERVAL_MS,
  DRAFT_POLL_MAX_COUNT,
  formatDraftDayHeader,
  isCandidatesDemoted,
  resolveDraftView,
  shouldKeepPollingDraft,
} from './draftView';
import type { DraftDayTab } from './draftView';

/**
 * h11 초안 화면의 **순수 판정 5종 + 폴링 상수 2개**. 화면은 이 중 어느 것도 다시 계산하지
 * 않는다(`features/itinerary/ui` 는 props 만 받는다 — 판정은 여기 한 곳).
 *
 * 무엇을 보장하나:
 *  - 날짜 탭은 **여행 기간**에서 나오고 `days` 는 활성 여부만 정한다(AC-4 · 01b D7). 서버가
 *    day1 만 먼저 주는 2단계 생성이라, `days.length` 로 탭을 세면 폴링 도중 탭이 늘었다 줄었다 한다.
 *  - 지도 핀은 좌표 없는 슬롯을 **건너뛰되 번호를 다시 매기지 않는다**(AC-13). 카드 번호는
 *    1..n 연속(INV-U3-02)인데 핀 번호는 ①③④ 로 뛴다 — **이 비대칭이 심판의 요점이다.**
 *  - 폴링은 **자체 타이머 없이** 상한을 센다(01b 폴링 수치). 60초짜리 테스트를 만들지 않으려고
 *    상한 판정을 이 순수 함수 경계에서 잰다(02a ★7).
 *  - 이미 도착한 일자가 **실패에 지워지지 않는다**(AC-9 · INV-4 · `mustVisitList` 의 `staleFailed`
 *    와 같은 형태 — 이 리포에서 네 번째 자리다).
 *
 * ── 판정 축 (M11~M16) ────────────────────────────────────────────────────────
 *  - 후보 강등 안내를 **켤지 말지**(`isCandidatesDemoted`)는 "조용한 값 화이트리스트"다
 *    (01b D2) — 모르는 값은 자동으로 시끄러운 쪽에 떨어진다(INV-4). 얼굴 판정과는 별개 축이다.
 *  - 얼굴은 **슬롯 합계**로만 목록/빈 화면을 가른다 — `level` 문자열 어휘에 기대지 않는다.
 *    (후보 0건 전용 `zero` 얼굴은 TRIP-791 로 화면이, 후속 정리로 kind 까지 제거됐다 — 안이
 *    빈 응답은 이제 `empty` 로 접힌다.)
 *  - 일부 날짜만 비면 얼굴을 갈아 끼우지 않는다(01b D6 · 「얼굴 판정이 잔존 데이터를
 *    가린다」 — 이 리포에서 네 번 반복된 사고).
 *
 * *(개념)* **순수 함수** — 같은 입력에 늘 같은 출력을 내고 바깥 세상(시계·네트워크·화면)을
 * 건드리지 않는 함수. 그래서 테스트가 값만 넣고 값만 보면 된다.
 *
 * 3동작 뼈대: 준비=입력 값을 만든다 → 실행=함수를 부른다 → 단언=돌려받은 값.
 */

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';

function slot(
  over: Partial<ItineraryDaysItemSlotsItem> & { poiId: string }
): ItineraryDaysItemSlotsItem {
  return {
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    ...over,
  };
}

function day(
  date: string,
  slots: ItineraryDaysItemSlotsItem[] = []
): ItineraryDaysItem {
  return { date, slots };
}

describe('M1·M2·M3·M4 · AC-4 — 날짜 탭은 여행 기간에서 나온다 (01b D7)', () => {
  it('M1 3일 여행에 day1 만 도착했으면 탭 3개 · 번호 1..3 · 첫 탭만 활성이다', () => {
    // 준비 — 서버가 PARTIAL 로 day1 만 준 순간.
    const tabs = buildDraftDayTabs({
      startDate: DAY1,
      endDate: DAY3,
      days: [day(DAY1)],
    });

    // 단언 — 개수·번호·날짜·활성 네 축을 각각 완전 일치로 잠근다. 날짜 배열 완전 일치가
    // "누락·중복 없음"(INV-U3-01)을 한 줄로 겸한다.
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.dayNumber)).toEqual([1, 2, 3]);
    expect(tabs.map((tab) => tab.date)).toEqual([DAY1, DAY2, DAY3]);
    // 🔴 여기가 D7 의 급소 — `days.length` 로 세면 [true] 하나만 나온다.
    expect(tabs.map((tab) => tab.hasData)).toEqual([true, false, false]);
  });

  it('M2 달과 해를 넘어도 날짜가 이어진다 (UTC 고정)', () => {
    // 준비·실행 — 6/30~7/1, 12/31~1/1. 로컬 타임존으로 계산하면 CI 가 UTC-x 일 때 하루 밀린다.
    expect(
      buildDraftDayTabs({
        startDate: '2026-06-30',
        endDate: '2026-07-01',
        days: [],
      }).map((tab) => tab.date)
    ).toEqual(['2026-06-30', '2026-07-01']);

    expect(
      buildDraftDayTabs({
        startDate: '2026-12-31',
        endDate: '2027-01-01',
        days: [],
      }).map((tab) => tab.date)
    ).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('M3 하루 여행이면 탭이 1개다 (openapi: 하루면 2차 없이 즉시 COMPLETE)', () => {
    const tabs = buildDraftDayTabs({
      startDate: DAY1,
      endDate: DAY1,
      days: [day(DAY1)],
    });

    expect(tabs).toEqual([{ date: DAY1, dayNumber: 1, hasData: true }]);
  });

  it('M4 여행 조회가 아직 안 왔으면 빈 목록이다 (전역성 — 요구가 아니라 방어)', () => {
    // `useGetTripsTripId` 가 pending 인 동안 배선이 빈 문자열을 넘긴다. 여기서 값을 안 정하면
    // undefined 가 화면까지 흘러 탭 렌더가 죽는다.
    expect(buildDraftDayTabs({ startDate: '', endDate: '', days: [] })).toEqual(
      []
    );
  });
});

describe('M5 · AC-4 — 날짜 헤더 문자열', () => {
  it('요일을 실제 달력에서 계산한다 — Figma 목업(화)이 아니라 수요일이다', () => {
    /**
     * ⚠️ **Figma h11 목업은 `6월 10일 · 화` 라고 적혀 있는데 2026-06-10 은 수요일이다.**
     * 목업의 요일은 실제 달력과 무관하다(TRIP-296 h07 에서도 같은 함정을 밟았다). 기대값을
     * 목업에서 베꼈다면 **올바른 구현이 red 를 내고**, 구현자는 요일 계산을 틀리게 고쳐 맞췄을 것이다.
     * 아래 값은 `Date.UTC(...).getUTCDay()` 로 계산해 넣었다(02a §5-D 실측).
     */
    expect(formatDraftDayHeader(DAY1)).toBe('6월 10일 · 수');
    expect(formatDraftDayHeader(DAY2)).toBe('6월 11일 · 목');
    expect(formatDraftDayHeader('2026-07-01')).toBe('7월 1일 · 수');
  });
});

describe('🔴 M6·M7 · AC-13 — 좌표 없는 슬롯은 핀을 건너뛰되 번호를 다시 매기지 않는다', () => {
  it('M6 4슬롯 중 2번만 좌표가 없으면 핀 번호가 1·3·4 다', () => {
    // 준비 — 스키마 실측: `lat`·`lng` 가 **둘 다 nullable** 이다(01b 인터뷰가 안 물은 구멍).
    const slots = [
      slot({ poiId: 'poi-a', lat: 33.458, lng: 126.942 }),
      slot({ poiId: 'poi-b', lat: null, lng: null }),
      slot({ poiId: 'poi-c', lat: 33.489, lng: 126.498 }),
      slot({ poiId: 'poi-d', lat: 33.487, lng: 126.499 }),
    ];

    const pins = buildDraftPins(slots);

    // ★ 이 한 줄이 AC-13 의 전부다 — 1 부터 다시 매기면 [1,2,3] 이 되어 카드↔핀 대응이 깨진다.
    //   사용자는 지도의 ② 를 누르고 카드 ② 를 기대하는데 다른 장소가 나온다.
    expect(pins.map((pin) => pin.number)).toEqual([1, 3, 4]);
    expect(pins).toEqual([
      { number: 1, lat: 33.458, lng: 126.942 },
      { number: 3, lat: 33.489, lng: 126.498 },
      { number: 4, lat: 33.487, lng: 126.499 },
    ]);
  });

  it('M7 한쪽 좌표만 있어도 건너뛰고, 전부 없으면 빈 목록이다', () => {
    // 준비 — 반쪽 좌표는 지도에 못 찍는다. `lat` 만 보고 통과시키면 `lng: undefined` 가 흘러간다.
    expect(
      buildDraftPins([
        slot({ poiId: 'poi-a', lat: 33.458, lng: null }),
        slot({ poiId: 'poi-b', lat: null, lng: 126.942 }),
        slot({ poiId: 'poi-c', lat: 33.489, lng: 126.498 }),
      ])
    ).toEqual([{ number: 3, lat: 33.489, lng: 126.498 }]);

    expect(
      buildDraftPins([slot({ poiId: 'poi-a' }), slot({ poiId: 'poi-b' })])
    ).toEqual([]);
  });
});

describe('🔴 M8 · AC-9 — 폴링 상한을 자체 타이머 없이 센다 (01b 폴링 수치)', () => {
  it('상수가 2초·30회이고, PARTIAL 이면서 상한 미만일 때만 계속 돈다', () => {
    // 준비 — 정본 부재라 이 두 값은 01b 가 정한 **이 사이클의 발명값**이다. 값이 바뀌면
    // 여기서 먼저 눈에 띄어야 한다.
    expect(DRAFT_POLL_INTERVAL_MS).toBe(2000);
    expect(DRAFT_POLL_MAX_COUNT).toBe(30);

    // 계속 — 아직 채워지는 중이고 상한 직전이다.
    expect(
      shouldKeepPollingDraft({ generationState: 'PARTIAL', dataUpdateCount: 0 })
    ).toBe(true);
    expect(
      shouldKeepPollingDraft({
        generationState: 'PARTIAL',
        dataUpdateCount: 29,
      })
    ).toBe(true);

    // 정지 ① 상한 도달 — 서버가 영영 COMPLETE 를 안 줘도 무한 요청을 보내지 않는다.
    expect(
      shouldKeepPollingDraft({
        generationState: 'PARTIAL',
        dataUpdateCount: 30,
      })
    ).toBe(false);
    expect(
      shouldKeepPollingDraft({
        generationState: 'PARTIAL',
        dataUpdateCount: 999,
      })
    ).toBe(false);

    // 정지 ② 끝난 상태 — COMPLETE 도 FAILED 도 더 받을 것이 없다(INV-4: 실패도 종착이다).
    expect(
      shouldKeepPollingDraft({
        generationState: 'COMPLETE',
        dataUpdateCount: 1,
      })
    ).toBe(false);
    expect(
      shouldKeepPollingDraft({ generationState: 'FAILED', dataUpdateCount: 1 })
    ).toBe(false);

    // 정지 ③ 첫 응답 전 — TanStack Query 는 데이터가 오기 전에도 이 판정을 부른다
    // (02a §5-F 실행 확인: `state=undefined dataUpdateCount=0` 으로 콜백이 불렸다).
    expect(
      shouldKeepPollingDraft({ generationState: undefined, dataUpdateCount: 0 })
    ).toBe(false);
  });
});

describe('🔴 M9·M10 · AC-9 — 도착한 일자가 실패에 지워지지 않는다 (INV-4)', () => {
  it('M9 days 가 있으면 실패·로딩보다 목록이 이기고, 실패는 같은 값에 실려 나간다', () => {
    // 준비 — 2차 생성이 죽었지만 1차분(day1)은 유효하다. openapi 원문: "FAILED=2차 실패
    // (1차분은 유효)". 여기서 목록을 버리면 사용자는 받은 것까지 잃는다.
    const days = [day(DAY1, [slot({ poiId: 'poi-a' })])];

    expect(resolveDraftView({ days, loading: false, failed: true })).toEqual({
      kind: 'listed',
      days,
      staleFailed: true,
    });

    // ★ 두 사실이 **한 값 안에** 있다 — 화면이 실패를 안 그리면 화면 테스트가 죽고, 목록을
    //   지우면 이 테스트가 죽는다. 두 방향으로 각각 재발했던 문제를 자료형 하나로 막는다.
    expect(resolveDraftView({ days, loading: true, failed: false })).toEqual({
      kind: 'listed',
      days,
      staleFailed: false,
    });
  });

  it('M10 도착한 일자가 없을 때만 로딩·실패·빈 얼굴로 갈린다 (판정 순서)', () => {
    expect(
      resolveDraftView({ days: [], loading: true, failed: false })
    ).toEqual({ kind: 'loading' });

    expect(
      resolveDraftView({ days: [], loading: false, failed: true })
    ).toEqual({ kind: 'failed' });

    // 로딩과 실패가 겹치면 실패가 아니라 로딩이다 — 재조회 중에는 아직 결론이 아니다.
    expect(resolveDraftView({ days: [], loading: true, failed: true })).toEqual(
      {
        kind: 'loading',
      }
    );

    expect(
      resolveDraftView({ days: [], loading: false, failed: false })
    ).toEqual({ kind: 'empty' });
  });
});

/** 요약이 도착했을 때만 켜는 판정이라 얼굴 판정과 입력이 같다 — 아래 네 칸이 함께 선다. */
const SLOTS3 = [
  slot({ poiId: 'poi-a' }),
  slot({ poiId: 'poi-b' }),
  slot({ poiId: 'poi-c' }),
];

describe('🔴 M11 · AC-2 — level 판정은 "조용한 값" 화이트리스트다 (01b D2·D3 · INV-4)', () => {
  it('OK·HIGH 계열만 무음이고 모르는 값을 포함한 나머지 전부가 안내를 켠다', () => {
    /**
     * 준비 — 01b AC-2 가 지정한 9값 + 대소문자가 섞인 형태 하나.
     *
     * *(개념)* `level` 은 **열거처럼 생겼지만 열거가 아니다** — 생성 타입이 `level: string`
     * 이고 openapi 원문이 "열거로 고정하지 않는다(AI 어휘가 그대로 나갈 수 있다)"라고
     * 적는다. 그래서 **모르는 값이 오는 것이 정상**이고, 판정은 "이것들만 무음"으로 짜야
     * 새 어휘가 자동으로 시끄러운 쪽에 떨어진다(반대로 "이것들만 안내"로 짜면 서버가 어휘를
     * 하나 늘리는 순간 화면이 조용해진다 — INV-4 위반).
     */
    const levels = [
      'OK',
      'HIGH',
      'ok',
      ' OK ',
      'hIgH',
      'LOW',
      'MEDIUM',
      'NO_CANDIDATES',
      'INSUFFICIENT',
      '',
    ];

    const decided = levels.map((level) => isCandidatesDemoted({ level }));

    // ① 위치별 완전 일치 — 한 칸만 뒤집혀도 어느 값인지 diff 에 그대로 보인다. 이 배열이
    //    끝까지 만들어졌다는 사실 자체가 "어떤 값에서도 예외로 죽지 않는다"의 증거다.
    expect(decided).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);

    // ② ★ 짝 — **조용한 집합이 비어 있지 않다.** 이 줄이 없으면 `() => true`(항상 안내) 한
    //    줄짜리 구현이 ①의 "모르는 값도 켠다"를 그대로 통과한다(02a ★9).
    expect(levels.filter((_, index) => !decided[index])).toEqual([
      'OK',
      'HIGH',
      'ok',
      ' OK ',
      'hIgH',
    ]);
  });
});

describe('M12 · AC-3 — 요약이 안 왔으면 판정 자체를 안 한다 (01b D4)', () => {
  it('undefined·null 은 무음이고, 객체로 도착했을 때만 판정한다', () => {
    /**
     * *(개념)* **3상태 옵셔널** — `candidatesSummary?: {...} | null` 은 `undefined`(키 자체가
     * 없음) · `null`(서버가 "판정 없음"이라고 말함) · 객체 셋이다. `=== null` 만 검사하는
     * 구현은 `undefined` 를 흘려보내 **오지도 않은 강등을 안내**한다(오탐).
     */
    expect(isCandidatesDemoted(undefined)).toBe(false);
    expect(isCandidatesDemoted(null)).toBe(false);

    // 짝 — 항상 false 를 돌려주는 구현을 죽인다.
    expect(isCandidatesDemoted({ level: 'LOW' })).toBe(true);
  });
});

describe('🔴 M13 · AC-5 — 슬롯 합계로 목록과 빈 화면을 가른다 (요약은 얼굴에 무관)', () => {
  it('슬롯 합계만 얼굴을 정한다 — 후보 요약은 얼굴 판정에 들어가지 않는다', () => {
    const base = { loading: false, failed: false };

    // 아직 만들지 않았거나 안이 빈 일정 — 슬롯 합계 0 은 전부 "빈 화면"이다.
    // (후보 0건 전용 `zero` 얼굴은 TRIP-791 로 화면이 삭제되고 이 정리로 kind 까지 제거됐다.)
    expect(resolveDraftView({ ...base, days: [] })).toEqual({ kind: 'empty' });

    // ★ 급소 — 일자는 왔는데 **슬롯이 0**이다. `days.length > 0` 만 보는 구현은 여기서
    //   listed 로 샌다. 세는 축이 "일자 개수"가 아니라 **슬롯 합계**임을 잠근다.
    expect(resolveDraftView({ ...base, days: [day(DAY1), day(DAY2)] })).toEqual(
      { kind: 'empty' }
    );

    // 슬롯이 있으면 얼굴은 목록이다.
    const days = [day(DAY1, SLOTS3)];
    expect(resolveDraftView({ ...base, days })).toEqual({
      kind: 'listed',
      days,
      staleFailed: false,
    });

    // ★ 짝 — 강등 안내(`isCandidatesDemoted`)는 얼굴과 **다른 축**이다. `resolveDraftView` 는
    //   더는 요약을 보지 않고(파라미터에서 제거됨), 안내 판정은 화면 층(`resolveFallbackNotice`)
    //   몫으로 별개 함수가 계속 진다.
    expect(isCandidatesDemoted({ level: 'LOW' })).toBe(true);
  });
});

describe('🔴 M14 · AC-9 — 일부 날짜만 비면 h11 을 유지한다 (01b D6)', () => {
  it('1일차 2장 · 2일차 0장이면 얼굴은 목록이고 빈 일자도 버리지 않는다', () => {
    // 준비 — 2일차가 비었다고 화면 전체를 빈 화면으로 갈아 끼우면 1일차에 받은 두 장이 사용자
    // 눈앞에서 사라진다(개념 「얼굴 판정이 잔존 데이터를 가린다」 — 이 리포에서 네 번 반복).
    // 빈 일자를 결과에서 걸러내도 안 된다: 날짜 탭의 활성 여부가 `days` 에서 나온다.
    const days = [
      day(DAY1, [slot({ poiId: 'poi-a' }), slot({ poiId: 'poi-b' })]),
      day(DAY2),
    ];

    expect(resolveDraftView({ days, loading: false, failed: false })).toEqual({
      kind: 'listed',
      days,
      staleFailed: false,
    });

    // ★ 짝(대조) — 같은 모양에서 1일차 슬롯까지 비면 그때는 빈 화면이다. 두 줄이 붙어 있어야
    //   판정축이 "일자 개수"가 아니라 **슬롯 합계**임이 드러난다.
    expect(
      resolveDraftView({
        days: [day(DAY1), day(DAY2)],
        loading: false,
        failed: false,
      })
    ).toEqual({ kind: 'empty' });
  });
});

describe('🔴 M15·M16 · 얼굴 우선순위 — 슬롯 > loading > failed > empty', () => {
  /**
   * 겹치는 조합의 순서에는 AC 가 없어 심판도 없었다 — 순서를 통째로 뒤집어도 전부 통과했다.
   * 결정을 코드에만 적으면 다음 사람이 아무 때나 되돌린다.
   *
   * 무엇을 막나 — 폴링이 상한(30회 ≒ 60초)에 걸리거나 2차 생성이 죽었는데 안이 빈 응답이
   * 오면, `empty` 가 `failed` 를 이기는 순서에서는 "아직 만들어진 추천안이 없어요" 라고 떠서
   * **재시도 경로 없이** 조용히 끝난다(INV-4). 실패가 이겨야 `다시 만들기` 가 남는다.
   */

  /**
   * 슬롯 합계 0 — **일자는 왔는데 안이 비었다.** 서버가 실제로 보내는 모양이라 `days: []` 보다
   * 이쪽으로 잡는다. `days.length` 로 세는 회귀는 `days: []` 케이스를 그냥 통과한다.
   */
  const NO_SLOTS = [day(DAY1), day(DAY2)];

  it('M15 실패가 빈 화면을 이긴다 — 실패에 재시도 경로를 남긴다', () => {
    // 준비 — 슬롯 0 · 생성 실패(폴링 상한 도달 포함)가 동시에 참인 한 칸.
    // 실행·단언 — 얼굴은 `failed`. 재시도 경로가 있는 쪽이 이긴다.
    expect(
      resolveDraftView({ days: NO_SLOTS, loading: false, failed: true })
    ).toEqual({ kind: 'failed' });

    // ★ 짝 — **`failed` 만 false 로 바꾼** 같은 입력에서는 `empty` 가 나온다. 이 줄이 없으면
    //   `empty` 를 맨 앞에 둔 구현이 위 실패 케이스를 삼켜도 안 걸린다.
    expect(
      resolveDraftView({ days: NO_SLOTS, loading: false, failed: false })
    ).toEqual({ kind: 'empty' });
  });

  it('M16 로딩은 실패와 빈 화면을 함께 이긴다 — 재조회 중에는 아직 결론이 아니다', () => {
    // 준비 — 셋이 겹치는 최악의 칸: 슬롯 0 · 로딩 중 · 실패 표시까지 켜짐.
    // 실행·단언 — 얼굴은 `loading`. 몇 초 뒤 슬롯이 도착할 수 있는데 결론을 앞세우면 화면이
    //   빈 화면 → 목록으로 튄다.
    expect(
      resolveDraftView({ days: NO_SLOTS, loading: true, failed: true })
    ).toEqual({ kind: 'loading' });
  });

  // 「슬롯이 있으면 전부를 이긴다」는 여기 없다 — M9(슬롯 vs 실패·로딩)와 M13(슬롯 vs 빈 화면)이
  // 이미 잡는다. 뮤테이션으로 확인했다: 슬롯 분기를 맨 뒤로 내리면 그 둘이 red 다.
});

describe('M17 · AC-1 (TRIP-790) — 게이지는 다중일차에서도 tabs.hasData 로 도출한다', () => {
  it('day1·day2 둘 다 도착한 4일 PARTIAL 이면 [done, done, active, waiting] 이다', () => {
    // 준비 — 4일 여행, day1·day2 만 도착(hasData=[true,true,false,false]).
    //   `DraftDayTab` 은 {date, dayNumber, hasData} — 리터럴로 세운다(날짜 산술은 M1~M4 소관).
    const tabs: DraftDayTab[] = [
      { date: '2026-06-10', dayNumber: 1, hasData: true },
      { date: '2026-06-11', dayNumber: 2, hasData: true },
      { date: '2026-06-12', dayNumber: 3, hasData: false },
      { date: '2026-06-13', dayNumber: 4, hasData: false },
    ];

    // 실행 — 게이지 상태를 도출한다.
    const states = buildGenerationGauge(tabs).map((cell) => cell.state);

    // 단언 — 도착한 두 일자는 done, 아직 안 온 것 중 첫째만 active, 나머지는 waiting.
    //   ★ 인덱스 하드코딩 뮤테이션(`i===0?'done':i===1?'active':'waiting'`)은 여기서
    //   ['done','active','waiting','waiting'] 를 내 index 1·2 에서 red — 이미 도착한 day2 를
    //   "생성 중"으로 거짓 표시하는 무심판(traps h10)을 이 케이스가 닫는다. **개념 [파생값]**:
    //   상태는 주입이 아니라 hasData 에서 도출돼 "전부 done" 가짜 진척이 원천 불가.
    //   함수는 이미 옳아 이 케이스는 회귀 심판(선제 green) — 뮤테이션 실측은 [구현] 5단계 몫.
    expect(states).toEqual(['done', 'done', 'active', 'waiting']);
  });
});
