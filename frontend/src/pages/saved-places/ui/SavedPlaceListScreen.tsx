import type { ReactElement } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SavedPlace } from '@/shared/api/generated/schemas';
import { CollageEmptyState } from '@/shared/ui/CollageEmptyState';
import { HeartFilledGlyph, HeartOutlineGlyph } from '@/shared/ui/HeartGlyphs';
import { StateNotice } from '@/shared/ui/StateNotice';
import { Skeleton } from '@/shared/ui/Skeleton';

import type { PlaceListState } from '@/features/explore/model/placeListState';
import type { PlaceSaveNotice } from '@/features/explore/model/placeSaveGuard';
import { SAVED_PLACE_BADGE } from '../model/savedPlaceList';
import {
  BackChevronGlyph,
  MapPinGlyph,
  SearchGlyph,
  WarningTriangleGlyph,
} from '@/features/explore/ui/ExploreGlyphs';

/**
 * d02 담은 장소(Figma `1693:1183`·`1695:1183`) — **프레젠테이션 화면**. props만 받는다.
 * 정렬은 페이지가 끝낸 순서를 그대로 그리고(단일 출처, `orderSavedPlaces`를 여기서 다시
 * 부르지 않는다), 얼굴 판정(`state`)도 페이지가 내려준 값을 그대로 따른다.
 *
 * **게스트 분기(`isGuest`)가 `state`보다 우선한다** — 담은 목록 쿼리는 `enabled: isAuthed`라,
 * 게스트에게는 `isPending`이 영원히 true다(01b Seed Q6·★1). 그 값을 그대로 상태 판정에
 * 태우면 화면이 끝나지 않는 로딩이 되고, `isLoading`으로 피하면 이번엔 "담은 게 없다"는
 * 거짓말이 뜬다 — 그래서 게스트 여부를 얼굴 판정의 가장 앞에 둔다.
 */
export interface SavedPlaceListScreenProps {
  /** 그릴 순서 그대로의 목록 — 정렬은 페이지가 끝냈다(단일 출처). */
  savedPlaces: SavedPlace[];
  /** 화면 얼굴. 미지정 = `{ kind: 'results' }`. d02에서 `filter-zero`는 구조적으로 도달 불가. */
  state?: PlaceListState;
  /** 여행 지역 필터로 0건일 때(TRIP-689) — 기본 empty 대신 구분 안내를 그린다. 미지정 = false. */
  regionFilterEmpty?: boolean;
  /** 해제 실패 배너. 미지정·null = 안 그린다. 위치는 CTA 바 위. */
  removeError?: PlaceSaveNotice | null;
  /** 미로그인 — 목록·빈 상태 대신 로그인 안내만 그린다. 미지정 = false. */
  isGuest?: boolean;
  /** 이번 방문에서 해제(빈 하트)된 poiId 목록(TRIP-394). 미지정 = []. */
  releasedPoiIds?: string[];
  onPressRemove: (saved: SavedPlace) => void;
  /** 빈 하트(released) 행을 누르면 되돌리기(재담기). 미지정 = 미배선(TRIP-394). */
  onPressRestore?: (saved: SavedPlace) => void;
  /** 행 본문 탭 → d06 상세. 미지정이면 행은 눌러도 무동작(additive, 게이트① 재개봉 없음). */
  onPressRow?: (saved: SavedPlace) => void;
  onPressCreateTrip: () => void;
  onPressBrowse: () => void;
  onRetry?: () => void;
  onPressLogin?: () => void;
  onPressRemoveErrorAction?: () => void;
  onBack?: () => void;
}

type Face = 'guest' | 'loading' | 'error' | 'empty' | 'results';

function resolveFace(isGuest: boolean, state: PlaceListState): Face {
  if (isGuest) return 'guest';
  if (state.kind === 'loading') return 'loading';
  if (state.kind === 'error') return 'error';
  if (state.kind === 'empty') return 'empty';
  // 'results' · 'filter-zero'(d02에서 구조적으로 도달 불가 — 페이지가 hasQuery·hasCategory를
  // 늘 false로 고정해 부른다) 둘 다 목록 얼굴로 접는다.
  return 'results';
}

