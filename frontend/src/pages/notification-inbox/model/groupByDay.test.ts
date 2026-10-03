import { groupByDay } from './groupByDay';
import type { Notification } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 · AC-1(2구간 분할) — `groupByDay(items, now) → { today, earlier }`.
 * NotificationList 를 "오늘/이전"으로 가르는 순수 함수(PBT-U6-F1). 화면이 두 그룹 카드로 그린다.
 *
 * 무엇을 보장하나(준비: 오늘·이전 섞인 items + now → 실행: groupByDay → 단언: 그룹별 id·유실중복0):
 *  - today = occurredAt 이 now 와 **로컬 같은 날**, 나머지 earlier.
 *  - **유실·중복 0**: today+earlier 길이 = 입력 수, 같은 id 가 양쪽에 없다(카드에서 사라지거나 두 번
 *    그려지지 않는다).
 *  - 그룹 내 입력 순서 보존(최신순 서버 응답을 그대로 유지).
 *  - 빈 입력 → 둘 다 빈 배열(empty 상태 분기의 전제).
 *
 * TZ 안전: now·항목을 로컬 Date 컴포넌트로 만들어 같은날은 09/11:59시, 이전날은 -2일로 둔다 —
 * 자정 경계를 건드리지 않아 CI 타임존과 무관하다(자정 정확 경계는 이번 스코프 밖).
 * (개념) `getFullYear/getMonth/getDate` = 로컬 달력의 연·월·일. 양변 모두 로컬 게터라 UTC 변환이 없다.
 */

/** 로컬 시각으로 Notification 하나(occurredAt = 로컬 y/m/d h 의 ISO). */
function notif(
  id: string,
  y: number,
  m: number,
  d: number,
  h: number
): Notification {
  return {
    notificationId: id,
    kind: 'SYSTEM',
    title: id,
    body: id,
    occurredAt: new Date(y, m - 1, d, h, 0, 0).toISOString(),
  };
}

describe('groupByDay · 오늘/이전 분할 (AC-1)', () => {
  const NOW = new Date(2026, 7, 30, 12, 0, 0); // 로컬 2026-08-30 정오

  it('오늘 항목은 today, 이전 항목은 earlier 로 갈리고 순서가 보존된다', () => {
    const t1 = notif('t1', 2026, 8, 30, 9); // 오늘 오전 9시
    const t2 = notif('t2', 2026, 8, 30, 11); // 오늘 오전 11시
    const e1 = notif('e1', 2026, 8, 28, 12); // 이틀 전
    const e2 = notif('e2', 2026, 8, 25, 12); // 닷새 전
    const items = [t1, t2, e1, e2];

    const { today, earlier } = groupByDay(items, NOW);

    expect(today.map((n) => n.notificationId)).toEqual(['t1', 't2']);
    expect(earlier.map((n) => n.notificationId)).toEqual(['e1', 'e2']);
  });

  it('유실·중복 0: today+earlier = 입력 수, 같은 id 가 양쪽에 없다', () => {
    const items = [
      notif('t1', 2026, 8, 30, 9),
      notif('e1', 2026, 8, 28, 12),
      notif('t2', 2026, 8, 30, 11),
      notif('e2', 2026, 8, 25, 12),
    ];

    const { today, earlier } = groupByDay(items, NOW);

    expect(today.length + earlier.length).toBe(items.length);
    const todayIds = new Set(today.map((n) => n.notificationId));
    const earlierIds = earlier.map((n) => n.notificationId);
    expect(earlierIds.some((id) => todayIds.has(id))).toBe(false);
  });

  it('빈 입력 → today·earlier 둘 다 빈 배열', () => {
    expect(groupByDay([], NOW)).toEqual({ today: [], earlier: [] });
  });
});
