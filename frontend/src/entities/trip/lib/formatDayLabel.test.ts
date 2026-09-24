import { formatDayLabel } from './formatDayLabel';

/**
 * TRIP-759 · AC-1 — entities/trip/lib/formatDayLabel: 일차 탭 라벨 포맷터(신설).
 *
 * 무엇을 보장하나:
 *  - 🔴 1-기반 일차 번호를 한국어 라벨 `${n}일차` 로 만든다(`Day${n}` 영문 탭을 대체).
 *    j01 방문 기록 화면의 일자 탭·귀속 헤더 dayLabel 이 이 포맷을 쓴다(TripRecordsPage 배선).
 *
 * ⚠️ red 상태 = **모듈 미존재**(Cannot find module './formatDayLabel'). implementer 가
 *   `formatDayLabel.ts` 를 신설하면(순수 함수 1개) 해소된다 — 선제 green 아님.
 *
 * (개념) `toBe(값)` = 원시값 완전일치(===). 순수 포맷터라 렌더·목 불필요, 준비→실행→단언 3동작.
 */

describe('🔴 AC-1 · formatDayLabel — 1-기반 번호를 "${n}일차" 로', () => {
  it('1 → "1일차", 2 → "2일차"', () => {
    expect(formatDayLabel(1)).toBe('1일차');
    expect(formatDayLabel(2)).toBe('2일차');
  });

  it('두 자리 일차도 접미가 붙는다 — 10 → "10일차"', () => {
    expect(formatDayLabel(10)).toBe('10일차');
  });
});
