import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { PlaceRowCard } from '@/entities/place/ui/PlaceRowCard';
import { PlaceSubtitle } from '@/entities/place/ui/PlaceSubtitle';
import { useMultiRegionPlaces } from '@/features/explore/model/useMultiRegionPlaces';
import { usePlacesInfinite } from '@/features/explore/model/usePlacesInfinite';
import { PlaceAddHeader } from '@/features/itinerary/ui/PlaceAddScreen';
import { rememberSpontaneousName } from '@/features/check-visit/model/spontaneousNames';
import { useVisitCheck } from '@/features/check-visit/model/useVisitCheck';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import { ArriveRequestSource } from '@/shared/api/generated/schemas';
import type { Place, PoiCategory } from '@/shared/api/generated/schemas';

// 후보가 없을 때 지도 중심 — 서울 시청(PlaceAddPage 선례).
const FALLBACK_CENTER = { lat: 37.5665, lng: 126.978 };

const PICK_FAILED = '방문을 기록하지 못했어요. 다시 시도해 주세요.';

/**
 * TRIP-1072 · j01 [방문 추가] 장소 피커 — 계획에 없던 곳(즉석 방문)의 도착을 기록한다.
 * 모양은 h13 장소 추가(`4337:1923`, `PlaceAddPage`)를 따르되 일차 칩·거리줄은 뺐다(오늘 하루뿐, 거리 필드 없음).
 *
 * 후보는 `GET /places` 결과만(INV-1 취지), 여행 목적지로 좁힌다 — 여행 조회가 끝날 때까지 장소 조회를
 * 미루고, 2곳 이상이면 지역별 병합, 실패·0곳이면 region 없이(PlaceAddPage TRIP-981 과 같은 규칙).
 *
 * 고르면 `useVisitCheck.arrive` 로 slotKey 없는 도착 1건 — j01 과 같은 (tripId, day) 캐시에 낙관 카드를
 * 끼우고 응답으로 교체하므로 돌아가면 재조회 없이 카드가 서 있다. 이름은 arrive **전에** 세션 캐시에
 * 남긴다(낙관 카드부터 이름이 보이게). 진행 중엔 어떤 행도 받지 않는다(훅 가드는 같은 poi 만 막는다).
 * 실패(404·네트워크)는 문구로 알리고 머문다 — 다음 누름 때 지운다(pages 층 타이머 금지).
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
  const picking = useRef(false);

  const trimmedQuery = searchText.trim();
  const trip = useGetTripsTripId(tripId, { query: { retry: false } });
  const regions = (trip.data?.destinations ?? []).map((dest) => dest.region);
  const isMultiRegion = regions.length >= 2;
  const infinite = usePlacesInfinite(
    {
      ...(regions.length === 1 ? { region: regions[0] } : {}),
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
  const isSuccess = isMultiRegion
    ? !multi.isPending && !multi.isError
    : infinite.isSuccess;

  const first = items[0];
  const center = first ? { lat: first.lat, lng: first.lng } : FALLBACK_CENTER;

  async function handlePick(place: Place): Promise<void> {
    if (picking.current) return;
    picking.current = true;
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
      router.back();
      return;
    }
    picking.current = false;
    // conflict 는 훅의 로컬 연타 신호다(즉석 방문엔 서버 409 가 없다) — 안내하지 않는다.
    if (outcome.kind === 'failed' && outcome.reason !== 'conflict') {
      setFailed(true);
    }
  }

  return (
    <View testID="record-add-visit-screen" className="flex-1">
      <MapSheetShell
        center={center}
        onBack={() => router.back()}
        header={
          <View>
            <Text className="px-lg pb-xs pt-sm font-noto-bold text-[18px] font-bold text-ink">
              방문 추가
            </Text>
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
          renderItem: ({ item }) => (
            <PlaceRowCard
              testIDPrefix="record-add-visit-row"
              id={item.poiId}
              name={item.nameKo}
              imageUrl={item.imageUrl}
              subtitle={
                <PlaceSubtitle
                  parts={[...item.tags.map((tag) => `#${tag}`), item.category]}
                  className="font-noto text-[12.5px] text-muted"
                  numberOfLines={1}
                />
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
          ),
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
          // 조회 성공 + 0건일 때만 안내(INV-4). 로딩 중엔 안 띄운다(깜빡임).
          ListEmptyComponent: isSuccess ? (
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
