import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PoiCategory, type Place } from '@/shared/api/generated/schemas';

import {
  BackChevronGlyph,
  CheckCircleGlyph,
  SearchGlyph,
} from './ItineraryGlyphs';
import { PlaceAddCard } from './PlaceAddCard';

/**
 * TRIP-338 · h20 장소 추가·검색 화면 — Figma `1894:1083`. **props-only**(검색어·카테고리·조회는
 * 페이지가 소유, 화면은 완성된 `places` 목록만 그린다). 검색 심판(AC-5)은 배선 층(msw)이 진다.
 *
 * §8② 카테고리 칩은 `PoiCategory` enum 을 정본으로 확정한다 — Figma 칩 "전시"는 enum 에 없어
 * (문화?) 발명이 되므로 뺀다. "전체"(null) + enum 7종을 그린다. testID `itinerary-place-category-{enum}`
 * 는 한글 enum 을 그대로 담는다(슬롯 testID 가 `{date}#{poiId}` 임의 문자열을 담는 선례라 무해, 02a §2).
 *
 * §8③ 각색: guide 카피는 Figma 원문("자동 배치돼요")을 안 쓴다 — `EditItineraryRequest` 가
 * `startAt`·`endAt` 을 필수로 받아 자동 배치가 불가능하다. "넣은 순서로 담겨요"로 정직하게 바꾼다.
 */

const SCREEN_TITLE = '장소 추가';
const DONE_LABEL = '완료';
const SEARCH_PLACEHOLDER = '장소·맛집·명소 검색';
const ALL_CHIP_LABEL = '전체';
const GUIDE_TEXT = '추가하면 빈 일정에 순서대로 담겨요';
const NOT_READY_TEXT =
  '아직 일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
const EMPTY_TEXT = '검색 결과가 없어요';
const VIEW_PLAN_CTA_LABEL = '일정에서 위치·순서 보기';

const CATEGORIES: PoiCategory[] = Object.values(PoiCategory);

export interface PlaceAddScreenProps {
  /** 이미 이름 부분일치로 걸러진 목록(`visiblePlaces` 결과) — 화면은 그대로 그린다. */
  places: Place[];
  searchText: string;
  selectedCategory: PoiCategory | null;
  /** 이미 담은 장소 poiId — "추가됨" 비활성 상태. */
  addedPoiIds: string[];
  /**
   * 일정 GET 이 아직 미도착·실패라 담을 대상 일자가 없다 — 안내를 노출해 추가가 조용히
   * 버려지는 것을 사용자가 인지하게 한다(배선이 press 도 막는다). 미지정=정상(기존 동작 불변).
   */
  notReady?: boolean;
  onChangeSearchText(text: string): void;
  onSelectCategory(category: PoiCategory | null): void;
  onPressAdd(place: Place): void;
  /** appbar "완료" → h19 복귀. */
  onPressDone(): void;
  /** appbar 뒤로. */
  onBack(): void;
  /** 하단 "일정에서 위치·순서 보기" → h19 복귀. */
  onPressViewPlan(): void;
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
  notReady = false,
  onChangeSearchText,
  onSelectCategory,
  onPressAdd,
  onPressDone,
  onBack,
  onPressViewPlan,
}: PlaceAddScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="itinerary-place-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {SCREEN_TITLE}
          </Text>
          <View className="flex-1" />
          <Pressable
            testID="itinerary-place-done"
            accessibilityRole="button"
            onPress={onPressDone}
            hitSlop={6}
          >
            <Text className="font-noto-bold text-[14.5px] font-bold text-primary">
              {DONE_LABEL}
            </Text>
          </Pressable>
        </View>

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
            <CategoryChip
              label={ALL_CHIP_LABEL}
              testID="itinerary-place-category-all"
              active={selectedCategory === null}
              onPress={() => onSelectCategory(null)}
            />
            {CATEGORIES.map((category) => (
              <CategoryChip
                key={category}
                label={category}
                testID={`itinerary-place-category-${category}`}
                active={selectedCategory === category}
                onPress={() => onSelectCategory(category)}
              />
            ))}
          </ScrollView>

          {notReady ? (
            <View
              testID="itinerary-place-notready"
              className="w-full flex-row items-center gap-sm rounded-[10px] bg-surface-soft px-md py-sm"
            >
              <Text className="font-noto text-[12.5px] text-muted">
                {NOT_READY_TEXT}
              </Text>
            </View>
          ) : (
            <View className="w-full flex-row items-center gap-sm rounded-[10px] bg-primary-pale px-md py-sm">
              <CheckCircleGlyph size={18} />
              <Text className="font-noto text-[12.5px] text-primary-text">
                {GUIDE_TEXT}
              </Text>
            </View>
          )}
        </View>

        <ScrollView contentContainerClassName="gap-md px-lg pb-2xl pt-sm">
          {places.length === 0 ? (
            <View className="w-full items-center py-2xl">
              <Text className="font-noto text-body text-muted">
                {EMPTY_TEXT}
              </Text>
            </View>
          ) : (
            places.map((place) => (
              <PlaceAddCard
                key={place.poiId}
                place={place}
                added={addedPoiIds.includes(place.poiId)}
                onPressAdd={() => onPressAdd(place)}
              />
            ))
          )}
        </ScrollView>

        <View className="w-full border-t border-hairline bg-canvas px-lg py-md">
          <Pressable
            testID="itinerary-place-back-cta"
            accessibilityRole="button"
            onPress={onPressViewPlan}
            className="w-full items-center justify-center rounded-button border border-hairline-strong bg-canvas py-md"
          >
            <Text className="font-noto-bold text-[14.5px] font-bold text-ink">
              {VIEW_PLAN_CTA_LABEL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
