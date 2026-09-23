import { formatDistance } from '@/entities/place/lib/formatDistance';

/**
 * TRIP-754 · i08 반영 시트 요약 배지 문구 — `['바뀐 곳 N', '방문지 A→B', '이동 ±X']`.
 *
 * 거리 차이는 거리로만 쓴다(INV-3 — `formatDistance` 는 m/km 만 낸다). 음수는 수학 빼기(U+2212),
 * 양수는 '+', |Δ|<10m 는 부호 없이 `이동 0m`(`−0m`·`−10m` 금지). null 이면 거리 배지를 뺀다.
 */

export interface AppliedSummaryInput {
  changedCount: number;
  visitsBefore: number;
  visitsAfter: number;
  distanceDeltaM: number | null;
}

export function appliedSummaryBadges({
  changedCount,
  visitsBefore,
  visitsAfter,
  distanceDeltaM,
}: AppliedSummaryInput): string[] {
  const badges = [
    `바뀐 곳 ${changedCount}`,
    `방문지 ${visitsBefore}→${visitsAfter}`,
  ];
  if (distanceDeltaM === null) return badges;

  if (Math.abs(distanceDeltaM) < 10) return [...badges, '이동 0m'];

  const sign = distanceDeltaM < 0 ? '−' : '+';
  return [...badges, `이동 ${sign}${formatDistance(Math.abs(distanceDeltaM))}`];
}
