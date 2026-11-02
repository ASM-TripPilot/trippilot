/**
 * d06 장소 상세 배선(TRIP-456 · US-EXPL-01~04). 장소는 단건 조회 `GET /places/{poiId}`(TRIP-824, 생성 훅
 * `useGetPlacesPoiId`)로 그린다 — 앞 화면이 넘겨준 목록·담은목록 캐시를 훑지 않는다(TRIP-1372). 그래서 딥링크·
 * 도우미 `next_action` 진입처럼 캐시가 하나도 없어도 그려지고, 목록 전량(`GET /places` 약 2MB)도 받지 않는다.
 *
 * ★ 얼굴 판정: 조회 중 loading → 404(없음·UNVERIFIED)는 notFound → 그 밖의 실패(500·네트워크)는 **오류 얼굴 +
 * 다시 시도**(404 로 접지 않는다, INV-4) → 성공이면 상세. 단건은 폐업(CLOSED)·유실(LOST)도 `dataStatus` 와 함께
 * 주므로(목록은 ACTIVE 만) 상태 배지는 화면이 그린다. `imageUrls`·`admissionFee`·`description` 은 서버에 아직 없다
 * — 그리지 않는다(INV-1).
 *
 * 저장 하트는 `useSavedPlaces` 를 그대로 타 서버 토글한다(낙관/롤백은 훅이 이미 이행) — 실패면
 * `saveError` 배너를 세운다(INV-4). 뒤로가기는 딥링크(히스토리 없음)에서 갇히지 않게 canGoBack
 * 폴백을 쓴다(TRIP-402·446 계승). 공유는 계약에 딥링크 URL 이 없어 이름만 나른다(Share.share).
 * 장소 없음·오류 얼굴에도 같은 뒤로를 앱바에 둔다 — notFound 안내엔 행동 버튼 없음(TRIP-1015 D · 결정 3).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { goBackOr } from '@/shared/lib/goBackOr';
import { shellTabHref } from '@/shared/ui/BottomTabBar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGetPlacesPoiId } from '@/shared/api/index.hooks';
import { getAccessToken, isNotFound } from '@/shared/api';
import { StateNotice } from '@/shared/ui/StateNotice';
import { canOpenNaverPlace, openNaverPlace } from '@/shared/map';

import {
  SAVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/save-place';
import { useSavedPlaces } from '@/features/save-place';
import { BackChevronGlyph } from '@/features/explore';
import { PlaceDetailScreen } from './PlaceDetailScreen';

const OPEN_NAVER_ERROR =
  '네이버 지도를 열 수 없어요. 잠시 후 다시 시도해 주세요.';

// notFound 삽화 — 회색 중립 배지(LivePlacePage 선례, 없는 사진을 지어내지 않는다).
const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

export function PlaceDetailPage({ poiId }: { poiId: string }): ReactElement {
  const router = useRouter();
  const isAuthed = getAccessToken() !== null;
  const detail = useGetPlacesPoiId(poiId);
  const { savedPoiIds, save, remove } = useSavedPlaces({ isAuthed });
  const [saveError, setSaveError] = useState<PlaceSaveNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [openNaverError, setOpenNaverError] = useState<string | null>(null);
  const place = detail.data ?? null;

  function handleBack(): void {
    goBackOr(router, shellTabHref('explore'));
  }

  if (detail.isPending) {
    return <View testID="explore-place-loading" className="flex-1 bg-canvas" />;
  }

  // 404 가 아닌 실패(500·네트워크)는 "장소 없음"이 아니다 — 모르는 걸 없다고 말하지 않는다(INV-4).
  if (place === null && !isNotFound(detail.error)) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas">
          <View className="w-full flex-row items-center bg-canvas pb-sm pl-md pr-lg pt-lg">
            <Pressable
              testID="explore-place-error-back"
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              onPress={handleBack}
              hitSlop={8}
            >
              <BackChevronGlyph />
            </Pressable>
          </View>
          <View className="flex-1 items-center justify-center px-lg">
            <StateNotice
              testID="explore-place-error"
              illustration={NEUTRAL_BADGE}
              title="장소를 불러오지 못했어요"
              description="네트워크를 확인하고 다시 시도해주세요"
              actions={[
                {
                  testID: 'explore-place-retry',
                  label: '다시 시도',
                  variant: 'filled',
                  onPress: () => void detail.refetch(),
                },
              ]}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (place === null) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas">
          {/* 앱바 뒤로 — `ItineraryPlanPage` PlanAppBar 셰브론 패턴(StateNotice 밖) */}
          <View className="w-full flex-row items-center bg-canvas pb-sm pl-md pr-lg pt-lg">
            <Pressable
              testID="explore-place-notfound-back"
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              onPress={handleBack}
              hitSlop={8}
            >
              <BackChevronGlyph />
            </Pressable>
          </View>
          <View className="flex-1 items-center justify-center px-lg">
            <StateNotice
              testID="explore-place-notfound"
              illustration={NEUTRAL_BADGE}
              title="장소를 찾을 수 없어요"
              description="목록에서 다시 찾아 담아 보세요"
              actions={[]}
            />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // place 는 위 가드로 non-null 이 확정됐다. 아래 `attemptToggle`(호이스트되는 함수 선언)이
  // 캡처할 때 CFA 좁힘이 풀려 Place|null 로 넓어지므로, 좁혀진 값을 Place 로 고정해 둔다.
  const resolvedPlace = place;
  const saved = savedPoiIds.includes(poiId);

  async function attemptToggle(): Promise<void> {
    setSaveError(null);
    setSaving(true);
    // save 는 Place 객체를 요구한다(poiId 아님) — 데이터 출처 A 가 넘긴 place 로 담는다.
    const outcome = saved ? await remove(poiId) : await save(resolvedPlace);
    setSaving(false);
    if (outcome.kind === 'failed') {
      setSaveError(SAVE_FAILURE_NOTICE[outcome.reason]);
    }
  }

  async function handleOpenNaver(): Promise<void> {
    setOpenNaverError(null);
    const result = await openNaverPlace(resolvedPlace);
    if (result === 'failed') setOpenNaverError(OPEN_NAVER_ERROR);
  }

  function handlePressSaveErrorAction(): void {
    if (saveError?.action === 'login') {
      router.push('/(auth)/login');
      return;
    }
    if (saveError?.action === 'retry') {
      void attemptToggle();
    }
  }

  return (
    <PlaceDetailScreen
      place={place}
      saved={saved}
      saving={saving}
      saveError={saveError}
      onPressBack={handleBack}
      onPressShare={() => void Share.share({ message: place.nameKo })}
      onToggleSave={() => void attemptToggle()}
      onPressOpenNaver={
        canOpenNaverPlace(place) ? () => void handleOpenNaver() : undefined
      }
      openNaverError={openNaverError}
      onPressSaveErrorAction={handlePressSaveErrorAction}
    />
  );
}
