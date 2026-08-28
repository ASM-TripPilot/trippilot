import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import type { Region } from '@/shared/api/generated/schemas';
import { StateNotice } from '@/shared/ui/StateNotice';

import { groupRegionsBySido, regionTint } from '../model/regions';
import type { RegionGroup } from '../model/regions';
import {
  BackChevronGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from './ExploreGlyphs';

/**
 * e00(숙소 지역 선택) · d1b(여행지 선택) 화면 — **props만 받는 프레젠테이션** (TRIP-445).
 *
 * BR-U1-07: 같은 컴포넌트가 목적 파라미터로 분기하고 **카피와 다음 목적지만 다르다**.
 * 다음 목적지는 화면 밖(컨테이너)이 정하므로 여기서 분기하는 것은 카피뿐이다.
 *
 * 서버 카탈로그(`Region`)를 그린다 — 카드는 세 갈래다:
 *  · `selectable && poiCount>0` → 누르면 선택되는 카드.
 *  · `selectable && poiCount===0` → "준비 중"(후보풀 빔, INV-1) — 보이되 선택 불가.
 *  · `selectable === false` → 도(道)·행정구 묶음 행 — 보이되 선택 불가.
 * 조회 실패(`isError`)는 빈 목록으로 뭉개지 않고 실패 얼굴로 그린다(INV-4).
 *
 * 빈 검색어에서는 **시/도→구/군 2단 드릴다운**으로 접는다(TRIP-597) — 인천광역시(시/도)와
 * 미추홀구(구/군)가 한 평면에 뒤섞이지 않게. 세 갈래 렌더 모드:
 *  · 검색 중(`query` 있음) → 드릴다운을 **우회**하고 페이지가 좁힌 결과를 평면 카드로.
 *  · 빈 검색어·미드릴인 → **1단**: 시/도 행(`explore-region-sido-{code}`)만, 누르면 드릴인.
 *  · 빈 검색어·드릴인 → **2단**: 그 시/도의 '전체' 행(SIDO Region) + 구/군 카드 + 상세 뒤로.
 * 드릴다운 상태(`openSidoCode`)는 화면 로컬 뷰 상태다 — 프롭 시그니처는 그대로다.
 *
 * ⚠️ `@/shared/api`·쿼리 훅·`expo-location`을 **전이 의존으로라도** 물면 안 된다 —
 * dev 프리뷰가 이 화면을 정적으로 그리고 `devPreview.test.tsx`의 지뢰 목이 즉시 터진다.
 * (그래서 `useRegions`가 아니라 `regionTint`만 model에서 가져온다 — 그 훅은 지연 로드된다.)
 */

export type RegionPurpose = 'stay' | 'trip';

export interface RegionPickerScreenProps {
  purpose: RegionPurpose;
  query: string;
  regions: readonly Region[];
  /** 페이지가 `useRegions().isPending`을 내린다 — 로딩과 빈 결과는 다른 얼굴이다(INV-4). */
  isLoading: boolean;
  /** 페이지가 `useRegions().isError`를 내린다 — 실패를 빈 목록으로 뭉개지 않는다(INV-4). */
  isError: boolean;
  onChangeQuery(next: string): void;
  onSelectRegion(region: Region): void;
  /** 에러 얼굴의 "다시 시도" → 페이지의 `refetch`. */
  onRetry(): void;
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

/** 선택 가능·후보풀 있음 지역 카드 — 누르면 선택된다. */
function SelectableCard({
  region,
  onPress,
}: {
  region: Region;
  onPress(): void;
}): ReactElement {
  const [from, to] = regionTint(region.regionCode);
  return (
    <Pressable
      testID={`explore-region-${region.regionCode}`}
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

/** poiCount===0 지역 카드 — 후보풀이 비어 "준비 중"(INV-1). 비-Pressable이라 눌러도 선택 안 됨. */
function ComingSoonCard({ region }: { region: Region }): ReactElement {
  const [from, to] = regionTint(region.regionCode);
  return (
    <View
      testID={`explore-region-${region.regionCode}`}
      className="mb-md w-[48%] overflow-hidden rounded-card bg-canvas opacity-50"
    >
      <LinearGradient
        colors={[from, to]}
        style={{ height: 116, width: '100%' }}
      />
      <View className="px-sm py-sm">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {region.name}
        </Text>
        <Text className="mt-xs font-noto text-label text-muted">준비 중</Text>
      </View>
    </View>
  );
}

/** selectable=false 묶음 행(도·행정구) — 목적지가 아니라 묶음 표시용. 보이되 선택 불가. */
function GroupRow({ region }: { region: Region }): ReactElement {
  return (
    <View
      testID={`explore-region-${region.regionCode}`}
      className="mb-md w-full rounded-card bg-surface-soft px-md py-3"
    >
      <Text className="font-noto-medium text-label text-muted">
        {region.name}
      </Text>
    </View>
  );
}

function RegionCard({
  region,
  onSelect,
}: {
  region: Region;
  onSelect(): void;
}): ReactElement {
  if (region.selectable === false) {
    return <GroupRow region={region} />;
  }
  if (region.poiCount === 0) {
    return <ComingSoonCard region={region} />;
  }
  return <SelectableCard region={region} onPress={onSelect} />;
}

/** 카드 그리드 — 검색 결과·드릴다운 상세가 공유한다(세 갈래 RegionCard 를 2열로). */
function RegionGrid({
  regions,
  onSelectRegion,
}: {
  regions: readonly Region[];
  onSelectRegion(region: Region): void;
}): ReactElement {
  return (
    <View className="flex-row flex-wrap justify-between">
      {regions.map((region) => (
        <RegionCard
          key={region.regionCode}
          region={region}
          onSelect={() => onSelectRegion(region)}
        />
      ))}
    </View>
  );
}

/**
 * 1단 시/도 행 — 누르면 그 시/도로 드릴인한다(선택이 아니라 탐색, ★4). 라벨은 `sidoName`이라
 * SIDO 행이 카탈로그에 없어도(방어) 산다. 오른쪽 셰브론은 뒤로가기 셰브론을 가로로 뒤집어 쓴다.
 */
function SidoRow({
  group,
  onOpen,
}: {
  group: RegionGroup;
  onOpen(): void;
}): ReactElement {
  return (
    <Pressable
      testID={`explore-region-sido-${group.sidoCode}`}
      onPress={onOpen}
      className="mb-sm flex-row items-center justify-between rounded-card border border-hairline-strong bg-canvas px-md py-3"
    >
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {group.sidoName}
      </Text>
      <View style={{ transform: [{ scaleX: -1 }] }}>
        <BackChevronGlyph size={18} />
      </View>
    </Pressable>
  );
}

/**
 * 2단 상세 — 최상단 '전체' 행(그 시/도의 SIDO Region) + 하위 구/군 카드. '전체' 행은 기존
 * `RegionCard` 3갈래를 그대로 탄다: selectable=true 면 선택 카드('인천 전체' 선택 가능),
 * false 면 묶음 행(선택 불가). 상세 뒤로(`explore-region-drilldown-back`)는 1단 복귀지
 * 라우터 이탈이 아니다(앱바 뒤로와 분리, ★3).
 */
function RegionDetail({
  group,
  onBack,
  onSelectRegion,
}: {
  group: RegionGroup;
  onBack(): void;
  onSelectRegion(region: Region): void;
}): ReactElement {
  const sido = group.sido;
  return (
    <View>
      <Pressable
        testID="explore-region-drilldown-back"
        onPress={onBack}
        hitSlop={8}
        className="mb-md flex-row items-center gap-xs"
      >
        <BackChevronGlyph size={18} />
        <Text className="font-noto-medium text-body text-muted">지역 목록</Text>
      </Pressable>

      <Text className="mb-sm font-noto-bold text-card-title font-bold text-ink">
        {group.sidoName} 전체
      </Text>

      <View className="flex-row flex-wrap justify-between">
        {sido !== null && (
          <RegionCard region={sido} onSelect={() => onSelectRegion(sido)} />
        )}
        {group.sigungu.map((region) => (
          <RegionCard
            key={region.regionCode}
            region={region}
            onSelect={() => onSelectRegion(region)}
          />
        ))}
      </View>
    </View>
  );
}

export function RegionPickerScreen({
  purpose,
  query,
  regions,
  isLoading,
  isError,
  onChangeQuery,
  onSelectRegion,
  onRetry,
  onBack,
}: RegionPickerScreenProps): ReactElement {
  const copy = COPY[purpose];

  // 드릴인한 시/도 코드(뷰 상태) — null 이면 1단(시/도 행 목록). 검색 중이면 무시한다.
  const [openSidoCode, setOpenSidoCode] = useState<string | null>(null);
  const isSearching = query.trim() !== '';
  const groups = isSearching ? [] : groupRegionsBySido(regions);
  // 드릴인했지만 그 그룹이 사라졌으면(검색 등으로 목록이 바뀜) 1단으로 방어 복귀한다.
  const detail =
    openSidoCode === null
      ? undefined
      : groups.find((group) => group.sidoCode === openSidoCode);

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

        <Text className="mb-md mt-2xl font-noto-bold text-section font-bold text-ink">
          {copy.section}
        </Text>

        {isError ? (
          <StateNotice
            testID="explore-region-error"
            icon={<WarningTriangleGlyph tone="primary" />}
            title="지역을 불러오지 못했어요"
            description="잠시 후 다시 시도해 주세요"
            actions={[
              {
                testID: 'explore-region-error-retry',
                label: '다시 시도',
                variant: 'filled',
                onPress: onRetry,
              },
            ]}
          />
        ) : isLoading ? (
          <View
            testID="explore-region-loading"
            className="flex-row flex-wrap justify-between"
          >
            {[0, 1, 2, 3].map((slot) => (
              <View
                key={slot}
                className="mb-md h-[152px] w-[48%] rounded-card bg-surface-soft"
              />
            ))}
          </View>
        ) : regions.length === 0 ? (
          <Text className="mt-lg text-center font-noto text-body text-muted">
            검색 결과가 없어요
          </Text>
        ) : isSearching ? (
          // 검색 모드: 드릴다운을 우회하고 페이지가 좁힌 결과를 평면 카드로.
          <RegionGrid regions={regions} onSelectRegion={onSelectRegion} />
        ) : detail !== undefined ? (
          // 2단 상세: 그 시/도의 '전체' 행 + 구/군 카드.
          <RegionDetail
            group={detail}
            onBack={() => setOpenSidoCode(null)}
            onSelectRegion={onSelectRegion}
          />
        ) : (
          // 1단: 시/도 행 목록(구/군은 접힘).
          <View>
            {groups.map((group) => (
              <SidoRow
                key={group.sidoCode}
                group={group}
                onOpen={() => setOpenSidoCode(group.sidoCode)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
