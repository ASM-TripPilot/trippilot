import { useCallback, useEffect } from 'react';

import { findSlotIndex, parseSlotKey } from '@/entities/itinerary-slot';

import type { ItineraryDaysItem } from '@/shared/api/index.schemas';

import { useItineraryEditStore } from './itineraryEditStore';

/**
 * 일정 편집기 두 페이지(`ItineraryEditPage`·`ManualPlanPage`)가 똑같이 쥐던 편집 스토어 5셀렉터와
 * "열린 시각 시트의 슬롯 찾기"를 한 곳에 둔다. 시트 개폐(`editingSlotKey`)는 페이지 state 가 쥐고 여기엔 값만 넘긴다.
 * `seedUnlessDirty` 는 "조회 데이터가 (다시) 도착하면 초안을 채움" 규칙의 가드판이다 — 사용자가 저장 전에 바꾼 초안(`dirty`)은
 * 남이 바꾼 캐시(장소 추가 응답 등)로 덮지 않는다. 편집기 **자신의 저장 성공**은 가드 밖이라 페이지가 `seed` 를 직접 부른다(TRIP-1498).
 * 편집기가 사라지면 스토어를 비운다 — 안 비우면 `dirty` 가 다음 진입(재진입·장소 추가 단독 진입)으로 넘어간다.
 * `editing` 은 파싱한 슬롯키(null = 닫힘), `editingSlot` 은 시트가 열렸고 그 슬롯이 드래프트에 실재할 때만 값이 있다(둘 중 하나라도 없으면 undefined).
 * 같은 날 같은 장소가 둘이면 키의 ordinal 번째 슬롯이다(TRIP-1812).
 */
export function useEditorDraft(editingSlotKey: string | null) {
  const seed = useItineraryEditStore((s) => s.seed);
  const deleteSlot = useItineraryEditStore((s) => s.deleteSlot);
  const deleteSlots = useItineraryEditStore((s) => s.deleteSlots);
  const reorderSlots = useItineraryEditStore((s) => s.reorderSlots);
  const adjustSlotTime = useItineraryEditStore((s) => s.adjustSlotTime);
  const moveSlot = useItineraryEditStore((s) => s.moveSlot);
  const renameSlot = useItineraryEditStore((s) => s.renameSlot);
  const undo = useItineraryEditStore((s) => s.undo);
  // 구독 값 — 렌더에서 써도 안전한 건 이 불리언뿐이다(맨 위 번호는 아래 getter 로 호출 시점에 읽는다).
  const canUndo = useItineraryEditStore((s) => s.history.length > 0);
  const days = useItineraryEditStore((s) => s.days);

  const seedUnlessDirty = useCallback(
    (loaded: ItineraryDaysItem[]) => {
      if (!useItineraryEditStore.getState().dirty) seed(loaded);
    },
    [seed]
  );
  // 맨 위 이력 번호(없으면 null) — 삭제 핸들러·안내 바 콜백이 부를 때 스토어를 읽는다. 렌더 중에 부르면 React Compiler 가 첫 값으로 굳힌다.
  const topUndoId = useCallback((): number | null => {
    const { history } = useItineraryEditStore.getState();
    return history.length > 0 ? history[history.length - 1].id : null;
  }, []);
  useEffect(() => () => useItineraryEditStore.getState().reset(), []);

  const editing = editingSlotKey === null ? null : parseSlotKey(editingSlotKey);
  const editingDaySlots =
    editing !== null && editing.kind === 'ok'
      ? days.find((day) => day.date === editing.date)?.slots
      : undefined;
  const editingSlot =
    editing !== null && editing.kind === 'ok' && editingDaySlots !== undefined
      ? editingDaySlots[
          findSlotIndex(editingDaySlots, editing.poiId, editing.ordinal)
        ]
      : undefined;

  return {
    seed,
    seedUnlessDirty,
    deleteSlot,
    deleteSlots,
    reorderSlots,
    adjustSlotTime,
    moveSlot,
    renameSlot,
    undo,
    canUndo,
    topUndoId,
    days,
    editing,
    editingSlot,
  };
}
