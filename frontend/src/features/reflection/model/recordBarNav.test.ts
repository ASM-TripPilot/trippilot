import { pickReflectionDate } from './recordBarNav';

/**
 * TRIP-1584 · 요약(j04) 하단 바 「회고」 칸이 갈 날짜 (Q6): 기간 안이면 오늘 · 끝난 여행이면 마지막 일차 · 시작 전이면 없음(칸 비활성).
 * 미래 일차로는 어떤 경우에도 가지 않는다. ISO 날짜는 사전순 = 시간순이라 문자열로 비교한다.
 */

const DAYS = ['2026-09-24', '2026-09-25', '2026-09-26'];

it.each([
  ['시작 전', '2026-09-23', undefined],
  ['여행 중', '2026-09-25', '2026-09-25'],
  ['끝난 여행', '2026-10-30', '2026-09-26'],
])('%s(오늘 %s) → %s', (_label, today, expected) => {
  expect(pickReflectionDate(DAYS, today)).toBe(expected);
});

it('일정 날짜가 아직 없으면(로딩·실패) 없음 — 날짜 없는 경로로 가지 않는다', () => {
  expect(pickReflectionDate([], '2026-09-25')).toBeUndefined();
});
