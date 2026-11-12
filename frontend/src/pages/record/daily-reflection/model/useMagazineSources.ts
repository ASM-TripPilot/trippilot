import { useSpontaneousNames } from '@/features/check-visit';
import type { MagazineSlot } from '@/features/reflection/index.view';
import {
  useGetTripsTripIdItinerary,
  useGetTripsTripIdVisitsDaysDay,
} from '@/shared/api/index.hooks';
import type { VisitCheck } from '@/shared/api/index.schemas';

import { failedUnlessNotFound } from './failedUnlessNotFound';

/**
 * TRIP-1665 · j03 매거진의 재료 조회 — 그날 방문 + (방문이 있을 때만) 일정 슬롯 + 즉석 방문 이름.
 * 방문 조회는 `useReflectionPhotos` 와 같은 쿼리 키라 요청이 한 번만 나간다. 일정은 장소 이름·카테고리를 얻는 용도라
 * 방문이 없는 날은 부르지 않는다. 일정 조회가 실패(404 포함)해도 화면은 오류 얼굴로 떨어지지 않고 이름만 "N번째 장소"로
 * 접힌다(지어내지 않는다, BR-U5-31). `slots` 가 undefined 면 "아직 모름" — **동선 박스만** 그리지 않아 이름이 늦게 붙는 깜빡임이 없다.
 * 표지·장면 카드는 일정 도착 전에 중립색(`STATS`)·이름 칩 없음으로 먼저 그려졌다가, 도착 후 카테고리 색·이름으로 바뀐다 —
 * VM 테스트가 "일정을 모르면 중립"으로 굳힌 의도된 동작이다(6-b 에서 느린 일정 응답으로 육안 확인).
 * TRIP-1757 — 단 **방문 조회**가 404 아닌 이유로 실패한 것은 "방문 없음"과 구별되지 않아 `visitsLoadFailed` 로 내려준다(페이지가 한 줄로 말한다).
 * 일정 조회 실패는 위 폴백 그대로 줄을 만들지 않는다. `retryVisits` 는 방문 GET 하나만 다시 부른다(사진 훅과 같은 키라 요청도 하나).
 */
export function useMagazineSources(
  tripId: string,
  date: string
): {
  visits: readonly VisitCheck[];
  slots: readonly MagazineSlot[] | undefined;
  spontaneousNames: Readonly<Record<string, string>>;
  visitsLoadFailed: boolean;
  visitsRetrying: boolean;
  retryVisits: () => void;
} {
  const visitsQuery = useGetTripsTripIdVisitsDaysDay(tripId, date, {
    query: { enabled: tripId !== '' && date !== '' },
  });
  const visits = visitsQuery.data?.visits ?? [];
  const itinerary = useGetTripsTripIdItinerary(tripId, {
    query: { enabled: tripId !== '' && visits.length > 0 },
  });
  const spontaneousNames = useSpontaneousNames(tripId);

  const slots: readonly MagazineSlot[] | undefined = itinerary.data
    ? itinerary.data.days.flatMap((d) => d.slots) // 전 일차 — 다른 날 슬롯과도 poiId 로 이어진다
    : itinerary.isError || visits.length === 0
      ? []
      : undefined;
  const visitsLoadFailed = failedUnlessNotFound(visitsQuery);
  return {
    visits,
    slots,
    spontaneousNames,
    visitsLoadFailed,
    visitsRetrying: visitsLoadFailed && visitsQuery.isFetching,
    retryVisits: () => {
      void visitsQuery.refetch();
    },
  };
}
