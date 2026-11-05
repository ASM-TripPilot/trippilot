import {
  addSlot,
  buildEditItineraryRequest,
  insertSlotAt,
} from '@/features/edit-itinerary';
import { suggestNextSlotTime } from '@/entities/itinerary-slot';
import type {
  EditItineraryRequest,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  Place,
} from '@/shared/api/index.schemas';

/**
 * TRIP-1794 · 장소 추가 「여러 곳 한 번에 담기」의 단계 전이 — 순수 리듀서(선례 `pages/record/share-card/model/storyDeck.ts`).
 * 초심자용: 리듀서 = "지금 상태와 사건 하나를 받아 다음 상태를 돌려주는 순수 함수". 화면·PUT 을 모르고 단계만 쥔다.
 * 바뀔 게 없으면 받은 상태를 **그대로**(같은 참조) 돌려준다 — 테스트가 이것으로 "이 사건은 무시됐다"를 판정한다.
 */

/** 시각 시트에서 확정한 한 곳의 시각 — `TimeSheet.onApply` 의 patch 와 같은 모양. */
export interface BulkTime {
  startAt: string;
  endAt: string;
  endsNextDay: boolean;
}

export type BulkAddState =
  /** 고르는 중 — `picked` 는 체크한 순서. */
  | { phase: 'picking'; picked: Place[] }
  /** 시각 시트를 곳마다 차례로 여는 중 — `times[i]` 는 `picked[i]` 의 확정이고 `times.length` 가 지금 시트 번호다. */
  | { phase: 'timing'; picked: Place[]; times: BulkTime[] }
  /** 마지막 시각을 확정해 PUT 이 나가는 중 — `times.length === picked.length`. */
  | { phase: 'saving'; picked: Place[]; times: BulkTime[] };

export type BulkAddEvent =
  | { type: 'toggle'; place: Place }
  | { type: 'start' }
  /** poiId 는 "지금 연 시트의 곳" — 갈아 끼운 옛 시트의 늦은 신호를 걸러내는 표다. */
  | { type: 'apply'; poiId: string; time: BulkTime }
  | { type: 'cancel'; poiId: string }
  | { type: 'succeeded' }
  | { type: 'failed' };

export const initialBulkAdd: BulkAddState = { phase: 'picking', picked: [] };

export function bulkAddReducer(
  state: BulkAddState,
  event: BulkAddEvent
): BulkAddState {
  switch (state.phase) {
    case 'picking':
      if (event.type === 'toggle') {
        const has = state.picked.some((p) => p.poiId === event.place.poiId);
        return {
          phase: 'picking',
          picked: has
            ? state.picked.filter((p) => p.poiId !== event.place.poiId)
            : [...state.picked, event.place],
        };
      }
      if (event.type === 'start' && state.picked.length > 0) {
        return { phase: 'timing', picked: state.picked, times: [] };
      }
      return state;
    case 'timing': {
      const current = state.picked[state.times.length];
      if (event.type === 'apply' && event.poiId === current.poiId) {
        const times = [...state.times, event.time];
        return {
          phase: times.length === state.picked.length ? 'saving' : 'timing',
          picked: state.picked,
          times,
        };
      }
      if (event.type === 'cancel' && event.poiId === current.poiId) {
        return { phase: 'picking', picked: state.picked };
      }
      return state;
    }
    case 'saving':
      if (event.type === 'succeeded') return initialBulkAdd;
      if (event.type === 'failed') {
        return { phase: 'picking', picked: state.picked };
      }
      return state;
  }
}

export function isPicked(state: BulkAddState, poiId: string): boolean {
  return state.picked.some((p) => p.poiId === poiId);
}

/**
 * 지금 열 시각 시트(timing 일 때만). 첫 곳 기본값은 페이지가 넘기고, 둘째부터는 **방금 확정한 곳의 끝**에서 이어진다
 * (자정을 넘겨 끝났으면 `suggestNextSlotTime` 의 10:00–11:00 폴백). 제안값일 뿐 시각 재추정이 아니다(INV-2).
 */
export function currentBulkSheet(
  state: BulkAddState,
  firstDefault: { startAt: string; endAt: string }
): {
  place: Place;
  index: number;
  total: number;
  startAt: string;
  endAt: string;
} | null {
  if (state.phase !== 'timing') return null;
  const index = state.times.length;
  const { startAt, endAt } =
    index === 0 ? firstDefault : suggestNextSlotTime(state.times[index - 1]);
  return {
    place: state.picked[index],
    index,
    total: state.picked.length,
    startAt,
    endAt,
  };
}

/**
 * K곳을 `insertAt`(없으면 그날 끝)부터 고른 순서로 연속해 끼운 PUT 요청을 만든다. 한 곳 「추가」도 K=1 로 이 함수를 지난다.
 * `addedIndex` = 첫 새 슬롯이 실제로 들어간 그날 배열 index(길이를 넘는 `insertAt` 은 끝으로 잘린 값), `newSlots` = 요청에 넣은 새 슬롯.
 * 입력 `days` 는 바꾸지 않는다.
 */
export function buildBulkAddRequest({
  days,
  targetDate,
  insertAt,
  places,
  times,
}: {
  days: ItineraryDaysItem[];
  targetDate: string;
  insertAt: number | undefined;
  places: Place[];
  times: BulkTime[];
}): {
  request: EditItineraryRequest;
  newSlots: ItineraryDaysItemSlotsItem[];
  addedIndex: number;
} {
  const newSlots: ItineraryDaysItemSlotsItem[] = places.map((place, i) => ({
    poiId: place.poiId,
    startAt: times[i].startAt,
    endAt: times[i].endAt,
    isFixed: false,
    endsNextDay: times[i].endsNextDay,
    hasViolation: false,
    tags: [],
    // 로컬로 만든 새 슬롯엔 AI 차선책이 없다 — 계약상 "편집하면 사라진다"(빈 배열).
    alternatives: [],
  }));
  const nextDays = days.map((day) =>
    day.date === targetDate
      ? {
          ...day,
          slots: newSlots.reduce(
            (slots, slot, i) =>
              insertAt !== undefined
                ? insertSlotAt(slots, slot, insertAt + i)
                : addSlot(slots, slot),
            day.slots
          ),
        }
      : day
  );
  return {
    request: buildEditItineraryRequest(nextDays),
    newSlots,
    addedIndex:
      newSlots.length === 0
        ? -1
        : (nextDays
            .find((day) => day.date === targetDate)
            ?.slots.indexOf(newSlots[0]) ?? -1),
  };
}
