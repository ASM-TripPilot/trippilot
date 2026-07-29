/**
 * e02 숙소 검색 결과 · 프레젠테이션 화면(Figma 1837:2283 default · 1340:1312~1344:1416
 * 상태 5종 · US-STAY-01·10·11). `region`·`items`·`state`·`onRetry` 4개 prop만 받는다 —
 * 네트워크·라우팅을 전혀 모른다(FSD 경계, 배선·상태 판정은 `pages/stay-search/ui/
 * StaySearchPage.tsx`가 진다). `state`는 옵셔널이고 기본값이 TRIP-181 default 얼굴이라
 * 기존 2-prop 호출은 한 글자도 바뀌지 않는다. 서버가 준 `items` 순서를 그대로 그리고
 * (BR-U1-15), 소요 시간은 어디에도 없으며(INV-3 · BR-U1-54), 필터 칩·저장 하트·목적지 없는
 * 완화/등록 버튼은 눌러도 아무것도 바뀌지 않는 정직한 스텁이다(Q7·Q9 — 저장 API·필터
 * 파라미터·등록 라우트가 아직 없다). `다시 시도`만 `onRetry`(=`refetch`)에 실배선된다(Q8).
 */
import type { ReactElement } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { StayItem } from '@/shared/api/generated/schemas';
import { BottomTabBar } from '@/shared/ui/BottomTabBar';

import { filterReasonLabel } from '../model/filterReasonLabel';
import { formatPrice } from '../model/formatPrice';
import type { StaySearchState } from '../model/staySearchState';
import { stayKey } from '../model/stayKey';
import { PartialFailureBanner } from './PartialFailureBanner';
import { SkeletonList } from './SkeletonList';
import { StateNotice } from './StateNotice';
import {
  BackChevronGlyph,
  ChevronDownGlyph,
  ChevronRightGlyph,
  FilterSlidersGlyph,
  HeartOutlineGlyph,
  MapPinGlyph,
  PlusGlyph,
  WarningTriangleGlyph,
} from './StayGlyphs';

export interface StaySearchScreenProps {
  region: string;
  items: StayItem[];
  /** 기본값 { kind: 'results', degraded: false } — TRIP-181 default 얼굴(AC-9 회귀 보호). */
  state?: StaySearchState;
  /** partial 배너·error 재시도의 콜백(Q8). 미지정이면 정직한 스텁. */
  onRetry?: () => void;
}

// 카드 그림자(브리프 §4-2 명시 raw 허용 — 그림자는 토큰 대상이 아니다, HomeScreen.tsx
// heroCardShadow와 동형). #000000은 토큰화된 색 목록 밖이라 V1 가드 대상이 아니다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

// `FlatList` 콘텐츠 컨테이너를 화면 잔여 높이까지 늘린다(§6 함정 1, 03b W-2) — 카드가
// 화면보다 짧을 때만 효과가 있고, 카드 자체는 top-align을 유지한다(중앙정렬은 `ListEmptyBlock`
// 래퍼 몫이라 여기선 `flexGrow`만 준다).
const listContentStyle = { flexGrow: 1 } as const;

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

