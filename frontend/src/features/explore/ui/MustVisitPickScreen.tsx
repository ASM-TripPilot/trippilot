import { Fragment, type ReactElement } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PlaceListState } from '@/features/explore/model/placeListState';
import type { SavedPlace } from '@/shared/api/generated/schemas';
import { HeartFilledGlyph } from '@/shared/ui/HeartGlyphs';

import {
  BackChevronGlyph,
  CheckCircleFilledGlyph,
  CheckCircleOutlineGlyph,
  CircleExclaimGlyph,
  MapPinGlyph,
  SearchGlyph,
} from './ExploreGlyphs';

/**
 * d02 select 모드 화면 — 담은 곳 중 '꼭 갈 곳'을 고른다(TRIP-706 D1·D2, props-only 순수 뷰).
 * save 화면(`SavedPlaceListScreen`)과 별도 형제 화면이다(게이트① 무개봉 — 얼굴 4개가 save 와
 * 다 달라 mode 분기로 포크하지 않고 새 파일로 갈랐다).
 *
 * **훅 0** — 선택 집합은 페이지(`SavedPlacesPage`)가 소유하고(D2, 시드 배선을 구동하므로),
 * 화면은 `selectedPoiIds` + `onToggleSelect` props 만 받는 제어형이다(내부 state 없음). 얼굴은
 * `state.kind`(페이지가 `resolvePlaceListState` 로 판정) 하나로만 갈린다(AC-11 — 화면은
 * `savedPlaces.length` 로 재판정하지 않는다). `useSafeAreaInsets` 대신 `SafeAreaView` 컴포넌트만
 * 쓴다(Provider 부재 렌더 크래시 회피 — `SavedPlaceListScreen` 선례).
 */
export interface MustVisitPickScreenProps {
  state: PlaceListState;
  /** 그릴 순서 그대로의 **고를 수 있는** 목록(지역 안) — 정렬은 페이지가 끝냈다(단일 출처). */
  savedPlaces: SavedPlace[];
  /** 여행 지역 밖 담은 곳 — 목록 뒤 "이 여행 지역 밖 N곳" 머리글 아래에 **흐리게, 체크 없이** 그린다
   * (TRIP-1042 · BR-U1-58 ② — 보이되 고를 수 없다. 숨기지 않는 것은 INV-4). */
  outsideRegionPlaces?: SavedPlace[];
  /** 지역 안이 0건일 때 페이지가 주는 여행지 표시명(`서울`·`서울·부산`) — 있으면 목록 머리에 region-empty
   * 블록을 끼우고 '+ 탐색에서 더 담기' 행을 숨긴다(Figma 4685:2646 — CTA 가 대신한다). */
  regionEmptyLabel?: string;
  /** poiId → 행 위치 표기(`인천 남동구`, TRIP-1042 AC-9). 키가 없으면 `place.region`. */
  locationLabels?: Readonly<Record<string, string>>;
  /** 지금 선택된 poiId 들 — 선택 여부는 색이 아니라 이 집합 + 글리프 컴포넌트 정체성으로 잰다. */
  selectedPoiIds: string[];
  /** 이미 그 여행 필수 방문지인 poiId(TRIP-1093 여행 모드 · INV-U1-18) — 체크된 채 잠겨 눌러도 안 풀리고,
   * 완료 활성은 이것을 뺀 **새로 고른 곳**으로만 센다. `selectedPoiIds` 에도 들어 있어야 부제 수와 맞는다. */
  lockedPoiIds?: string[];
  /** 완료 실패 안내(TRIP-1093 · INV-4) — 있으면 완료 버튼 위에 한 줄. 재시도는 완료를 다시 누르는 것이다. */
  completeError?: string | null;
  onToggleSelect: (poiId: string) => void;
  onComplete: () => void;
  /** 리스트 하단 '+ 탐색에서 더 담기' → d04. */
  onPressAddMore: () => void;
  /** error 얼굴 '다시 시도'. */
  onRetry: () => void;
  /** empty 얼굴 '장소 둘러보기' → d04. */
  onPressBrowse: () => void;
  onBack: () => void;
}

