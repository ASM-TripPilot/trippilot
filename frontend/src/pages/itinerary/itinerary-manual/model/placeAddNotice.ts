/** 비교에 쓰는 슬롯 최소 모양 — 요청(EditItineraryRequest)·응답(Itinerary) 슬롯 둘 다 맞는다. */
export interface PlaceAddSlotLike {
  poiId: string;
  /** "HH:mm:ss" */
  startAt: string;
}

/** 응답에서 추가한 슬롯을 특정한 결과(TRIP-1424). */
export interface PlaceAddShift {
  /** 추가한 슬롯의 응답 시작 `HH:mm` — 요청과 분까지 다를 때만. 같으면 null. */
  addedStartAt: string | null;
  /** 같은 날 추가한 자리 뒤 슬롯 중 시작 `HH:mm` 가 요청과 달라진 수(앞·다른 날은 안 센다). */
  laterShiftedCount: number;
}

/**
 * 그날 요청·응답 슬롯을 같은 자리(index)끼리 견준다 — 정본(BR-U3-13·14 §3 개정)상 성공 응답의 그날 장소 순서는
 * 요청과 같다. 순서가 어긋나면(길이·장소 하나라도 다름) 추가한 슬롯을 특정 못 한 것이라 null(시각을 말하지 않는다).
 * 시각은 `HH:mm`(앞 5글자)로 견주고, 말할 땐 응답값 그대로다(INV-2).
 */
export function comparePlaceAdd({
  requestSlots,
  responseSlots,
  addedIndex,
}: {
  /** 그날 PUT 요청 슬롯(추가한 슬롯 포함, 요청 순서). */
  requestSlots: readonly PlaceAddSlotLike[];
  /** 그날 PUT 응답 슬롯. 응답에 그날이 없으면 undefined. */
  responseSlots: readonly PlaceAddSlotLike[] | undefined;
  /** 요청 배열에서 추가한 슬롯의 index. */
  addedIndex: number;
}): PlaceAddShift | null {
  if (
    responseSlots === undefined ||
    responseSlots.length !== requestSlots.length ||
    addedIndex < 0 ||
    addedIndex >= requestSlots.length ||
    requestSlots.some((slot, i) => slot.poiId !== responseSlots[i].poiId)
  ) {
    return null;
  }
  const hhmm = (startAt: string): string => startAt.slice(0, 5);
  const added = hhmm(responseSlots[addedIndex].startAt);
  return {
    addedStartAt:
      added === hhmm(requestSlots[addedIndex].startAt) ? null : added,
    laterShiftedCount: requestSlots.filter(
      (slot, i) =>
        i > addedIndex && hhmm(slot.startAt) !== hhmm(responseSlots[i].startAt)
    ).length,
  };
}

/** 토스트 문구(01b Q6 행렬). 특정 못 함(null)·바뀐 것 없음은 같은 저장 문구다. */
export function placeAddToastMessage(shift: PlaceAddShift | null): string {
  if (shift === null) return '추가했어요 · 일정에 바로 저장됐어요';
  const { addedStartAt, laterShiftedCount } = shift;
  if (addedStartAt !== null) {
    const base = `추가했어요 · 이동 시간을 반영해 ${addedStartAt}으로 맞췄어요`;
    return laterShiftedCount > 0
      ? `${base} · 뒤 ${laterShiftedCount}곳도 시간이 밀렸어요`
      : base;
  }
  return laterShiftedCount > 0
    ? `추가했어요 · 뒤 ${laterShiftedCount}곳의 시간이 밀렸어요`
    : '추가했어요 · 일정에 바로 저장됐어요';
}

/**
 * TRIP-1794 · 여러 곳 담기 토스트 — 요청·응답 그날 슬롯을 같은 자리끼리 견줘 **어느 시작이라도** 달라졌으면 밀림 문구, 아니면(특정 못 함 포함)
 * 저장 문구. 곳이 여럿이라 구체 시각은 말하지 않는다(INV-2·3 — 시각은 시트·일정 화면이 응답 그대로 보여 준다).
 */
export function bulkAddToastMessage({
  count,
  requestSlots,
  responseSlots,
}: {
  count: number;
  requestSlots: readonly PlaceAddSlotLike[];
  responseSlots: readonly PlaceAddSlotLike[] | undefined;
}): string {
  const shifted =
    responseSlots !== undefined &&
    responseSlots.length === requestSlots.length &&
    requestSlots.every((slot, i) => slot.poiId === responseSlots[i].poiId) &&
    requestSlots.some(
      (slot, i) =>
        slot.startAt.slice(0, 5) !== responseSlots[i].startAt.slice(0, 5)
    );
  return `${count}곳을 담았어요 · ${
    shifted ? '이동 시간을 반영해 시각을 맞췄어요' : '일정에 바로 저장됐어요'
  }`;
}
