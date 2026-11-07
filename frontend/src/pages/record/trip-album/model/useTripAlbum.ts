import { useQueries, useQuery } from '@tanstack/react-query';

import { useSpontaneousNames } from '@/features/check-visit';
import {
  getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions,
  useGetTripsTripId,
  useGetTripsTripIdRecords,
} from '@/shared/api/index.hooks';
import type { VisitPhoto } from '@/shared/api/index.schemas';
import { photoUriQueryOptions } from '@/shared/photo/index.view';
import { getInstallId } from '@/shared/storage';

import { failedUnlessNotFound } from './failedUnlessNotFound';
import { buildTripAlbumVM, type TripAlbumVM } from './tripAlbumVM';

/**
 * TRIP-1798 · 여행 앨범 조회 훅 — 기록(방문 목록) → 방문별 사진 메타 → 이 기기 앨범 주소를 모아 `buildTripAlbumVM` 에 넣는다.
 * 초심자용: 서버에는 사진 파일이 없고 메타뿐이라 주소는 이 기기 앨범에서 푼다(여행 전체 사진 GET 은 없어 방문마다 부른다).
 *
 * 판정은 전부 `useQueries`/`useQuery` 결과 값으로 한다(React Compiler 는 렌더 중 캐시 바깥 읽기를 굳힌다 — repo-traps).
 * 얼굴: 기록·기기 번호·여행이 도착하기 전 `loading`(빈 안내·사진 0장이 번쩍이지 않게) → 기록 실패 `error` → `ready`.
 * ready 안에서 방문 사진 목록 실패(404 제외)는 `photoError` 로 알리고(조용히 빼지 않는다) 빈 앨범 안내는 목록·주소가 다 정해진 뒤에만 낸다.
 */

export type TripAlbumState =
  | { kind: 'loading' }
  | { kind: 'error'; retrying: boolean; onRetry: () => void }
  | {
      kind: 'ready';
      tripTitle: string;
      vm: TripAlbumVM;
      /** 보일 사진이 0장이고 더 기다릴 것도 실패한 것도 없어 "이 기기에서 볼 사진 없음"이 확정. */
      empty: boolean;
      photoError: { retrying: boolean; onRetry: () => void } | null;
    };

// useTripCoverPhoto 의 RECORDS_PARAMS 와 같은 값 — 같아야 j04 가 받아 둔 기록 캐시를 같이 쓴다(형제 feature 라 복제).
const RECORDS_PARAMS = { changeLimit: 1 };
const FALLBACK_TITLE = '이번 여행';

export function useTripAlbum(tripId: string): TripAlbumState {
  const trip = useGetTripsTripId(tripId, { query: { retry: false } });
  const records = useGetTripsTripIdRecords(tripId, RECORDS_PARAMS);
  const installQuery = useQuery({
    queryKey: ['install-id'],
    queryFn: () => getInstallId().catch(() => null),
    staleTime: Infinity,
  });
  const spontaneousNames = useSpontaneousNames(tripId);

  const days = records.data?.days ?? [];
  const visits = days.flatMap((d) => d.actual).filter((v) => v.photoCount > 0);
  const lists = useQueries({
    queries: visits.map((v) =>
      getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions(
        tripId,
        v.visitCheckId
      )
    ),
  });

  const photosByVisit: Record<string, VisitPhoto[] | undefined> = {};
  visits.forEach((v, i) => {
    photosByVisit[v.visitCheckId] = lists[i]?.data?.items;
  });

  const installId = installQuery.data ?? null;
  // 이 기기 사진의 앨범 번호만(중복 제거) 주소를 묻는다 — 키·옵션은 표지·j03·j01 과 같다.
  const assetIds = [
    ...new Set(
      Object.values(photosByVisit)
        .flatMap((items) => items ?? [])
        .filter((p) => installId !== null && p.deviceId === installId)
        .map((p) => p.localAssetId)
    ),
  ];
  const uris = useQueries({
    queries: assetIds.map((id) => photoUriQueryOptions(id)),
  });
  const uriByAssetId: Record<string, string | null | undefined> = {};
  assetIds.forEach((id, i) => {
    uriByAssetId[id] = uris[i]?.data;
  });

  const recordsFailed =
    records.data === undefined &&
    (records.isError || records.errorUpdateCount > 0);
  if (recordsFailed) {
    return {
      kind: 'error',
      retrying: records.isFetching,
      onRetry: () => {
        void records.refetch();
      },
    };
  }
  if (records.data === undefined || installQuery.isPending || trip.isPending) {
    return { kind: 'loading' };
  }

  const vm = buildTripAlbumVM({
    days,
    photosByVisit,
    installId,
    uriByAssetId,
    startDate: trip.data?.startDate,
    spontaneousNames,
  });

  const failed = lists.filter(failedUnlessNotFound);
  const listsPending = lists.some(
    (q) => q.data === undefined && !q.isError && !failedUnlessNotFound(q)
  );
  const urisPending = assetIds.some((id) => uriByAssetId[id] === undefined);

  return {
    kind: 'ready',
    tripTitle: trip.data?.title || FALLBACK_TITLE,
    vm,
    empty:
      vm.visiblePhotoCount === 0 &&
      failed.length === 0 &&
      !listsPending &&
      !urisPending,
    photoError:
      failed.length > 0
        ? {
            retrying: failed.some((q) => q.isFetching),
            onRetry: () => {
              for (const q of failed) void q.refetch();
            },
          }
        : null,
  };
}
