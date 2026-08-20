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
import { StateNotice } from '@/shared/ui/StateNotice';

import type { PlaceListState } from '../model/placeListState';
import type { PlaceSaveNotice } from '../model/placeSaveGuard';
import {
  BackChevronGlyph,
  FilterSlidersGlyph,
  HeartBadgeGlyph,
  HeartFilledGlyph,
  HeartOutlineGlyph,
  InfoGlyph,
  MapPinGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from './ExploreGlyphs';

/**
 * d04 장소 탐색 default(Figma `1692:1183`) — **프레젠테이션 화면**. props 8개(TRIP-221 확정)
 * + 옵셔널 7개(TRIP-222)만 받는다. 조회·라우팅·로컬 상태는 `pages/place-explore/ui/
 * PlaceExplorePage.tsx` 몫이고, 상태 판정(`resolvePlaceListState`)도 페이지가 끝내 `state`
 * 하나로 내려준다 — 이 화면은 그 판별 유니온을 보고 그리기만 한다(판정의 단일 출처).
 * 새 prop은 전부 옵셔널이고 `state` 기본값이 `results`라 TRIP-221 동결 렌더(prop 8개)가
 * 한 글자도 안 바뀐다(AC-G7).
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
  /** 카드 본문 탭 → d06 상세. 미지정이면 카드는 눌러도 무동작(additive, 게이트① 재개봉 없음). */
  onPressCard?: (place: Place) => void;
  onPressCreateTrip: () => void;
  /** 미지정이어도 화면은 그대로 동작한다(`StayRegisterScreen.tsx:62`와 같은 선택). */
  onBack?: () => void;
  /** 화면 얼굴. 미지정 = `{ kind: 'results' }` — 동결 렌더 헬퍼가 8개만 넘기므로 이 기본값이
   * AC-G7 무회귀의 기계다(`StaySearchScreen.state` 선례와 동형). */
  state?: PlaceListState;
  /** 응답 대기 중인 poiId — 그 하트를 `disabled`로 만든다(01b Seed Q7 ⓑ). 미지정 = []. */
  pendingPoiIds?: string[];
  /** 담기 실패 배너. 미지정·null이면 배너를 그리지 않는다(01b Seed Q5 ⓐ). 위치는 CTA 바 위. */
  saveError?: PlaceSaveNotice | null;
  /** error 안내의 `다시 시도` — 실제 재조회에 배선한다(스텁 금지). */
  onRetry?: () => void;
  /** empty 안내의 `다른 지역 보기`. */
  onPressChangeRegion?: () => void;
  /** filter-zero 안내의 해제 버튼 — 지목한 하나만 해제한다(01b Seed Q3 ⓐ). */
  onClearFilter?: () => void;
  /** 배너 액션 버튼(재시도·로그인하기 공용) — 무엇을 하는지는 `saveError.action`이 정한다. */
  onPressSaveErrorAction?: () => void;
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
  pending,
  onToggleSave,
  onPressCard,
}: {
  place: Place;
  saved: boolean;
  pending: boolean;
  onToggleSave: (place: Place) => void;
  onPressCard?: (place: Place) => void;
}): ReactElement {
  const subtitle = place.region
    ? `${place.category} · ${place.region}`
    : place.category;

  return (
    // bare Pressable(accessibilityRole 없음) — role 을 붙이면 `states.test.tsx` 의 role=button
    // 개수 동결(정확히 15)이 깨진다(02a ★1). bare 는 getAllByRole 에 안 잡히고 press 는 먹는다.
    // `!pending` 가드: 대기(disabled) 하트 press 는 부모 Pressable 로 새는데(RNTL Probe C, ★2),
    // pending 이면 카드 이동(d06)을 무효화해 그 누수를 막는다.
    <Pressable
      testID={`explore-places-card-${place.poiId}`}
      onPress={() => {
        if (!pending) onPressCard?.(place);
      }}
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
          disabled={pending}
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
    </Pressable>
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

/** loading(AC-4·01b Seed Q8) — 2열×2행 스켈레톤 카드 4장. d04 카드 형상(사진 132px·radius
 * 14)을 회색 블록으로 접는다. 행 testID가 2열 판정의 유일한 렌더 관측 수단이다 — NativeWind
 * `className`은 jest에서 `style`로 안 남아 `flexDirection` 신호를 못 쓴다(★1). */
function SkeletonCard({ index }: { index: number }): ReactElement {
  return (
    <View
      testID={`explore-places-skeleton-${index}`}
      className="w-[48%] gap-[7px]"
    >
      <View className="h-[132px] w-full rounded-[14px] bg-surface-strong" />
      <View className="h-[13px] w-2/3 rounded-[6px] bg-hairline" />
      <View className="h-[11px] w-1/2 rounded-[6px] bg-surface-strong" />
    </View>
  );
}

function SkeletonRow({
  row,
  indices,
}: {
  row: number;
  indices: [number, number];
}): ReactElement {
  return (
    <View
      testID={`explore-places-loading-row-${row}`}
      className="w-full flex-row justify-between"
    >
      <SkeletonCard index={indices[0]} />
      <SkeletonCard index={indices[1]} />
    </View>
  );
}

function SkeletonGrid(): ReactElement {
  return (
    <View testID="explore-places-loading" className="w-full gap-lg px-lg pt-lg">
      <Text className="font-noto text-label text-muted-soft">
        장소를 모으는 중
      </Text>
      <View className="gap-lg">
        <SkeletonRow row={0} indices={[0, 1]} />
        <SkeletonRow row={1} indices={[2, 3]} />
      </View>
    </View>
  );
}

/** `FlatList`의 `ListEmptyComponent` — `data=[]`일 때만 그려진다(StaySearchScreen 선례와
 * 동형). `state.kind`를 안내 하나로 매핑한다. filter-zero는 `blame`을 보고 검색어·카테고리
 * 중 실제 범인의 값을 문구에 지목한다(BR-U1-16 취지) — 계약이 사유를 안 주므로 화면이 이미
 * 갖고 있는 `searchText`·`selectedCategory`에서 파생한다.
 *
 * `error`는 여기서 안 그린다 — 재조회 실패는 이전 목록(stale data)이 남아 있을 수 있어
 * `data.length>0`이면 이 자리 자체가 안 그려진다. 그러면 INV-4(침묵 실패 금지)를 어긴다
 * (TRIP-222 03b W-1). `ErrorNotice`가 `state.kind`만 보고 카드 유무와 무관하게 그린다. */
function ListEmptyBlock({
  state,
  searchText,
  selectedCategory,
  onPressChangeRegion,
  onClearFilter,
}: {
  state: PlaceListState;
  searchText: string;
  selectedCategory: PoiCategory | null;
  onPressChangeRegion?: () => void;
  onClearFilter?: () => void;
}): ReactElement | null {
  if (state.kind === 'loading') {
    return <SkeletonGrid />;
  }
  if (state.kind === 'results') {
    return null;
  }

  if (state.kind === 'empty') {
    return (
      <View className="w-full items-center justify-center px-lg pt-xl">
        <StateNotice
          testID="explore-places-empty"
          dashed
          icon={<MapPinGlyph size={32} />}
          title="담긴 장소가 없어요"
          description="다른 지역을 둘러보고 ♥로 담아 보세요"
          actions={[
            {
              testID: 'explore-places-empty-region',
              label: '다른 지역 보기',
              variant: 'outline',
              onPress: onPressChangeRegion,
            },
          ]}
        />
      </View>
    );
  }

  if (state.kind === 'filter-zero') {
    const blameLabel =
      state.blame === 'search' ? searchText : (selectedCategory ?? '');
    return (
      <View className="w-full items-center justify-center px-lg pt-xl">
        <StateNotice
          testID="explore-places-filterzero"
          icon={<FilterSlidersGlyph size={32} />}
          title={`‘${blameLabel}’ 때문에 0건이에요`}
          description="조건을 해제하면 더 많은 장소를 볼 수 있어요"
          actions={[
            {
              testID: 'explore-places-filterzero-clear',
              label:
                state.blame === 'search'
                  ? '검색어 지우기'
                  : `‘${blameLabel}’ 필터 해제`,
              variant: 'outline',
              onPress: onClearFilter,
            },
          ]}
        />
      </View>
    );
  }

  // error — ErrorNotice가 화면 상단에서 그린다(위 주석 참고).
  return null;
}

/** error 안내(AC-7 · INV-4) — `ListEmptyBlock` 밖, 목록 **헤더 안**에서 `state.kind==='error'`
 * 하나만 보고 그린다. 카드가 몇 장 떠 있든(재조회 실패로 이전 목록이 남아 있어도) 항상
 * 보인다(TRIP-222 03b W-1).
 * 헤더 안인 이유: `FlatList` 밖에 두면 검색바·카테고리 칩까지 통째로 아래로 밀린다
 * (실기 스모크 실측 2026-08-05). 밖으로 뺀 것은 "카드가 있어도 보이게"가 목적이었고
 * 헤더 안에서도 그 목적은 그대로 달성된다. */
function ErrorNotice({ onRetry }: { onRetry?: () => void }): ReactElement {
  return (
    <View className="w-full items-center justify-center px-lg pt-xl">
      <StateNotice
        testID="explore-places-error"
        icon={<WarningTriangleGlyph size={32} />}
        title="지금 장소 정보를 불러올 수 없어요"
        description="잠시 후 다시 시도해 주세요"
        actions={[
          {
            testID: 'explore-places-error-retry',
            label: '다시 시도',
            variant: 'filled',
            onPress: onRetry,
          },
        ]}
      />
    </View>
  );
}

/** 담기 실패 배너(01b Seed Q5 ⓐ) — `trip-wizard-submit-banner` 선례와 같은 모양(아이콘 +
 * 문구 + 조건부 액션 버튼). CTA 바 위에 그려지고, 다음 조작 시 사라진다(타이머 금지 —
 * 사라지는 조건은 페이지가 `saveError`를 다시 `null`로 돌리는 것으로 정한다). */
function SaveErrorBanner({
  notice,
  onPressAction,
}: {
  notice: PlaceSaveNotice;
  onPressAction?: () => void;
}): ReactElement {
  const actionTestId =
    notice.action === 'login'
      ? 'explore-places-saveerror-login'
      : notice.action === 'retry'
        ? 'explore-places-saveerror-retry'
        : null;
  const actionLabel = notice.action === 'login' ? '로그인하기' : '다시 시도';

  return (
    <View
      testID="explore-places-saveerror"
      className="mx-lg mb-sm flex-row items-start gap-[10px] rounded-button bg-primary-pale p-md"
    >
      <InfoGlyph size={18} />
      <Text className="flex-1 font-noto text-label text-primary-text">
        {notice.message}
      </Text>
      {actionTestId ? (
        <Pressable
          testID={actionTestId}
          accessibilityRole="button"
          onPress={onPressAction}
          className="items-center justify-center rounded-pill border-[1.4px] border-primary bg-canvas px-md py-[7px]"
        >
          <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
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
  onPressCard,
  onPressCreateTrip,
  onBack,
  state = { kind: 'results' },
  pendingPoiIds = [],
  saveError,
  onRetry,
  onPressChangeRegion,
  onClearFilter,
  onPressSaveErrorAction,
}: PlaceExploreScreenProps): ReactElement {
  const savedSet = new Set(savedPoiIds);
  const pendingSet = new Set(pendingPoiIds);

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
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 20,
            flexGrow: 1,
          }}
          ItemSeparatorComponent={() => <View style={{ height: 18 }} />}
          ListHeaderComponent={
            <View className="gap-lg pb-lg">
              <SearchBar value={searchText} onChangeText={onChangeSearchText} />
              <CategoryChips
                selected={selectedCategory}
                onSelect={onSelectCategory}
              />
              <SortRow />
              {state.kind === 'error' ? (
                <ErrorNotice onRetry={onRetry} />
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <ListEmptyBlock
              state={state}
              searchText={searchText}
              selectedCategory={selectedCategory}
              onPressChangeRegion={onPressChangeRegion}
              onClearFilter={onClearFilter}
            />
          }
          renderItem={({ item }) => (
            <PlaceCard
              place={item}
              saved={savedSet.has(item.poiId)}
              pending={pendingSet.has(item.poiId)}
              onToggleSave={onToggleSave}
              onPressCard={onPressCard}
            />
          )}
        />

        {saveError ? (
          <SaveErrorBanner
            notice={saveError}
            onPressAction={onPressSaveErrorAction}
          />
        ) : null}

        {savedPoiIds.length > 0 ? (
          <CtaBar count={savedPoiIds.length} onPress={onPressCreateTrip} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
