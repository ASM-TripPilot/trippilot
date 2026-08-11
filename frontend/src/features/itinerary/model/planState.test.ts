import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import {
  buildPlanDayTabs,
  formatNightsLabel,
  resolvePlanState,
} from './planState';

/**
 * h25 완성 일정의 순수 판정/조립 3종.
 *
 * 화면(`ui/TimelineScreen`)은 이 값들을 다시 계산하지 않는다 — 판정이 두 층에 흩어지면 같은
 * 규칙이 서로 다르게 진화한다(`draftView.ts` 와 같은 배치).
 *
 * 무엇을 보장하나:
 *  - `resolvePlanState` 가 로딩·404·실패·목록을 **우선순위대로** 하나의 얼굴로 가른다(AC9 · AC1).
 *  - `formatNightsLabel` 이 날짜 두 개를 "N박 M일"로 옮기되 **UTC 계산**이다(월·해 넘김 · CI 안전).
 *  - `buildPlanDayTabs` 가 날짜탭 메타(1..N · 곳 수)를 만든다(AC1).
 */

function day(date: string, slotCount: number): ItineraryDaysItem {
  return {
    date,
    slots: Array.from({ length: slotCount }, (_unused, i) => ({
      poiId: `poi-${date}-${i}`,
      startAt: '09:30:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: [],
    })),
  };
}

const DAYS: ItineraryDaysItem[] = [day('2026-06-10', 2), day('2026-06-11', 3)];

describe('M1 · resolvePlanState — 네 갈래 얼굴', () => {
  it('로딩·404·실패·목록을 각각 그 종류로 가른다', () => {
    expect(
      resolvePlanState({
        loading: true,
        notFound: false,
        failed: false,
        days: [],
      })
    ).toEqual({ kind: 'loading' });

    expect(
      resolvePlanState({
        loading: false,
        notFound: true,
        failed: false,
        days: [],
      })
    ).toEqual({ kind: 'notFound' });

    expect(
      resolvePlanState({
        loading: false,
        notFound: false,
        failed: true,
        days: [],
      })
    ).toEqual({ kind: 'failed' });

    // days 가 있고 아무 플래그도 없으면 목록 — days 를 그대로 실어 보낸다.
    expect(
      resolvePlanState({
        loading: false,
        notFound: false,
        failed: false,
        days: DAYS,
      })
    ).toEqual({ kind: 'listed', days: DAYS });
  });
});

describe('M2 · resolvePlanState — 우선순위 loading > notFound > failed > listed', () => {
  it('겹치면 앞선 것이 이긴다', () => {
    // 로딩 중엔 stale 한 error 플래그가 남아 있어도 로딩이 이긴다.
    expect(
      resolvePlanState({
        loading: true,
        notFound: true,
        failed: true,
        days: DAYS,
      })
    ).toEqual({ kind: 'loading' });

    // 404(일정 없음)와 그밖 실패가 겹치면 404 가 이긴다 — 얼굴·문구가 다르다(isNotFound 분기).
    expect(
      resolvePlanState({
        loading: false,
        notFound: true,
        failed: true,
        days: [],
      })
    ).toEqual({ kind: 'notFound' });

    // 실패가 켜져 있으면 days 가 있어도 실패가 이긴다(부분 목록을 성공으로 위장하지 않는다).
    expect(
      resolvePlanState({
        loading: false,
        notFound: false,
        failed: true,
        days: DAYS,
      })
    ).toEqual({ kind: 'failed' });
  });
});

describe('M3 · formatNightsLabel — "N박 M일" · UTC 계산', () => {
  it('기간·같은날·월넘김·해넘김을 정확히 옮기고, 형식 오류는 빈 문자열이다', () => {
    // 3일 차이 = 3박 4일. Figma 목업 숫자를 베끼지 않고 날짜 산술로 잰다(02a ★11).
    expect(formatNightsLabel('2026-06-10', '2026-06-13')).toBe('3박 4일');
    // 같은 날 = 0박 1일.
    expect(formatNightsLabel('2026-06-10', '2026-06-10')).toBe('0박 1일');
    // 월 넘김 — 6/30 → 7/2 = 2박 3일(로컬 타임존이면 CI UTC-x 에서 하루 밀린다).
    expect(formatNightsLabel('2026-06-30', '2026-07-02')).toBe('2박 3일');
    // 해 넘김 — 12/31 → 1/2 = 2박 3일.
    expect(formatNightsLabel('2026-12-31', '2027-01-02')).toBe('2박 3일');
    // 형식이 아니면 빈 문자열(호출부가 빈 헤더로 갈라낸다).
    expect(formatNightsLabel('x', 'y')).toBe('');
  });
});

describe('M4 · buildPlanDayTabs — 날짜탭 메타 1..N', () => {
  it('dayIndex 는 1부터, count 는 각 날의 슬롯 수다', () => {
    expect(buildPlanDayTabs(DAYS)).toEqual([
      { dayIndex: 1, date: '2026-06-10', count: 2 },
      { dayIndex: 2, date: '2026-06-11', count: 3 },
    ]);
    // 빈 입력은 빈 탭.
    expect(buildPlanDayTabs([])).toEqual([]);
  });
});
