import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { goBackOr } from '@/shared/lib/goBackOr';
import { shellTabHref } from '@/shared/ui/BottomTabBar';

import type { BaseAssignment, SavedStay } from '@/shared/api/index.schemas';
import { useGetSavedStays } from '@/shared/api/index.hooks';
import {
  getGetTripsTripIdBasesQueryKey,
  useGetTrips,
  useGetTripsTripIdBases,
} from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { buildStayTripLink, type StayTripLink } from '../model/stayTripLink';
import { MyStaysScreen, type MyStayRowVM } from './MyStaysScreen';
import { isOtaSource } from '@/entities/stay';

/**
 * TRIP-605 · l04 페이지 배선 — 조회(`useGetSavedStays`·`useGetTrips`·N+1 bases)·역참조 조립
 * (`buildStayTripLink`)·행 VM 조립·거점 화면 push·탐색 push 를 진다. 화면엔 완성 VM만 내린다.
 *
 * 연결 여행은 파생이다 — SavedStay 에 `tripId` 가 없어 여행마다 `GET /trips/{id}/bases` 를 한 번씩 더
 * 부른다(N+1: 목록 1회 + 여행 N회). 훅은 루프를 못 도니 여행 1건당 `TripBasesProbe` 를 렌더해 그 거점
 * 목록을 페이지 상태(`basesByTripId`)로 모은 뒤 `buildStayTripLink` 로 역참조 Map 을 만든다
 * (`TripCardContainer`(l03) N+1 골격 동형).
 *
 * 「거점 변경」(TRIP-1076 결정 2(A))은 그 여행의 거점 화면(`/trips/[tripId]/bases`)으로 push 만 한다 —
 * 이 페이지는 거점을 쓰지 않는다(옛 해제 DELETE 배선 제거). push 라서 거점 화면 CTA 의 `back()` 이 여기로
 * 돌아온다(`ItineraryMethodPage` onPressRebase 선례).
 *
 * TRIP-1637(INV-4): 조회 실패(saved-stays·trips 어느 쪽이든)는 빈 목록·"연결된 여행 없음"으로 접지 않고
 * 실패 얼굴로 올린다. 쿼리별 판정 `data === undefined && (isError || errorUpdateCount > 0)` — 재시도 중엔
 * status 가 pending 으로 돌아가 isError 가 꺼지므로 실패 이력 카운터를 같이 본다(알림함 TRIP-1501 선례).
 * 받은 목록이 있으면(`data` 있음) 재조회가 실패해도 목록을 유지한다. [다시 시도]는 실패한 쿼리만 refetch.
 *
 * TRIP-1754(INV-4): 여행별 거점 조회(N+1) 일부가 실패하면 그 여행의 숙소가 「연결된 여행 없음」으로 접혀 거짓이 된다 —
 * 프로브가 실패(404 아닌 것)를 페이지에 올려 목록 위 한 줄 + [다시 시도]로 밝힌다. 404 는 "연결 없음"이 진짜라 대상이 아니다.
 * [다시 시도]는 실패한 여행의 거점만 다시 받는다. 행 단위 표식은 안 한다(`buildStayTripLink` 가 실패 여행을 모른다).
 */

/** 여행 1건의 거점 목록을 조회해 페이지로 올린다(N+1 훅-per-여행 — 훅이 루프를 못 도는 우회). */
function TripBasesProbe({
  tripId,
  onResult,
  onFailure,
}: {
  tripId: string;
  onResult: (tripId: string, bases: BaseAssignment[]) => void;
  onFailure: (tripId: string, failed: boolean) => void;
}): null {
  const { data, error } = useGetTripsTripIdBases(tripId);
  useEffect(() => {
    if (data !== undefined) onResult(tripId, data);
  }, [tripId, data, onResult]);
  // 실패는 상태에서 매번 다시 도출하지 않고 **전이 순간에 기록**한다 — 재조회가 시작되면 `error` 가 null 로 지워져
  // (이 효과는 아무것도 안 해 기록이 유지된다) 그 뒤엔 404 와 5xx 를 가를 수 없다. 성공(data 도착)은 onResult 가 기록을 푼다.
  useEffect(() => {
    if (data === undefined && error != null) {
      onFailure(tripId, !isNotFound(error));
    }
  }, [tripId, data, error, onFailure]);
  // 여행이 지워져 프로브가 사라지면 그 여행의 실패 기록도 푼다(배너가 영영 안 남게).
  useEffect(() => () => onFailure(tripId, false), [tripId, onFailure]);
  return null;
}

/**
 * 등록 출처 라벨(BR-U6-20) — `externalSource` 는 예약처가 아니라 카탈로그 원천이다(LOCALDATA 등).
 * 사전에 있는 OTA 코드만 예약, 그 밖의 원천은 탐색에서 저장, 없으면(null·필드 없음) 직접 등록.
 */
function sourceLabel(stay: SavedStay): string {
  if (isOtaSource(stay.externalSource)) return '예약 사이트';
  return stay.externalSource ? '탐색에서 저장' : '직접 등록';
}

/** 메모(예약번호) 상태 칩 — OTA 예약인데 번호가 비어 있으면 안내, 그 외 없음. */
function memoLabel(stay: SavedStay): string | null {
  const missingBookingNo =
    isOtaSource(stay.externalSource) && (stay.memo == null || stay.memo === '');
  return missingBookingNo ? '예약번호 미입력' : null;
}

