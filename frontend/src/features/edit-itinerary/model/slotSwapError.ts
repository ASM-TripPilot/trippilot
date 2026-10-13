import { isAxiosError } from 'axios';

/**
 * AC7 (INV-4) — 슬롯 교체 PUT 실패를 침묵시키지 않고 갈래별 문구로 안내한다.
 *
 * 409 는 상태코드만으론 못 가른다 — 전역 오류봉투(`ErrorResponse { error: { code, message } }`)의
 * `error.response.data.error.code` 로 확정일정·생성중·슬롯특정불가 셋을 **서로 다른 문구**로 가르고,
 * code 가 없거나 모르는 값이면 **공통 폴백**으로 안전하게 접는다(계약이 3 코드를 아직 문서화하지
 * 않았으므로 — Seed 3-a). 404·400·네트워크·비-axios 오류도 각각 안내한다. 어느 경우에도 빈 문구로
 * 삼키지 않는다.
 *
 * 기존 `isNotFound`(404)·`isAlreadyRegistered`(409)는 status 만 봐 409 세 갈래를 못 가른다 —
 * 그래서 code 까지 보는 신규 판정이다(같은 `isAxiosError` 오리검사를 공유한다: 평범한 객체
 * `{ response: { status } }` 는 통과 못 하고 실제 axios 오류만 이 경로를 탄다).
 */

/**
 * 409 세 갈래의 대표 code 상수. 계약이 아직 실제 값을 문서화하지 않아(Seed 3-a) 이 모듈이 **단일
 * 출처**로 소유한다 — 테스트도 값을 발명하지 않고 이 상수를 import 해 분기를 잰다. 서버가 실제 값을
 * 확정하면 여기만 고치면 된다(호출부는 kind 로만 분기하므로 불변).
 */
export const SLOT_SWAP_CONFLICT_CODES = {
  confirmed: 'ITINERARY_CONFIRMED',
  generating: 'ITINERARY_GENERATING',
  ambiguous: 'SLOT_AMBIGUOUS',
} as const;

export type SlotSwapErrorKind =
  | 'confirmed'
  | 'generating'
  | 'ambiguous'
  | 'notFound'
  | 'badRequest'
  | 'fallback';

export interface SlotSwapError {
  kind: SlotSwapErrorKind;
  /** 인라인으로 그대로 노출할 안내 문구 — 절대 빈 문자열이 아니다(INV-4 침묵 금지). */
  message: string;
}

// kind 별 문구 — 네 갈래(확정·생성중·특정불가·폴백)가 서로 달라야 "한 문구로 뭉개기"를 안 한다.
const MESSAGE: Record<SlotSwapErrorKind, string> = {
  confirmed: '확정된 일정이라 지금은 바꿀 수 없어요',
  generating: '일정을 만드는 중이에요. 잠시 후 다시 시도해 주세요',
  ambiguous: '같은 장소가 여러 번 있어 어떤 걸 바꿀지 정하지 못했어요',
  notFound: '해당 일정을 찾을 수 없어요',
  badRequest: '요청을 확인하지 못했어요. 입력을 다시 확인해 주세요',
  fallback: '지금은 바꿀 수 없어요. 잠시 후 다시 시도해 주세요',
};

const CODE_TO_KIND: Record<string, SlotSwapErrorKind> = {
  [SLOT_SWAP_CONFLICT_CODES.confirmed]: 'confirmed',
  [SLOT_SWAP_CONFLICT_CODES.generating]: 'generating',
  [SLOT_SWAP_CONFLICT_CODES.ambiguous]: 'ambiguous',
};

function build(kind: SlotSwapErrorKind): SlotSwapError {
  return { kind, message: MESSAGE[kind] };
}

export function resolveSlotSwapError(error: unknown): SlotSwapError {
  // axios 오류가 아니면(평범한 Error·undefined·null) 원인을 못 읽으니 안전한 폴백 — 삼키지 않는다.
  if (!isAxiosError(error)) return build('fallback');

  const status = error.response?.status;
  // 응답 자체가 없다(네트워크 실패) → "모른다" → 폴백(fail-safe, isNotFound 오리검사와 같은 취지).
  if (status === undefined) return build('fallback');

  if (status === 409) {
    const data = error.response?.data as
      { error?: { code?: string } } | undefined;
    const code = data?.error?.code;
    const kind = code === undefined ? undefined : CODE_TO_KIND[code];
    return build(kind ?? 'fallback');
  }
  if (status === 404) return build('notFound');
  if (status === 400) return build('badRequest');
  return build('fallback');
}
