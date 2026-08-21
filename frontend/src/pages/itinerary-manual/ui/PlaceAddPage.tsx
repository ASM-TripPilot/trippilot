import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { addSlot } from '@/features/itinerary/model/itineraryEditStore';
import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { visiblePlaces } from '@/features/explore/model/placeListView';
import { PlaceAddScreen } from '@/features/itinerary/ui/PlaceAddScreen';
import { SlotTimeSheet } from '@/features/itinerary/ui/SlotTimeSheet';
import { useGetPlaces } from '@/shared/api/generated/places/places';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import type { Place, PoiCategory } from '@/shared/api/generated/schemas';

/**
 * h20 배선(TRIP-338 · AC-5) — `GET /places` 로 후보를 받아 화면에 잇고, 추가를 저장으로 잇는다.
 *
 * 검색 규율(AC-5, `PlaceExplorePage`·U1 F-3 계승):
 *  - **카테고리만 서버 파라미터**(`GET /places?category=`). `region` 은 이 화면 라우트에 출처가 없어
 *    안 보낸다(YAGNI — 이름 필터가 클라라 굳이 지역을 안 좁혀도 된다, 03 §트레이드오프).
 *  - **검색어는 서버에 안 보낸다** — 계약에 검색어 키가 없어(`GetPlacesParams={region,category}`)
 *    받아온 목록을 `visiblePlaces(data, searchText)` 로 이름 부분일치 클라 필터한다(재요청 0).
 *
 * 추가 저장(01b Q1 — Figma 공백이라 이 사이클 심판 밖, 02a §7-2): "추가" → `SlotTimeSheet`(h24
 * 재사용)로 시각 자유입력 → `addSlot`(끝에 append)+`buildEditItineraryRequest`(5필드 픽) →
 * `PUT /trips/{tripId}/itinerary`(전체 교체) → 성공 시 일정 GET 캐시 무효화로 h19 가 갱신 재조회한다.
 * 서버 재검증 결과(`hasViolation`)는 그 재조회가 표시한다(INV-2 — 클라는 시각 타당성을 판정하지 않는다).
 * 일정 GET 미도착·실패(`notReady`)면 추가를 막고 안내를 노출한다(조용한 소실 차단). 여러 일자면 첫 날에
 * 담는다(h20 에 일자 선택 UI 가 Figma 공백 — 03 §미룬 것).
 */
export function PlaceAddPage({ tripId }: { tripId: string }): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [searchText, setSearchText] = useState('');
  const [pendingPlace, setPendingPlace] = useState<Place | null>(null);
  const [addedPoiIds, setAddedPoiIds] = useState<string[]>([]);

  const places = useGetPlaces(
    selectedCategory ? { category: selectedCategory } : {}
  );
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const save = usePutTripsTripIdItinerary();

  const visible = visiblePlaces(places.data?.items ?? [], searchText);

  // 담을 대상 일자 — 일정 GET 미도착·실패면 undefined(첫 날에 담는다, h20 일자 선택 UI Figma 공백).
  const days = itinerary.data?.days ?? [];
  const targetDate = days[0]?.date;
  const notReady = targetDate === undefined;

  function handleApplyTime(patch: {
    startAt: string;
    endAt: string;
    endsNextDay: boolean;
  }): void {
    const place = pendingPlace;
    setPendingPlace(null);
    if (!place) return;
    // 방어 — notReady 면 press 가 이미 막지만 빈-PUT 은 절대 안 내보낸다(데이터 손실 차단).
    if (targetDate === undefined) return;

    const newSlot = {
      poiId: place.poiId,
      startAt: patch.startAt,
      endAt: patch.endAt,
      isFixed: false,
      endsNextDay: patch.endsNextDay,
      hasViolation: false,
      tags: [],
    };
    const nextDays = days.map((day) =>
      day.date === targetDate
        ? { ...day, slots: addSlot(day.slots, newSlot) }
        : day
    );

    save.mutate(
      { tripId, data: buildEditItineraryRequest(nextDays) },
      {
        // 저장 성공 → 일정 GET 캐시 무효화. h19 가 갱신 재조회해 추가한 슬롯·서버 재검증
        // 결과(hasViolation)를 표시한다 — 없으면 추가가 화면에 영영 안 보인다(SlotCandidate 선례).
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getGetTripsTripIdItineraryQueryKey(tripId),
          });
        },
      }
    );
    setAddedPoiIds((ids) => [...ids, place.poiId]);
  }

  return (
    <>
      <PlaceAddScreen
        places={visible}
        searchText={searchText}
        selectedCategory={selectedCategory}
        addedPoiIds={addedPoiIds}
        notReady={notReady}
        onChangeSearchText={setSearchText}
        onSelectCategory={setSelectedCategory}
        onPressAdd={(place) => {
          // 담을 일자가 없으면 시트를 열지 않는다 — 안내 배너가 이유를 보여준다(조용한 소실 차단).
          if (notReady) return;
          setPendingPlace(place);
        }}
        onPressDone={() => router.back()}
        onBack={() => router.back()}
        onPressViewPlan={() => router.back()}
      />
      {pendingPlace ? (
        <SlotTimeSheet
          startAt="10:00:00"
          endAt="11:00:00"
          onApply={handleApplyTime}
          onCancel={() => setPendingPlace(null)}
        />
      ) : null}
    </>
  );
}
