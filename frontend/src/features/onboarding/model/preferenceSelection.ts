/**
 * 취향 토글 순수 규칙(TRIP-163 · AC5 · §3-4) — 복수/단일 축 공용.
 * null=미설정, []는 절대 만들지 않는다(US-ONB-14 — 미설정과 "골랐다가 다 지움"을 구분).
 */

export function toggleMulti(
  current: string[] | null,
  id: string
): string[] | null {
  if (current === null) {
    return [id];
  }
  if (current.includes(id)) {
    const next = current.filter((value) => value !== id);
    return next.length === 0 ? null : next;
  }
  return [...current, id];
}

export function toggleSingle(
  current: string | null,
  id: string
): string | null {
  return current === id ? null : id;
}
