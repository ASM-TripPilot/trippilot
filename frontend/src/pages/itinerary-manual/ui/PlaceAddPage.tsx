import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import {
  addSlot,
  insertSlotAt,
} from '@/features/itinerary/model/itineraryEditStore';
import { buildEditItineraryRequest } from '@/features/itinerary/model/buildEditItineraryRequest';
import { buildDraftPins } from '@/features/itinerary/model/draftView';
import { usePlacesInfinite } from '@/features/explore/model/usePlacesInfinite';
import {
  PlaceAddHeader,
  PlaceAddRow,
} from '@/features/itinerary/ui/PlaceAddScreen';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { TimeSheet } from '@/widgets/time-sheet/ui/TimeSheet';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripIdItinerary,
  usePutTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import type { Place, PoiCategory } from '@/shared/api/generated/schemas';

// 핀이 없을 때 지도 중심 — 서울 시청(LiveHubView 선례). {0,0} 은 기니만 바다(null-island)라 무의미하다.
const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };

/**
 * h13 장소 추가 배선(TRIP-798, 구 h20 TRIP-338·TRIP-502 계승) — `usePlacesInfinite` 로 후보를 받아
 * 전면 지도 위 peek 시트로 조립한다(묶음 C 시트화). 공용 `MapSheetShell`(widgets)의 `list` 슬롯에
 * 후보를 `BottomSheetFlatList` 로 얹고(무한 스크롤 `onEndReached` 유지), 검색바+칩(`PlaceAddHeader`)은
 * 리스트 헤더(`children`)로, "장소 추가 · N일차" 헤더 텍스트는 `header` 로, 후보 카드(`PlaceAddRow`)는
 * `list.renderItem` 으로 조립한다 — features→widgets 상향 참조 금지라 셸 조립은 이 페이지가 진다.
 * 앱바·완료·하단 CTA·안내/notReady 배너는 h13 재편으로 걷었다.
 *
 * 검색 규율(AC-5 · TRIP-502): 카테고리·검색어를 서버 파라미터로(`GET /places?category=&q=`) — 검색은
 * 서버가 하고 커서 무한 스크롤로 전량 수신을 없앤다(`region` 은 이 화면 라우트에 출처가 없어 안 보냄).
 *
 * 추가 저장(TRIP-338 무심판 해소 — AC-6 통합 심판이 이 플로우를 잠근다): "추가" → `TimeSheet` 로 시각
 * 자유입력 → **삽입 index 분기**(AC-7): 라우트 `insertAfter`(선행 슬롯 index)가 있으면
 * `insertSlotAt(slots, slot, Number(insertAfter) + 1)`(797 "카드 사이 +" 가 넘긴 선행 index 의 다음
 * 자리), 없으면 `addSlot`(말미 append, 후방호환) → `buildEditItineraryRequest`(5필드 픽) →
 * `PUT /trips/{tripId}/itinerary`(전체 교체) → 성공 시 일정 GET 캐시 무효화로 h19 가 갱신 재조회한다
 * (없으면 추가가 화면에 영영 안 보인다, W-1). 서버 재검증 결과(`hasViolation`)는 그 재조회가 표시한다
 * (INV-2 — 클라는 시각 타당성을 판정하지 않는다). 일정 GET 미도착·실패(`notReady`)면 추가를 조용히
 * 막는다(빈-PUT 미발사, W-2). 여러 일자면 첫 날에 담는다(일자 선택 UI 는 Figma 공백).
 *
 * insertAfter 는 **prop 이 아니라 `useLocalSearchParams`** 로 받는다 — tripId(prop, P1~P4 무회귀)와
 * 라우트 계약(useLocalSearchParams, 797 호출부)을 동시에 만족시키는 조합이다.
 */
