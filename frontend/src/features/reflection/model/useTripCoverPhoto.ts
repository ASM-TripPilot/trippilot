import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions,
  useGetTripsTripIdRecords,
} from '@/shared/api/index.hooks';
import { photoUriQueryOptions } from '@/shared/photo/index.view';
import { getInstallId } from '@/shared/storage';

import {
  coverCandidates,
  firstDevicePhotoId,
  type CoverPhoto,
} from './coverPhoto';

/**
 * TRIP-1781 · 여행 표지에 쓸 "이 기기에서 찍은 대표 사진 한 장" — j04 요약·j06 공유 카드가 같이 쓴다.
 * 초심자용: 서버에는 사진 파일이 없고 메타(앨범 id·찍은 기기)뿐이라, 주소는 이 기기 앨범에서 풀어야 한다.
 *
 * 흐름: 사진이 0장·모르면 아무것도 안 부른다 → `records`(방문별 사진 개수, 1건) → 후보 방문이 0곳이면 기기 id 도 안 묻고 끝
 * (사진 개수가 있어도 기록이 비면 후보가 없다) → 후보 방문(최대 3곳)을 **차례로** 보며
 * 방문마다 이 기기 사진 첫 장 하나만 앨범에 푼다, 찾으면 멈춘다(병렬이면 첫 후보가 풀려도 해석이 3번 나간다).
 * 실패는 던지지 않고 다음 후보 → 끝내 없으면 null(색 표지, INV-4). 사진 파일·주소는 서버로 보내지 않는다(BR-U5-46).
 *
 * `picking` = 요청이 실제로 날아가 있는 동안만 참(`isLoading`). `isPending` 을 쓰면 오프라인 보류·꺼진 쿼리에서도 참이라
 * 저장·공유 잠금이 영영 안 풀린다.
 */

// useVisitMemo(features/attach-visit-media)의 RECORDS_PARAMS 와 같은 값 — 같아야 j01 이 받아 둔 기록 캐시를 같이 쓴다.
// 형제 feature 라 import 하지 못해 복제한다.
const RECORDS_PARAMS = { changeLimit: 1 };

export function useTripCoverPhoto({
  tripId,
  totalPhotos,
}: {
  tripId: string;
  totalPhotos: number | undefined;
}): { photo: CoverPhoto | null; picking: boolean } {
  const queryClient = useQueryClient();
  const on = tripId !== '' && (totalPhotos ?? 0) > 0;

  // 장식이라 실패는 빨리 색 표지로 — 재시도로 저장·공유 잠금을 길게 끌지 않는다.
  const records = useGetTripsTripIdRecords(tripId, RECORDS_PARAMS, {
    query: { enabled: on, retry: false },
  });
  const visits = records.data?.days.flatMap((d) => d.actual);
  const candidates = visits ? coverCandidates(visits) : [];

  const pick = useQuery({
    queryKey: [
      'trip-cover-photo',
      tripId,
      candidates.map((v) => v.visitCheckId),
    ],
    enabled: on && candidates.length > 0,
    // TRIP-1803 — 못 고른 표지(null)는 바로 낡은 값이라 앱 복귀 때 다시 고른다. 고른 표지는 앱 기본값 30초 그대로
    // (함수가 undefined 를 돌려주면 react-query 는 "늘 낡음"으로 읽어 복귀마다 다시 고른다).
    staleTime: (query) => (query.state.data === null ? 0 : 30_000),
    queryFn: async (): Promise<CoverPhoto | null> => {
      const installId = await getInstallId().catch(() => null);
      if (installId === null) return null; // 모르면 그리지 않는다(남의 기기 사진을 내 것으로 그리는 것보다 낫다).
      for (const v of candidates) {
        try {
          const list = await queryClient.fetchQuery(
            getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions(
              tripId,
              v.visitCheckId
            )
          );
          const assetId = firstDevicePhotoId(list.items, installId);
          if (assetId === null) continue;
          const uri = await queryClient.fetchQuery(
            photoUriQueryOptions(assetId)
          );
          if (uri) return { uri, poiId: v.poiId };
        } catch {
          // 이 후보는 포기하고 다음 후보로.
        }
      }
      return null;
    },
  });

  return {
    photo: on ? (pick.data ?? null) : null,
    picking: records.isLoading || pick.isLoading,
  };
}
