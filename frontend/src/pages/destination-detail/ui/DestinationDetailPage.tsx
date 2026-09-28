/**
 * d03 목적지 상세 배선 (TRIP-183 스텁 → 실화면, 2026-08-22). `RegionPickerPage`(purpose='explore')가
 * `router.dismissTo(\`/explore/destination/${region.regionCode}\`)`로 보낸 코드 하나로 숙소·장소
 * 두 레인을 채운다. URL엔 코드만 실린다(RegionPickerPage.tsx D2, 계약 불변) — 표시용 지역
 * **이름**은 같은 `useRegions()` 캐시(직전 화면이 채운 그 쿼리키)에서 코드로 역인덱스한다.
 * 캐시가 비어 있으면(딥링크 진입 등) 이 훅이 새로 조회하고, 그 사이엔 코드를 그대로 보인다.
 *
 * 숙소(`GetStaysSearchParams.region`)·장소(`GetPlacesParams.region`) 둘 다 **이름** 기반 서버
 * 파라미터라, 이름이 풀리기 전(로딩 중이거나 못 찾음)엔 두 조회를 `enabled`로 꺼 둔다 — 코드
 * 문자열을 그대로 region에 실어 보내면 아무 것도 안 걸리는 조회가 나간다.
 *
 * 여행자 일정 레인은 조회하지 않는다 — 화면이 정적 "준비 중" 처리를 진다(BR-U1-05).
 *
 * **뒤로가기 없음(2026-08-22 요청)** — `(tabs)` 밖 라우트라 진짜 탭바가 없어 `/stays`(e02)
 * 선례처럼 `BottomTabBar`를 복제해 그리고, `onPressTab`은 그 선례와 같은 `router.replace`
 * 배선이다(스택에 쌓지 않는다 — 탭끼리 옮겨 다니듯 다음 탭이 이 화면을 대체한다). 담은 곳
 * 하트 FAB은 d01 `(tabs)/explore.tsx`의 `savedMenu` 배선(열림 상태·`useSavedPlaces`)을
 * 그대로 복제한다 — 두 라우트가 같은 화면 조각을 공유하진 않지만(화면은 features/explore
 * 안에서 각자 다른 파일), 배선 모양은 의도적으로 같다.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { StayItem } from '@/shared/api/generated/schemas';
import { useGetPlaces } from '@/shared/api/generated/places/places';
import { getAccessToken } from '@/shared/api/tokenManager';
import { guardPress } from '@/shared/press/pressGuard';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { useSavedStays } from '@/features/stay/model/savedStays';
import { stayKey } from '@/features/stay/model/stayKey';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useRegions } from '@/features/explore/model/regions';
import { usePlaceSaveToggle } from '@/features/explore/model/placeSaveToggle';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import {
  regionPickerHref,
  type RegionPickerTab,
} from '@/features/explore/model/regionPickerPurpose';
import { DestinationDetailScreen } from '@/features/explore/ui/DestinationDetailScreen';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import type {
  PlaceCardVM,
  StayCardVM,
} from '@/features/explore/ui/ExploreLandingScreen';

// 장소 칸은 2열 격자 최대 4행이라 전량이 필요 없다 — 서버 limit으로 필요한 개수만 받는다
// (ExploreLandingScreen의 PLACE_LANE_LIMIT 선례와 같은 값).
const PLACE_LANE_LIMIT = 8;

export function DestinationDetailPage(): ReactElement {
  const { region: regionCode, tab } = useLocalSearchParams<{
    region?: string;
    tab?: string;
  }>();
  // 홈 검색으로 들어왔으면 복제 탭바가 홈을 가리킨다(TRIP-1015 E · 결정 4). 아는 값만 받는다(URL 신뢰 경계).
  const entryTab: RegionPickerTab | undefined =
    tab === 'home' ? 'home' : undefined;
  // 피커의 `dismissTo`는 스택 밑의 이 화면을 재마운트 없이 params만 바꿔 되살린다(TRIP-985).
  // 지역이 바뀌면 key로 본문을 새로 만들어 이전 지역의 로컬 상태(저장 실패 배너·대기 표식)와
  // 이전 지역에서 늦게 끝난 저장 결과가 새 지역 화면에 닿지 않게 한다.
  return (
    <DestinationDetailBody
      key={regionCode}
      regionCode={regionCode}
      entryTab={entryTab}
    />
  );
}

function DestinationDetailBody({
  regionCode,
  entryTab,
}: {
  regionCode: string | undefined;
  entryTab: RegionPickerTab | undefined;
}): ReactElement {
  const router = useRouter();

  const isAuthed = getAccessToken() !== null;
  const savedPlaces = useSavedPlaces({ isAuthed });
  const { savedPoiIds } = savedPlaces;
  // 숙소 담기 하트(TRIP-709, `(tabs)/explore.tsx` SavableStayLane 선례) — 서버 상태 소유자는
  // useSavedStays(react-query 캐시)다. 로컬 useState 토글이 아니라 save/remove 실호출이라
  // "저장됐다는 거짓말"이 안 통한다(repo-trap 글리프 함정). 게스트는 훅이 enabled:false 로
  // 요청을 안 보내고, 하트 press 는 로그인으로 보낸다(BR-U1-03).
  const { isSaved, save, remove, savedKeys } = useSavedStays({ isAuthed });
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [saveError, setSaveError] = useState(false);
  // 담은 곳 saved-menu 열림 상태(`(tabs)/explore.tsx` TRIP-494 선례) — 화면은 useState 0건.
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);

  const regions = useRegions();
  const resolvedName = regions.data?.find(
    (r) => r.regionCode === regionCode
  )?.name;
  const displayName = resolvedName ?? regionCode ?? '여행지';

  const stay = useStaySearch(
    { region: resolvedName },
    { enabled: resolvedName !== undefined }
  );
  const places = useGetPlaces(
    { region: resolvedName, limit: PLACE_LANE_LIMIT },
    { query: { enabled: resolvedName !== undefined } }
  );

  const stayItems = stay.data?.items ?? [];
  const stayCards: StayCardVM[] = stayItems.map((item) => ({
    key: stayKey(item),
    name: item.name,
    region: item.region,
    priceText: formatPrice(item.price),
  }));

  // 장소 담기 하트(TRIP-1049) — 이 본문(key=regionCode) 안에 둬 지역이 바뀌면 대기·배너가 함께 사라진다.
  const placeSave = usePlaceSaveToggle({
    isAuthed,
    savedPoiIds,
    save: savedPlaces.save,
    remove: savedPlaces.remove,
    places: places.data?.items ?? [],
    onRequireLogin: () => router.push('/(auth)/login'),
  });

  const placeCards: PlaceCardVM[] = (places.data?.items ?? []).map((place) => ({
    poiId: place.poiId,
    name: place.nameKo,
    region: place.region ?? '',
    imageUrl: place.imageUrl ?? null,
  }));

  function pressStayCard(card: StayCardVM): void {
    const item = stayItems.find((it: StayItem) => stayKey(it) === card.key);
    if (item) {
      router.push({
        pathname: '/stays/[stayId]',
        params: { stayId: card.key },
      });
    }
  }

  // 하트 press — 게스트는 요청 없이 로그인으로(BR-U1-03), 로그인 사용자는 담김이면 remove·
  // 아니면 save 를 실호출한다(낙관/롤백은 훅이 짐, `SavableStayLane` attemptToggle 선례 동형).
  // 실패는 침묵하지 않고 배너로 알린다(INV-4). 배너는 다음 하트 press 첫 줄로 소멸.
  async function attemptToggle(card: StayCardVM): Promise<void> {
    if (!isAuthed) {
      router.push('/(auth)/login');
      return;
    }
    setSaveError(false);
    const item = stayItems.find((it: StayItem) => stayKey(it) === card.key);
    if (!item) return;
    setPendingKeys((keys) => [...keys, card.key]);
    const outcome = isSaved(card.key) ? await remove(item) : await save(item);
    setPendingKeys((keys) => keys.filter((k) => k !== card.key));
    if (outcome.kind === 'failed') {
      setSaveError(true);
    }
  }

  return (
    <DestinationDetailScreen
      regionName={displayName}
      // 다시 검색(=다른 지역 고르기) → d1b 여행지 선택(RegionPickerScreen). 이 화면엔 자유
      // 검색어를 다루는 계약이 없다(위 헤더 주석 참고) — 그 화면에서 새로 고른다.
      // 진입 탭을 다시 실어 보낸다 — 안 실으면 다른 지역을 고른 뒤 탭바가 탐색으로 돌아간다.
      onPressSearch={() =>
        router.push(regionPickerHref('explore', entryTab && { tab: entryTab }))
      }
      activeTab={entryTab ?? 'explore'}
      stayLane={{
        error: stay.isError,
        cards: stayCards,
        onRetry: () => void stay.refetch(),
        // TRIP-1013 #012 — 연타의 두 번째 탭이 숙소 검색의 첫 카드를 관통하지 않게 창을 연다.
        onSeeAll: guardPress(() =>
          router.push(`/stays?region=${encodeURIComponent(displayName)}`)
        ),
        onPressCard: pressStayCard,
        savedKeys,
        pendingKeys,
        onToggleSave: (card) => void attemptToggle(card),
        saveError,
        onDismissSaveError: () => setSaveError(false),
      }}
      placeLane={{
        error: places.isError,
        cards: placeCards,
        onRetry: () => void places.refetch(),
        onSeeAll: () =>
          router.push(
            `/explore/places?region=${encodeURIComponent(displayName)}`
          ),
        onPressCard: (poiId) => router.push(`/explore/places/${poiId}`),
        savedPoiIds,
        ...placeSave,
      }}
      // `/stays`(StaySearchPage) 선례와 동일한 탭 전환 배선 — replace라 스택에 안 쌓인다.
      onPressTab={(key) =>
        router.replace(key === 'home' ? '/(tabs)' : `/${key}`)
      }
      // ＋ 여행 만들기 FAB → g01 위저드(d01 라우트 선례).
      onPressCreateTrip={() => {
        // 새 여행 진입이라 직전 드래프트를 이동 전에 비운다(TRIP-1012 #074).
        useTripWizardStore.getState().reset();
        router.push('/trips/new/step1');
      }}
      savedMenu={{
        open: savedMenuOpen,
        savedCount: savedPoiIds.length,
        onToggle: () => setSavedMenuOpen((v) => !v),
        onPressSavedPlaces: () => {
          setSavedMenuOpen(false);
          router.push('/explore/saved-places');
        },
        onPressSavedStays: () => {
          setSavedMenuOpen(false);
          router.push('/stays/saved');
        },
      }}
    />
  );
}
