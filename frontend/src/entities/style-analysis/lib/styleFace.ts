import type { StyleAnalysisEnvelope } from '@/shared/api/generated/schemas';

/**
 * TRIP-637 · 스타일 분석 정식/임시 판정 — j05(reflection)와 l03 요약카드(settings)가 같이 쓰는 한 곳
 * (TRIP-573 `features/reflection/model/styleThreshold.ts` 에서 본문 무변경 이동, PBT-U5-F4 CI 차단 게이트 대상).
 *
 * 승격 권위는 **서버 `official` 플래그**다 — 클라는 `progress.current >= required` 로 정식을 자체
 * 합성하지 않는다(9↔10 경계에서도).
 *
 * [[반쪽 방어]]: envelope·`analysis` 중첩 결측(null/undefined)에도 크래시 0·never promote on garbage.
 */

export type StyleFace = 'official' | 'insufficient';

/**
 * 정식(official)이려면 서버가 official 이라 내려주고 **또한** 분석 본문(analysis)이 있어야 한다.
 * 그 외 — official=false / analysis 결측 / envelope·중첩 결측 — 은 전부 임시(insufficient).
 * `progress.current` 는 **읽지 않는다**(current 비교로 승격을 몰지 않는 것이 PBT-U5-F4 의 계약).
 */
export function resolveStyleFace(envelope: StyleAnalysisEnvelope): StyleFace {
  if (
    envelope != null &&
    envelope.official === true &&
    envelope.analysis != null
  ) {
    return 'official';
  }
  return 'insufficient';
}
