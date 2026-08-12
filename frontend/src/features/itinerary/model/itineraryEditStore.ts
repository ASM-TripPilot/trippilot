import { create, type StateCreator } from 'zustand';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-302 · h24 편집 드래프트 상자(슬라이스1). 편집 중 `days`를 화면 밖에서 든다 — 서버 상태의
 * 사본이 아니라 **로컬 편집 드래프트**다(README §66 예외: UI 편집 상태지 서버 캐시가 아니다).
 * `tripWizardStore`·`preferenceStore`와 같은 배치이고 `persist`는 없다(로컬 자동임시저장은 후속
 * 슬라이스 — 지금은 앱 생존 중만 유지되는 모듈 싱글턴이면 충분하다).
 *
 * 삭제·재정렬 수학은 **순수 헬퍼**로 뺐다 — 드래그 제스처는 jest로 못 태우니(reanimated 네이티브)
 * 재정렬 규칙(특히 고정 슬롯 잠금)을 렌더 없이 직접 태워 잠근다(02a ★1·★2). 스토어 액션은 그
 * 헬퍼를 "해당 날에만" 얹는 얇은 래퍼다.
 *
 * `create(` 리터럴 표기는 `tripWizardStore` 선례대로 — 타입을 `StateCreator` 변수로 먼저 확정하고
 * `create(그변수)`로 부른다(구조 가드 정규식이 `create<T>(...)` 제네릭을 오탐하지 않게).
 */

type Slot = ItineraryDaysItemSlotsItem;

/**
 * 첫 일치 슬롯 하나만 뺀 **새 배열**. `filter`는 같은 poiId가 둘이면 전부 지운다(wizard
 * `removeDestination`과 같은 함정) — `findIndex`로 그 한 자리만 잘라낸다. 원본은 `slice`라 안
 * 바뀐다(비파괴 — 시드한 GET 배열을 건드리지 않기 위함, 엣지5).
 */
export function removeSlot(slots: Slot[], poiId: string): Slot[] {
  const index = slots.findIndex((s) => s.poiId === poiId);
  if (index === -1) return slots.slice();
  return [...slots.slice(0, index), ...slots.slice(index + 1)];
}

/**
 * 재정렬 결과를 다시 쌓되 **고정 슬롯은 원래 절대 인덱스에 재고정**한다(엣지1 · INV-U3-02).
 * lib(`onDragEnd.data`)이 준 배열이 고정을 밀어냈어도, 고정은 `original`의 자리를 지키고
 * 비고정만 `reordered` 순서로 빈 자리를 채운다. 핸들을 숨겨 드래그를 막아도 비고정을 고정
 * 너머로 드롭하면 lib이 고정을 밀 수 있어(배열 순서 = 슬롯 순서라 고정이 자리를 잃는다), 이
 * 수학이 최종 방어선이다.
 */
export function reorderKeepingFixed(
  original: Slot[],
  reordered: Slot[]
): Slot[] {
  const nonFixedInOrder = reordered.filter((s) => !s.isFixed);
  const result: Slot[] = new Array(original.length);
  let cursor = 0;
  for (let i = 0; i < original.length; i += 1) {
    if (original[i].isFixed) {
      result[i] = original[i];
    } else {
      result[i] = nonFixedInOrder[cursor];
      cursor += 1;
    }
  }
  return result;
}

export interface ItineraryEditState {
  days: ItineraryDaysItem[];
  /** GET 결과로 1회 시드 — 원본 배열과 독립하도록 얕게 복사해 담는다(비파괴). */
  seed(days: ItineraryDaysItem[]): void;
  /** 해당 날에서 첫 일치 슬롯 제거. */
  deleteSlot(date: string, poiId: string): void;
  /** `onDragEnd.data`를 받아 해당 날 슬롯을 고정 재고정 후 반영. */
  reorderSlots(date: string, reordered: Slot[]): void;
  /**
   * 대상 슬롯의 시각 3필드(startAt·endAt·endsNextDay)만 갱신 — 슬롯을 이동시키지 않고
   * (배열 순서 = 슬롯 순서, INV-U3-02) 시드 원본도 안 건드린다(비파괴). `deleteSlot`·
   * `reorderSlots`와 같은 "해당 날에만 얹는 얇은 래퍼"다. 없는 poiId 는 무해(어느 것도 안 바뀜).
   * `endsNextDay`는 시트가 유도한 값을 그대로 싣는다 — 여기서 재판정하지 않는다(§3·★10).
   */
  adjustSlotTime(
    date: string,
    poiId: string,
    patch: { startAt: string; endAt: string; endsNextDay: boolean }
  ): void;
  /** 테스트/재진입 초기화(싱글턴 격리). */
  reset(): void;
}

const INITIAL: Pick<ItineraryEditState, 'days'> = { days: [] };

const createItineraryEditStore: StateCreator<ItineraryEditState> = (set) => ({
  ...INITIAL,
  seed: (days) =>
    set({
      days: days.map((day) => ({ date: day.date, slots: [...day.slots] })),
    }),
  deleteSlot: (date, poiId) =>
    set((state) => ({
      days: state.days.map((day) =>
        day.date === date
          ? { ...day, slots: removeSlot(day.slots, poiId) }
          : day
      ),
    })),
  reorderSlots: (date, reordered) =>
    set((state) => ({
      days: state.days.map((day) =>
        day.date === date
          ? { ...day, slots: reorderKeepingFixed(day.slots, reordered) }
          : day
      ),
    })),
  adjustSlotTime: (date, poiId, patch) =>
    set((state) => ({
      days: state.days.map((day) =>
        day.date === date
          ? {
              ...day,
              slots: day.slots.map((slot) =>
                slot.poiId === poiId
                  ? {
                      ...slot,
                      startAt: patch.startAt,
                      endAt: patch.endAt,
                      endsNextDay: patch.endsNextDay,
                    }
                  : slot
              ),
            }
          : day
      ),
    })),
  reset: () => set(INITIAL),
});

export const useItineraryEditStore = create(createItineraryEditStore);