/** `6.10 ~ 6.13`(공백 有, Figma 칩 서식) — checkIn·checkOut 둘 다 있을 때만, 아니면 null. */
function dateRangeLabel(stay: SavedStay): string | null {
  if (!stay.checkIn || !stay.checkOut) return null;
  return `${monthDay(stay.checkIn)} ~ ${monthDay(stay.checkOut)}`;
}

function monthDay(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${month}.${day}`;
}

function toRowVM(stay: SavedStay, link: StayTripLink | undefined): MyStayRowVM {
  const assigned = link !== undefined;
  return {
    savedStayId: stay.savedStayId,
    name: stay.name,
    // SavedStay 스키마에 주소 필드가 없다(F-1) — 채울 계약이 없어 빈 값(화면이 빈 줄을 안 그린다).
    location: '',
    dateRangeLabel: dateRangeLabel(stay),
    sourceLabel: sourceLabel(stay),
    memoLabel: memoLabel(stay),
    linkedTripLabel: assigned
      ? `연결 여행 · ${link.tripName}`
      : '연결된 여행 없음',
    baseState: assigned ? 'assigned' : 'unassigned',
    canAssignBase: stay.coordConfirmed,
    tripId: assigned ? link.tripId : null,
    baseAssignmentId: assigned ? link.baseAssignmentId : null,
  };
}

export function MyStaysPage(): ReactElement {
  const router = useRouter();
  const savedQuery = useGetSavedStays();
  const tripsQuery = useGetTrips();

  const savedStays = savedQuery.data ?? [];
  const trips = tripsQuery.data ?? [];

  const [basesByTripId, setBasesByTripId] = useState<
    Record<string, BaseAssignment[]>
  >({});

  // react-query 의 `data` 는 값이 바뀔 때만 참조가 바뀐다 — 같은 참조면 상태를 안 건드려 무한 루프를 막는다.
  const [failedBaseTripIds, setFailedBaseTripIds] = useState<string[]>([]);
  const [retryingLinks, setRetryingLinks] = useState(false);
  const queryClient = useQueryClient();

  const handleBaseFailure = useCallback((tripId: string, failed: boolean) => {
    setFailedBaseTripIds((prev) => {
      if (prev.includes(tripId) === failed) return prev;
      return failed ? [...prev, tripId] : prev.filter((id) => id !== tripId);
    });
  }, []);

  const handleBasesResult = useCallback(
    (tripId: string, bases: BaseAssignment[]) => {
      setBasesByTripId((prev) =>
        prev[tripId] === bases ? prev : { ...prev, [tripId]: bases }
      );
      handleBaseFailure(tripId, false);
    },
    [handleBaseFailure]
  );

  const links = buildStayTripLink(savedStays, trips, basesByTripId);
  const rows = savedStays.map((stay) =>
    toRowVM(stay, links.get(stay.savedStayId))
  );

  const savedFailed =
    savedQuery.data === undefined &&
    (savedQuery.isError || savedQuery.errorUpdateCount > 0);
  const tripsFailed =
    tripsQuery.data === undefined &&
    (tripsQuery.isError || tripsQuery.errorUpdateCount > 0);
  const loadFailed = savedFailed || tripsFailed;
  const retrying =
    (savedFailed && savedQuery.isFetching) ||
    (tripsFailed && tripsQuery.isFetching);

  const handleRetry = (): void => {
    if (savedFailed) void savedQuery.refetch();
    if (tripsFailed) void tripsQuery.refetch();
  };

  // 전체 실패(loadFailed)면 화면이 큰 얼굴만 그려 이 한 줄은 보이지 않는다.
  const linksFailed = failedBaseTripIds.length > 0;

  const handleRetryLinks = (): void => {
    setRetryingLinks(true);
    // 실패한 여행의 거점만 다시 받는다(저장 숙소·여행 목록·성공한 여행은 다시 안 부른다).
    void Promise.all(
      failedBaseTripIds.map((tripId) =>
        queryClient.refetchQueries({
          queryKey: getGetTripsTripIdBasesQueryKey(tripId),
        })
      )
    ).finally(() => {
      setRetryingLinks(false);
    });
  };

  const isEmpty = !savedQuery.isPending && rows.length === 0;

  const handleChangeBase = (row: MyStayRowVM): void => {
    // 버튼은 등록 행에만 있고 등록 행은 tripId 가 있다 — null 은 방어만(갈 여행이 없으면 이동하지 않는다).
    if (row.tripId === null) return;
    router.push({
      pathname: '/trips/[tripId]/bases',
      // TRIP-1082 — 확정된 여행의 거점만 바꾸는 편집 얼굴로 연다(h04 입구는 mode 없이 위저드 얼굴).
      params: { tripId: row.tripId, mode: 'edit' },
    });
  };

  return (
    <>
      {trips.map((trip) => (
        <TripBasesProbe
          key={trip.tripId}
          tripId={trip.tripId}
          onResult={handleBasesResult}
          onFailure={handleBaseFailure}
        />
      ))}
      <MyStaysScreen
        rows={rows}
        isEmpty={isEmpty}
        onPressChangeBase={handleChangeBase}
        onPressExplore={() => router.push('/stays')}
        onPressBack={() => goBackOr(router, shellTabHref('my'))}
        loadFailed={loadFailed}
        retrying={retrying}
        onRetry={handleRetry}
        linksFailed={linksFailed}
        retryingLinks={retryingLinks}
        onRetryLinks={handleRetryLinks}
      />
    </>
  );
}
