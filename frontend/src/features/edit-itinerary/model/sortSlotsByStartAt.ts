/**
 * 그 날 슬롯을 시작 시각(`HH:mm:ss` 전체) 오름차순으로 세운다 — 서버(AI `DaySolution`)가 "슬롯은 시작
 * 시각 순"을 422 로 검사하므로, 시각을 바꾼 뒤 저장 전에 같은 규칙으로 맞춘다. 키는 `startAt` 뿐이다
 * (`endAt`·`endsNextDay` 는 안 본다 — 23:15 시작 자정 넘김 슬롯도 그날 맨 뒤). 같은 시각은 입력 순서
 * 유지(`Array.prototype.sort` 는 안정 정렬). `startAt === null`(미지정) 슬롯은 제자리에 두고 시각 있는
 * 슬롯끼리 그 빈 자리를 채운다. 새 배열을 돌려주고 입력·원소는 안 바꾼다.
 */
export function sortSlotsByStartAt<T extends { startAt: string | null }>(
  slots: readonly T[]
): T[] {
  const timed = slots.filter((s) => s.startAt !== null);
  // ponytail: 문자열 비교가 곧 시각 비교 — `HH:mm:ss` 는 고정 폭·0 채움이라 사전순 = 시각순.
  timed.sort((a, b) =>
    a.startAt! < b.startAt! ? -1 : a.startAt! > b.startAt! ? 1 : 0
  );
  let next = 0;
  return slots.map((s) => (s.startAt === null ? s : timed[next++]!));
}
