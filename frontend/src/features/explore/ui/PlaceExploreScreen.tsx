import type { ReactElement } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Place } from '@/shared/api/generated/schemas';
import { PoiCategory } from '@/shared/api/generated/schemas';

import {
  BackChevronGlyph,
  HeartBadgeGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  SearchGlyph,
} from './ExploreGlyphs';

/**
 * d04 장소 탐색 default(Figma `1692:1183`) — **프레젠테이션 화면**. props 8개만 받는다
 * (조회·라우팅·로컬 상태는 `pages/place-explore/ui/PlaceExplorePage.tsx` 몫). 정렬·검색은
 * 페이지가 끝내서 `places`로 내려주므로 이 화면은 받은 순서를 그대로 그린다 — 담김 여부는
 * `savedPoiIds` 하나에서만 파생한다(01b Seed §2 "계약에 판정 재료가 없는 컨트롤은 그리지
 * 않는다" — "가까운 순"·"지금 뜨는 순"·검색바 우측 필터 아이콘이 그래서 없다).
 */
export interface PlaceExploreScreenProps {
  /** 그릴 순서 그대로의 목록. 정렬·검색 필터는 이미 끝나 있다(페이지 몫). */
  places: Place[];
  /** 담긴 poiId 목록 — 하트 상태·"담음" 배지·CTA 숫자의 단일 출처. */
  savedPoiIds: string[];
  /** null = "전체" 칩 활성. */
  selectedCategory: PoiCategory | null;
  searchText: string;
  onSelectCategory: (category: PoiCategory | null) => void;
  onChangeSearchText: (text: string) => void;
  /** 담김/해제 판정은 페이지가 한다 — 화면은 "이 카드가 눌렸다"만 올린다. */
  onToggleSave: (place: Place) => void;
  onPressCreateTrip: () => void;
  /** 미지정이어도 화면은 그대로 동작한다(`StayRegisterScreen.tsx:62`와 같은 선택). */
  onBack?: () => void;
}

/** 칩 code는 셀렉터 전용 latin, 라벨·서버 질의값은 계약 enum 그대로(`regions.ts` 규칙 —
 * 한글 testID는 셀렉터가 취약해진다). `Record<PoiCategory, string>`이라 enum이 늘면 tsc가
 * 깨진다(전수 강제). */
const CATEGORY_CODES: Record<PoiCategory, string> = {
  명소: 'attraction',
  맛집: 'food',
  카페: 'cafe',
  야경: 'nightview',
  자연: 'nature',
  쇼핑: 'shopping',
  문화: 'culture',
};

const CATEGORY_CHIPS: {
  code: string;
  label: string;
  value: PoiCategory | null;
}[] = [
  { code: 'all', label: '전체', value: null },
  ...Object.values(PoiCategory).map((category) => ({
    code: CATEGORY_CODES[category],
    label: category,
    value: category,
  })),
];

function AppBar({ onBack }: { onBack?: () => void }): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-xs pb-sm pl-[10px] pr-lg">
      <Pressable
        testID="explore-places-back"
        accessibilityRole="button"
        onPress={onBack}
        className="h-10 w-10 items-center justify-center"
      >
        <BackChevronGlyph size={24} />
      </Pressable>
      <Text className="font-noto-bold text-[18px] font-bold text-ink">
        장소 탐색
      </Text>
    </View>
  );
}

function SearchBar({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (text: string) => void;
}): ReactElement {
  return (
    <View className="h-[52px] w-full flex-row items-center gap-sm rounded-pill border border-hairline-strong bg-canvas pl-lg pr-sm">
      <SearchGlyph size={20} />
      <TextInput
        testID="explore-places-search"
        value={value}
        onChangeText={onChangeText}
        placeholder="장소 · 명소 · 맛집 검색"
        className="flex-1 font-noto text-card-title text-ink placeholder:text-muted-soft"
      />
    </View>
  );
}

