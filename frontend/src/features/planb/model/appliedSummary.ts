import { formatDistance } from '@/entities/place';
import type { ReplanDiff } from '@/shared/api/index.schemas';

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

/**
 * TRIP-1188 · 재계획 비교(diff) 응답 → 배지 입력. 허브가 확정 직후 초안 화면이 남긴 쿼리 캐시의 diff 를
 * 읽을 때 쓴다(서버는 확정 뒤 diff 를 비운다 — `ready=false`).
 *
 *  - 바뀐 곳 = 추가·빠짐·이동. `FIXED`(잠긴 칸)·`UNCHANGED` 는 바뀐 곳이 아니다.
 *  - 방문지 A→B = 그날 확정 전(`before`)·후(`after`) 곳 수. 거리는 서버가 낸 총거리 차이 그대로(모르면 null).
 */
export function appliedSummaryInputFromDiff(
  diff: ReplanDiff
): AppliedSummaryInput {
  return {
    changedCount: diff.entries.filter(
      (entry) =>
        entry.change === 'ADDED' ||
        entry.change === 'REMOVED' ||
        entry.change === 'MOVED'
    ).length,
    visitsBefore: diff.before.length,
    visitsAfter: diff.after.length,
    distanceDeltaM: diff.impact?.totalDistanceDeltaM ?? null,
  };
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
