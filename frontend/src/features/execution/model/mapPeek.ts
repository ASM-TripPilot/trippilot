import type { ProjectedSlot } from './slotProgress';

/**
 * TRIP-397 · 지도(i02·i03) peek 요약 도출 — 지도 아래 "남은 N곳 + 지금/다음" 미리보기 재료.
 *
 * 순수 도출(BR-U4-34 무관 — 시각을 재추정하지 않고 진행 상태만 읽는다):
 *  - `remainingCount` = 예정(state==='upcoming') 슬롯 수(브리프 §2 "남은 N곳").
 *  - `now`  = 진행 중(active) 슬롯, 없으면 첫 예정 슬롯(첫 non-done). 없으면 null.
 *  - `next` = now 바로 다음 슬롯. 없으면 null.
 *  - 이름 결측은 빈칸이 아니라 '미확인'(BR-U4-40).
 */

export interface MapPeekSlot {
  /** 표시 이름 — `nameKo ?? '미확인'`. */
  name: string;
}

export interface MapPeekView {
  remainingCount: number;
  now: MapPeekSlot | null;
  next: MapPeekSlot | null;
}

// ProjectedSlot → 표시용 이름 한 칸. 이름 결측은 빈칸 대신 '미확인'(BR-U4-40).
function toPeekSlot(projected: ProjectedSlot): MapPeekSlot {
  return { name: projected.slot.nameKo ?? '미확인' };
}

export function buildMapPeek(slots: readonly ProjectedSlot[]): MapPeekView {
  const remainingCount = slots.filter(
    (projected) => projected.state === 'upcoming'
  ).length;

  // 지금 = 진행 중(active) 슬롯. 없으면 완료를 건너뛴 첫 슬롯(첫 non-done = 첫 예정).
  const activeIndex = slots.findIndex(
    (projected) => projected.state === 'active'
  );
  const nowIndex =
    activeIndex >= 0
      ? activeIndex
      : slots.findIndex((projected) => projected.state !== 'done');

  if (nowIndex === -1) {
    return { remainingCount, now: null, next: null };
  }

  // 다음 = 지금 바로 다음 슬롯(마지막이면 없음).
  const nextSlot = slots[nowIndex + 1];
  return {
    remainingCount,
    now: toPeekSlot(slots[nowIndex]),
    next: nextSlot ? toPeekSlot(nextSlot) : null,
  };
}
