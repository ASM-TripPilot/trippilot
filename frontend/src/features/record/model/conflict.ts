/**
 * TRIP-568 · BR-U5-22 (AC-3 전제) — updated_at 기반 충돌 판정 + 충돌 카드 뷰모델 타입.
 *
 * 무엇을 보장하나: `isVisitConflict` 는 **로컬 편집이 딛고 선 base 시각이 서버 `updated_at`
 * 보다 이르면 충돌**이라고 답한다 — 그 사이 다른 기기가 먼저 고쳐 서버가 앞서갔다는 뜻이라
 * 조용히 덮으면 안 되고 사용자가 골라야 한다(BR-U5-21, INV-4). base 가 서버와 같거나(로컬이
 * 최신) 늦으면 충돌이 아니다.
 *
 * 개념: **낙관적 락(optimistic lock)** — 잠그지 않고 편집하되 저장 시 "내가 딛고 선 버전이 아직
 * 서버 최신인가"를 시각으로 검사한다. ISO 문자열은 UTC(`...Z`)면 사전식(문자) 비교가 시각 순서와
 * 일치해 `new Date` 파싱 없이도 타임존 안전하다(stayAttribution 선례).
 *
 * `ConflictVisitVM` 은 충돌 카드가 그릴 값이다 — 비교 행을 `rows` 로 실어(카드마다 필드 세트가
 * 달라도, 충돌 축 시각\|상태 + 메모 + 사진수) 화면이 유연하게 렌더한다. VM 을 실데이터로 채우는
 * 배선(서버 serverUpdatedAt·day-visits 조회)은 후속 티켓이다.
 */

export type ConflictChoice = 'local' | 'server';

/** 방문 하나에 대해 사용자가 고른 버전. */
export interface ConflictSelection {
  visitCheckId: string;
  choice: ConflictChoice;
}

/** 충돌 카드 비교 행 하나(로컬 vs 서버 값). */
export interface ConflictRow {
  label: string;
  local: string;
  server: string;
}

/** 충돌 카드 뷰모델 — 방문 하나 = 카드 하나. */
export interface ConflictVisitVM {
  visitCheckId: string;
  nameKo: string;
  rows: ConflictRow[];
}

export function isVisitConflict(
  localBaseUpdatedAt: string,
  serverUpdatedAt: string
): boolean {
  return localBaseUpdatedAt < serverUpdatedAt;
}
