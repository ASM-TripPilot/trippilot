/**
 * 취향 축 토글 순수 규칙 (US-ONB-05·15 · AC5) — `toggleMulti`(복수 축)·`toggleSingle`(단일 축).
 *
 * 승격 배경(TRIP-610): 원래 `features/onboarding/model/preferenceSelection.ts` 에 있던 것을
 * `shared/` 로 올렸다. `features/settings`(l05 취향 수정)가 같은 토글 규칙을 써야 하는데
 * `features` 간 직접 import 가 막혀 있어(eslint 층 zone), 공용 재사용 경로는 `shared` 뿐이다.
 *
 * 지금 위치(TRIP-1162): "다 지우면 null" 은 취향 데이터에 거는 제품 규칙이라 shared 에 두지 않고
 * 이 슬라이스로 왔다. 소비처는 공개 API `@/features/edit-preferences` 로 가져온다.
 *
 * `null` = 미설정(아직 안 고름), `[]` = "골랐다가 다 지웠다"와 섞이면 안 되는 별개 상태다
 * (US-ONB-14 — 서버가 미설정 축에 중립 기본값을 파생하려면 `null`과 `[]`를 구분해야 한다).
 * 그래서 `toggleMulti`는 마지막 원소를 지운 결과가 빈 배열이면 `null`로 되돌린다.
 */

export function toggleMulti(
  current: readonly string[] | null,
  id: string
): string[] | null {
  const next = current ? [...current] : [];
  const index = next.indexOf(id);

  if (index === -1) {
    next.push(id);
  } else {
    next.splice(index, 1);
  }

  return next.length === 0 ? null : next;
}

export function toggleSingle(
  current: string | null,
  id: string
): string | null {
  // 라디오형이지만 "선택 안 함"으로 되돌릴 별도 UI가 없으므로, 같은 값을 다시 고르면
  // 해제(null)로 취급한다 — 그래야 한 번 고른 축을 다시 미설정으로 되돌릴 수 있다.
  return current === id ? null : id;
}
