import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import {
  buildDraftDayTabs,
  buildDraftPins,
  DRAFT_POLL_INTERVAL_MS,
  DRAFT_POLL_MAX_COUNT,
  formatDraftDayHeader,
  resolveDraftView,
  shouldKeepPollingDraft,
} from './draftView';

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
