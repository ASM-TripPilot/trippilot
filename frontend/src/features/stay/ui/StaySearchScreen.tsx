/**
 * e02 숙소 검색 결과 · 프레젠테이션 화면(Figma 1837:2283 default · 1340:1312~1344:1416
 * 상태 5종 · US-STAY-01·10·11). `region`·`items`·`state`·`onRetry` 4개 prop만 받는다 —
 * 네트워크·라우팅을 전혀 모른다(FSD 경계, 배선·상태 판정은 `pages/stay-search/ui/
 * StaySearchPage.tsx`가 진다). `state`는 옵셔널이고 기본값이 TRIP-181 default 얼굴이라
 * 기존 2-prop 호출은 한 글자도 바뀌지 않는다. 서버가 준 `items` 순서를 그대로 그리고
 * (BR-U1-15), 소요 시간은 어디에도 없다(INV-3 · BR-U1-54). 세 필터 칩은 화면 층에선 모두
 * 동일하게 `onPressFilter(axis)`로 배선된다(TRIP-415) — 가격대가 "스텁"인 것은 화면이 아니라
 * **페이지**가 'price' axis 를 무시해서 실현된다(계약에 가격대 파라미터가 없다 — 범위 밖).
 * 저장 하트는 옵셔널 prop 3개(`savedKeys`·`onToggleSave`·`pendingKeys`)로 채움/빈·누름·
 * 대기(disabled)를 그리되 저장/해제 판정·네트워크는 모른다(TRIP-417, 미지정=빈 하트 무회귀).
 * `다시 시도`는 `onRetry`(=`refetch`)에 실배선된다(Q8).
 */
import type { ReactElement } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { StayItem } from '@/shared/api/generated/schemas';
import { BottomTabBar, type ShellTabKey } from '@/shared/ui/BottomTabBar';
import { StateNotice, type StateNoticeAction } from '@/shared/ui/StateNotice';

