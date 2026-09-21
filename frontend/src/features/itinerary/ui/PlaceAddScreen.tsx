import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PlaceRowCard } from '@/entities/place/ui/PlaceRowCard';
import { PlaceSubtitle } from '@/entities/place/ui/PlaceSubtitle';
import type { Place, PoiCategory } from '@/shared/api/generated/schemas';

import { PlusGlyph, SearchGlyph } from './ItineraryGlyphs';
import { PLACE_CATEGORY_CHIPS } from '../config/placeCategoryChips';

/**
 * TRIP-798 · h13 장소 추가 시트 콘텐츠 순수 뷰 — Figma `4337:1923`. **props-only**(검색어·카테고리·
 * 조회는 페이지가 소유, 화면은 완성된 `places` 목록만 그린다). 검색 심판(AC-5)은 배선 층(msw)이 진다.
 *
 * 앱바("장소 추가")·"완료"·하단 CTA·안내/notReady 배너는 h13 재편으로 **제거**됐다 — 시트 헤더
 * ("장소 추가 · N일차")·전면 지도는 페이지(`PlaceAddPage`)가 조립한다(features→widgets 상향 금지).
 *
 * AC-2 칩은 `PLACE_CATEGORY_CHIPS`(config 정본) 6종·순서 그대로 — '전시' 칩은 서버로 '문화'를 보낸다
 * (라벨≠전송값). AC-3 카드는 `entities/place/ui/PlaceRowCard`(접두 `itinerary-place-card`) 채택,
 * "+추가"는 아웃라인(빨강 테두리·글자, 필 폐기). AC-4 거리줄은 `distanceByPoiId` 에 값이 있을 때만
 * 렌더한다(없으면 지어내지 않는다, INV-3 — 실 GET 계약엔 거리 필드가 없어 픽스처/6-b 전용).
 */

const SEARCH_PLACEHOLDER = '장소·맛집·명소 검색';
const EMPTY_TEXT = '검색 결과가 없어요';

export interface PlaceAddScreenProps {
  /** 이미 이름 부분일치로 걸러진 목록(`visiblePlaces` 결과) — 화면은 그대로 그린다. */
  places: Place[];
  searchText: string;
  selectedCategory: PoiCategory | null;
  /** 이미 담은 장소 poiId — "추가됨" 비활성 상태. */
  addedPoiIds: string[];
  /**
   * poiId → pre-composed 거리줄 텍스트(예 `'③에서 1.1km'`). 값이 있을 때만 거리줄을 렌더한다 —
   * 없으면 미렌더(지어내기 금지, INV-3). 조립(`formatDistance` + 원점 라벨)은 페이지/픽스처 몫이고,
   * 실 GET 엔 거리 필드가 없어 실서비스에선 미렌더로 머문다.
   */
  distanceByPoiId?: Record<string, string>;
  onChangeSearchText(text: string): void;
  onSelectCategory(category: PoiCategory | null): void;
  onPressAdd(place: Place): void;
  /** 목록 끝에 닿으면 다음 장을 이어 받는다(TRIP-502 무한 스크롤). 미지정=무동작(additive). */
  onEndReached?: () => void;
  /** 다음 장을 받는 중이면 목록 하단 로딩(footer). 미지정=false. */
  isFetchingMore?: boolean;
}

/** 카테고리 칩 하나 — 활성(primary bg + white) / 비활성(border + body). */
function CategoryChip({
  label,
  testID,
  active,
  onPress,
}: {
  label: string;
  testID: string;
  active: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`items-center justify-center rounded-pill px-lg py-[7px] ${
        active ? 'bg-primary' : 'border border-hairline-strong bg-canvas'
      }`}
    >
      <Text
        className={`text-label ${
          active
            ? 'font-noto-bold font-bold text-on-primary'
            : 'font-noto text-body'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function PlaceAddScreen({
  places,
  searchText,
  selectedCategory,
  addedPoiIds,
  distanceByPoiId,
  onChangeSearchText,
  onSelectCategory,
  onPressAdd,
  onEndReached,
  isFetchingMore = false,
}: PlaceAddScreenProps): ReactElement {
  return (
    <View className="flex-1 bg-canvas">
      <View className="w-full gap-md px-lg pb-sm pt-sm">
        <View className="h-[46px] w-full flex-row items-center gap-sm rounded-pill border border-hairline bg-surface-soft pl-lg pr-md">
          <SearchGlyph size={20} />
          <TextInput
            testID="itinerary-place-search"
            value={searchText}
            onChangeText={onChangeSearchText}
            placeholder={SEARCH_PLACEHOLDER}
            className="flex-1 font-noto text-[14.5px] text-ink placeholder:text-muted-soft"
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {PLACE_CATEGORY_CHIPS.map((chip) => (
            <CategoryChip
              key={chip.testId}
              label={chip.label}
              testID={`itinerary-place-category-${chip.testId}`}
              active={selectedCategory === chip.category}
              onPress={() => onSelectCategory(chip.category)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList<Place>
        testID="itinerary-place-list"
        data={places}
        keyExtractor={(place) => place.poiId}
        contentContainerClassName="gap-md px-lg pb-2xl pt-sm"
        ListEmptyComponent={
          <View className="w-full items-center py-2xl">
            <Text className="font-noto text-body text-muted">{EMPTY_TEXT}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const distanceLine = distanceByPoiId?.[item.poiId];
          const added = addedPoiIds.includes(item.poiId);
          return (
            <PlaceRowCard
              testIDPrefix="itinerary-place-card"
              id={item.poiId}
              name={item.nameKo}
              imageUrl={item.imageUrl}
              subtitle={
                <View className="gap-[2px]">
                  <PlaceSubtitle
                    parts={[
                      ...item.tags.map((tag) => `#${tag}`),
                      item.category,
                    ]}
                    className="font-noto text-[12.5px] text-muted"
                    numberOfLines={1}
                  />
                  {distanceLine ? (
                    <Text
                      testID={`itinerary-place-distance-${item.poiId}`}
                      className="font-noto text-[12px] text-muted-soft"
                      numberOfLines={1}
                    >
                      {distanceLine}
                    </Text>
                  ) : null}
                </View>
              }
              trailing={
                added ? (
                  <View
                    testID={`itinerary-place-added-${item.poiId}`}
                    accessibilityState={{ disabled: true }}
                    className="items-center justify-center rounded-button bg-surface-strong px-md py-sm"
                  >
                    <Text className="font-noto-bold text-label font-bold text-muted">
                      추가됨
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    testID={`itinerary-place-add-${item.poiId}`}
                    accessibilityRole="button"
                    onPress={() => onPressAdd(item)}
                    className="flex-row items-center gap-[3px] rounded-button border border-primary px-md py-sm"
                  >
                    <PlusGlyph size={14} tone="primary" />
                    <Text className="font-noto-bold text-label font-bold text-primary">
                      추가
                    </Text>
                  </Pressable>
                )
              }
            />
          );
        }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          isFetchingMore ? (
            <View
              testID="itinerary-place-loading-more"
              className="w-full items-center py-lg"
            >
              <ActivityIndicator />
            </View>
          ) : null
        }
      />
    </View>
  );
}
