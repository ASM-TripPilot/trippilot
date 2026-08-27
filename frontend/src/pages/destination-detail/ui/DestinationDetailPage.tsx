/**
 * d03 목적지 상세 배선 (TRIP-183 스텁 → 실화면, 2026-08-22). `RegionPickerPage`(purpose='trip')가
 * `router.push(\`/explore/destination/${region.regionCode}\`)`로 보낸 코드 하나로 숙소·장소
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
import { formatPrice } from '@/features/stay/model/formatPrice';
import { stayKey } from '@/features/stay/model/stayKey';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useRegions } from '@/features/explore/model/regions';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { DestinationDetailScreen } from '@/features/explore/ui/DestinationDetailScreen';
import type {
  PlaceCardVM,
  StayCardVM,
} from '@/features/explore/ui/ExploreLandingScreen';

// 장소 레인은 가로 레인이라 전량이 필요 없다 — 서버 limit으로 필요한 개수만 받는다
// (ExploreLandingScreen의 PLACE_LANE_LIMIT 선례와 같은 값).
const PLACE_LANE_LIMIT = 8;

export function DestinationDetailPage(): ReactElement {
  const router = useRouter();
  const { region: regionCode } = useLocalSearchParams<{ region?: string }>();

  const isAuthed = getAccessToken() !== null;
  const { savedPoiIds } = useSavedPlaces({ isAuthed });
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
        params: { stayId: card.key, item: JSON.stringify(item) },
      });
    }
  }

  return (
    <DestinationDetailScreen
      regionName={displayName}
      // 다시 검색(=다른 지역 고르기) → d1b 여행지 선택(RegionPickerScreen). 이 화면엔 자유
      // 검색어를 다루는 계약이 없다(위 헤더 주석 참고) — 그 화면에서 새로 고른다.
      onPressSearch={() => router.push('/explore/region?purpose=trip')}
      stayLane={{
        error: stay.isError,
        cards: stayCards,
        onRetry: () => void stay.refetch(),
        onSeeAll: () =>
          router.push(`/stays?region=${encodeURIComponent(displayName)}`),
        onPressCard: pressStayCard,
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
      }}
      // `/stays`(StaySearchPage) 선례와 동일한 탭 전환 배선 — replace라 스택에 안 쌓인다.
      onPressTab={(key) =>
        router.replace(key === 'home' ? '/(tabs)' : `/${key}`)
      }
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
