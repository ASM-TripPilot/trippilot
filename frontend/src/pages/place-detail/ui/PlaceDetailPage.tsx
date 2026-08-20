/**
 * d06 장소 상세 배선(TRIP-456 · US-EXPL-01~04). 단건 조회 계약(`GET /places/{poiId}`)이 아직
 * 없어, poiId 로 **목록 캐시**에서 장소를 골라 쓴다(오케 확정: 데이터 출처 A). d04 에서 왔으면
 * `GET /places`, d02 에서 왔으면 `GET /saved-places`(entry.place)에 있으므로 **두 캐시를 다 본다**
 * — 콜드 딥링크(캐시 없음)면 못 찾아 notFound 얼굴로 접는다(i05 `-notfound` 선례).
 *
 * ★ 로딩 판정은 **공개 목록 쿼리**(`useGetPlaces().isPending`)만 본다 — `useSavedPlaces`의 저장
 * 쿼리는 `enabled:isAuthed`라 게스트에게 isPending 이 영원히 true 다. 그걸 로딩에 태우면 게스트
 * d06 가 끝나지 않는 로딩이 된다(02a ★6).
 *
 * 저장 하트는 `useSavedPlaces` 를 그대로 타 서버 토글한다(낙관/롤백은 훅이 이미 이행) — 실패면
 * `saveError` 배너를 세운다(INV-4). 뒤로가기는 딥링크(히스토리 없음)에서 갇히지 않게 canGoBack
 * 폴백을 쓴다(TRIP-402·446 계승). 공유는 계약에 딥링크 URL 이 없어 이름만 나른다(Share.share).
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useGetPlaces } from '@/shared/api/generated/places/places';
import { getAccessToken } from '@/shared/api/tokenManager';
import { StateNotice } from '@/shared/ui/StateNotice';

import {
  SAVE_FAILURE_NOTICE,
  type PlaceSaveNotice,
} from '@/features/explore/model/placeSaveGuard';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { PlaceDetailScreen } from '@/features/explore/ui/PlaceDetailScreen';

// 딥링크로 이 화면에 직접 떨어지면(explore/** 는 (tabs) 밖) 뒤로 갈 히스토리가 없다 — 홈으로
// replace 해 탈출구를 준다(개념 [[router.canGoBack() — 딥링크 히스토리 없음 폴백]]).
const HOME_FALLBACK = '/(tabs)';

// notFound 삽화 — 회색 중립 배지(LivePlacePage 선례, 없는 사진을 지어내지 않는다).
const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

export function PlaceDetailPage({ poiId }: { poiId: string }): ReactElement {
  const router = useRouter();
  const isAuthed = getAccessToken() !== null;
  const placesQuery = useGetPlaces();
  const { savedPlaces, savedPoiIds, save, remove } = useSavedPlaces({
    isAuthed,
  });
  const [saveError, setSaveError] = useState<PlaceSaveNotice | null>(null);
  const [saving, setSaving] = useState(false);

  // 공개 목록이 아직 로딩 중이면 로딩 얼굴(★6 — 저장 쿼리는 게스트 영원-pending 이라 안 본다).
  if (placesQuery.isPending) {
    return <View testID="explore-place-loading" className="flex-1 bg-canvas" />;
  }

  // 두 캐시(목록·담은목록)를 다 본다 — CLOSED/UNVERIFIED 담긴 장소는 /places(ACTIVE만)엔 없다.
  const place =
    (placesQuery.data ?? []).find((p) => p.poiId === poiId) ??
    savedPlaces.find((entry) => entry.place.poiId === poiId)?.place ??
    null;

  if (place === null) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID="explore-place-notfound"
          illustration={NEUTRAL_BADGE}
          title="장소를 찾을 수 없어요"
          description="목록에서 다시 찾아 담아 보세요"
          actions={[]}
        />
      </View>
    );
  }

  // place 는 위 가드로 non-null 이 확정됐다. 아래 `attemptToggle`(호이스트되는 함수 선언)이
  // 캡처할 때 CFA 좁힘이 풀려 Place|null 로 넓어지므로, 좁혀진 값을 Place 로 고정해 둔다.
  const resolvedPlace = place;
  const saved = savedPoiIds.includes(poiId);

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(HOME_FALLBACK);
    }
  }

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
      onPressSaveErrorAction={handlePressSaveErrorAction}
    />
  );
}