/** 서브헤더 — `showCount`는 `state.kind`에서 파생한다(loading·error엔 개수가 없다, §2-6). */
function ListHeader({
  region,
  count,
  showCount,
}: {
  region: string;
  count: number;
  showCount: boolean;
}): ReactElement {
  return (
    <View className="w-full gap-[14px] px-lg pb-xl pt-[6px]">
      <Text
        testID="stay-search-header"
        className="font-noto text-label text-muted"
      >
        {region} · 날짜 미정{showCount ? ` · ${count}곳` : ''}
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

/** 점선 박스 밖, 구분선 아래 수동 등록 유도 카드(AC-3 · US-STAY-10 예외 → US-STAY-08 연결). */
function RegisterPromptCard(): ReactElement {
  return (
    <Pressable
      testID="stay-search-register"
      accessibilityRole="button"
      onPress={undefined}
      className="w-full flex-row items-center gap-[14px] px-lg pb-lg"
    >
      <View className="h-10 w-10 items-center justify-center rounded-pill bg-primary-pale">
        <PlusGlyph size={22} />
      </View>
      <View className="flex-1 gap-xs">
        <Text className="font-noto-bold text-[14px] font-bold text-ink">
          이미 예약한 숙소가 있나요?
        </Text>
        <Text className="font-noto text-caption text-muted">
          OTA에 없어도 위치 · 이름으로 직접 등록
        </Text>
      </View>
      <ChevronRightGlyph size={20} />
    </Pressable>
  );
}

/** empty(AC-2·AC-3) — 점선 안내 박스 + 구분선 + 수동 등록 카드(박스 밖 별도 형제). */
function EmptyBlock(): ReactElement {
  return (
    <View className="w-full gap-lg">
      {/* `px-lg`는 StateNotice **안쪽** 여백(내용물 오프셋)이라 점선 테두리를 못 민다 —
       * 테두리 자체를 아래 구분선·등록카드처럼 화면 좌우에서 16px 띄우려면 바깥에
       * 한 겹 더 감싸야 한다(03b W-1, Figma 1341:1338 x=16·width=358 실측). */}
      <View className="px-lg">
        <StateNotice
          testID="stay-search-empty"
          dashed
          icon={<MapPinGlyph size={32} />}
          title="조건에 맞는 숙소가 없어요"
          description="지역이나 필터를 바꿔 다시 찾아보세요"
          actions={[
            {
              testID: 'stay-search-empty-region',
              label: '지역 바꾸기',
              variant: 'outline',
            },
            {
              testID: 'stay-search-empty-filter',
              label: '필터 완화',
              variant: 'outline',
            },
          ]}
        />
      </View>
      <View className="px-lg">
        <View className="h-[1px] w-full bg-hairline" />
      </View>
      <RegisterPromptCard />
    </View>
  );
}

/** filter-zero(AC-4) — `StateNotice`를 감싸는 얇은 래퍼(01b Seed §1 정본 이름). 자체
 * 마크업은 없고, 필터명 변환(`filterReasonLabel`)과 곡선 따옴표 문구만 조립한다. */
function FilterZeroNotice({ reasons }: { reasons: string[] }): ReactElement {
  // `reasons[0]`은 타입상 `string`이지만 빈 배열이면 실제로는 `undefined`다(03b W-4) —
  // `?? ''`로 크래시만 막는다. 빈 배열 자체를 막는 타입 좁히기는 동결 테스트(reasons:
  // string[])의 tsc를 깨뜨려 별도 사이클이다(게이트② 미룸 항목).
  const label = filterReasonLabel(reasons[0] ?? '');
  return (
    <StateNotice
      testID="stay-search-filterzero"
      icon={<FilterSlidersGlyph size={32} />}
      title={`‘${label}’ 필터가 0건을 만들었어요`}
      description="필터를 해제하면 더 많은 숙소를 볼 수 있어요"
      actions={[
        {
          testID: 'stay-search-filterzero-clear',
          label: `‘${label}’ 필터 해제`,
          variant: 'outline',
        },
        {
          testID: 'stay-search-filterzero-reset',
          label: '필터 초기화',
          variant: 'link',
        },
      ]}
    />
  );
}

/** error(AC-7) — 이 상태만 1차 버튼이 채움(filled)이다. */
function ErrorNotice({ onRetry }: { onRetry?: () => void }): ReactElement {
  return (
    <StateNotice
      testID="stay-search-error"
      icon={<WarningTriangleGlyph size={32} tone="primary" />}
      title="지금 숙소 정보를 불러올 수 없어요"
      description="잠시 후 다시 시도해 주세요"
      actions={[
        {
          testID: 'stay-search-error-retry',
          label: '다시 시도',
          variant: 'filled',
          onPress: onRetry,
        },
        {
          testID: 'stay-search-error-register',
          label: '숙소 직접 등록',
          variant: 'outline',
        },
      ]}
    />
  );
}

/** `FlatList`의 `ListEmptyComponent` — `data=[]`일 때만 그려진다(RNTL 실측, 03b가 "M9"로 부른
 * 관찰이지 §6 함정 1이 아니다 — 이전 주석의 인용 번호가 틀렸었다). `state.kind` 4갈래를 안내
 * 하나로 매핑하고, 'results'(items=[] 직접 지정 조합)는 null이다.
 *
 * loading을 뺀 나머지 3종(empty·filter-zero·error)은 `flex-1`+중앙정렬 `View`로 한 번 더
 * 감싼다 — **이게 진짜 §6 함정 1**이다: `FlatList`의 `contentContainerStyle`은 기본값에
 * `flexGrow`가 없어서, 안내 블록이 남은 화면 높이를 차지하지 못하고 필터 칩 바로 아래
 * 상단 붙임으로 그려졌다(03b W-2). 아래 `FlatList`의 `contentContainerStyle={{flexGrow:1}}`과
 * 짝을 이뤄야 실제로 중앙에 온다 — 하나만 있으면 효과가 없다. */
function ListEmptyBlock({
  state,
  onRetry,
}: {
  state: StaySearchState;
  onRetry?: () => void;
}): ReactElement | null {
  if (state.kind === 'loading') return <SkeletonList />;
  if (state.kind === 'results') return null;

  const notice =
    state.kind === 'error' ? (
      <ErrorNotice onRetry={onRetry} />
    ) : state.kind === 'filter-zero' ? (
      <FilterZeroNotice reasons={state.reasons} />
    ) : (
      <EmptyBlock />
    );

  return (
    <View className="w-full flex-1 items-center justify-center">{notice}</View>
  );
}

export function StaySearchScreen({
  region,
  items,
  state = { kind: 'results', degraded: false },
  onRetry,
}: StaySearchScreenProps): ReactElement {
  // loading·error엔 'degraded'가 없다 — `in` 좁히기로 판별 유니온을 안전하게 읽는다.
  const degraded = 'degraded' in state ? state.degraded : false;
  const showCount = state.kind !== 'loading' && state.kind !== 'error';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="stay-search-root" className="flex-1 bg-canvas">
        <AppBar />

        <FlatList<StayItem>
          testID="stay-search-list"
          className="flex-1"
          contentContainerStyle={listContentStyle}
          data={items}
          keyExtractor={(item) => stayKey(item)}
          ListHeaderComponent={
            <>
              <ListHeader
                region={region}
                count={items.length}
                showCount={showCount}
              />
              {degraded ? (
                <View className="px-lg pb-lg">
                  <PartialFailureBanner onRetry={onRetry} />
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <ListEmptyBlock state={state} onRetry={onRetry} />
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
    </SafeAreaView>
  );
}
