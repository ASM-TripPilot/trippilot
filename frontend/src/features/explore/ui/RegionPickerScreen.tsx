import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import type { Region, RegionCode } from '../model/regions';
import {
  BackChevronGlyph,
  InfoGlyph,
  NearbyPinGlyph,
  SearchGlyph,
} from './ExploreGlyphs';

/**
 * e00(숙소 지역 선택) · d1b(여행지 선택) 화면 — **props만 받는 프레젠테이션**.
 *
 * BR-U1-07: 같은 컴포넌트가 목적 파라미터로 분기하고 **카피와 다음 목적지만 다르다**.
 * 다음 목적지는 화면 밖(컨테이너)이 정하므로 여기서 분기하는 것은 카피뿐이다.
 *
 * ⚠️ `@/shared/api`·쿼리 훅·`expo-location`을 **전이 의존으로라도** 물면 안 된다 —
 * dev 프리뷰가 이 화면을 정적으로 그리고 `devPreview.test.tsx`의 지뢰 목이 즉시 터진다.
 */

export type RegionPurpose = 'stay' | 'trip';

export type NearbyState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'fallback' }
  | { kind: 'unavailable'; reason: 'denied-no-fallback' | 'position-failed' };

export interface RegionPickerScreenProps {
  purpose: RegionPurpose;
  query: string;
  regions: readonly Region[];
  nearby: NearbyState;
  onChangeQuery(next: string): void;
  onSelectRegion(region: Region): void;
  onSelectNearby(): void;
  onBack(): void;
}

/** Figma e00·d1b 실측 카피. 두 화면의 차이는 이 표가 전부다(BR-U1-07). */
const COPY: Record<
  RegionPurpose,
  {
    appBar: string;
    title: string;
    subtitle: string;
    placeholder: string;
    section: string;
  }
> = {
  stay: {
    appBar: '지역 선택',
    title: '어디서 묵을까요?',
    subtitle: '지역을 고르면 숙소를 모아 보여드려요',
    placeholder: '지역·숙소 이름 검색',
    section: '지역별 숙소',
  },
  trip: {
    appBar: '여행지 선택',
    title: '어디로 떠날까요?',
    subtitle: '가고 싶은 도시를 먼저 골라요',
    placeholder: '도시·지역 검색',
    section: '인기 여행지',
  },
};

/**
 * 지역 사진 자리 — 리포에 이미지 에셋이 0건이라(실측) 그라데이션으로 대체한다.
 * 지역별로 색을 달리해 카드가 구별되게만 한다. 사진이 들어오면 이 상수를 지우고 <Image>로 바꾼다.
 */
const REGION_TINT: Record<RegionCode, [string, string]> = {
  busan: ['#4A90D9', '#2B5F9E'],
  gyeongju: ['#C98A3E', '#8A5A22'],
  seoul: ['#6E7B8B', '#3F4A57'],
  jeju: ['#4FA97F', '#2C7355'],
  gangneung: ['#5C8FA8', '#33606F'],
  yeosu: ['#7A6BB5', '#4A3E7A'],
};

/** 대체·실패 고지 문구. Figma i21(1790:3549)의 "현재 위치 대신 등록 숙소를 기준으로 …"를 차용. */
function noticeText(nearby: NearbyState): string | null {
  switch (nearby.kind) {
    case 'locating':
      return '현재 위치를 확인하는 중';
    case 'fallback':
      return '현재 위치 대신 등록 숙소를 기준으로 찾았어요';
    case 'unavailable':
      return nearby.reason === 'denied-no-fallback'
        ? '위치 권한이 꺼져 있고 등록한 숙소도 없어요. 지역을 골라 주세요'
        : '현재 위치를 확인하지 못했어요. 지역을 골라 주세요';
    case 'idle':
      return null;
  }
}

function RegionCard({
  region,
  onPress,
}: {
  region: Region;
  onPress(): void;
}): ReactElement {
  const [from, to] = REGION_TINT[region.code];
  return (
    <Pressable
      testID={`explore-region-${region.code}`}
      onPress={onPress}
      className="mb-md w-[48%] overflow-hidden rounded-card bg-canvas"
    >
      <LinearGradient
        colors={[from, to]}
        style={{ height: 116, width: '100%' }}
      />
      <View className="px-sm py-sm">
        {/* 집계(숙소 수·최저가)는 계약이 없어 생략한다 — US-EXPL-02 예외항이
            "카드는 유지하고 집계 값만 생략한다"로 이 경우를 이미 정해 뒀다. */}
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {region.name}
        </Text>
      </View>
    </Pressable>
  );
}

export function RegionPickerScreen({
  purpose,
  query,
  regions,
  nearby,
  onChangeQuery,
  onSelectRegion,
  onSelectNearby,
  onBack,
}: RegionPickerScreenProps): ReactElement {
  const copy = COPY[purpose];
  const notice = noticeText(nearby);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View className="flex-row items-center gap-sm px-lg py-sm">
        <Pressable testID="explore-region-back" onPress={onBack} hitSlop={8}>
          <BackChevronGlyph />
        </Pressable>
        <Text className="font-noto-bold text-section font-bold text-ink">
          {copy.appBar}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mt-sm font-noto-bold text-hero font-bold text-ink">
          {copy.title}
        </Text>
        <Text className="mt-xs font-noto text-body text-muted">
          {copy.subtitle}
        </Text>

        <View className="mt-lg flex-row items-center gap-sm rounded-pill border border-hairline-strong px-md py-3">
          <SearchGlyph />
          <TextInput
            testID="explore-region-search"
            value={query}
            onChangeText={onChangeQuery}
            placeholder={copy.placeholder}
            placeholderTextColor="#9AA1AB"
            className="flex-1 font-noto text-body text-ink"
          />
        </View>

        {/* '내 주변'은 숙소 탐색 전용 진입이다(US-STAY-01). 여행지 선택에 끌고 오면 범위가 샌다.
            Figma 밴드 e에 이 진입점이 없어 이 칸에서 신설했다 — 브리프 §2-2. */}
        {purpose === 'stay' ? (
          <Pressable
            testID="explore-region-nearby"
            onPress={onSelectNearby}
            className="mt-sm flex-row items-center gap-sm rounded-card border border-hairline px-md py-3"
          >
            <NearbyPinGlyph />
            <Text className="font-noto-medium text-body text-ink">내 주변</Text>
          </Pressable>
        ) : null}

        {notice ? (
          <View
            testID="explore-region-notice"
            className="mt-sm flex-row items-start gap-sm rounded-card bg-surface-soft px-md py-3"
          >
            <InfoGlyph />
            <Text className="flex-1 font-noto text-label text-muted">
              {notice}
            </Text>
          </View>
        ) : null}

        <Text className="mb-md mt-2xl font-noto-bold text-section font-bold text-ink">
          {copy.section}
        </Text>

        {regions.length === 0 ? (
          <Text className="mt-lg text-center font-noto text-body text-muted">
            검색 결과가 없어요
          </Text>
        ) : (
          <View className="flex-row flex-wrap justify-between">
            {regions.map((region) => (
              <RegionCard
                key={region.code}
                region={region}
                onPress={() => onSelectRegion(region)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
