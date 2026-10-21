import { useCallback, useEffect } from 'react';

import { parseSlotKey } from '@/entities/itinerary-slot';

import type { ItineraryDaysItem } from '@/shared/api/index.schemas';

import { useItineraryEditStore } from './itineraryEditStore';

/**
 * 일정 편집기 두 페이지(`ItineraryEditPage`·`ManualPlanPage`)가 똑같이 쥐던 편집 스토어 5셀렉터와
 * "열린 시각 시트의 슬롯 찾기"를 한 곳에 둔다. 시트 개폐(`editingSlotKey`)는 페이지 state 가 쥐고 여기엔 값만 넘긴다.
 * `seedUnlessDirty` 는 "조회 데이터가 (다시) 도착하면 초안을 채움" 규칙의 가드판이다 — 사용자가 저장 전에 바꾼 초안(`dirty`)은
 * 남이 바꾼 캐시(장소 추가 응답 등)로 덮지 않는다. 편집기 **자신의 저장 성공**은 가드 밖이라 페이지가 `seed` 를 직접 부른다(TRIP-1498).
 * 편집기가 사라지면 스토어를 비운다 — 안 비우면 `dirty` 가 다음 진입(재진입·장소 추가 단독 진입)으로 넘어간다.
 * `editing` 은 파싱한 슬롯키(null = 닫힘), `editingSlot` 은 시트가 열렸고 그 슬롯이 드래프트에 실재할 때만 값이 있다(둘 중 하나라도 없으면 undefined).
 */
export function useEditorDraft(editingSlotKey: string | null) {
  const seed = useItineraryEditStore((s) => s.seed);
  const deleteSlot = useItineraryEditStore((s) => s.deleteSlot);
  const reorderSlots = useItineraryEditStore((s) => s.reorderSlots);
  const adjustSlotTime = useItineraryEditStore((s) => s.adjustSlotTime);
  const days = useItineraryEditStore((s) => s.days);

  const seedUnlessDirty = useCallback(
    (loaded: ItineraryDaysItem[]) => {
      if (!useItineraryEditStore.getState().dirty) seed(loaded);
    },
    [seed]
  );
  useEffect(() => () => useItineraryEditStore.getState().reset(), []);

  const editing = editingSlotKey === null ? null : parseSlotKey(editingSlotKey);
  const editingSlot =
    editing !== null && editing.kind === 'ok'
      ? days
          .find((day) => day.date === editing.date)
          ?.slots.find((slot) => slot.poiId === editing.poiId)
      : undefined;

  return {
    seed,
    seedUnlessDirty,
    deleteSlot,
    reorderSlots,
    adjustSlotTime,
    days,
    editing,
    editingSlot,
  };
}
