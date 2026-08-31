import { isAxiosError } from 'axios';

/**
 * TRIP-619 · AC-4 · BR-U5-20·21 · INV-4 — 방문 409 응답을 code 로 갈라 멱등 수렴과 해소필요를
 * 서로 다른 결과로 분류한다. `features/itinerary/model/slotSwapError.ts` 선례를 미러링한다.
 *
 * 409 는 상태코드만으론 못 가른다 — 전역 오류봉투(`ErrorResponse { error: { code } }`)의
 * `error.response.data.error.code` 로 두 갈래를 가르고, 모르는/없는 code·비-409·네트워크·비-axios 는
 * 전부 안전한 폴백(`unknown`)으로 접는다(조용히 삼키지 않는다, INV-4).
 *
 * ★ slotSwap 과 다른 점 둘: (1) slotSwap 은 계약이 code 를 문서화하지 않아 대표값을 발명했지만
 * 방문은 openapi 가 실코드를 문서화했다(895·931·2513) — 아래 상수는 그 계약값이다. (2) 이 티켓은
 * "두 code 를 서로 다른 결과로 가른다"까지가 범위라, 해소 화면·큐 카피를 발명하지 않으려고 판별
 * 결과에서 `message` 를 뺀다(slotSwap 의 `{ kind, message }` 에서 `{ kind }` 만 미러).
 */
export const VISIT_CONFLICT_CODES = {
  conflict: 'VISIT_CONFLICT',
  alreadyRecorded: 'VISIT_ALREADY_RECORDED',
} as const;

export type VisitConflictKind = 'conflict' | 'alreadyRecorded' | 'unknown';

const CODE_TO_KIND: Record<string, VisitConflictKind> = {
  [VISIT_CONFLICT_CODES.conflict]: 'conflict',
  [VISIT_CONFLICT_CODES.alreadyRecorded]: 'alreadyRecorded',
};

export function resolveVisitConflict(error: unknown): {
  kind: VisitConflictKind;
} {
  // axios 오류가 아니면(평범한 Error·undefined·null) 원인을 못 읽으니 안전한 폴백 — 삼키지 않는다.
  if (!isAxiosError(error)) return { kind: 'unknown' };
  // 응답 없음(네트워크)·비-409 는 방문 충돌 판정 대상이 아니다 → 한 줄로 폴백에 접는다.
  if (error.response?.status !== 409) return { kind: 'unknown' };

  const data = error.response?.data as
    { error?: { code?: string } } | undefined;
  const code = data?.error?.code;
  const kind = code === undefined ? undefined : CODE_TO_KIND[code];
  // 모르는/없는 code 는 계약 공백 방어로 폴백(침묵 금지).
  return { kind: kind ?? 'unknown' };
}
