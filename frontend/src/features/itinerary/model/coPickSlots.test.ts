import { buildSlotKey } from './slotKey';
import { firstCoPickSlotKey, nextCoPickSlotKey } from './coPickSlots';
import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-504 · copick 선형 순회의 슬롯 진행 판정(01b 순회 세부, AC-8).
 *
 * 무엇을 보장하나:
 *  - `firstCoPickSlotKey(days)` = 비고정 슬롯을 day 순서 → 슬롯 순서로 훑은 **첫** 키. 고정(숙소)은
 *    건너뛴다. 하나도 없으면 `null`(순회할 것이 없다 → 곧장 h17).
 *  - `nextCoPickSlotKey(days, currentKey)` = 현재 키 **다음**의 비고정 키. 사이의 고정은 건너뛰고
 *    일자 경계도 넘는다. 다음이 없으면 `null`(→h17). 현재 키가 목록에 없어도 `null`.
 *  - 키는 `"{date}#{poiId}"` 규약(`buildSlotKey` 재사용 — `#` 하드코딩 금지, 규약 드리프트 방지).
 *
 * 3동작: 준비(days 픽스처)→실행(함수 호출)→단언(정확한 키 또는 null).
 *
 * > *(개념)* **순수 함수** — 같은 days 면 항상 같은 키. 바깥 상태를 읽지도 바꾸지도 않아,
 * > GeneratingPage(첫 진입)·SlotFillPage(전진)가 같은 규칙을 두 번 짜지 않고 이 한 곳을 부른다.
 */

const D1 = '2026-06-10';
const D2 = '2026-06-11';

/** 슬롯 하나 — 필수 필드만 채운 최소 형태(나머지 표면 필드는 이 판정과 무관). */
function slot(
  poiId: string,
  isFixed: boolean
): ItineraryDaysItem['slots'][number] {
  return {
    poiId,
    startAt: '09:00:00',
    endAt: '10:00:00',
    isFixed,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
  };
}

function day(
  date: string,
  slots: ItineraryDaysItem['slots']
): ItineraryDaysItem {
  return { date, slots };
}

describe('🔴 firstCoPickSlotKey (AC-8)', () => {
  it('F1 · 앞 고정 슬롯을 건너뛰고 첫 비고정 슬롯 키를 낸다(day/슬롯 순서)', () => {
    const days = [
      day(D1, [slot('hotel', true), slot('a', false)]),
      day(D2, [slot('c', false)]),
    ];

    expect(firstCoPickSlotKey(days)).toBe(buildSlotKey(D1, 'a'));
  });

  it('F2 · 앞 일자가 전부 고정이면 다음 일자의 첫 비고정으로 넘어간다', () => {
    const days = [
      day(D1, [slot('h1', true), slot('h2', true)]),
      day(D2, [slot('x', false)]),
    ];

    expect(firstCoPickSlotKey(days)).toBe(buildSlotKey(D2, 'x'));
  });

  it('F3 · 비고정 슬롯이 하나도 없으면 null(순회 대상 0 → h17)', () => {
    const days = [day(D1, [slot('h1', true), slot('h2', true)])];

    expect(firstCoPickSlotKey(days)).toBeNull();
  });

  it('F4 · 빈 days 는 null', () => {
    expect(firstCoPickSlotKey([])).toBeNull();
  });
});

describe('🔴 nextCoPickSlotKey (AC-8)', () => {
  it('N1 · 현재 슬롯 바로 다음의 비고정 키를 낸다', () => {
    const days = [day(D1, [slot('a', false), slot('b', false)])];

    expect(nextCoPickSlotKey(days, buildSlotKey(D1, 'a'))).toBe(
      buildSlotKey(D1, 'b')
    );
  });

  it('N2 · 마지막 비고정 슬롯이면 null(더 갈 곳 없음 → h17)', () => {
    const days = [day(D1, [slot('a', false), slot('b', false)])];

    expect(nextCoPickSlotKey(days, buildSlotKey(D1, 'b'))).toBeNull();
  });

  it('N3 · 현재 키가 목록에 없으면 null(엉뚱한 슬롯으로 안 튄다)', () => {
    const days = [day(D1, [slot('a', false), slot('b', false)])];

    expect(nextCoPickSlotKey(days, buildSlotKey(D1, 'zzz'))).toBeNull();
  });

  it('N4 · 사이의 고정 슬롯을 건너뛰고 일자 경계를 넘어 다음 비고정으로', () => {
    const days = [
      day(D1, [slot('a', false), slot('h', true)]),
      day(D2, [slot('c', false)]),
    ];

    // a 다음은 고정 h → 건너뛰고 다음 일자의 c.
    expect(nextCoPickSlotKey(days, buildSlotKey(D1, 'a'))).toBe(
      buildSlotKey(D2, 'c')
    );
  });
});
