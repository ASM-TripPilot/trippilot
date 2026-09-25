import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { PlaceRowCard } from '@/entities/place/ui/PlaceRowCard';
import { PlaceSubtitle } from '@/entities/place/ui/PlaceSubtitle';
import type { Place, PoiCategory } from '@/shared/api/generated/schemas';

import { PlusGlyph, SearchGlyph } from './ItineraryGlyphs';
import { PLACE_CATEGORY_CHIPS } from '../config/placeCategoryChips';

/**
 * TRIP-798 묶음 C · h13 장소 추가 시트 콘텐츠 순수 뷰 — Figma `4337:1923`. **props-only**.
 *
 * 시트화(묶음 C)로 화면 자체 `FlatList`·앱바·전면 지도가 사라지고, 이 파일은 두 순수 조각으로
 * 쪼개진다 — 리스트(FlatList)·헤더 텍스트·전면 지도는 페이지(`PlaceAddPage`)가 공용 `MapSheetShell`
 * 로 조립한다(features→widgets 상향 참조 금지라 조립처는 pages, 리스트 슬롯 body 는 셸이 소유):
 *  - `PlaceAddHeader` — 검색바 + 카테고리 칩 6종. 셸의 `children`(리스트 헤더 자리)에 얹힌다.
 *  - `PlaceAddRow` — 후보 카드 한 줄. 페이지가 `MapSheetShell.list.renderItem` 으로 조립한다.
 * foundation testID(`itinerary-place-search`·`-category-{라벨}`·`-card/add/added/distance`)는 두
 * 조각에 그대로 보존된다(재조립 무회귀 그물 = `PlaceAddPage.integration` SC2).
 *
 * AC-2 칩은 `PLACE_CATEGORY_CHIPS`(config 정본) 6종·순서 그대로 — '전시' 칩은 서버로 '문화'를 보낸다
 * (라벨≠전송값). AC-3 카드는 `entities/place/ui/PlaceRowCard`(접두 `itinerary-place-card`) 채택,
 * "+추가"는 아웃라인(빨강 테두리·글자, 필 폐기). AC-4 거리줄은 `distanceLine` 이 있을 때만 렌더한다
 * (없으면 지어내지 않는다, INV-3 — 실 GET 계약엔 거리 필드가 없어 픽스처/6-b 전용).
 */

const SEARCH_PLACEHOLDER = '장소·맛집·명소 검색';

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

export interface PlaceAddHeaderProps {
  searchText: string;
  selectedCategory: PoiCategory | null;
  onChangeSearchText(text: string): void;
  onSelectCategory(category: PoiCategory | null): void;
}

/** 검색바 + 카테고리 칩 6종 — `MapSheetShell` 의 `children`(리스트 헤더 자리)에 얹는 순수 헤더 뷰. */
export function PlaceAddHeader({
  searchText,
  selectedCategory,
  onChangeSearchText,
  onSelectCategory,
}: PlaceAddHeaderProps): ReactElement {
  return (
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
  );
}

export interface PlaceAddRowProps {
  place: Place;
  /** 이미 담은 장소면 "추가됨"(비활성). */
  added: boolean;
  /**
   * pre-composed 거리줄 텍스트(예 `'③에서 1.1km'`). 값이 있을 때만 거리줄을 렌더한다 — 없으면
   * 미렌더(지어내기 금지, INV-3). 실 GET 엔 거리 필드가 없어 실서비스에선 미렌더로 머문다(픽스처 전용).
   */
  distanceLine?: string;
  onPressAdd(): void;
}

/** 후보 카드 한 줄 — 페이지가 `MapSheetShell.list.renderItem` 으로 조립한다(PlaceRowCard 채택). */
export function PlaceAddRow({
  place,
  added,
  distanceLine,
  onPressAdd,
}: PlaceAddRowProps): ReactElement {
  return (
    <PlaceRowCard
      testIDPrefix="itinerary-place-card"
      id={place.poiId}
      name={place.nameKo}
      imageUrl={place.imageUrl}
      subtitle={
        <View className="gap-[2px]">
          <PlaceSubtitle
            parts={[...place.tags.map((tag) => `#${tag}`), place.category]}
            className="font-noto text-[12.5px] text-muted"
            numberOfLines={1}
          />
          {distanceLine ? (
            <Text
              testID={`itinerary-place-distance-${place.poiId}`}
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
            testID={`itinerary-place-added-${place.poiId}`}
            accessibilityState={{ disabled: true }}
            className="items-center justify-center rounded-button bg-surface-strong px-md py-sm"
          >
            <Text className="font-noto-bold text-label font-bold text-muted">
              추가됨
            </Text>
          </View>
        ) : (
          <Pressable
            testID={`itinerary-place-add-${place.poiId}`}
            accessibilityRole="button"
            onPress={onPressAdd}
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
}
