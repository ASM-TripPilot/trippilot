/**
 * TRIP-295 · BR-U2-04 · PBT-U3-4 · PBT-U2-B3 (01b D1 · D2) — 슬롯 키 `"{date}#{poiId}"` 규약.
 *
 * 한 슬롯을 가리키는 이름이 이 파일에서만 만들어진다 — `explanations`의 키, `Violation.slotKey`,
 * 화면 testID(`itinerary-draft-slot-{slotKey}`)가 전부 같은 규약을 써야 하므로 목록 조립
 * (`buildSlotKeys`)도 자기 규칙을 따로 갖지 않고 `buildSlotKey`를 부른다. 두 경로가 갈리면
 * 렌더 층에서야 드러난다.
 *
 * 실패할 수 있는 두 판정(되읽기·충돌)은 던지지 않고 `kind`로 갈라 돌려준다(`parseBudgetAmount`
 * 선례). RN에서 미처리 예외는 화면을 죽이고, `null` 하나로는 "없음"과 "깨짐"을 호출부가 다시
 * 추측해야 한다.
 *
 * `buildSlotKey`는 입력을 검증하지 않는다 — 동결 시그니처가 `(string, string) => string`이고
 * ISO 날짜·UUID 강제는 어느 정본에도 없다(넣으면 요구사항 발명이다). 그 자리를 대신하는 것이
 * 구분자 `#`다: `('2026-09-1','4abc')`와 `('2026-09-14','abc')`는 그냥 이으면 같은 문자열이
 * 되지만 구분자가 있으면 갈라진다.
 *
 * TRIP-1812 · 같은 날 같은 장소가 둘이면 `ordinal`(앞선 같은 장소 수)을 접미로 붙인다(BR-U2-04 `#{ordinal}` 확장). 첫 슬롯은 접미가 없어
 * 같은 장소가 없는 일정의 키는 글자까지 그대로다. **편집기 안에서만 쓴다** — 서버 slotKey 는 여전히 `{date}#{poiId}` 라 요청에 싣지 않는다.
 * 자리 번호가 아닌 이유: 다른 장소를 끌거나 빼도 눌린 카드를 계속 가리켜야 한다.
 */
export function buildSlotKey(date: string, poiId: string, ordinal = 0): string {
  return ordinal > 0 ? `${date}#${poiId}#${ordinal}` : `${date}#${poiId}`;
}

export type ParsedSlotKey =
  | { kind: 'ok'; date: string; poiId: string; ordinal?: number }
  | { kind: 'invalid' };

/**
 * 키를 다시 값으로 가른다. `{date}#{poiId}` 와 1 이상 ordinal 접미(`#N`)만 `ok`다 — 그 밖은 어느 조각이 무엇인지
 * 정해지지 않아 왕복이 성립하지 않는다. `#0` 이 invalid 인 이유는 접미 없는 키와 같은 슬롯이 두 이름을 갖게 되기 때문이다.
 */
export function parseSlotKey(key: string): ParsedSlotKey {
  const parts = key.split('#');
  if (parts.length === 2) {
    return { kind: 'ok', date: parts[0], poiId: parts[1] };
  }
  if (parts.length === 3 && /^[1-9]\d*$/.test(parts[2])) {
    return {
      kind: 'ok',
      date: parts[0],
      poiId: parts[1],
      ordinal: Number(parts[2]),
    };
  }

  return { kind: 'invalid' };
}

/** `slots[index]` 앞에 같은 장소가 몇 곳인가 — 같은 날 같은 장소 카드를 가르는 번호(TRIP-1812). */
export function slotOrdinal(
  slots: readonly { poiId: string }[],
  index: number
): number {
  return slots
    .slice(0, index)
    .filter((slot) => slot.poiId === slots[index]?.poiId).length;
}

/** 그 장소의 `ordinal` 번째 슬롯 자리. 없으면 -1. `slotOrdinal` 의 역. */
export function findSlotIndex(
  slots: readonly { poiId: string }[],
  poiId: string,
  ordinal = 0
): number {
  let seen = 0;
  return slots.findIndex((slot) => slot.poiId === poiId && seen++ === ordinal);
}

export type SlotKeySet =
  { kind: 'ok'; keys: string[] } | { kind: 'conflict'; duplicates: string[] };

/**
 * 목록 전체의 키. 같은 날 같은 POI가 두 번 오면 `ok`를 내지 않는다 — 키가 겹친 채로 지도·
 * 객체에 담기면 뒤엣것이 앞엣것을 덮어써 슬롯 하나가 조용히 사라진다(BR-U2-04 키 충돌 방지).
 * 겹친 키를 함께 돌려주므로 호출부가 무엇을 고쳐야 하는지 알 수 있다 — **겹친 키 목록**이지
 * 충돌 횟수가 아니라서, 같은 키가 세 번 와도 한 번만 담긴다(순서는 처음 겹친 순서).
 */
export function buildSlotKeys(
  entries: { date: string; poiId: string }[]
): SlotKeySet {
  const keys = entries.map((entry) => buildSlotKey(entry.date, entry.poiId));
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const key of keys) {
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }

  return duplicates.size > 0
    ? { kind: 'conflict', duplicates: [...duplicates] }
    : { kind: 'ok', keys };
}
