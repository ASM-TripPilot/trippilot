import type { CategoryShare } from '@/shared/api/generated/schemas';

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
