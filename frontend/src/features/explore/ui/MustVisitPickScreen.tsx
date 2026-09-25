import type { ReactElement } from 'react';
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
  /** 그릴 순서 그대로의 목록 — 정렬은 페이지가 끝냈다(단일 출처). */
  savedPlaces: SavedPlace[];
  /** 지금 선택된 poiId 들 — 선택 여부는 색이 아니라 이 집합 + 글리프 컴포넌트 정체성으로 잰다. */
  selectedPoiIds: string[];
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
  isLast,
  onToggleSelect,
}: {
  saved: SavedPlace;
  rank: number;
  selected: boolean;
  /** 마지막 행은 구분선을 안 그린다(Figma 2437:1500). */
  isLast: boolean;
  onToggleSelect: (poiId: string) => void;
}): ReactElement {
  const { place } = saved;
  const tag = place.tags[0];

  return (
    <View
      testID={`mustvisit-pick-row-${place.poiId}`}
      className={`w-full flex-row items-center gap-md py-md ${
        isLast ? '' : 'border-b border-hairline'
      }`}
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
        {place.region ? (
          <View className="flex-row items-center gap-xs">
            <MapPinGlyph size={13} tone="muted" />
            <Text className="font-noto text-caption text-muted">
              {place.region}
            </Text>
          </View>
        ) : null}
        {tag ? (
          <View className="self-start rounded-pill bg-surface-strong px-sm py-xs">
            <Text className="font-noto text-micro text-body">{tag}</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        testID={`mustvisit-pick-check-${place.poiId}`}
        accessibilityRole="button"
        // 선택=selected. 빈/찬을 색이 아니라 이 접근성 상태 + 서로 다른 글리프 컴포넌트로 잰다
        // (repo-trap: SVG fill 은 렌더 트리에 안 남는다, 02a ★1 · save 하트와 같은 신호).
        accessibilityState={{ selected }}
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
    </View>
  );
}

function CompleteBar({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled: boolean;
}): ReactElement {
  // 0곳이면 진짜 `disabled` prop 을 건다 — accessibilityState.disabled 만으론 press 가 안 막힌다
  // (02a §5-4). 회색 비활성으로 자리를 지키되 눌러도 onComplete 가 안 나간다.
  return (
    <View className="w-full border-t border-hairline bg-canvas px-lg pb-lg pt-md">
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

function ResultsBody({
  savedPlaces,
  selectedPoiIds,
  onToggleSelect,
  onComplete,
  onPressAddMore,
}: {
  savedPlaces: SavedPlace[];
  selectedPoiIds: string[];
  onToggleSelect: (poiId: string) => void;
  onComplete: () => void;
  onPressAddMore: () => void;
}): ReactElement {
  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
      >
        {savedPlaces.map((saved, index) => (
          <PickRow
            key={saved.savedPlaceId}
            saved={saved}
            rank={index + 1}
            selected={selectedPoiIds.includes(saved.place.poiId)}
            isLast={index === savedPlaces.length - 1}
            onToggleSelect={onToggleSelect}
          />
        ))}
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
      </ScrollView>
      <CompleteBar
        onPress={onComplete}
        disabled={selectedPoiIds.length === 0}
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
  selectedPoiIds,
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
      ? `담은 곳 ${savedPlaces.length}곳 · ${selectedPoiIds.length}곳 선택됨`
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
            selectedPoiIds={selectedPoiIds}
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
