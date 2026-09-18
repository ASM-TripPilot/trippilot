/**
 * d06 장소 상세 배선(TRIP-456 · US-EXPL-01~04). 단건 조회 계약(`GET /places/{poiId}`)이 아직
 * 없어, poiId 로 앞 화면이 이미 채운 **캐시**에서 장소를 골라 쓴다(오케 확정: 데이터 출처 A).
 *
 * ★ TRIP-501 — 상세는 목록 전량(`GET /places` 약 2MB)을 **새로 받지 않는다**. 예전엔 `useGetPlaces()`
 * 로 전량을 받아 1건을 찾았는데(11,101건 받아 1건), 목록에 상한이 걸리면(TRIP-503) 대상이 응답에서
 * 빠져 상세가 조용히 깨진다. 대신 QueryClient 캐시를 읽는다 — d04 는 `GET /places`(region·category
 * 조합별 캐시 키)를, d02 는 `GET /saved-places`(entry.place)를 이미 채워 두므로 **두 캐시를 다 본다**.
 * `getQueriesData({ queryKey: ['/places'] })` 는 필터 조합이 뭐든 캐시된 목록을 전부 훑는다(부분 일치).
 * 콜드 딥링크(어느 캐시도 없음)면 notFound 로 접는다 — cache-only 결정의 명시적 천장(i05 선례).
 *
 * ★ 로딩 판정은 **담은목록 조회**(authed 일 때만)로 본다 — 목록은 캐시 읽기라 즉시 판정되지만,
 * 담은목록만 가진 장소(d02→d06 콜드 담은캐시)는 그 조회가 해소돼야 나타난다. 성급히 notFound 로
 * 접지 않게 그 창에서 loading 을 세운다. 게스트는 담은목록이 없어(enabled:false) 이 창을 안 탄다.
 *
 * 저장 하트는 `useSavedPlaces` 를 그대로 타 서버 토글한다(낙관/롤백은 훅이 이미 이행) — 실패면
 * `saveError` 배너를 세운다(INV-4). 뒤로가기는 딥링크(히스토리 없음)에서 갇히지 않게 canGoBack
 * 폴백을 쓴다(TRIP-402·446 계승). 공유는 계약에 딥링크 URL 이 없어 이름만 나른다(Share.share).
 */
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { InfiniteData } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';

import { getGetPlacesQueryKey } from '@/shared/api/generated/places/places';
import type { Place, PlaceList } from '@/shared/api/generated/schemas';
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

// 목록 캐시는 두 모양이 섞인다 — 랜딩은 PlaceList(단일 장, TRIP-500), d04·수동추가는
// InfiniteData(여러 장, TRIP-502). 둘 다에서 Place[] 를 뽑는다.
function placesFromCache(
  data: PlaceList | InfiniteData<PlaceList> | undefined
): Place[] {
  if (data === undefined) return [];
  return 'pages' in data
    ? data.pages.flatMap((page) => page.items)
    : data.items;
}

export function PlaceDetailPage({ poiId }: { poiId: string }): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthed = getAccessToken() !== null;
  const { savedPlaces, savedPoiIds, save, remove, isPending } = useSavedPlaces({
    isAuthed,
  });
  const [saveError, setSaveError] = useState<PlaceSaveNotice | null>(null);
  const [saving, setSaving] = useState(false);
  // 한 번 찾은 장소는 스냅숏으로 굳힌다 — 상세는 이 캐시의 소유자(관찰자)가 아니라, 앞 화면이
  // 언마운트되면 gcTime 뒤 목록 캐시가 GC 될 수 있다. 굳혀 두지 않으면 상세 도중 재렌더에서
  // 장소가 사라져 notFound 로 깜빡인다. (ponytail: savedCount 등 사후 변동은 안 따라감 — 상세
  // 세션 중 place 본문은 안 바뀌므로 무해.)
  const [snapshot, setSnapshot] = useState<Place | null>(null);

  // 목록 캐시(필터 조합 무관 전부)를 훑어 poiId 를 찾는다 — 새 조회를 일으키지 않는다(TRIP-501).
  const cachedListPlace = queryClient
    .getQueriesData<PlaceList | InfiniteData<PlaceList>>({
      queryKey: getGetPlacesQueryKey(),
    })
    .flatMap(([, data]) => placesFromCache(data))
    .find((p) => p.poiId === poiId);

  // 스냅숏 → 목록 캐시 → 담은목록 순으로 본다 — CLOSED/UNVERIFIED 담긴 장소는 /places(ACTIVE만)엔 없다.
  const place =
    snapshot ??
    cachedListPlace ??
    savedPlaces.find((entry) => entry.place.poiId === poiId)?.place ??
    null;

  useEffect(() => {
    if (place !== null && snapshot === null) setSnapshot(place);
  }, [place, snapshot]);

  // 목록 캐시엔 없고 담은목록 조회가 아직 해소 중이면(authed) loading — 성급히 notFound 로 접지 않는다.
  if (place === null && isAuthed && isPending) {
    return <View testID="explore-place-loading" className="flex-1 bg-canvas" />;
  }

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