function AppBar({
  subtitle,
  onBack,
}: {
  subtitle: string | null;
  onBack?: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-xs pb-sm pl-[10px] pr-lg pt-sm">
      <Pressable
        testID="explore-saved-back"
        accessibilityRole="button"
        onPress={onBack}
        className="h-10 w-10 items-center justify-center"
      >
        <BackChevronGlyph size={24} />
      </Pressable>
      <View className="gap-xs">
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          담은 장소
        </Text>
        {subtitle ? (
          <View testID="explore-saved-subtitle">
            <Text className="font-noto text-caption text-muted">
              {subtitle}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SavedPlaceRow({
  saved,
  rank,
  released,
  onPressRemove,
  onPressRestore,
  onPressRow,
}: {
  saved: SavedPlace;
  rank: number;
  /** 이번 방문에서 해제된(빈 하트) 행인가(TRIP-394). */
  released: boolean;
  onPressRemove: (saved: SavedPlace) => void;
  onPressRestore?: (saved: SavedPlace) => void;
  onPressRow?: (saved: SavedPlace) => void;
}): ReactElement {
  const { place } = saved;
  const badge = SAVED_PLACE_BADGE[place.dataStatus];
  const tag = place.tags[0];

  return (
    // bare Pressable(accessibilityRole 없음) — d04 카드와 같은 규율(role 을 붙이면 개수 심판이
    // 깨질 위험 · 여기 d02 엔 role-count 가드가 없지만 대칭 유지). d02 하트는 disabled 가 없어
    // 항상 활성이라 하트 press 는 부모로 안 샌다(RNTL Probe A, ★2) — `!pending` 가드 불필요.
    <Pressable
      testID={`explore-saved-item-${saved.savedPlaceId}`}
      onPress={() => onPressRow?.(saved)}
      className="w-full flex-row items-center gap-md border-b border-hairline py-md"
    >
      <View
        testID={`explore-saved-rank-${saved.savedPlaceId}`}
        className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary"
      >
        <Text className="font-inter-bold text-label font-bold text-on-primary">
          {rank}
        </Text>
      </View>

      <View className="h-20 w-[104px] overflow-hidden rounded-thumb bg-surface-strong">
        {place.imageUrl ? (
          <Image
            testID={`explore-saved-photo-${saved.savedPlaceId}`}
            source={{ uri: place.imageUrl }}
            resizeMode="cover"
            className="h-full w-full"
          />
        ) : null}
        {badge ? (
          <View
            testID={`explore-saved-badge-${saved.savedPlaceId}`}
            className="absolute left-xs top-xs rounded-pill bg-ink px-sm py-[2px]"
          >
            <Text className="font-noto-bold text-micro font-bold text-on-primary">
              {badge}
            </Text>
          </View>
        ) : null}
      </View>

      <View className="flex-1 gap-xs">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {place.nameKo}
        </Text>
        {place.region ? (
          <View
            testID={`explore-saved-region-${saved.savedPlaceId}`}
            className="flex-row items-center gap-xs"
          >
            <MapPinGlyph size={13} tone="muted" />
            <Text className="font-noto text-caption text-muted">
              {place.region}
            </Text>
          </View>
        ) : null}
        {tag ? (
          <View
            testID={`explore-saved-tag-${saved.savedPlaceId}`}
            className="self-start rounded-pill bg-surface-strong px-sm py-xs"
          >
            <Text className="font-noto text-micro text-body">{tag}</Text>
          </View>
        ) : null}
      </View>

      <Pressable
        testID={`explore-saved-remove-${saved.savedPlaceId}`}
        accessibilityRole="button"
        // 담김=선택됨. 빈/찬을 색이 아니라 이 접근성 상태 + 글리프 컴포넌트 정체성으로 잰다
        // (repo-trap: SVG fill 은 렌더 트리에 안 남는다, 02a ★1 · d04 카드 하트와 같은 신호).
        accessibilityState={{ selected: !released }}
        onPress={() =>
          released ? onPressRestore?.(saved) : onPressRemove(saved)
        }
        className="h-[38px] w-[38px] items-center justify-center"
      >
        {released ? (
          <HeartOutlineGlyph
            size={24}
            testID={`explore-saved-heart-outline-${saved.savedPlaceId}`}
          />
        ) : (
          <HeartFilledGlyph
            size={24}
            testID={`explore-saved-heart-filled-${saved.savedPlaceId}`}
          />
        )}
      </Pressable>
    </Pressable>
  );
}

function ResultsList({
  savedPlaces,
  releasedPoiIds,
  onPressRemove,
  onPressRestore,
  onPressRow,
}: {
  savedPlaces: SavedPlace[];
  releasedPoiIds: string[];
  onPressRemove: (saved: SavedPlace) => void;
  onPressRestore?: (saved: SavedPlace) => void;
  onPressRow?: (saved: SavedPlace) => void;
}): ReactElement {
  return (
    <FlatList<SavedPlace>
      testID="explore-saved-list"
      className="flex-1"
      data={savedPlaces}
      keyExtractor={(saved) => saved.savedPlaceId}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
      renderItem={({ item, index }) => (
        <SavedPlaceRow
          saved={item}
          rank={index + 1}
          released={releasedPoiIds.includes(item.place.poiId)}
          onPressRemove={onPressRemove}
          onPressRestore={onPressRestore}
          onPressRow={onPressRow}
        />
      )}
    />
  );
}

function RemoveErrorBanner({
  notice,
  onPressAction,
}: {
  notice: PlaceSaveNotice;
  onPressAction?: () => void;
}): ReactElement {
  const actionTestId =
    notice.action === 'login'
      ? 'explore-saved-removeerror-login'
      : notice.action === 'retry'
        ? 'explore-saved-removeerror-retry'
        : null;
  const actionLabel = notice.action === 'login' ? '로그인하기' : '다시 시도';

  return (
    <View
      testID="explore-saved-removeerror"
      className="mx-lg mb-sm flex-row items-start gap-[10px] rounded-button bg-primary-pale p-md"
    >
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

function CtaBar({
  onPress,
  disabled = false,
}: {
  onPress: () => void;
  disabled?: boolean;
}): ReactElement {
  // disabled(TRIP-705, Figma loading) — 로딩 중엔 CTA 를 회색·비활성으로 보여 자리를 지키되
  // 누를 수 없게 한다. Pressable `disabled` 는 press 를 원천 차단하고 accessibilityState 로도 알린다.
  return (
    <View className="w-full border-t border-hairline bg-canvas px-lg pb-lg pt-md">
      <Pressable
        testID="explore-saved-createtrip"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        className={`h-[54px] w-full items-center justify-center rounded-[14px] ${
          disabled ? 'bg-surface-strong' : 'bg-primary'
        }`}
      >
        <Text
          className={`font-noto-bold text-[16px] font-bold ${
            disabled ? 'text-muted' : 'text-on-primary'
          }`}
        >
          이 장소들로 여행 만들기
        </Text>
      </Pressable>
    </View>
  );
}

function LoadingBlock(): ReactElement {
  // Figma 3614:2032 — 6행 스켈레톤(좌 순번 원 · 썸네일 104×80 · 바 2줄 · 우 하트 원)에 행
  // 구분선. 서브텍스트("담은 곳 불러오는 중")는 본문이 아니라 앱바로 올렸다(TRIP-705).
  return (
    <View testID="explore-saved-loading" className="w-full">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <View
          key={index}
          testID={`explore-saved-skeleton-${index}`}
          className="flex-row items-center gap-md border-b border-hairline px-lg py-md"
        >
          <Skeleton className="h-[26px] w-[26px] rounded-pill bg-surface-strong" />
          <Skeleton className="h-20 w-[104px] rounded-thumb bg-surface-strong" />
          <View className="flex-1 gap-sm">
            <Skeleton className="h-[15px] w-2/3 rounded-[6px] bg-hairline" />
            <Skeleton className="h-[13px] w-1/2 rounded-[6px] bg-surface-strong" />
          </View>
          <Skeleton className="h-[26px] w-[26px] rounded-pill bg-surface-strong" />
        </View>
      ))}
    </View>
  );
}

function ErrorBlock({ onRetry }: { onRetry?: () => void }): ReactElement {
  return (
    <View className="w-full items-center justify-center px-lg pt-xl">
      <StateNotice
        testID="explore-saved-error"
        icon={<WarningTriangleGlyph size={32} />}
        title="담은 장소를 불러올 수 없어요"
        description="잠시 후 다시 시도해 주세요"
        actions={[
          {
            testID: 'explore-saved-error-retry',
            label: '다시 시도',
            variant: 'filled',
            onPress: onRetry,
          },
        ]}
      />
    </View>
  );
}

function GuestBlock({
  onPressLogin,
}: {
  onPressLogin?: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-1 items-center justify-center px-lg">
      <StateNotice
        testID="explore-saved-guest"
        icon={<MapPinGlyph size={32} />}
        title="로그인하면 담은 장소를 볼 수 있어요"
        description="마음에 든 곳을 담아 두면 여행 만들기로 바로 이어져요"
        actions={[
          {
            testID: 'explore-saved-guest-login',
            label: '로그인하기',
            variant: 'filled',
            onPress: onPressLogin,
          },
        ]}
      />
    </View>
  );
}

/** empty 삽화(01b Seed Q4 ⓑ) — Figma의 사진 3장 겹침 콜라주를 라운드 사각 3개 + 하트 원으로
 * 재현한다. 실사진은 에셋 라이선스·출처가 미정이라 벡터로 대체(미충족 기록). */
function EmptyCollage(): ReactElement {
  // Figma 1695:1183 — 사진 카드 3장 부채꼴(가운데 앞·크게, 좌우 기울어짐) + 중앙 하트 원.
  // 실사진은 에셋 라이선스·출처 미정이라 회색 벡터로 대체(미충족 기록, 6-b/후속) — 기울기만
  // transform 으로 부채꼴 느낌을 낸다(순수 스타일, 저위험).
  return (
    <View
      testID="explore-saved-empty-art"
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

function EmptyBlock({
  onPressBrowse,
}: {
  onPressBrowse: () => void;
}): ReactElement {
  // TRIP-1050 — e04 와 같은 공통 틀(Figma 1695:1183). 본문은 지역 무관 문구(사용자 결정).
  return (
    <CollageEmptyState
      testID="explore-saved-empty"
      title="마음에 드는 곳을 담아 보세요"
      description={
        '인기 장소를 둘러보고 ♥로 담으면\n여기에 모여 바로 여행이 돼요'
      }
      ctaTestID="explore-saved-browse"
      ctaLabel="장소 둘러보기"
      ctaIcon={
        <SearchGlyph
          size={19}
          tone="on-primary"
          testID="explore-saved-browse-icon"
        />
      }
      onPressCta={onPressBrowse}
    />
  );
}

/** 여행 지역 필터로 0건일 때(TRIP-689 AC-5) — "담은 곳 없음"(거짓)이 아니라 이 여행 지역에
 * 담은 곳이 없다는 별도 안내. 기본 empty(`explore-saved-empty`)와 상호배타다. */
function RegionEmptyBlock({
  onPressBrowse,
}: {
  onPressBrowse: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-1 items-center justify-center px-2xl">
      <StateNotice
        testID="explore-saved-region-empty"
        illustration={<EmptyCollage />}
        title="이 여행 지역에 담은 곳이 없어요"
        description="다른 지역에 담아둔 장소는 여기에 안 보여요. 여행 지역의 장소를 둘러보고 담아 보세요"
        actions={[
          {
            testID: 'explore-saved-region-empty-browse',
            label: '장소 둘러보기',
            variant: 'filled',
            onPress: onPressBrowse,
          },
        ]}
      />
    </View>
  );
}

export function SavedPlaceListScreen({
  savedPlaces,
  state = { kind: 'results' },
  regionFilterEmpty = false,
  removeError,
  isGuest = false,
  releasedPoiIds = [],
  onPressRemove,
  onPressRestore,
  onPressRow,
  onPressCreateTrip,
  onPressBrowse,
  onRetry,
  onPressLogin,
  onPressRemoveErrorAction,
  onBack,
}: SavedPlaceListScreenProps): ReactElement {
  const face = resolveFace(isGuest, state);
  const showLoading = face === 'loading';
  const showPlaceError = face === 'error';
  // 지역 필터 0건은 기본 empty 를 이긴다(상호배타). 에러·로딩 중엔 그 얼굴이 먼저다(INV-4).
  const showRegionEmpty = regionFilterEmpty && !showPlaceError;
  const showEmptyFace = !showRegionEmpty && face === 'empty';
  // 목록이 남아 있으면(재조회 실패로 얼굴이 error 로 넘어가도) 행·CTA 는 유지한 채 에러
  // 안내를 함께 그린다 — 얼굴을 error 하나로 통째로 바꾸면 남은 목록이 사라진다(TRIP-223
  // 03b W-2, TRIP-222 03b W-1 과 같은 방향).
  const showResults =
    face === 'results' || (face === 'error' && savedPlaces.length > 0);
  // released(빈 하트) 행은 담김이 풀린 항목이라 개수·CTA 활성 판정에서 뺀다(01b Seed Q1=a,
  // BR-U1-09 와 결이 맞음). 행 자체는 목록에 그대로 남는다(빈 하트).
  const activeSavedCount = showResults
    ? savedPlaces.filter((saved) => !releasedPoiIds.includes(saved.place.poiId))
        .length
    : 0;
  // 앱바 서브텍스트 — 로딩 중엔 "담은 곳 불러오는 중"(Figma 3614:2032, 본문에서 앱바로 이동),
  // 그 밖엔 담은 개수(TRIP-705).
  const subtitle = showLoading
    ? '담은 곳 불러오는 중'
    : activeSavedCount > 0
      ? `${activeSavedCount}곳 · 마음에 든 순서대로`
      : null;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View testID="explore-saved-root" className="flex-1 bg-canvas">
        <AppBar subtitle={subtitle} onBack={onBack} />

        {face === 'guest' ? <GuestBlock onPressLogin={onPressLogin} /> : null}
        {showLoading ? (
          <>
            <View className="flex-1">
              <LoadingBlock />
            </View>
            {/* Figma loading 은 하단 CTA 를 회색 비활성으로 남겨 자리를 지킨다(TRIP-705). */}
            <CtaBar onPress={onPressCreateTrip} disabled />
          </>
        ) : null}

        {face !== 'guest' && !showLoading ? (
          <>
            {showPlaceError ? <ErrorBlock onRetry={onRetry} /> : null}

            {showResults ? (
              <>
                <ResultsList
                  savedPlaces={savedPlaces}
                  releasedPoiIds={releasedPoiIds}
                  onPressRemove={onPressRemove}
                  onPressRestore={onPressRestore}
                  onPressRow={onPressRow}
                />
                {removeError ? (
                  <RemoveErrorBanner
                    notice={removeError}
                    onPressAction={onPressRemoveErrorAction}
                  />
                ) : null}
                {activeSavedCount > 0 ? (
                  <CtaBar onPress={onPressCreateTrip} />
                ) : null}
              </>
            ) : null}

            {showRegionEmpty ? (
              <RegionEmptyBlock onPressBrowse={onPressBrowse} />
            ) : null}
            {showEmptyFace ? (
              <EmptyBlock onPressBrowse={onPressBrowse} />
            ) : null}
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
