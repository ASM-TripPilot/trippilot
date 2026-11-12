/**
 * TRIP-1795 — 슬롯의 "화면에 보일 이름·분류". 사용자가 이 여행에서만 고친 값(`displayName`·`displayCategory`)이 있으면 그것을,
 * 없으면(null·undefined·빈 문자열·공백뿐) 장소 원본(`nameKo`·`category`)을 돌려준다. 둘 다 비면 null — 표면별 폴백(`''`·`'미확인'`)은 호출부 몫.
 * 보이는 곳만 이 함수를 지난다. 판정·외부 검색·조인 키는 원본(`nameKo`·`category`)을 직접 읽는다.
 */
const present = (value: string | null | undefined): string | null =>
  value != null && value.trim() !== '' ? value : null;

// 서버 슬롯뿐 아니라 칸 이름만 같은 부분 모양(회고 입력 등)도 받도록 구조 타입으로 받는다.
export function slotDisplayName(slot: {
  nameKo?: string | null;
  displayName?: string | null;
}): string | null {
  return present(slot.displayName) ?? present(slot.nameKo);
}

export function slotDisplayCategory(slot: {
  category?: string | null;
  displayCategory?: string | null;
}): string | null {
  return present(slot.displayCategory) ?? present(slot.category);
}
