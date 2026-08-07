import type { ReactElement } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SavedPlace } from '@/shared/api/generated/schemas';
import { StateNotice } from '@/shared/ui/StateNotice';

import type { PlaceListState } from '../model/placeListState';
import type { PlaceSaveNotice } from '../model/placeSaveGuard';
import { SAVED_PLACE_BADGE } from '../model/savedPlaceList';
import {
  BackChevronGlyph,
  HeartFilledGlyph,
  MapPinGlyph,
  WarningTriangleGlyph,
} from './ExploreGlyphs';

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
  /** 해제 실패 배너. 미지정·null = 안 그린다. 위치는 CTA 바 위. */
  removeError?: PlaceSaveNotice | null;
  /** 미로그인 — 목록·빈 상태 대신 로그인 안내만 그린다. 미지정 = false. */
  isGuest?: boolean;
  onPressRemove: (saved: SavedPlace) => void;
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
    <View className="w-full flex-row items-center gap-xs pb-sm pl-[10px] pr-lg">
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
  onPressRemove,
}: {
  saved: SavedPlace;
  rank: number;
  onPressRemove: (saved: SavedPlace) => void;
}): ReactElement {
  const { place } = saved;
  const badge = SAVED_PLACE_BADGE[place.dataStatus];
  const tag = place.tags[0];

  return (
    <View
      testID={`explore-saved-item-${saved.savedPlaceId}`}
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
        onPress={() => onPressRemove(saved)}
        className="h-[38px] w-[38px] items-center justify-center"
      >
        <HeartFilledGlyph size={24} />
      </Pressable>
    </View>
  );
}

function ResultsList({
  savedPlaces,
  onPressRemove,
}: {
  savedPlaces: SavedPlace[];
  onPressRemove: (saved: SavedPlace) => void;
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
          onPressRemove={onPressRemove}
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

function CtaBar({ onPress }: { onPress: () => void }): ReactElement {
  return (
    <View className="w-full border-t border-hairline bg-canvas px-lg pb-lg pt-md">
      <Pressable
        testID="explore-saved-createtrip"
        accessibilityRole="button"
        onPress={onPress}
        className="h-[54px] w-full items-center justify-center rounded-[14px] bg-primary"
      >
        <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
          이 장소들로 여행 만들기
        </Text>
      </Pressable>
    </View>
  );
}

function LoadingBlock(): ReactElement {
  return (
    <View testID="explore-saved-loading" className="w-full gap-lg px-lg pt-lg">
      <Text className="font-noto text-label text-muted-soft">
        담은 장소를 불러오는 중
      </Text>
      <View className="gap-md">
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            testID={`explore-saved-skeleton-${index}`}
            className="h-20 w-full flex-row gap-md"
          >
            <View className="h-20 w-[104px] rounded-thumb bg-surface-strong" />
            <View className="flex-1 gap-sm">
              <View className="h-[15px] w-2/3 rounded-[6px] bg-hairline" />
              <View className="h-[13px] w-1/2 rounded-[6px] bg-surface-strong" />
            </View>
          </View>
        ))}
      </View>
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
  return (
    <View
      testID="explore-saved-empty-art"
      className="h-[162px] w-[220px] flex-row items-center justify-center gap-xs"
    >
      <View className="h-[118px] w-[70px] rounded-card bg-surface-strong" />
      <View className="h-[162px] w-[92px] items-center justify-center rounded-card bg-surface-soft">
        <View className="h-12 w-12 items-center justify-center rounded-pill bg-canvas">
          <HeartFilledGlyph size={26} />
        </View>
      </View>
      <View className="h-[118px] w-[70px] rounded-card bg-surface-strong" />
    </View>
  );
}

function EmptyBlock({
  onPressBrowse,
}: {
  onPressBrowse: () => void;
}): ReactElement {
  return (
    <View className="w-full flex-1 items-center justify-center px-2xl">
      <StateNotice
        testID="explore-saved-empty"
        illustration={<EmptyCollage />}
        title="마음에 드는 곳을 담아 보세요"
        description="부산 인기 장소를 둘러보고 ♥로 담으면 여기에 모여 바로 여행이 돼요"
        actions={[
          {
            testID: 'explore-saved-browse',
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
  removeError,
  isGuest = false,
  onPressRemove,
  onPressCreateTrip,
  onPressBrowse,
  onRetry,
  onPressLogin,
  onPressRemoveErrorAction,
  onBack,
}: SavedPlaceListScreenProps): ReactElement {
  const face = resolveFace(isGuest, state);
  // 목록이 남아 있으면(재조회 실패로 얼굴이 error 로 넘어가도) 행·CTA 는 유지한 채 에러
  // 안내를 함께 그린다 — 얼굴을 error 하나로 통째로 바꾸면 남은 목록이 사라진다(TRIP-223
  // 03b W-2, TRIP-222 03b W-1 과 같은 방향).
  const showResults =
    face === 'results' || (face === 'error' && savedPlaces.length > 0);
  const subtitle = showResults
    ? `${savedPlaces.length}곳 · 마음에 든 순서대로`
    : null;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-canvas">
      <View testID="explore-saved-root" className="flex-1 bg-canvas">
        <AppBar subtitle={subtitle} onBack={onBack} />

        {face === 'guest' ? <GuestBlock onPressLogin={onPressLogin} /> : null}
        {face === 'loading' ? <LoadingBlock /> : null}
        {face === 'error' ? <ErrorBlock onRetry={onRetry} /> : null}
        {face === 'empty' ? <EmptyBlock onPressBrowse={onPressBrowse} /> : null}

        {showResults ? (
          <>
            <ResultsList
              savedPlaces={savedPlaces}
              onPressRemove={onPressRemove}
            />
            {removeError ? (
              <RemoveErrorBanner
                notice={removeError}
                onPressAction={onPressRemoveErrorAction}
              />
            ) : null}
            <CtaBar onPress={onPressCreateTrip} />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
