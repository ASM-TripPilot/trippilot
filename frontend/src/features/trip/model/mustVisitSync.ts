import type { MustVisit } from '@/shared/api/generated/schemas';

export interface MustVisitSyncPlan {
  /** 새로 등록할 poiId — 시드 순서, 중복 없음. */
  toAdd: string[];
  /** 지울 mustVisitId — 서버 목록 순서, 중복 없음. */
  toDelete: string[];
}

/**
 * 이미 만든 여행의 꼭 갈 곳(서버)을 위저드 시드(화면)에 맞추는 계획(TRIP-1113). 서버에 수정 경로가
 * 없어 추가·삭제 두 가지뿐이고, 삭제는 `sourcePoiId`가 아니라 `mustVisitId`로 짚어야 한다.
 * 양쪽에 다 있는 곳은 어느 쪽에도 넣지 않는다 — 적용한 결과로 다시 계획하면 빈 계획이라 재시도는
 * 남은 차이만 보낸다.
 */
export function planMustVisitSync(input: {
  registered: readonly Pick<MustVisit, 'mustVisitId' | 'sourcePoiId'>[];
  seedPoiIds: readonly string[];
}): MustVisitSyncPlan {
  const serverPoiIds = new Set(input.registered.map((row) => row.sourcePoiId));
  const seed = new Set(input.seedPoiIds);
  return {
    toAdd: [...seed].filter((poiId) => !serverPoiIds.has(poiId)),
    toDelete: input.registered
      .filter((row) => !seed.has(row.sourcePoiId))
      .map((row) => row.mustVisitId),
  };
}