export function PlaceAddPage({ tripId }: { tripId: string }): ReactElement {
  const { insertAfter } = useLocalSearchParams<{ insertAfter?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [searchText, setSearchText] = useState('');
  const [pendingPlace, setPendingPlace] = useState<Place | null>(null);
  const [addedPoiIds, setAddedPoiIds] = useState<string[]>([]);

  // 검색은 서버가 한다(q) + 커서 무한 스크롤(TRIP-502) — 클라 이름 필터·전량 수신을 없앤다.
  const trimmedQuery = searchText.trim();
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage, isSuccess } =
    usePlacesInfinite({
      ...(selectedCategory ? { category: selectedCategory } : {}),
      ...(trimmedQuery ? { q: trimmedQuery } : {}),
    });
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const save = usePutTripsTripIdItinerary();

  function handleEndReached(): void {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }

  // 담을 대상 일자 — 일정 GET 미도착·실패면 undefined(첫 날에 담는다, 일자 선택 UI Figma 공백).
  const days = itinerary.data?.days ?? [];
  const targetDate = days[0]?.date;
  const notReady = targetDate === undefined;
  // 시트 헤더 "장소 추가 · N일차" — N = 담을 일자 index+1(현행 day[0]=1일차).
  const targetDayIndex = days.findIndex((day) => day.date === targetDate);
  const dayNumber = (targetDayIndex >= 0 ? targetDayIndex : 0) + 1;

  // 전면 지도 — 담을 일자(days[0]) 슬롯 좌표로 핀을 세운다(MapSheetShell 이 MapView 를 소유하므로
  // 지도 census 신규 등재 불필요). 좌표 없으면 서울 기본 중심(FALLBACK_CENTER).
  const targetSlots = days[0]?.slots ?? [];
  const pins = buildDraftPins(targetSlots);
  const center =
    pins.length > 0 ? { lat: pins[0].lat, lng: pins[0].lng } : FALLBACK_CENTER;

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
        ? {
            ...day,
            // insertAfter(선행 index)가 있으면 그 다음 자리에 splice, 없으면 말미 append(후방호환).
            slots:
              insertAfter !== undefined
                ? insertSlotAt(day.slots, newSlot, Number(insertAfter) + 1)
                : addSlot(day.slots, newSlot),
          }
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
    <View className="flex-1">
      <MapSheetShell
        center={center}
        pins={pins}
        onBack={() => router.back()}
        header={
          <Text className="px-lg pb-xs pt-sm font-noto-bold text-[18px] font-bold text-ink">
            {`장소 추가 · ${dayNumber}일차`}
          </Text>
        }
        list={{
          data: items,
          renderItem: ({ item }) => (
            <PlaceAddRow
              place={item}
              added={addedPoiIds.includes(item.poiId)}
              onPressAdd={() => {
                // 담을 일자가 없으면 시트를 안 연다(조용한 소실 차단, W-2 — 배너는 제거됐다).
                if (notReady) return;
                setPendingPlace(item);
              }}
            />
          ),
          keyExtractor: (place) => place.poiId,
          onEndReached: handleEndReached,
          onEndReachedThreshold: 0.5,
          ListFooterComponent: isFetchingNextPage ? (
            <View
              testID="itinerary-place-loading-more"
              className="w-full items-center py-lg"
            >
              <ActivityIndicator />
            </View>
          ) : null,
          // 조회 성공 + 0건일 때만 안내(INV-4 — 검색 0건 침묵 금지). 로딩 중엔 안 띄운다(깜빡임), 실패는 범위 밖.
          ListEmptyComponent: isSuccess ? (
            <View
              testID="itinerary-place-empty"
              className="w-full items-center py-lg"
            >
              <Text className="font-noto text-caption text-muted">
                검색 결과가 없어요
              </Text>
            </View>
          ) : null,
          testID: 'itinerary-place-list',
        }}
      >
        <PlaceAddHeader
          searchText={searchText}
          selectedCategory={selectedCategory}
          onChangeSearchText={setSearchText}
          onSelectCategory={setSelectedCategory}
        />
      </MapSheetShell>

      {pendingPlace ? (
        <TimeSheet
          startAt="10:00:00"
          endAt="11:00:00"
          onApply={handleApplyTime}
          onCancel={() => setPendingPlace(null)}
          testIDPrefix="itinerary-edit-time"
          labels={{ start: '시작', end: '종료' }}
        />
      ) : null}
    </View>
  );
}
