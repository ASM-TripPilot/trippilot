import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { WarningTriangleGlyph } from '@/shared/ui/glyphs';
import { goBackOr } from '@/shared/lib/goBackOr';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { PlaceRowCard } from '@/entities/place';
import { PlaceSubtitle } from '@/entities/place';
import { useMultiRegionPlaces } from '@/features/explore';
import { usePlacesInfinite } from '@/features/explore';
import {
  buildDraftPins,
  PlaceAddHeader,
  placeAddSubtitle,
} from '@/features/itinerary';
import { rememberSpontaneousName } from '@/features/check-visit';
import { useVisitCheck } from '@/features/check-visit';
import { MapSheetShell } from '@/widgets/map-sheet-shell';
import {
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { placeRegionQuery } from '@/entities/trip';
import { StateNotice } from '@/shared/ui/StateNotice';
import { ArriveRequestSource } from '@/shared/api/index.schemas';
import type { Place, PoiCategory } from '@/shared/api/index.schemas';
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedValue,
} from '@/shared/lib/useDebouncedValue';
import { usePressLock } from '@/shared/lib/pressGuard';

// 그날 좌표 핀도 후보도 없을 때 지도 중심 — 서울 시청(PlaceAddPage 선례).
const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };

const PICK_FAILED = '방문을 기록하지 못했어요. 다시 시도해 주세요.';

/**
 * TRIP-1072 · j01 [방문 추가] 장소 피커 — 계획에 없던 곳(즉석 방문)의 도착을 기록한다.
 * 모양은 h13 장소 추가(`4337:1923`, `PlaceAddPage`)를 따르되 일차 칩·거리줄은 뺐다(오늘 하루뿐, 거리 필드 없음).
 *
 * 후보는 `GET /places` 결과만(INV-1 취지), 여행 목적지로 좁힌다 — 여행 조회가 끝날 때까지 장소 조회를
 * 미루고, 2곳 이상이면 지역별 병합, 실패·0곳이면 region 없이(PlaceAddPage TRIP-981 과 같은 규칙).
 * 여행 조회가 404 아닌 이유로 실패해 전국 목록으로 열리면 그 사실을 목록 위에 알린다(기록이 남는 화면 — TRIP-1756).
 * 장소 조회 실패는 빈 목록이 아니라 실패 얼굴 + 다시 시도로 말한다.
 *
 * 고르면 `useVisitCheck.arrive` 로 slotKey 없는 도착 1건 — j01 과 같은 (tripId, day) 캐시에 낙관 카드를
 * 끼우고 응답으로 교체하므로 돌아가면 재조회 없이 카드가 서 있다. 이름은 arrive **전에** 세션 캐시에
 * 남긴다(낙관 카드부터 이름이 보이게). 진행 중엔 어떤 행도 받지 않는다(훅 가드는 같은 poi 만 막는다).
 * 실패(404·네트워크)는 문구로 알리고 머문다 — 다음 누름 때 지운다(pages 층 타이머 금지).
 *
 * 지도(TRIP-1416)는 그날(`day`) 일정 슬롯 중 좌표 있는 곳에 번호 핀을 세우고 셸의 핀 맞춤을 켠다(h13 선례).
 * 일정은 j01 과 같은 캐시 키라 보통 즉시 있다. 그날이 일정에 없거나·좌표가 없거나·조회가 실패하면 핀 없이
 * 첫 후보 → 서울 기본 중심(첫 날로 폴백하지 않는다 — 다른 날 핀은 오늘 기록과 무관하다). 일정이 늦게 오면
 * 지도가 camera→region 으로 한 번 다시 마운트된다(다른 셸 화면 첫 로드와 같음).
 */
