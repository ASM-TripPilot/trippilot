import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Text, View } from 'react-native';

import {
  addSlot,
  buildEditItineraryRequest,
  insertSlotAt,
  useItineraryEditStore,
} from '@/features/edit-itinerary';
import { buildDraftPins } from '@/features/itinerary';
import { usePlacesInfinite } from '@/features/explore';
import { PlaceAddHeader, PlaceAddRow } from '@/features/itinerary';
import { MapSheetShell } from '@/widgets/map-sheet-shell';
import { TimeSheet } from '@/widgets/time-sheet';
import { suggestNextSlotTime } from '@/entities/itinerary-slot';
import { regionForDay } from '@/entities/trip';
import {
  getGetTripsTripIdItineraryQueryKey,
  getPutTripsTripIdItineraryMutationOptions,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
  usePutTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import type {
  ItineraryDaysItemSlotsItem,
  Place,
  PoiCategory,
} from '@/shared/api/index.schemas';
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedValue,
} from '@/shared/lib/useDebouncedValue';
import { showToast } from '@/shared/ui/Toast';

import { comparePlaceAdd, placeAddToastMessage } from '../model/placeAddNotice';
import type { PlaceAddSlotLike } from '../model/placeAddNotice';

// 핀이 없을 때 지도 중심 — 서울 시청(LiveHubView 선례). {0,0} 은 기니만 바다(null-island)라 무의미하다.
const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };
const PUT_MUTATION_KEY =
  getPutTripsTripIdItineraryMutationOptions().mutationKey;
/** 편집기에 저장 안 한 변경이 있을 때 추가 토스트 뒤에 붙는 꼬리(TRIP-1498) — 추가는 바로 저장됐지만 나머지는 아니다. */
const UNSAVED_EDITS_TAIL = ' · 다른 수정은 저장해야 남아요';

/**
 * h13 장소 추가 배선(TRIP-798, 구 h20 TRIP-338·TRIP-502 계승) — `usePlacesInfinite` 로 후보를 받아
 * 전면 지도 위 peek 시트로 조립한다(묶음 C 시트화). 공용 `MapSheetShell`(widgets)의 `list` 슬롯에
 * 후보를 `BottomSheetFlatList` 로 얹고(무한 스크롤 `onEndReached` 유지), 검색바+칩(`PlaceAddHeader`)은
 * 리스트 헤더(`children`)로, "장소 추가 · N일차" 헤더 텍스트는 `header` 로, 후보 카드(`PlaceAddRow`)는
 * `list.renderItem` 으로 조립한다 — features→widgets 상향 참조 금지라 셸 조립은 이 페이지가 진다.
 * 앱바·완료·하단 CTA·안내/notReady 배너는 h13 재편으로 걷었다.
 *
 * 검색 규율(AC-5 · TRIP-502): 카테고리·검색어를 서버 파라미터로(`GET /places?category=&q=`) — 검색은
 * 서버가 하고 커서 무한 스크롤로 전량 수신을 없앤다. 후보는 여행 목적지(`GET /trips/{tripId}` 의
 * `destinations[].region`)로 좁힌다(TRIP-981 #041) — 여행 조회가 끝날 때까지 장소 조회를 미루고(전국
 * 목록 깜빡임 방지), 2곳 이상이면 담을 날의 지역 하나(`regionForDay`, TRIP-1233), 실패·0곳이면 `region` 없이 연다.
 *
 * 추가 저장(TRIP-338 무심판 해소 — AC-6 통합 심판이 이 플로우를 잠근다): "추가" → `TimeSheet` 로 시각
 * 자유입력 → **삽입 index 분기**(AC-7): 라우트 `insertAfter`(선행 슬롯 index)가 있으면
 * `insertSlotAt(slots, slot, Number(insertAfter) + 1)`(797 "카드 사이 +" 가 넘긴 선행 index 의 다음
 * 자리 — 같은 화면에서 연달아 담으면 성공한 추가 수만큼 뒤로 민다, TRIP-1640), 없으면 `addSlot`(말미 append, 후방호환) → `buildEditItineraryRequest`(5필드 픽) →
 * `PUT /trips/{tripId}/itinerary`(전체 교체) → 성공 시 일정 GET 캐시 무효화로 h19 가 갱신 재조회한다
 * (없으면 추가가 화면에 영영 안 보인다, W-1). 서버 재검증 결과(`hasViolation`)는 그 재조회가 표시한다
 * (INV-2 — 클라는 시각 타당성을 판정하지 않는다). 일정 GET 미도착·실패(`notReady`)면 추가를 조용히
 * 막는다(빈-PUT 미발사, W-2). 여러 일자면 라우트 `date` 의 날(카드 사이 "+", TRIP-1115), 없으면 첫 날에
 * 담는다(말미 추가의 일자 선택 UI 는 Figma 공백).
 *
 * insertAfter 는 **prop 이 아니라 `useLocalSearchParams`** 로 받는다 — tripId(prop, P1~P4 무회귀)와
 * 라우트 계약(useLocalSearchParams, 797 호출부)을 동시에 만족시키는 조합이다.
 */
