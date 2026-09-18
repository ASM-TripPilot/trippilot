import type { Notification } from '@/shared/api/generated/schemas';

/**
 * TRIP-576 · l01 — NotificationList 를 "오늘/이전" 2구간으로 가르는 순수 함수(PBT-U6-F1).
 * `today` = occurredAt 이 now 와 로컬 같은 날, 나머지는 `earlier`. 그룹 내 입력 순서 보존,
 * 유실·중복 0. */

export interface NotificationGroups {
  today: Notification[];
  earlier: Notification[];
}

/** occurredAt 이 now 와 로컬 같은 날(연·월·일 일치)이면 오늘. 양변 모두 로컬 게터라 TZ-safe. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function groupByDay(
  items: Notification[],
  now: Date
): NotificationGroups {
  const today: Notification[] = [];
  const earlier: Notification[] = [];
  for (const item of items) {
    if (isSameLocalDay(new Date(item.occurredAt), now)) {
      today.push(item);
    } else {
      earlier.push(item);
    }
  }
  return { today, earlier };
}