export function RecordAddVisitPage({
  tripId,
  day,
}: {
  tripId: string;
  day: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const visitCheck = useVisitCheck({ tripId, day });
  const [selectedCategory, setSelectedCategory] = useState<PoiCategory | null>(
    null
  );
  const [searchText, setSearchText] = useState('');
  const [failed, setFailed] = useState(false);
  // 동기 가드 — 같은 틱 연타도 두 번째 요청을 못 내게 state 가 아니라 ref 로 쥔다.
  const pickingLock = usePressLock();

  // 입력칸은 즉시, 서버 조회 키는 300ms 멈춘 값(TRIP-1617).
  const trimmedQuery = useDebouncedValue(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const trip = useGetTripsTripId(tripId, { query: { retry: false } });
  const regions = (trip.data?.destinations ?? []).map(placeRegionQuery);
  const isMultiRegion = regions.length >= 2;
  const infinite = usePlacesInfinite(
    {
      ...(regions.length === 1 ? regions[0] : {}),
      ...(selectedCategory ? { category: selectedCategory } : {}),
      ...(trimmedQuery ? { q: trimmedQuery } : {}),
    },
    { enabled: !trip.isPending && !isMultiRegion }
  );
  const multi = useMultiRegionPlaces(regions, {
    category: selectedCategory,
    q: trimmedQuery,
  });
  const { items, fetchNextPage, hasNextPage, isFetchingNextPage } =
    isMultiRegion ? multi : infinite;
  const listFailed = isMultiRegion ? multi.isError : infinite.isError;
  // 여행 조회 실패(404 제외 — 404 는 종전대로 안내 없이 region 없이 연다)로 전국 목록이 떴을 때만.
  const regionUnknown =
    trip.data === undefined && trip.isError && !isNotFound(trip.error);
  function retryList(): void {
    void (isMultiRegion ? multi : infinite).refetch();
  }
  const isSuccess = isMultiRegion
    ? !multi.isPending && !multi.isError
    : infinite.isSuccess;

  const itinerary = useGetTripsTripIdItinerary(tripId);
  const pins = buildDraftPins(
    itinerary.data?.days.find((d) => d.date === day)?.slots ?? []
  );
  const first = items[0];
  const center = pins[0]
    ? { lat: pins[0].lat, lng: pins[0].lng }
    : first
      ? { lat: first.lat, lng: first.lng }
      : FALLBACK_CENTER;

  async function handlePick(place: Place): Promise<void> {
    if (!pickingLock.acquire()) return;
    setFailed(false);
    rememberSpontaneousName(queryClient, tripId, place.poiId, place.nameKo);
    const outcome = await visitCheck.arrive({
      // 계획에 있는 곳이어도 슬롯 키를 추측하지 않는다 — 즉석 방문(BR-U5-03).
      slotKey: null,
      poiId: place.poiId,
      source: ArriveRequestSource.MANUAL,
    });
    // 성공이면 가드를 쥔 채 돌아간다(뒤로 가는 동안 다른 행이 눌리지 않게).
    if (outcome.kind === 'arrived') {
      goBackOr(router, `/trips/${tripId}/records`);
      return;
    }
    pickingLock.release();
    // conflict 는 훅의 로컬 연타 신호다(즉석 방문엔 서버 409 가 없다) — 안내하지 않는다.
    if (outcome.kind === 'failed' && outcome.reason !== 'conflict') {
      setFailed(true);
    }
  }

  return (
    <View testID="record-add-visit-screen" className="flex-1">
      <MapSheetShell
        center={center}
        pins={pins}
        fitPins
        onBack={() => goBackOr(router, `/trips/${tripId}/records`)}
        // TRIP-1204 — 시트가 열린 채로도 손가락 확대·이동(셸 기본은 열림=잠금). 6-b 실기 전용.
        mapViewOnly={false}
        header={
          <View>
            <Text className="px-lg pb-xs pt-sm font-noto-bold text-[18px] font-bold text-ink">
              방문 추가
            </Text>
            {regionUnknown ? (
              <View
                testID="record-add-visit-region-notice"
                className="mx-lg mt-xs flex-row items-center gap-sm rounded-card bg-primary-pale px-md py-sm"
              >
                <Text className="shrink font-noto text-caption text-primary-text">
                  여행지를 확인하지 못해 전국 장소를 보여 드려요
                </Text>
                <Pressable
                  testID="record-add-visit-region-retry"
                  accessibilityRole="button"
                  onPress={() => {
                    void trip.refetch();
                  }}
                  className="ml-auto"
                >
                  <Text className="font-noto-bold text-caption font-bold text-primary">
                    다시 시도
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {failed ? (
              <View
                testID="record-add-visit-error"
                className="mx-lg mt-xs rounded-card bg-primary-pale px-md py-sm"
              >
                <Text className="font-noto text-caption text-primary-text">
                  {PICK_FAILED}
                </Text>
              </View>
            ) : null}
          </View>
        }
        list={{
          data: items,
          renderItem: ({ item }) => {
            const subtitle = placeAddSubtitle(item);
            return (
              <PlaceRowCard
                testIDPrefix="record-add-visit-row"
                id={item.poiId}
                name={item.nameKo}
                imageUrl={item.imageUrl}
                category={item.category}
                subtitle={
                  <View className="gap-[2px]">
                    <PlaceSubtitle
                      parts={subtitle.parts}
                      className="font-noto text-[12.5px] text-muted"
                      numberOfLines={1}
                    />
                    {subtitle.address !== null ? (
                      <Text
                        testID={`record-add-visit-address-${item.poiId}`}
                        className="font-noto text-[12px] text-muted-soft"
                        numberOfLines={1}
                      >
                        {subtitle.address}
                      </Text>
                    ) : null}
                  </View>
                }
                trailing={
                  <Pressable
                    testID={`record-add-visit-pick-${item.poiId}`}
                    accessibilityRole="button"
                    onPress={() => {
                      void handlePick(item);
                    }}
                    className="items-center justify-center rounded-button border border-primary px-md py-sm"
                  >
                    <Text className="font-noto-bold text-label font-bold text-primary">
                      기록
                    </Text>
                  </Pressable>
                }
              />
            );
          },
          keyExtractor: (place) => place.poiId,
          onEndReached: () => {
            if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
          },
          onEndReachedThreshold: 0.5,
          ListFooterComponent: isFetchingNextPage ? (
            <View className="w-full items-center py-lg">
              <ActivityIndicator />
            </View>
          ) : null,
          // 조회 성공 + 0건이면 빈 안내, 실패면 실패 얼굴(INV-4). 로딩 중엔 안 띄운다(깜빡임).
          // 실패 얼굴은 목록이 비었을 때만 보인다 — 다음 쪽 실패로 목록이 남아 있으면 안 뜬다(범위 밖).
          ListEmptyComponent: listFailed ? (
            <View className="w-full items-center justify-center px-lg pt-xl">
              <StateNotice
                testID="record-add-visit-load-error"
                icon={<WarningTriangleGlyph size={32} color="primary" />}
                title="지금 장소 정보를 불러올 수 없어요"
                description="잠시 후 다시 시도해 주세요"
                actions={[
                  {
                    testID: 'record-add-visit-load-retry',
                    label: '다시 시도',
                    variant: 'filled',
                    onPress: retryList,
                  },
                ]}
              />
            </View>
          ) : isSuccess ? (
            <View
              testID="record-add-visit-empty"
              className="w-full items-center py-lg"
            >
              <Text className="font-noto text-caption text-muted">
                검색 결과가 없어요
              </Text>
            </View>
          ) : null,
          testID: 'record-add-visit-list',
        }}
      >
        <PlaceAddHeader
          testIDPrefix="record-add-visit"
          searchText={searchText}
          selectedCategory={selectedCategory}
          onChangeSearchText={setSearchText}
          onSelectCategory={setSelectedCategory}
        />
      </MapSheetShell>
    </View>
  );
}
