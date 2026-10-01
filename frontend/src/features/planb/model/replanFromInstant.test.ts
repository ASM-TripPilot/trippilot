import { readFromInstant } from './replanFromInstant';

/**
 * TRIP-752 · AC-11 · Seed Q3·Q5 — 재계획 기준 시각(`fromInstant`, 서버 ISO 순간)을 **여행지 시각
 * (Asia/Seoul = UTC+9)** 의 날짜와 시(hour)로 읽는다.
 *
 * 무엇을 보장하나:
 *  - i05 캡션 `{hour}시 이후 다시 짜는 중`의 hour, 그리고 "어느 날 일정을 보여 줄까"의 date 가 이 한 곳에서 나온다.
 *  - UTC 로 전날이어도 KST 로 다음 날이면 다음 날이다(서버의 "오늘"도 Asia/Seoul 날짜다).
 *  - 오프셋 표기(`+09:00`)·소수 초·연도 넘김도 같은 순간으로 읽는다 — 문자열을 잘라 +9 하는 구현을 막는다.
 *
 * ⚠️ 이 기계는 KST 라 로컬 시계(`getHours`)로 구현해도 여기선 통과한다. 그 구멍은
 *    `planbSolvingStructure` G7 이 소스에서 막는다(02a ★6).
 */

describe('🔴 readFromInstant — ISO 순간 → 여행지(KST) 날짜·시', () => {
  it.each([
    ['2026-06-11T08:00:00Z', '2026-06-11', 17],
    ['2026-06-10T15:30:00Z', '2026-06-11', 0],
    ['2026-06-11T04:00:00Z', '2026-06-11', 13],
    ['2026-12-31T15:00:00Z', '2027-01-01', 0],
    ['2026-06-11T13:00:00+09:00', '2026-06-11', 13],
    ['2026-06-11T08:00:00.123456Z', '2026-06-11', 17],
  ])('%s → %s %i시', (instant, date, hour) => {
    expect(readFromInstant(instant)).toEqual({ date, hour });
  });
});
