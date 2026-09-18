import type {
  CategoryShare,
  StyleAnalysisEnvelope,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-573 · j05 여행 스타일 — 임계/승격 판정 순수 함수(PBT-U5-F4 CI 차단 게이트 대상).
 *
 * 승격 권위는 **서버 `official` 플래그**다 — 클라는 `progress.current >= required` 로 정식을 자체
 * 합성하지 않는다(9↔10 경계에서도). `buildStyleCardModel`(features/settings, l03 요약카드)이 같은
 * 계약을 각자 판정하지만 features 간 import 금지라 공유 불가 — reflection 이 자체 판정을 소유한다
 * (병렬 드리프트는 shared 승격 후속, Follow-up E).
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

/** poi.category 코드 → 화면 표시 라벨(O-U5-7). 유일한 불일치는 `맛집→미식`. */
const CATEGORY_LABEL: Record<string, string> = { 맛집: '미식' };

/**
 * 표시 라벨만 입힌다 — 집계(상위 3 + 기타)는 서버가 이미 했다(`CategoryShare.isOther`).
 * isOther 줄은 코드와 무관하게 예약 라벨 `기타`, 그 외는 매핑표 → 없으면 코드 그대로(항등 폴백).
 */
export function categoryLabel(share: CategoryShare): string {
  if (share.isOther) return '기타';
  return CATEGORY_LABEL[share.category] ?? share.category;
}