import { filterReasonLabel } from '../model/filterReasonLabel';
import { formatPrice } from '../model/formatPrice';
import type { StaySearchState } from '../model/staySearchState';
import { stayKey } from '../model/stayKey';
import { PartialFailureBanner } from './PartialFailureBanner';
import { SkeletonList } from './SkeletonList';
import {
  BackChevronGlyph,
  ChevronDownGlyph,
  ChevronRightGlyph,
  FilterSlidersGlyph,
  HeartFilledGlyph,
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
  /** 수동 등록 유도(empty·error) 콜백(01b Seed §3-6 — e05로 가는 문). 미지정이면 정직한
   * 스텁이라 기존 2-prop 호출이 깨지지 않는다. */
  onPressRegister?: () => void;
  /** 앱바 뒤로가기 콜백. 목적지는 페이지가 정한다(화면은 라우터를 모른다). 미지정이면
   * 정직한 스텁. */
  onPressBack?: () => void;
  /** 하단 탭바 탭 콜백(TRIP-413). 누른 탭의 key 가 그대로 온다 — 라우팅은 페이지 몫이다.
   * 미지정이면 정직한 스텁이라 기존 2-prop 호출이 안 깨진다. */
  onPressTab?: (key: ShellTabKey) => void;
  /** FAB "여행 만들기" 콜백(TRIP-414). 목적지(/trips/new/step1)는 페이지가 정한다.
   * 미지정이면 정직한 스텁. */
  onPressCreateTrip?: () => void;
  /** 지역·필터 칩 콜백(TRIP-415). 누른 칩의 axis 가 온다 — 지역 재선택·필터 시트는 페이지 몫.
   * 미지정이면 정직한 스텁(가격대 칩은 페이지가 axis 를 무시해 스텁으로 남는다). */
  onPressFilter?: (axis: 'price' | 'region' | 'more') => void;
  /** 적용된 필터 개수(TRIP-415) — '필터' 칩에 배지로 드러낸다(0이면 배지 없음). empty 카드의
   * "필터 완화" 조건부 렌더에도 쓰인다(TRIP-416 AC-3, `=== 0`일 때만 숨김). */
  activeFilterCount?: number;
  /** empty 카드 "지역 바꾸기" 콜백(TRIP-416 AC-1). 목적지(/explore/region)는 페이지가 정한다.
   * 미지정이면 정직한 스텁. */
  onPressChangeRegion?: () => void;
  /** empty "필터 완화"·filter-zero "필터 초기화" 공용 콜백(TRIP-416 AC-2·AC-4) — 적용필터 전체
   * 해제. 미지정이면 정직한 스텁. */
  onRelaxFilters?: () => void;
  /** filter-zero "'{원인}' 필터 해제" 콜백(TRIP-416 AC-5) — 원인 코드(reasons[0]) 문자열을 받는다.
   * 미지정이면 정직한 스텁. */
  onClearCulpritFilter?: (reason: string) => void;
  /** 담김 상태 키 집합(TRIP-417 AC-3) — 든 카드는 찬 하트(+selected), 나머지는 빈 하트.
   * 미지정=빈=전부 빈 하트(기존 2-prop 무회귀 — 저장 API 없이 채워진 하트는 거짓말). */
  savedKeys?: string[];
  /** 하트 누름 콜백(TRIP-417 AC-1·AC-2) — 눌린 item을 그대로 올린다(저장/해제 판정은 페이지 몫).
   * 미지정=`onPress` 실질 무동작(정직한 스텁). */
  onToggleSave?: (item: StayItem) => void;
  /** 응답 대기 중 키 집합(TRIP-417 AC-8) — 든 하트는 `disabled`(연타 중복 요청 차단).
   * 미지정=빈=전부 활성. */
  pendingKeys?: string[];
  /** 카드 본문 탭 콜백(TRIP-420 AC-1) — 눌린 item을 그대로 올린다. 목적지(상세 라우트)는
   * 페이지가 정한다(화면은 라우터를 모른다). 미지정=정직한 스텁(카드 press가 무동작). */
  onPressCard?: (item: StayItem) => void;
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

function AppBar({ onPress }: { onPress?: () => void }): ReactElement {
  return (
    <View
      testID="stay-search-appbar"
      className="h-14 w-full flex-row items-center gap-xs bg-canvas pl-sm pr-lg"
    >
      <Pressable
        testID="stay-search-back"
        accessibilityRole="button"
        onPress={onPress}
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
  count,
  onPress,
}: {
  axis: 'price' | 'region' | 'more';
  label: string;
  /** '필터'(more) 칩 배지용 적용 개수 — >0일 때만 배지를 그린다. */
  count?: number;
  onPress?: () => void;
}): ReactElement {
  const showBadge = axis === 'more' && (count ?? 0) > 0;
  // 가격대는 계약(GET /stays/search)에 파라미터가 없어 아직 동작하지 않는다 — 준비중으로
  // 정직하게 표기한다. 무동작 소유권이 페이지(axis 무시)에서 화면으로 옮겨온다: disabled 라
  // press 가 no-op 이라 onPress(=onPressFilter('price'))가 아예 안 불린다. onPress 배선 자체는
  // 그대로 둔다(staySearchStructure 동결이 FilterChip 의 onPress={onPress} 을 못박음 — 무동작은
  // 배선 제거가 아니라 disabled 로 준다). 셰브론은 펼치기 암시라 제거한다(OQ1). V3 동결
  // (rounded-pill·border-hairline-strong·"가격대" Text)은 그대로 둔다.
  const comingSoon = axis === 'price';
  return (
    <Pressable
      testID={`stay-search-filter-${axis}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: comingSoon }}
      disabled={comingSoon}
      onPress={onPress}
      className="flex-row items-center gap-xs rounded-pill border border-hairline-strong bg-canvas px-md py-sm"
    >
      <Text
        className={
          comingSoon
            ? 'font-noto text-body text-muted'
            : 'font-noto text-body text-body'
        }
      >
        {label}
      </Text>
      {comingSoon ? (
        <Text className="font-noto text-micro text-muted-soft">준비 중</Text>
      ) : null}
      {showBadge ? (
        <View className="h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-primary px-[5px]">
          <Text className="font-noto-bold text-micro font-bold text-on-primary">
            {count}
          </Text>
        </View>
      ) : null}
      {axis === 'more' ? (
        <FilterSlidersGlyph size={14} />
      ) : comingSoon ? null : (
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
  activeFilterCount,
  onPressFilter,
}: {
  region: string;
  count: number;
  showCount: boolean;
  activeFilterCount?: number;
  onPressFilter?: (axis: 'price' | 'region' | 'more') => void;
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
          <FilterChip
            key={axis}
            axis={axis}
            label={label}
            count={axis === 'more' ? activeFilterCount : undefined}
            onPress={() => onPressFilter?.(axis)}
          />
        ))}
      </View>
    </View>
  );
}

function StayCard({
  item,
  saved,
  pending,
  onToggleSave,
  onPressCard,
}: {
  item: StayItem;
  saved: boolean;
  pending: boolean;
  onToggleSave?: (item: StayItem) => void;
  onPressCard?: (item: StayItem) => void;
}): ReactElement {
  const key = stayKey(item);
  return (
    <Pressable
      testID={`stay-card-${key}`}
      accessibilityRole="button"
      onPress={() => onPressCard?.(item)}
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
          // 담김=선택됨(AC-10) · 대기=비활성(TRIP-417 AC-8)을 색이 아니라 accessibilityState로
          // 관찰한다. ⚠️ `disabled` 프롭을 쓰면 대기 하트가 터치 응답자에서 빠져 press가 카드
          // Pressable로 버블링돼 상세로 튕긴다(TRIP-420 AC-3 함정) — accessibilityState.disabled는
          // 하트를 터치 응답자로 남겨(버블 차단) RNTL press를 no-op으로 만든다(02a §5 probe).
          accessibilityState={{ selected: saved, disabled: pending }}
          // onPress는 항상 present한 함수로 두고(undefined면 조상=카드로 버블) 몸통 첫 줄에서
          // pending을 가드한다 — 실기(RN)에선 accessibilityState.disabled가 onPress를 못 막으므로
          // 이 내부 가드가 실제 연타 차단이다.
          onPress={() => {
            if (pending) return;
            onToggleSave?.(item);
          }}
          className="absolute right-[32px] top-[14px] h-[28px] w-[30px] items-center justify-center"
        >
          {saved ? (
            <HeartFilledGlyph
              testID={`stay-card-save-${key}-filled`}
              size={22}
            />
          ) : (
            <HeartOutlineGlyph
              testID={`stay-card-save-${key}-outline`}
              size={22}
            />
          )}
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
    </Pressable>
  );
}

/** 점선 박스 밖, 구분선 아래 수동 등록 유도 카드(AC-3 · US-STAY-10 예외 → US-STAY-08 연결). */
function RegisterPromptCard({
  onPress,
}: {
  onPress?: () => void;
}): ReactElement {
  return (
    <Pressable
      testID="stay-search-register"
      accessibilityRole="button"
      onPress={onPress}
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

/** empty(AC-2·AC-3) — 점선 안내 박스 + 구분선 + 수동 등록 카드(박스 밖 별도 형제).
 * "필터 완화"(AC-3)는 적용된 필터가 있을 때만 낸다 — 필터가 0이면 완화할 대상이 없어 무동작
 * 버튼(이 티켓이 고치는 결함)을 재생산하기 때문. `activeFilterCount === 0`일 때만 숨기고,
 * 미지정(undefined)은 "0"이 아니므로 유지한다(기존 2-prop 무회귀 — `?? 0` 폴백 금지). */
function EmptyBlock({
  activeFilterCount,
  onPressChangeRegion,
  onRelaxFilters,
  onPressRegister,
}: {
  activeFilterCount?: number;
  onPressChangeRegion?: () => void;
  onRelaxFilters?: () => void;
  onPressRegister?: () => void;
}): ReactElement {
  const actions: StateNoticeAction[] = [
    {
      testID: 'stay-search-empty-region',
      label: '지역 바꾸기',
      variant: 'outline',
      onPress: onPressChangeRegion,
    },
  ];
  if (activeFilterCount !== 0) {
    actions.push({
      testID: 'stay-search-empty-filter',
      label: '필터 완화',
      variant: 'outline',
      onPress: onRelaxFilters,
    });
  }

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
          actions={actions}
        />
      </View>
      <View className="px-lg">
        <View className="h-[1px] w-full bg-hairline" />
      </View>
      <RegisterPromptCard onPress={onPressRegister} />
    </View>
  );
}

/** filter-zero(AC-4) — `StateNotice`를 감싸는 얇은 래퍼(01b Seed §1 정본 이름). 자체
 * 마크업은 없고, 필터명 변환(`filterReasonLabel`)과 곡선 따옴표 문구만 조립한다. */
function FilterZeroNotice({
  reasons,
  onRelaxFilters,
  onClearCulpritFilter,
}: {
  reasons: string[];
  onRelaxFilters?: () => void;
  onClearCulpritFilter?: (reason: string) => void;
}): ReactElement {
  // `reasons[0]`은 타입상 `string`이지만 빈 배열이면 실제로는 `undefined`다(03b W-4) —
  // `?? ''`로 크래시만 막는다. 빈 배열 자체를 막는 타입 좁히기는 동결 테스트(reasons:
  // string[])의 tsc를 깨뜨려 별도 사이클이다(게이트② 미룸 항목).
  const label = filterReasonLabel(reasons[0] ?? '');
  return (
    <StateNotice
      testID="stay-search-filterzero"
      icon={<FilterSlidersGlyph size={32} tone="primary" />}
      title={`‘${label}’ 필터가 0건을 만들었어요`}
      description="필터를 해제하면 더 많은 숙소를 볼 수 있어요"
      actions={[
        {
          testID: 'stay-search-filterzero-clear',
          label: `‘${label}’ 필터 해제`,
          variant: 'outline',
          // 화살표로 감싸 원인 코드 문자열(reasons[0])을 넘긴다 — 직결하면 RN 이 눌림 이벤트를
          // 인자로 흘려 페이지의 relaxCulpritFilter(event, …)가 크래시한다(★3). 라벨과 제거값이
          // 같은 reasons[0]에서 나와 "'오션뷰' 해제"라 써놓고 딴 걸 지우는 일이 없다(★2).
          onPress: () => onClearCulpritFilter?.(reasons[0] ?? ''),
        },
        {
          testID: 'stay-search-filterzero-reset',
          label: '필터 초기화',
          variant: 'link',
          onPress: onRelaxFilters,
        },
      ]}
    />
  );
}

/** error(AC-7) — 이 상태만 1차 버튼이 채움(filled)이다. */
function ErrorNotice({
  onRetry,
  onPressRegister,
}: {
  onRetry?: () => void;
  onPressRegister?: () => void;
}): ReactElement {
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
          onPress: onPressRegister,
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
  activeFilterCount,
  onRetry,
  onPressRegister,
  onPressChangeRegion,
  onRelaxFilters,
  onClearCulpritFilter,
}: {
  state: StaySearchState;
  activeFilterCount?: number;
  onRetry?: () => void;
  onPressRegister?: () => void;
  onPressChangeRegion?: () => void;
  onRelaxFilters?: () => void;
  onClearCulpritFilter?: (reason: string) => void;
}): ReactElement | null {
  if (state.kind === 'loading') return <SkeletonList />;
  if (state.kind === 'results') return null;

  const notice =
    state.kind === 'error' ? (
      <ErrorNotice onRetry={onRetry} onPressRegister={onPressRegister} />
    ) : state.kind === 'filter-zero' ? (
      <FilterZeroNotice
        reasons={state.reasons}
        onRelaxFilters={onRelaxFilters}
        onClearCulpritFilter={onClearCulpritFilter}
      />
    ) : (
      <EmptyBlock
        activeFilterCount={activeFilterCount}
        onPressChangeRegion={onPressChangeRegion}
        onRelaxFilters={onRelaxFilters}
        onPressRegister={onPressRegister}
      />
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
  onPressRegister,
  onPressBack,
  onPressTab,
  onPressCreateTrip,
  onPressFilter,
  activeFilterCount,
  onPressChangeRegion,
  onRelaxFilters,
  onClearCulpritFilter,
  savedKeys = [],
  onToggleSave,
  pendingKeys = [],
  onPressCard,
}: StaySearchScreenProps): ReactElement {
  // loading·error엔 'degraded'가 없다 — `in` 좁히기로 판별 유니온을 안전하게 읽는다.
  const degraded = 'degraded' in state ? state.degraded : false;
  const showCount = state.kind !== 'loading' && state.kind !== 'error';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="stay-search-root" className="flex-1 bg-canvas">
        <AppBar onPress={onPressBack} />

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
                activeFilterCount={activeFilterCount}
                onPressFilter={onPressFilter}
              />
              {degraded ? (
                <View className="px-lg pb-lg">
                  <PartialFailureBanner onRetry={onRetry} />
                </View>
              ) : null}
            </>
          }
          ListEmptyComponent={
            <ListEmptyBlock
              state={state}
              activeFilterCount={activeFilterCount}
              onRetry={onRetry}
              onPressRegister={onPressRegister}
              onPressChangeRegion={onPressChangeRegion}
              onRelaxFilters={onRelaxFilters}
              onClearCulpritFilter={onClearCulpritFilter}
            />
          }
          renderItem={({ item }) => {
            const key = stayKey(item);
            return (
              <View className="w-full px-lg">
                <StayCard
                  item={item}
                  saved={savedKeys.includes(key)}
                  pending={pendingKeys.includes(key)}
                  onToggleSave={onToggleSave}
                  onPressCard={onPressCard}
                />
              </View>
            );
          }}
          ItemSeparatorComponent={() => <View className="h-lg" />}
          // FAB(absolute bottom-104 + h-52 = 상단 156)·탭바(96) 오버레이가 마지막 카드를
          // 가리지 않도록 스크롤 끝 여백을 156까지 확보한다(TRIP-414, Figma fabSpacer 대응).
          ListFooterComponent={
            <View testID="stay-search-list-footer" className="h-[156px]" />
          }
        />

        <BottomTabBar
          activeKey="explore"
          onPressTab={(key) => onPressTab?.(key)}
        />

        <Pressable
          testID="stay-search-fab"
          accessibilityRole="button"
          // 자식 Text 의 전각 '＋'가 스크린리더 이름에 새지 않게 명시한다(TRIP-414 접근성 AC,
          // TRIP-391 홈 FAB 이 겪은 유일한 실패 경로와 동형).
          accessibilityLabel="여행 만들기"
          onPress={onPressCreateTrip}
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
