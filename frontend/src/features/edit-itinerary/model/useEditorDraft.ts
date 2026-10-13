import { parseSlotKey } from '@/entities/itinerary-slot';

import { useItineraryEditStore } from './itineraryEditStore';

/**
 * 일정 편집기 두 페이지(`ItineraryEditPage`·`ManualPlanPage`)가 똑같이 쥐던 편집 스토어 5셀렉터와
 * "열린 시각 시트의 슬롯 찾기"를 한 곳에 둔다. 시트 개폐(`editingSlotKey`)는 페이지 state 가 쥐고 여기엔 값만 넘긴다.
 * `editing` 은 파싱한 슬롯키(null = 닫힘), `editingSlot` 은 시트가 열렸고 그 슬롯이 드래프트에 실재할 때만 값이 있다(둘 중 하나라도 없으면 undefined).
 */
export function useEditorDraft(editingSlotKey: string | null) {
  const seed = useItineraryEditStore((s) => s.seed);
  const deleteSlot = useItineraryEditStore((s) => s.deleteSlot);
  const reorderSlots = useItineraryEditStore((s) => s.reorderSlots);
  const adjustSlotTime = useItineraryEditStore((s) => s.adjustSlotTime);
  const days = useItineraryEditStore((s) => s.days);

  const editing = editingSlotKey === null ? null : parseSlotKey(editingSlotKey);
  const editingSlot =
    editing !== null && editing.kind === 'ok'
      ? days
          .find((day) => day.date === editing.date)
          ?.slots.find((slot) => slot.poiId === editing.poiId)
      : undefined;

  return {
    seed,
    deleteSlot,
    reorderSlots,
    adjustSlotTime,
    days,
    editing,
    editingSlot,
  };
}
