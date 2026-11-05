/**
 * TRIP-1797 · 방문 하나에 붙일 수 있는 사진 수 규칙(클라 사본).
 *
 * 서버가 권위다 — 방문당 30장은 백엔드 `VisitRecordService.MAX_PHOTOS_PER_VISIT` 상수이고 openapi 에는 수치가 없다.
 * 서버가 바꾸면 여기가 조용히 어긋나지만, 상한을 넘기면 서버가 400 을 주므로 그 장은 일반 실패로 세어진다(최후 가드).
 */
export const MAX_PHOTOS_PER_VISIT = 30;
export const MAX_PICK_PER_BATCH = 10;

/** 이번에 고를 수 있는 장수 = min(10, 30 − 현재 장수). 현재 장수를 모르면(null) 10 으로 열고 서버 400 에 맡긴다. */
export function remainingPhotoSlots(count: number | null): number {
  if (count === null) return MAX_PICK_PER_BATCH;
  return Math.min(
    MAX_PICK_PER_BATCH,
    Math.max(0, MAX_PHOTOS_PER_VISIT - count)
  );
}
