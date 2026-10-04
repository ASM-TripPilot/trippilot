import fc from 'fast-check';

import { deriveEndsNextDay, isValidTimeRange } from './endsNextDay';

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

// TRIP-1215 · 시각 시트가 [적용]을 막을지 정하는 판정 — 종료가 시작보다 늦으면 같은 날로 허용하고,
// 종료가 같거나 이르면 "밤 시작(18:00 이상) + 새벽 종료(09:00 전)"일 때만 자정 넘김으로 허용한다.
// 경계 18:00·09:00 은 01b 결정(정본 근거 없음). 같은 시각은 밤 창 안에 들 수 없어 항상 오류다.
describe('🔴 V1 · isValidTimeRange — 경계 표', () => {
  it.each([
    ['13:00:00', '14:30:00', true, '같은 날'],
    ['18:00:00', '08:59:00', true, '밤 시작 경계 18:00 · 새벽 종료 08:59'],
    ['17:59:00', '08:59:00', false, '시작 17:59 는 밤이 아니다'],
    ['18:00:00', '09:00:00', false, '종료 09:00 은 새벽이 아니다'],
    ['23:30:00', '00:30:00', true, '장소 추가 기본 제안 자정 넘김'],
    ['11:00:00', '08:00:00', false, 'QA Q-29 — 실수로 넣은 이른 종료'],
    ['15:00:00', '14:30:00', false, '숨은 종료보다 늦게 옮긴 시작'],
    ['13:00:00', '13:00:00', false, '같은 시각'],
    ['00:00:00', '00:00:00', false, '같은 시각(자정)'],
    ['18:00:00', '18:00:00', false, '밤 경계에서도 같은 시각은 오류'],
    ['18:00:00', '08:59:59', true, '초까지 — 08:59:59 는 09:00 전'],
    ['17:59:59', '08:00:00', false, '초까지 — 17:59:59 는 18:00 전'],
    ['10:15:00', '10:15:30', true, '초만 늦음(같은 날)'],
    ['23:15:00', '11:45:30', false, '시작 :00 · 종료 초 보존 페이지 조합'],
  ])('시작 %s · 종료 %s → %s (%s)', (startAt, endAt, expected) => {
    expect(isValidTimeRange(startAt, endAt)).toBe(expected);
  });
});

describe('🔴 V2 · isValidTimeRange — 임의 시각 쌍에서 초 환산 규칙과 같다', () => {
  const NIGHT_START = 18 * 3600;
  const MORNING_END = 9 * 3600;
  const hh = (n: number): string => String(n).padStart(2, '0');
  const clock = (sec: number): string =>
    `${hh(Math.floor(sec / 3600))}:${hh(Math.floor(sec / 60) % 60)}:${hh(sec % 60)}`;
  const secArb = fc.integer({ min: 0, max: 24 * 3600 - 1 });
  const at = (h: number, m: number, s = 0): number => h * 3600 + m * 60 + s;

  it('isValidTimeRange(s, e) === (e > s) || (s >= 18:00 && e < 09:00)', () => {
    fc.assert(
      fc.property(secArb, secArb, (start, end) => {
        const expected =
          end > start || (start >= NIGHT_START && end < MORNING_END);
        expect(isValidTimeRange(clock(start), clock(end))).toBe(expected);
      }),
      {
        // 경계 쌍은 무작위로 거의 안 나온다 — 반드시 한 번씩 태운다.
        examples: [
          [at(18, 0), at(8, 59)],
          [at(17, 59), at(8, 59)],
          [at(18, 0), at(9, 0)],
          [at(18, 0), at(8, 59, 59)],
          [at(17, 59, 59), at(8, 0)],
          [at(23, 30), at(0, 30)],
          [at(13, 0), at(13, 0)],
          [at(11, 0), at(8, 0)],
        ],
      }
    );
  });
});
