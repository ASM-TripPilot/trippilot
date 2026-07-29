/**
 * e02 숙소 검색 결과 · default 프레젠테이션 화면 (Figma 1837:2283 · US-STAY-01).
 * `region`·`items` 2개 prop만 받는다 — 네트워크·라우팅을 전혀 모른다(FSD 경계, 배선은
 * `pages/stay-search/ui/StaySearchPage.tsx`가 진다). 서버가 준 `items` 순서를 그대로 그리고
 * (BR-U1-15), 소요 시간은 어디에도 없으며(INV-3 · BR-U1-54), 필터 칩·저장 하트는 눌러도
 * 아무것도 바뀌지 않는 정직한 스텁이다(01b Seed Q5·Q9 — 저장 API·필터 파라미터가 아직 없다).
 */
import type { ReactElement } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { BottomTabBar } from '@/shared/ui/BottomTabBar';

import { formatPrice } from '../model/formatPrice';
import { stayKey } from '../model/stayKey';
import {
  BackChevronGlyph,
  ChevronDownGlyph,
  FilterSlidersGlyph,
  HeartOutlineGlyph,
} from './StayGlyphs';

export interface StaySearchScreenProps {
  region: string;
  items: StayItem[];
}

// 카드 그림자(브리프 §4-2 명시 raw 허용 — 그림자는 토큰 대상이 아니다, HomeScreen.tsx
// heroCardShadow와 동형). #000000은 토큰화된 7색 목록 밖이라 V1 가드 대상이 아니다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

const FILTER_CHIPS: { axis: 'price' | 'region' | 'more'; label: string }[] = [
  { axis: 'price', label: '가격대' },
  { axis: 'region', label: '지역' },
  { axis: 'more', label: '필터' },
];

function AppBar(): ReactElement {
  return (
    <View
      testID="stay-search-appbar"
      className="h-14 w-full flex-row items-center gap-xs bg-canvas pl-sm pr-lg"
    >
      <Pressable
        testID="stay-search-back"
        accessibilityRole="button"
        onPress={undefined}
        className="h-10 w-10 items-center justify-center"
      >
        <BackChevronGlyph size={24} />
      </Pressable>
      <Text className="font-noto-bold text-section font-bold text-ink">
        숙소 검색 결과
      </Text>
    </View>
  );
}

function FilterChip({
  axis,
  label,
}: {
  axis: 'price' | 'region' | 'more';
  label: string;
}): ReactElement {
  return (
    <Pressable
      testID={`stay-search-filter-${axis}`}
      accessibilityRole="button"
      onPress={undefined}
      className="flex-row items-center gap-xs rounded-pill border border-hairline-strong bg-canvas px-md py-sm"
    >
      <Text className="font-noto text-body text-body">{label}</Text>
      {axis === 'more' ? (
        <FilterSlidersGlyph size={14} />
      ) : (
        <ChevronDownGlyph size={14} />
      )}
    </Pressable>
  );
}

function ListHeader({
  region,
  count,
}: {
  region: string;
  count: number;
}): ReactElement {
  return (
    <View className="w-full gap-[14px] px-lg pb-xl pt-[6px]">
      <Text
        testID="stay-search-header"
        className="font-noto text-label text-muted"
      >
        {region} · 날짜 미정 · {count}곳
      </Text>
      <View className="flex-row gap-sm">
        {FILTER_CHIPS.map(({ axis, label }) => (
          <FilterChip key={axis} axis={axis} label={label} />
        ))}
      </View>
    </View>
  );
}

function StayCard({ item }: { item: StayItem }): ReactElement {
  const key = stayKey(item);
  return (
    <View
      testID={`stay-card-${key}`}
      style={cardShadow}
      className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      <View
        testID={`stay-card-photo-${key}`}
        className="h-[178px] w-full bg-surface-strong"
      >
        <Pressable
          testID={`stay-card-save-${key}`}
          accessibilityRole="button"
          onPress={undefined}
          className="absolute right-[32px] top-[14px] h-[28px] w-[30px] items-center justify-center"
        >
          <HeartOutlineGlyph size={22} />
        </Pressable>
      </View>
      <View className="w-full gap-xs px-[14px] pb-[14px] pt-md">
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          {item.name}
        </Text>
        <Text className="font-noto text-label text-muted">{item.region}</Text>
        <Text className="font-inter-bold text-[16px] font-bold text-ink">
          {formatPrice(item.price)}
        </Text>
      </View>
    </View>
  );
}

export function StaySearchScreen({
  region,
  items,
}: StaySearchScreenProps): ReactElement {
  return (
    <View testID="stay-search-root" className="flex-1 bg-canvas">
      <AppBar />

      <FlatList<StayItem>
        testID="stay-search-list"
        className="flex-1"
        data={items}
        keyExtractor={(item) => stayKey(item)}
        ListHeaderComponent={
          <ListHeader region={region} count={items.length} />
        }
        renderItem={({ item }) => (
          <View className="w-full px-lg">
            <StayCard item={item} />
          </View>
        )}
        ItemSeparatorComponent={() => <View className="h-lg" />}
        ListFooterComponent={<View className="h-10" />}
      />

      <BottomTabBar activeKey="explore" onPressTab={() => {}} />

      <Pressable
        testID="stay-search-fab"
        accessibilityRole="button"
        onPress={undefined}
        className="absolute bottom-[104px] right-lg h-[52px] items-center justify-center rounded-pill bg-primary px-xl"
      >
        <Text className="font-noto-bold text-card-title font-bold text-on-primary">
          ＋ 여행 만들기
        </Text>
      </Pressable>
    </View>
  );
}