function CategoryChips({
  selected,
  onSelect,
}: {
  selected: PoiCategory | null;
  onSelect: (category: PoiCategory | null) => void;
}): ReactElement {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
    >
      {CATEGORY_CHIPS.map(({ code, label, value }) => {
        const isSelected = value === selected;
        return (
          <Pressable
            key={code}
            testID={`explore-places-category-${code}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(value)}
            className={
              isSelected
                ? 'rounded-pill bg-primary px-[15px] py-[9px]'
                : 'rounded-pill border border-hairline-strong bg-canvas px-[15px] py-[9px]'
            }
          >
            <Text
              className={
                isSelected
                  ? 'font-noto-bold text-label font-bold text-on-primary'
                  : 'font-noto-bold text-label font-bold text-ink'
              }
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** 정렬 칩 — 선택지가 아니라 **현재 정렬을 알리는 라벨**이다(01b Seed Q8: `savedCount`가
 * 계약의 유일한 정렬 재료라 "지금 뜨는 순"을 더해도 완전히 같은 순서가 된다). 그래서
 * `Pressable`이 아니라 `View`다 — 누를 수 있는 것 목록(AC-G1)에 걸리면 안 된다. */
function SortRow(): ReactElement {
  return (
    <View className="flex-row items-center gap-sm">
      <Text className="font-noto-bold text-caption font-bold text-muted-soft">
        정렬
      </Text>
      <View
        testID="explore-places-sort-saved"
        className="rounded-pill bg-primary-pale px-[13px] py-[7px]"
      >
        <Text className="font-noto-bold text-[12.5px] font-bold text-primary">
          요즘 담긴 순
        </Text>
      </View>
    </View>
  );
}

function PlaceCard({
  place,
  saved,
  onToggleSave,
}: {
  place: Place;
  saved: boolean;
  onToggleSave: (place: Place) => void;
}): ReactElement {
  const subtitle = place.region
    ? `${place.category} · ${place.region}`
    : place.category;

  return (
    <View
      testID={`explore-places-card-${place.poiId}`}
      className="w-[48%] gap-[7px]"
    >
      <View className="h-[132px] w-full overflow-hidden rounded-[14px] bg-surface-soft">
        {place.imageUrl ? (
          <Image
            source={{ uri: place.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        ) : null}
        {saved ? (
          <View className="absolute left-sm top-sm flex-row items-center gap-xs rounded-pill bg-primary pb-[5px] pl-[9px] pr-[11px] pt-[5px]">
            <HeartBadgeGlyph size={12} />
            <Text className="font-noto-bold text-micro font-bold text-on-primary">
              담음
            </Text>
          </View>
        ) : null}
        <Pressable
          testID={`explore-places-save-${place.poiId}`}
          accessibilityRole="button"
          accessibilityState={{ selected: saved }}
          onPress={() => onToggleSave(place)}
          className="absolute right-sm top-sm h-8 w-8 items-center justify-center rounded-pill bg-on-primary"
        >
          {saved ? (
            <HeartFilledGlyph size={18} />
          ) : (
            <HeartOutlineGlyph size={18} />
          )}
        </Pressable>
      </View>
      <Text className="font-noto-bold text-[13.5px] font-bold text-ink">
        {place.nameKo}
      </Text>
      <Text className="font-noto text-[11.5px] text-muted">{subtitle}</Text>
    </View>
  );
}

function CtaBar({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}): ReactElement {
  return (
    <View className="w-full border-t border-hairline bg-canvas px-lg pb-lg pt-md">
      <Pressable
        testID="explore-places-createtrip"
        accessibilityRole="button"
        onPress={onPress}
        className="h-[54px] w-full flex-row items-center justify-center gap-sm rounded-[14px] bg-primary"
      >
        <View className="h-6 w-6 items-center justify-center rounded-pill bg-on-primary">
          <Text className="font-inter-bold text-label font-bold text-primary">
            {count}
          </Text>
        </View>
        <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
          담은 장소로 여행 만들기
        </Text>
      </Pressable>
    </View>
  );
}

export function PlaceExploreScreen({
  places,
  savedPoiIds,
  selectedCategory,
  searchText,
  onSelectCategory,
  onChangeSearchText,
  onToggleSave,
  onPressCreateTrip,
  onBack,
}: PlaceExploreScreenProps): ReactElement {
  const savedSet = new Set(savedPoiIds);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View testID="explore-places-root" className="flex-1 bg-canvas">
        <AppBar onBack={onBack} />

        <FlatList<Place>
          testID="explore-places-grid"
          className="flex-1"
          data={places}
          keyExtractor={(place) => place.poiId}
          numColumns={2}
          columnWrapperStyle={{ justifyContent: 'space-between' }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
          ListHeaderComponent={
            <View className="gap-lg pb-lg">
              <SearchBar value={searchText} onChangeText={onChangeSearchText} />
              <CategoryChips
                selected={selectedCategory}
                onSelect={onSelectCategory}
              />
              <SortRow />
            </View>
          }
          renderItem={({ item }) => (
            <PlaceCard
              place={item}
              saved={savedSet.has(item.poiId)}
              onToggleSave={onToggleSave}
            />
          )}
        />

        {savedPoiIds.length > 0 ? (
          <CtaBar count={savedPoiIds.length} onPress={onPressCreateTrip} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
