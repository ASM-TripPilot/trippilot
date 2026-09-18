import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import type { BaseAssignment, SavedStay } from '@/shared/api/generated/schemas';
import { useGetSavedStays } from '@/shared/api/generated/saved-stays/saved-stays';
import {
  getGetTripsTripIdBasesQueryKey,
  useDeleteTripsTripIdBasesBaseAssignmentId,
  useGetTrips,
  useGetTripsTripIdBases,
} from '@/shared/api/generated/trips/trips';
import {
  buildStayTripLink,
  type StayTripLink,
} from '@/features/settings/model/stayTripLink';
import {
  MyStaysScreen,
  type MyStayRowVM,
} from '@/features/settings/ui/MyStaysScreen';

/**
 * TRIP-605 · l04 페이지 배선 — 조회(`useGetSavedStays`·`useGetTrips`·N+1 bases)·역참조 조립
 * (`buildStayTripLink`)·행 VM 조립·해제 DELETE·탐색 push 를 진다. 화면엔 완성 VM만 내린다.
 *
 * 연결 여행은 파생이다 — SavedStay 에 `tripId` 가 없어 여행마다 `GET /trips/{id}/bases` 를 한 번씩 더
 * 부른다(N+1: 목록 1회 + 여행 N회). 훅은 루프를 못 도니 여행 1건당 `TripBasesProbe` 를 렌더해 그 거점
 * 목록을 페이지 상태(`basesByTripId`)로 모은 뒤 `buildStayTripLink` 로 역참조 Map 을 만든다
 * (`TripCardContainer`(l03) N+1 골격 동형).
 *
 * 출발점 확정 콜백은 **연결된 숙소 해제(DELETE)** 만 배선한다 — 미등록 숙소의 지정(POST)은
 * `AssignBaseRequest{savedStayId,dateFrom,dateTo}` 가 여행·기간 컨텍스트를 요구하는데 이 화면에 그 정보가
 * 없어 이 티켓 범위 밖(F-2, 후속 티켓). 그래서 화면은 다이얼로그까지만 띄우고 확정은 no-op 로 둔다.
 */

/** 여행 1건의 거점 목록을 조회해 페이지로 올린다(N+1 훅-per-여행 — 훅이 루프를 못 도는 우회). */
function TripBasesProbe({
  tripId,
  onResult,
}: {
  tripId: string;
  onResult: (tripId: string, bases: BaseAssignment[]) => void;
}): null {
  const { data } = useGetTripsTripIdBases(tripId);
  useEffect(() => {
    if (data !== undefined) onResult(tripId, data);
  }, [tripId, data, onResult]);
  return null;
}

/** 등록 출처 라벨 — 외부 OTA 출처가 있으면 예약, 없으면 앱 저장(BR-U6-20 등록 출처). */
function sourceLabel(stay: SavedStay): string {
  return stay.externalSource ? 'OTA 예약' : '앱 저장';
}

/** 메모(예약번호) 상태 칩 — OTA 예약인데 번호가 비어 있으면 안내, 그 외 없음. */
function memoLabel(stay: SavedStay): string | null {
  const missingBookingNo =
    stay.externalSource != null && (stay.memo == null || stay.memo === '');
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
  const queryClient = useQueryClient();
  const savedQuery = useGetSavedStays();
  const tripsQuery = useGetTrips();
  const deleteBase = useDeleteTripsTripIdBasesBaseAssignmentId();

  const savedStays = savedQuery.data ?? [];
  const trips = tripsQuery.data ?? [];

  const [basesByTripId, setBasesByTripId] = useState<
    Record<string, BaseAssignment[]>
  >({});

  // react-query 의 `data` 는 값이 바뀔 때만 참조가 바뀐다 — 같은 참조면 상태를 안 건드려 무한 루프를 막는다.
  const handleBasesResult = useCallback(
    (tripId: string, bases: BaseAssignment[]) => {
      setBasesByTripId((prev) =>
        prev[tripId] === bases ? prev : { ...prev, [tripId]: bases }
      );
    },
    []
  );

  const links = buildStayTripLink(savedStays, trips, basesByTripId);
  const rows = savedStays.map((stay) =>
    toRowVM(stay, links.get(stay.savedStayId))
  );

  const isEmpty = !savedQuery.isPending && rows.length === 0;

  const handleConfirmBaseToggle = (row: MyStayRowVM): void => {
    // 연결된 숙소 해제만 배선 — 미등록 지정(POST)은 여행·기간 컨텍스트 부재로 이 티켓 밖(F-2).
    if (
      row.baseState === 'assigned' &&
      row.tripId !== null &&
      row.baseAssignmentId !== null
    ) {
      const tripId = row.tripId;
      deleteBase.mutate(
        { tripId, baseAssignmentId: row.baseAssignmentId },
        {
          // 성공 시 bases 조회 캐시를 낡음으로 표시 → 재조회로 행이 '연결된 여행 없음'으로 갱신된다.
          onSuccess: () => {
            void queryClient.invalidateQueries({
              queryKey: getGetTripsTripIdBasesQueryKey(tripId),
            });
          },
        }
      );
    }
  };

  return (
    <>
      {trips.map((trip) => (
        <TripBasesProbe
          key={trip.tripId}
          tripId={trip.tripId}
          onResult={handleBasesResult}
        />
      ))}
      <MyStaysScreen
        rows={rows}
        isEmpty={isEmpty}
        onConfirmBaseToggle={handleConfirmBaseToggle}
        onPressExplore={() => router.push('/stays')}
        onPressBack={() => router.back()}
      />
    </>
  );
}
