import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';

import type { BaseAssignment, SavedStay } from '@/shared/api/index.schemas';
import { useGetSavedStays } from '@/shared/api/index.hooks';
import { useGetTrips, useGetTripsTripIdBases } from '@/shared/api/index.hooks';
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
 * 「출발점 변경」(TRIP-1076 결정 2(A))은 그 여행의 거점 화면(`/trips/[tripId]/bases`)으로 push 만 한다 —
 * 이 페이지는 거점을 쓰지 않는다(옛 해제 DELETE 배선 제거). push 라서 거점 화면 CTA 의 `back()` 이 여기로
 * 돌아온다(`ItineraryMethodPage` onPressRebase 선례).
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

/**
 * 등록 출처 라벨(BR-U6-20) — `externalSource` 는 예약처가 아니라 카탈로그 원천이다(LOCALDATA 등).
 * 사전에 있는 OTA 코드만 예약, 그 밖의 원천은 탐색에서 저장, 없으면(null·필드 없음) 직접 등록.
 */
function sourceLabel(stay: SavedStay): string {
  if (isOtaSource(stay.externalSource)) return 'OTA 예약';
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
        />
      ))}
      <MyStaysScreen
        rows={rows}
        isEmpty={isEmpty}
        onPressChangeBase={handleChangeBase}
        onPressExplore={() => router.push('/stays')}
        onPressBack={() => router.back()}
      />
    </>
  );
}
