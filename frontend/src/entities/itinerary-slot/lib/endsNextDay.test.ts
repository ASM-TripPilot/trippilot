import fc from 'fast-check';

import { deriveEndsNextDay } from './endsNextDay';

/**
 * TRIP-927 · 자정 넘김(`endsNextDay`, HC4) 유도 규칙 — 리포 유일 출처.
 *
 * 무엇을 보장하나: 종료가 시작보다 같거나 이르면(`end <= start`) 익일로 본다. 같은 시각도 익일이다
 * (기존 TimeSheet CS4 경계 계승). 인자는 (시작, 종료) 순서이고 `HH:mm:ss` 사전식 비교라 초까지 본다
 * — 페이지는 위젯의 `:00` 시작과 서버 원값 종료(초 보존)를 섞어 부른다.
 * 클라 유도는 제안일 뿐이고 최종 판정은 저장 시 서버 재검증이다(INV-2).
 *
 * 3동작: 준비(시작·종료) → 실행(deriveEndsNextDay) → 단언(boolean).
 */

describe('🔴 E1 · end <= start 면 익일 — 경계 표', () => {
  it.each([
    ['13:00:00', '14:30:00', false, '같은 날'],
    ['13:00:00', '13:00:00', true, '같은 시각이면 익일'],
    ['13:00:00', '13:30:00', false, '같은 시·늦은 분'],
    ['13:30:00', '13:00:00', true, '같은 시·이른 분'],
    [
      '23:15:00',
      '11:45:30',
      true,
      '시작 :00 · 종료 초 보존이 섞인 페이지 조합',
    ],
    ['10:15:00', '10:15:30', false, '초만 늦음'],
  ])('시작 %s · 종료 %s → %s (%s)', (startAt, endAt, expected) => {
    expect(deriveEndsNextDay(startAt, endAt)).toBe(expected);
  });
});

describe('🔴 E2 · 임의 시각 쌍에서 분 환산 비교와 같다', () => {
  const hh = (n: number): string => String(n).padStart(2, '0');
  const timeArb = fc.record({
    h: fc.integer({ min: 0, max: 23 }),
    m: fc.integer({ min: 0, max: 59 }),
  });

  it('deriveEndsNextDay(start, end) === (end 분 <= start 분)', () => {
    fc.assert(
      fc.property(timeArb, timeArb, (start, end) => {
        const startAt = `${hh(start.h)}:${hh(start.m)}:00`;
        const endAt = `${hh(end.h)}:${hh(end.m)}:00`;
        const expected = end.h * 60 + end.m <= start.h * 60 + start.m;
        expect(deriveEndsNextDay(startAt, endAt)).toBe(expected);
      })
    );
  });
});
