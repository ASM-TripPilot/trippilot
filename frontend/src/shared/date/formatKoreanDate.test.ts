import { formatKoreanDate } from './formatKoreanDate';

/**
 * TRIP-395 · formatKoreanDate — 'YYYY-MM-DD' → "M월 D일 요일".
 *
 * *(개념)* 여행 중 일정(i01) 헤더 부제("6월 11일 목요일 · 오늘 일정")의 날짜 부분을 만드는
 * 순수 함수다. `features/execution` 안에서 날짜를 포맷하면 시각-무추정 구조가드
 * (`liveTimeStructure`)에 걸리므로, 포맷은 execution **밖**(여기 shared)에서 하고 완성
 * 문자열을 화면에 prop 으로 내려보낸다(01b Seed 맹점 상환 ①).
 *
 * 3동작 뼈대: 준비=ISO 날짜 문자열 → 실행=formatKoreanDate → 단언=정확 문자열(`.toBe`).
 *
 * 기대값은 실제 요일 실측으로 확정했다(UTC): 2026-08-20~26 = 목/금/토/일/월/화/수(7요일 전수).
 * ⚠️ Figma 부제의 "6월 11일 수요일"은 **placeholder mock** 이다 — 2025-06-11 이 수요일이고,
 * 2026-06-11 은 목요일이다. 포매터는 디자인 목이 아니라 **실제 요일**을 내야 옳다(F3).
 */
describe('formatKoreanDate — "M월 D일 요일"', () => {
  it.each([
    ['2026-08-20', '8월 20일 목요일'],
    ['2026-08-21', '8월 21일 금요일'],
    ['2026-08-22', '8월 22일 토요일'],
    ['2026-08-23', '8월 23일 일요일'],
    ['2026-08-24', '8월 24일 월요일'],
    ['2026-08-25', '8월 25일 화요일'],
    ['2026-08-26', '8월 26일 수요일'],
  ])('F1 %s → %s (7요일 전수)', (input, expected) => {
    expect(formatKoreanDate(input)).toBe(expected);
  });

  it('F2 월·일의 leading-zero 를 지운다 (01→1, 05→5)', () => {
    expect(formatKoreanDate('2026-01-05')).toBe('1월 5일 월요일');
  });

  it('F3 Figma placeholder(수요일)가 아니라 실제 요일(목요일)을 낸다', () => {
    // 2026-06-11 은 목요일. Figma "6월 11일 수요일"은 2025-06-11(수) 기반 목업.
    expect(formatKoreanDate('2026-06-11')).toBe('6월 11일 목요일');
  });
});