function AppBar({
  subtitle,
  subtitleTestID,
  onBack,
}: {
  subtitle: string | null;
  subtitleTestID?: string;
  onBack: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-xs pb-sm pl-[10px] pr-lg">
      <Pressable
        testID="mustvisit-pick-back"
        accessibilityRole="button"
        onPress={onBack}
        className="h-10 w-10 items-center justify-center"
      >
        <BackChevronGlyph size={24} />
      </Pressable>
      <View className="gap-xs">
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          꼭 갈 곳 고르기
        </Text>
        {subtitle ? (
          <View testID={subtitleTestID}>
            <Text className="font-noto text-caption text-muted">
              {subtitle}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PickRow({
  saved,
  rank,
  selected,
  locked,
  isLast,
  outside,
  location,
  onToggleSelect,
}: {
  saved: SavedPlace;
  rank: number;
  selected: boolean;
  /** 이미 등록 — 선택 상태로 잠근다(진짜 `disabled` 라 press 가 막힌다). */
  locked: boolean;
  /** 마지막 행은 구분선을 안 그린다(Figma 2437:1500). */
  isLast: boolean;
  /** 지역 밖 — 흐리게(opacity 0.4) 그리고 체크 원을 아예 안 그린다(Figma 2437:1500). */
  outside: boolean;
  location: string | null | undefined;
  onToggleSelect: (poiId: string) => void;
}): ReactElement {
  const { place } = saved;
  const tag = place.tags[0];

  return (
    <View
      testID={`mustvisit-pick-row-${place.poiId}`}
      accessibilityState={{ disabled: outside }}
      className={`w-full flex-row items-center gap-md py-md ${
        isLast ? '' : 'border-b border-hairline'
      } ${outside ? 'opacity-40' : ''}`}
    >
      <View
        testID={`mustvisit-pick-rank-${place.poiId}`}
        className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary"
      >
        <Text className="font-inter-bold text-label font-bold text-on-primary">
          {rank}
        </Text>
      </View>

      <View className="h-20 w-[104px] overflow-hidden rounded-thumb bg-surface-strong">
        {place.imageUrl ? (
          <Image
            source={{ uri: place.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        ) : null}
      </View>

      <View className="flex-1 gap-xs">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {place.nameKo}
        </Text>
        {location ? (
          <View className="flex-row items-center gap-xs">
            <MapPinGlyph size={13} tone="muted" />
            <Text className="font-noto text-caption text-muted">
              {location}
            </Text>
          </View>
        ) : null}
        {tag ? (
          <View className="self-start rounded-pill bg-surface-strong px-sm py-xs">
            <Text className="font-noto text-micro text-body">{tag}</Text>
          </View>
        ) : null}
      </View>

      {outside ? null : (
        <Pressable
          testID={`mustvisit-pick-check-${place.poiId}`}
          accessibilityRole="button"
          // 선택=selected. 빈/찬을 색이 아니라 이 접근성 상태 + 서로 다른 글리프 컴포넌트로 잰다
          // (repo-trap: SVG fill 은 렌더 트리에 안 남는다, 02a ★1 · save 하트와 같은 신호).
          accessibilityState={{ selected, disabled: locked }}
          disabled={locked}
          onPress={() => onToggleSelect(place.poiId)}
          className="h-[38px] w-[38px] items-center justify-center"
        >
          {selected ? (
            <CheckCircleFilledGlyph
              size={24}
              testID={`mustvisit-pick-check-filled-${place.poiId}`}
            />
          ) : (
            <CheckCircleOutlineGlyph
              size={24}
              testID={`mustvisit-pick-check-outline-${place.poiId}`}
            />
          )}
        </Pressable>
      )}
    </View>
  );
}

function CompleteBar({
  onPress,
  disabled,
  error,
}: {
  onPress: () => void;
  disabled: boolean;
  error?: string | null;
}): ReactElement {
  // 0곳이면 진짜 `disabled` prop 을 건다 — accessibilityState.disabled 만으론 press 가 안 막힌다
  // (02a §5-4). 회색 비활성으로 자리를 지키되 눌러도 onComplete 가 안 나간다.
  return (
    <View className="w-full gap-sm border-t border-hairline bg-canvas px-lg pb-lg pt-md">
      {/* 실패 배너 — Figma 없음(01b Q3). 같은 feature `RemoveErrorBanner` 모양을 따른다. */}
      {error ? (
        <View
          testID="mustvisit-pick-complete-error"
          className="rounded-button bg-primary-pale p-md"
        >
          <Text className="font-noto text-label text-primary-text">
            {error}
          </Text>
        </View>
      ) : null}
      <Pressable
        testID="mustvisit-pick-complete"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        className={`h-[54px] w-full items-center justify-center rounded-button ${
          disabled ? 'bg-surface-strong' : 'bg-primary'
        }`}
      >
        <Text
          className={`font-noto-bold text-[16px] font-bold ${
            disabled ? 'text-muted' : 'text-on-primary'
          }`}
        >
          완료
        </Text>
      </Pressable>
    </View>
  );
}

/** 지역 안 0건 블록 — Figma 4685:2646. 전체 화면 얼굴이 아니라 results 목록 머리에 끼고, 삽화·본문·아이콘이
 * 없다(진짜 0곳 얼굴 `EmptyBody` 와 다른 모양). CTA 는 '+ 탐색에서 더 담기' 행을 대신한다. */
function RegionEmptyBlock({
  label,
  onPressBrowse,
}: {
  label: string;
  onPressBrowse: () => void;
}): ReactElement {
  return (
    <View
      testID="mustvisit-pick-region-empty"
      className="w-full items-center gap-lg py-3xl"
    >
      <Text className="font-noto-bold text-section font-bold text-ink">
        {`${label}에 담은 곳이 없어요`}
      </Text>
      <Pressable
        testID="mustvisit-pick-region-empty-browse"
        accessibilityRole="button"
        onPress={onPressBrowse}
        className="h-[52px] items-center justify-center rounded-button bg-primary px-2xl"
      >
        <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
          {`탐색에서 ${label} 장소 담기`}
        </Text>
      </Pressable>
    </View>
  );
}

function ResultsBody({
  savedPlaces,
  outsideRegionPlaces,
  regionEmptyLabel,
  locationLabels,
  selectedPoiIds,
  lockedPoiIds,
  completeError,
  onToggleSelect,
  onComplete,
  onPressAddMore,
}: {
  savedPlaces: SavedPlace[];
  outsideRegionPlaces: SavedPlace[];
  regionEmptyLabel: string | undefined;
  locationLabels: Readonly<Record<string, string>> | undefined;
  selectedPoiIds: string[];
  lockedPoiIds: string[];
  completeError: string | null | undefined;
  onToggleSelect: (poiId: string) => void;
  onComplete: () => void;
  onPressAddMore: () => void;
}): ReactElement {
  // 안 → (밖이 있으면) 머리글 → 밖. 순번·마지막 행 판정은 보이는 전체 순서로 이어 센다(01b Q2).
  const rows = [...savedPlaces, ...outsideRegionPlaces];
  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
      >
        {regionEmptyLabel ? (
          <RegionEmptyBlock
            label={regionEmptyLabel}
            onPressBrowse={onPressAddMore}
          />
        ) : null}
        {rows.map((saved, index) => (
          <Fragment key={saved.savedPlaceId}>
            {/* Figma 2437:1500 — 12px muted 캡션, pt 8. */}
            {index === savedPlaces.length && outsideRegionPlaces.length > 0 ? (
              <Text
                testID="mustvisit-pick-region-outside"
                className="pt-sm font-noto text-caption text-muted"
              >
                {`이 여행 지역 밖 ${outsideRegionPlaces.length}곳`}
              </Text>
            ) : null}
            <PickRow
              saved={saved}
              rank={index + 1}
              selected={selectedPoiIds.includes(saved.place.poiId)}
              locked={lockedPoiIds.includes(saved.place.poiId)}
              isLast={index === rows.length - 1}
              outside={index >= savedPlaces.length}
              location={
                locationLabels?.[saved.place.poiId] ?? saved.place.region
              }
              onToggleSelect={onToggleSelect}
            />
          </Fragment>
        ))}
        {regionEmptyLabel ? null : (
          <Pressable
            testID="mustvisit-pick-addmore"
            accessibilityRole="button"
            onPress={onPressAddMore}
            className="items-center justify-center py-[18px]"
          >
            <Text className="font-noto-bold text-[14px] font-bold text-primary">
              + 탐색에서 더 담기
            </Text>
          </Pressable>
        )}
      </ScrollView>
      {/* 새로 고른 곳이 0이면 잠근다 — 잠긴(이미 등록) 체크만 있으면 보낼 것이 없다(TRIP-1093 AC-9). */}
      <CompleteBar
        onPress={onComplete}
        disabled={selectedPoiIds.every((id) => lockedPoiIds.includes(id))}
        error={completeError}
      />
    </>
  );
}

function LoadingBody({ onComplete }: { onComplete: () => void }): ReactElement {
  // Figma 2437:1666 — 스켈레톤 4행(좌 원 · 썸네일 · 바 2줄 · 우 원), 구분선 없음(save 6행과 다름).
  return (
    <>
      <View className="w-full flex-1">
        {[0, 1, 2, 3].map((r) => (
          <View
            key={r}
            testID={`mustvisit-pick-skeleton-row-${r}`}
            className="flex-row items-center gap-md px-lg py-md"
          >
            <View className="h-[26px] w-[26px] rounded-pill bg-surface-strong" />
            <View className="h-20 w-[104px] rounded-thumb bg-surface-strong" />
            <View className="flex-1 gap-sm">
              <View className="h-[15px] w-2/3 rounded-[6px] bg-hairline" />
              <View className="h-[13px] w-1/2 rounded-[6px] bg-surface-strong" />
            </View>
            <View className="h-[26px] w-[26px] rounded-pill bg-surface-strong" />
          </View>
        ))}
      </View>
      <CompleteBar onPress={onComplete} disabled />
    </>
  );
}

/** empty 삽화 — Figma 2437:1616 의 사진 3장 부채꼴 + 중앙 하트 원. save 화면의 `EmptyCollage`
 * 와 같은 그림이나, 게이트① 로 `SavedPlaceListScreen.tsx` 를 못 건드려 여기 벡터를 복제한다
 * (그 로컬 함수는 미export — 추출하려면 save 화면을 손대야 한다, 02a EmptyCollage 판정 (b)).
 * 실사진은 에셋 라이선스·출처 미정이라 회색 벡터로 대체(미충족 기록, 6-b 육안). */
function EmptyCollage(): ReactElement {
  return (
    <View
      testID="mustvisit-pick-empty-art"
      className="h-[170px] w-[230px] flex-row items-center justify-center"
    >
      <View
        className="h-[118px] w-[74px] rounded-card bg-surface-strong"
        style={{ transform: [{ rotate: '-12deg' }], marginRight: -12 }}
      />
      <View className="z-10 h-[162px] w-[96px] items-center justify-center rounded-card bg-surface-soft">
        <View className="h-12 w-12 items-center justify-center rounded-pill bg-canvas">
          <HeartFilledGlyph size={26} />
        </View>
      </View>
      <View
        className="h-[118px] w-[74px] rounded-card bg-surface-strong"
        style={{ transform: [{ rotate: '12deg' }], marginLeft: -12 }}
      />
    </View>
  );
}

function EmptyBody({
  onPressBrowse,
}: {
  onPressBrowse: () => void;
}): ReactElement {
  return (
    <View
      testID="mustvisit-pick-empty"
      className="w-full flex-1 items-center justify-center gap-lg px-2xl"
    >
      <EmptyCollage />
      <Text className="font-noto-bold text-[21px] font-bold text-ink">
        아직 담은 곳이 없어요
      </Text>
      {/* 서브카피는 select 전용 문구(save-empty 와 다름). 개행(\n)을 문자열 하나로 담아
          두 줄로 그린다 — 단일 Text · 문자열 children 계약(02a §10, CS-8 이 raw children 으로 잰다). */}
      <Text
        testID="mustvisit-pick-empty-subcopy"
        className="text-center font-noto text-body text-muted"
      >
        {
          '탐색에서 마음에 드는 곳을 먼저 담아 주세요\n담은 곳이 여기 모이면 꼭 갈 곳으로 고를 수 있어요'
        }
      </Text>
      <Pressable
        testID="mustvisit-pick-browse"
        accessibilityRole="button"
        onPress={onPressBrowse}
        className="mt-sm h-[48px] flex-row items-center gap-sm self-center rounded-button bg-primary px-xl"
      >
        <SearchGlyph size={18} />
        <Text className="font-noto-bold text-[15px] font-bold text-on-primary">
          장소 둘러보기
        </Text>
      </Pressable>
    </View>
  );
}

function ErrorBody({ onRetry }: { onRetry: () => void }): ReactElement {
  // Figma 2437:1639 — 92px 연회색 원 + 핑크 원형 느낌표. save-error(StateNotice)와 전혀 다른
  // 전용 시각이라(원 색·크기·문구·버튼 폭 전부 다름) shared StateNotice 를 쓰지 않고 직접 그린다.
  return (
    <View
      testID="mustvisit-pick-error"
      className="w-full flex-1 items-center justify-center gap-lg px-2xl"
    >
      <View className="h-[92px] w-[92px] items-center justify-center rounded-pill bg-surface-strong">
        <CircleExclaimGlyph size={40} testID="mustvisit-pick-error-icon" />
      </View>
      <Text className="font-noto-bold text-[21px] font-bold text-ink">
        담은 곳을 불러오지 못했어요
      </Text>
      <Text className="text-center font-noto text-body text-muted">
        네트워크를 확인하고 다시 시도해 주세요
      </Text>
      <Pressable
        testID="mustvisit-pick-error-retry"
        accessibilityRole="button"
        onPress={onRetry}
        className="mt-sm h-[54px] items-center justify-center rounded-button bg-primary px-[28px]"
      >
        <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
          다시 시도
        </Text>
      </Pressable>
    </View>
  );
}

export function MustVisitPickScreen({
  state,
  savedPlaces,
  outsideRegionPlaces = [],
  regionEmptyLabel,
  locationLabels,
  selectedPoiIds,
  lockedPoiIds = [],
  completeError,
  onToggleSelect,
  onComplete,
  onPressAddMore,
  onRetry,
  onPressBrowse,
  onBack,
}: MustVisitPickScreenProps): ReactElement {
  // 얼굴은 state.kind 하나로만 갈린다(AC-11). 'filter-zero'(d02 에선 구조적으로 도달 불가 —
  // 페이지가 hasQuery·hasCategory 를 늘 false 로 부른다)는 results 로 접는다.
  const face =
    state.kind === 'loading'
      ? 'loading'
      : state.kind === 'error'
        ? 'error'
        : state.kind === 'empty'
          ? 'empty'
          : 'results';

  const subtitle =
    face === 'results'
      ? `담은 곳 ${savedPlaces.length + outsideRegionPlaces.length}곳 · ${selectedPoiIds.length}곳 선택됨`
      : face === 'loading'
        ? '담은 곳 불러오는 중'
        : null;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View testID="mustvisit-pick-root" className="flex-1 bg-canvas">
        <AppBar
          subtitle={subtitle}
          subtitleTestID={
            face === 'results' ? 'mustvisit-pick-subtitle' : undefined
          }
          onBack={onBack}
        />

        {face === 'results' ? (
          <ResultsBody
            savedPlaces={savedPlaces}
            outsideRegionPlaces={outsideRegionPlaces}
            regionEmptyLabel={regionEmptyLabel}
            locationLabels={locationLabels}
            selectedPoiIds={selectedPoiIds}
            lockedPoiIds={lockedPoiIds}
            completeError={completeError}
            onToggleSelect={onToggleSelect}
            onComplete={onComplete}
            onPressAddMore={onPressAddMore}
          />
        ) : null}
        {face === 'loading' ? <LoadingBody onComplete={onComplete} /> : null}
        {face === 'empty' ? <EmptyBody onPressBrowse={onPressBrowse} /> : null}
        {face === 'error' ? <ErrorBody onRetry={onRetry} /> : null}
      </View>
    </SafeAreaView>
  );
}
