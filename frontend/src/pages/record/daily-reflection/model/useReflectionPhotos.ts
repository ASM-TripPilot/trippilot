import { useEffect, useState } from 'react';
import { useQueries } from '@tanstack/react-query';

import {
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions,
  useGetTripsTripIdVisitsDaysDay,
} from '@/shared/api/index.hooks';
import { resolvePhotoUri } from '@/shared/photo';
import { getInstallId } from '@/shared/storage';

/**
 * TRIP-1444 · j03 회고 사진 칸 — 그 날 방문들의 사진 메타를 모아 **이 기기 앨범**에서 주소를 꺼낸다.
 * 서버엔 사진 파일이 없고 메타(localAssetId·deviceId)뿐이라 URL 은 앞으로도 안 온다. j01
 * `VisitRecordCardContainer` 와 같은 쿼리 키(photos · photo-uri)를 써서 캐시를 공유한다.
 * 다른 기기 사진·앨범에서 못 찾은 사진은 조용히 뺀다(회고 격자는 빈 칸을 그리지 않는다).
 */
export function useReflectionPhotos(
  tripId: string,
  date: string
): { uri: string; poiId: string }[] {
  const visits = useGetTripsTripIdVisitsDaysDay(tripId, date, {
    query: { enabled: tripId !== '' && date !== '' },
  });
  const [installId, setInstallId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getInstallId().then(
      (id) => {
        if (alive) setInstallId(id);
      },
      () => {} // 모르면 사진을 그리지 않는다(다른 기기 사진을 내 것으로 그리는 것보다 낫다).
    );
    return () => {
      alive = false;
    };
  }, []);

  const lists = useQueries({
    queries: (visits.data?.visits ?? []).map((v) =>
      getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions(
        tripId,
        v.visitCheckId
      )
    ),
  });
  // 방문 순서 → 방문 안에서는 sortOrder 순. 같은 장소를 두 번 가면 먼저 간 방문의 사진이 앞선다(TRIP-1445).
  const visitList = visits.data?.visits ?? [];
  const mine = lists.flatMap((q, i) =>
    [...(q.data?.items ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((p) => installId !== null && p.deviceId === installId)
      .map((p) => ({ ...p, poiId: visitList[i].poiId }))
  );
  const uris = useQueries({
    queries: mine.map((p) => ({
      queryKey: ['photo-uri', p.localAssetId],
      queryFn: () => resolvePhotoUri(p.localAssetId),
      staleTime: Infinity,
    })),
  });
  return uris.flatMap((q, i) =>
    q.data ? [{ uri: q.data, poiId: mine[i].poiId }] : []
  );
}
