import type { ActualVisit, VisitPhoto } from '@/shared/api/index.schemas';

/**
 * TRIP-1781 · 여행 표지 사진을 고르는 순수 규칙 — j04 요약과 j06 공유 카드가 같은 사진을 쓰게 하는 한 곳.
 * 초심자용: `photoCount` 는 서버가 방문마다 주는 사진 **개수**다(주소가 아님). 주소는 이 기기 앨범에서 따로 풀어야 한다.
 *
 * 규칙(테스트가 곧 명세 — `coverPhoto.test.ts`): 건너뛴 방문·사진 0장 방문은 후보가 아니고, 사진이 많은 방문이 먼저,
 * 같으면 입력(= 도착) 순서가 앞선 방문. 최대 3곳 — 앨범 해석(iCloud 원본 다운로드가 일어날 수 있음)의 상한이기도 하다.
 */
export const COVER_CANDIDATE_LIMIT = 3;

export interface CoverPhoto {
  uri: string;
  poiId: string;
}

export function coverCandidates<
  T extends Pick<ActualVisit, 'photoCount' | 'skippedAt'>,
>(visits: readonly T[]): T[] {
  return visits
    .filter((v) => v.photoCount > 0 && v.skippedAt == null)
    .map((v, order) => ({ v, order }))
    .sort((a, b) => b.v.photoCount - a.v.photoCount || a.order - b.order)
    .slice(0, COVER_CANDIDATE_LIMIT)
    .map(({ v }) => v);
}

/** 방문 하나의 사진 메타 중 `sortOrder` 가 가장 앞선 **이 기기** 사진의 앨범 id. 없으면 null. */
export function firstDevicePhotoId(
  items: readonly VisitPhoto[],
  installId: string
): string | null {
  let best: VisitPhoto | null = null;
  for (const p of items) {
    if (
      p.deviceId === installId &&
      (best === null || p.sortOrder < best.sortOrder)
    )
      best = p;
  }
  return best?.localAssetId ?? null;
}