export function PlaceAddPage({ tripId }: { tripId: string }): ReactElement {
  const { insertAfter, date } = useLocalSearchParams<{
    insertAfter?: string;
    date?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [searchText, setSearchText] = useState('');
  const [pendingPlace, setPendingPlace] = useState<Place | null>(null);
  // 저장에 성공한 추가마다 하나씩(중복 poiId 도) — 행의 "담김" 표시이자 아래 insertAt 오프셋(길이 = 성공 수)이다.
  // 줄이거나 중복을 거르면 연달아 담기 자리가 어긋난다(TRIP-1640).
  const [addedPoiIds, setAddedPoiIds] = useState<string[]>([]);
  // 카드 사이 「+」로 들어온 삽입 자리(선행 index 의 다음). 라우트 파라미터 insertAfter 는 화면이 떠 있는 동안
  // 고정이라, 저장에 성공한 추가 수만큼 뒤로 민다 — 안 밀면 연달아 담은 둘째가 첫째 앞에 끼고 시각도 겹친다
  // (TRIP-1640). 실패한 추가는 끼지 않았으니 세지 않는다. 없으면(말미 추가) undefined.
  const insertAt =
    insertAfter !== undefined
      ? Number(insertAfter) + 1 + addedPoiIds.length
      : undefined;
  // TRIP-1424 — 마지막 추가 저장이 실패했나. 다음 저장이 시작되면 지운다(01b Q7).
  const [addFailed, setAddFailed] = useState(false);
  // 저장 중인 추가(null = 없음) — 응답과 견줄 그날 요청 슬롯·추가한 자리를 들고 있다. 값이 있는 동안은 다른 추가를
  // 받지 않는다(01b Q3 — 첫 응답이 캐시에 오기 전 days 로 둘째 PUT 을 만들면 서버에서 첫 추가가 지워진다).
  // 상태가 아니라 ref 인 이유: 「+ 추가」(시트 열기)의 같은 틱 누름도 막아야 하고, 화면을 떠난 뒤 도는 훅 콜백도
  // 읽어야 한다. 실제로 PUT 을 내는 [적용]의 같은 틱 두 누름은 이 가드 밖이다.
  const inFlightRef = useRef<{
    poiId: string;
    date: string;
    requestSlots: PlaceAddSlotLike[];
    addedIndex: number;
    /** 요청에 넣은 새 슬롯 — 편집기 초안에 끼울 때 응답에서 못 찾으면 이걸 쓴다. */
    slot: ItineraryDaysItemSlotsItem;
    /** 요청 때의 삽입 자리 — 초안에도 같은 자리에 끼운다(없으면 말미). */
    insertAt: number | undefined;
  } | null>(null);

  // 검색은 서버가 한다(q) + 커서 무한 스크롤(TRIP-502) — 클라 이름 필터·전량 수신을 없앤다.
  // 입력창은 즉시 반영하되 서버 조회 키만 300ms 멈춘 값으로 민다 — 글자마다 요청이 나가던 것을 줄인다(TRIP-1348).
  const trimmedQuery = useDebouncedValue(searchText.trim(), SEARCH_DEBOUNCE_MS);
  // 후보는 여행 목적지로 좁힌다(TRIP-981 #041). 여행 조회가 끝나기 전엔 장소 조회를 켜지 않는다 —
  // 켜면 전국 목록이 먼저 떴다가 바뀐다. 실패·목적지 0곳이면 region 없이 연다(INV-4).
  // 재시도 없음 — 기본 3회(1+2+4초)를 다 기다리면 실패 시 목록이 ~7초 빈다.
  const trip = useGetTripsTripId(tripId, { query: { retry: false } });
  const itinerary = useGetTripsTripIdItinerary(tripId);
  // 콜백은 호출별(`mutate(vars, { onSuccess })`)이 아니라 훅 옵션에 둔다 — 호출별 콜백은 응답 전에 화면을 떠나면
  // 안 불려, 편집기 캐시에 추가가 안 보이고 안내도 사라진다(TRIP-1424 Q2). 훅 옵션은 언마운트 뒤에도 돈다.
  const save = usePutTripsTripIdItinerary({
    mutation: {
      // 저장 성공 → PUT 응답(추가한 슬롯·서버 재검증 결과 hasViolation)으로 일정 GET 캐시를 교체한다
      // (재조회 0, TRIP-1348). h19 가 그 캐시를 읽는다 — 없으면 추가가 화면에 영영 안 보인다.
      onSuccess: (data) => {
        queryClient.setQueryData(
          getGetTripsTripIdItineraryQueryKey(tripId),
          data
        );
        const added = inFlightRef.current;
        if (added === null) return;
        setAddedPoiIds((ids) => [...ids, added.poiId]);
        // 편집기에 저장 안 한 변경(dirty)이 있으면 편집기는 이 응답으로 초안을 다시 채우지 않는다 — 그러면 추가한
        // 장소가 초안에 없어 이어 누른 [저장]이 서버에서 그 장소를 지운다. 그래서 초안에도 같은 자리(초안 기준
        // 삽입 자리 insertAt, 없으면 말미)에 끼운다. dirty 가 아니면 편집기가 응답으로 시드하므로 손대지 않는다.
        const draft = useItineraryEditStore.getState();
        const hasUnsavedEdits = draft.dirty;
        if (hasUnsavedEdits) {
          draft.insertSlot(
            added.date,
            data.days
              .find((day) => day.date === added.date)
              ?.slots.find((slot) => slot.poiId === added.poiId) ?? added.slot,
            added.insertAt
          );
        }
        // 서버가 이동을 반영해 시각을 밀었으면 응답 시각 그대로 말한다(INV-2). 응답엔 "밀었다" 필드가 없어
        // 요청과 같은 자리의 슬롯을 견준다(BR-U3-13·14 §3 개정 — 장소·순서는 요청 그대로일 때만 repair 를 쓴다).
        showToast({
          testID: 'itinerary-place-added-toast',
          message:
            placeAddToastMessage(
              comparePlaceAdd({
                requestSlots: added.requestSlots,
                responseSlots: data.days.find((day) => day.date === added.date)
                  ?.slots,
                addedIndex: added.addedIndex,
              })
            ) + (hasUnsavedEdits ? UNSAVED_EDITS_TAIL : ''),
        });
      },
      // 실패한 추가를 "추가됨"으로 두지 않고 말한다(INV-4). 화면을 떠난 뒤의 실패는 보일 자리가 없다(맹점 ③-c).
      onError: () => setAddFailed(true),
      onSettled: () => {
        inFlightRef.current = null;
      },
    },
  });

  // 담을 대상 일자 — 라우트 `date`(편집기의 활성 일자 — 카드 사이 "+" TRIP-1115·말미 「장소 추가」
  // TRIP-1233)가 일정에 있으면 그 날, 없거나 미전달(같이 짜기·후보 시트의 장소 검색)이면 첫 날.
  // insertAfter 는 그 날 기준 index 라 날이 어긋나면 다른 날의 완료 카드 앞에 끼어든다(INV-U3-03). 일정 GET 미도착·실패면 undefined.
  const days = itinerary.data?.days ?? [];
  const targetDay = days.find((day) => day.date === date) ?? days[0];
  const targetDate = targetDay?.date;
  const notReady = targetDate === undefined;
  // 시트 헤더 "장소 추가 · N일차" — N = 담을 일자 index+1.
  const targetDayIndex = days.findIndex((day) => day.date === targetDate);
  const dayNumber = (targetDayIndex >= 0 ? targetDayIndex : 0) + 1;

  // 후보 지역 = 담을 날(헤더 N일차)의 지역 하나(TRIP-1233 AC-3 — 옛 다지역 병합은 1일차 지역을 앞에
  // 세워 2일차를 못 채웠다). 다지역이면 N 을 알려면 일정이 와야 하므로 그때까지 조회를 미룬다.
  const destinations = trip.data?.destinations ?? [];
  const region = regionForDay(destinations, dayNumber);
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage, isSuccess } =
    usePlacesInfinite(
      {
        ...(region !== null ? { region } : {}),
        ...(selectedCategory ? { category: selectedCategory } : {}),
        ...(trimmedQuery ? { q: trimmedQuery } : {}),
      },
      {
        enabled:
          !trip.isPending && !(destinations.length >= 2 && itinerary.isPending),
      }
    );

  function handleEndReached(): void {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }

  // 전면 지도 — 담을 일자 슬롯 좌표로 핀을 세운다(MapSheetShell 이 MapView 를 소유하므로
  // 지도 census 신규 등재 불필요). 좌표 없으면 서울 기본 중심(FALLBACK_CENTER).
  const targetSlots = targetDay?.slots ?? [];
  const pins = buildDraftPins(targetSlots);
  const center =
    pins.length > 0 ? { lat: pins[0].lat, lng: pins[0].lng } : FALLBACK_CENTER;
  // 시트 기본값 = 새 장소 바로 앞 슬롯(insertAt 앞 카드 — 연달아 담으면 방금 담은 장소, 없으면 마지막)의 종료부터 1시간
  // (TRIP-1009). 제안값일 뿐 시각 재추정이 아니다 — 저장 후 서버가 재검증한다(INV-2).
  const suggested = suggestNextSlotTime(
    insertAt !== undefined
      ? targetSlots[insertAt - 1]
      : targetSlots[targetSlots.length - 1]
  );

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
      // 로컬로 만든 새 슬롯엔 AI 차선책이 없다 — 계약상 "편집하면 사라진다"(빈 배열).
      alternatives: [],
    };
    const nextDays = days.map((day) =>
      day.date === targetDate
        ? {
            ...day,
            // 삽입 자리(insertAt)가 있으면 그 자리에 splice, 없으면 말미 append(후방호환).
            slots:
              insertAt !== undefined
                ? insertSlotAt(day.slots, newSlot, insertAt)
                : addSlot(day.slots, newSlot),
          }
        : day
    );

    const request = buildEditItineraryRequest(nextDays);
    inFlightRef.current = {
      poiId: place.poiId,
      date: targetDate,
      requestSlots:
        request.days.find((day) => day.date === targetDate)?.slots ?? [],
      // 서버 슬롯은 시작이 늘 있어 요청이 거르는 슬롯이 없다 — 그날 배열의 자리가 곧 요청의 자리다.
      addedIndex:
        nextDays
          .find((day) => day.date === targetDate)
          ?.slots.indexOf(newSlot) ?? -1,
      slot: newSlot,
      insertAt,
    };
    setAddFailed(false);
    save.mutate({ tripId, data: request });
  }

  return (
    <View className="flex-1">
      <MapSheetShell
        center={center}
        pins={pins}
        onBack={() => router.back()}
        // TRIP-1204 — 시트가 열린 채로도 손가락 확대·이동(셸 기본은 열림=잠금). 6-b 실기 전용.
        mapViewOnly={false}
        header={
          <View>
            <Text className="px-lg pb-xs pt-sm font-noto-bold text-[18px] font-bold text-ink">
              {`장소 추가 · ${dayNumber}일차`}
            </Text>
            {/* TRIP-1424 — 저장 실패 안내(Figma 공백 — 편집기 저장 실패 배너 꼴). 토스트는 성공 아이콘 고정이라 못 쓴다. */}
            {addFailed ? (
              <View
                testID="itinerary-place-add-error"
                className="mx-lg mb-xs rounded-card bg-primary-pale px-md py-sm"
              >
                <Text className="font-noto text-caption text-primary-text">
                  장소를 담지 못했어요. 잠시 후 다시 시도해 주세요
                </Text>
              </View>
            ) : null}
          </View>
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
                // 저장 중엔 다른 추가를 받지 않는다(TRIP-1424 Q3 — 진행 표시는 6-b 결정).
                if (inFlightRef.current !== null) return;
                // 다른 화면 인스턴스(나갔다 다시 들어온 이 화면)의 저장이 아직 진행 중이어도 받지 않는다 — ref 는
                // 인스턴스마다 새로 생겨 그 저장을 모른다(TRIP-1498). 일정 PUT 이 하나라도 도는 중이면 무반응.
                if (
                  queryClient.isMutating({ mutationKey: PUT_MUTATION_KEY }) > 0
                )
                  return;
                // 검색 키보드를 내린다 — 목록은 탭을 행에 넘기되(handled) 키보드는 그대로 두므로,
                // 안 내리면 새 시각 시트가 키보드 밑에 깔린다(TRIP-981 #057).
                Keyboard.dismiss();
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
          startAt={suggested.startAt}
          endAt={suggested.endAt}
          onApply={handleApplyTime}
          onCancel={() => setPendingPlace(null)}
          testIDPrefix="itinerary-edit-time"
          labels={{ start: '시작', end: '종료' }}
        />
      ) : null}
    </View>
  );
}
