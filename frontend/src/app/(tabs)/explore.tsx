import type { ReactElement } from 'react';
import { useState } from 'react';
import { useRouter } from 'expo-router';

import type { StayItem } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';
import { formatPrice } from '@/features/stay/model/formatPrice';
import { stayKey } from '@/features/stay/model/stayKey';
import { useSavedStays } from '@/features/stay/model/savedStays';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { useGetPlaces } from '@/shared/api/generated/places/places';
import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
  type StayCardVM,
} from '@/features/explore/ui/ExploreLandingScreen';

/**
 * (tabs) 탐색 진입 라우트 — 죽은 껍데기가 아니라 d01 탐색 랜딩(US-EXPL-01)을 배선한다.
 *
 * 왜 라우트가 훅을 무는가: 랜딩 화면(`ExploreLandingScreen`)은 `features/explore` 라
 * `placeExploreStructure` 재귀 스캔이 `@/features/stay` import·훅·zustand 를 0건 강제하는
 * 순수 프레젠테이션이다. 그래서 조회 두 개(`useStaySearch`·`useSavedPlaces`)와
 * `formatPrice`/`stayKey` 카드 매핑, 그리고 숙소 담기 하트(`useSavedStays`) 배선은 스캔 밖인
 * 이 라우트(app 층)가 진다 — `itinerary.tsx` 승격과 동형(브리프 §0-1).
 *
 * 검색창 탭 → `/explore/search`(입력 불가 진입 버튼 — 입력은 d05 에서 받아 자유 문자열이 region
 * 으로 새는 걸 막는다, TRIP-450 되돌림) · 모두 보기 → `/stays?region={레인 지역}`(첫 카드 지역을 실어 부산 폴백 회피) ·
 * 담은 곳 saved-menu FAB(TRIP-494) → 펼치면 담은 장소 `/explore/saved-places`(d02) · 저장한 숙소
 * `/stays/saved`(e04), 0곳이어도 유지 — TRIP-448 계승). 구획별 독립 쿼리라 숙소 레인 실패가
 * 나머지 구획을 안 죽인다(INV-4).
 *
 * 담기 하트(TRIP-447): `useSavedStays`(react-query)는 `QueryClientProvider` 아래서만 돈다.
 * 게스트는 훅을 아예 안 태우고 로그인 유도만 하고, 로그인 사용자만 조건부 자식
 * `SavableStayLane` 에서 훅을 돌린다 — `(tabs)/index.tsx` 의 `PlanningHome` 선례(조건부 자식
 * 으로 훅 실행을 격리)와 동형. 이 격리가 없으면 프로바이더 없이 라우트를 렌더하는 동결
 * 테스트(`tabsExploreRoute.test.tsx`)가 "No QueryClient" 로 깨진다.
 */

type LandingBase = Pick<
  ExploreLandingScreenProps,
  'heading' | 'onPressSearch' | 'onPressPlaces' | 'placeLane' | 'savedMenu'
> & {
  stayLane: Pick<
    ExploreLandingScreenProps['stayLane'],
    'error' | 'cards' | 'onRetry' | 'onSeeAll' | 'onPressCard'
  >;
};

export default function ExploreRoute(): ReactElement {
  const router = useRouter();
  const stay = useStaySearch();
  const places = useGetPlaces();
  const isAuthed = getAccessToken() !== null;
  const { savedPoiIds } = useSavedPlaces({ isAuthed });

  // 담은 곳 saved-menu 열림 상태(TRIP-494) — 순수 화면이 useState 0건이라 라우트가 소유해
  // 화면에 내린다(sheet 열림을 페이지가 쥐는 선례와 동형).
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);

  // 가볼 곳 레인(TRIP-470) — 앞쪽 소수만(가로 레인이라 전량 필요 없음). 카드 press → d06.
  const placeCards: PlaceCardVM[] = (places.data ?? [])
    .slice(0, 8)
    .map((place) => ({
      poiId: place.poiId,
      name: place.nameKo,
      region: place.region ?? '',
      imageUrl: place.imageUrl ?? null,
    }));

  const items = stay.data?.items ?? [];
  const cards: StayCardVM[] = items.map((item) => ({
    key: stayKey(item),
    name: item.name,
    region: item.region,
    priceText: formatPrice(item.price),
  }));

  // "모두 보기"가 실어 보낼 지역 — 레인 첫 카드의 지역(TRIP-412). 없으면 지역 없이 push 하고
  // 착지 화면의 폴백에 맡긴다. 지역을 실어야 부산 폴백(빈 목록)에 안 걸린다.
  const laneRegion = items[0]?.region;

  const base: LandingBase = {
    heading: {
      title: '무엇을 둘러볼까요?',
      subtitle: '숙소·장소·여행자 일정을 둘러보고 담아요',
    },
    onPressSearch: () => router.push('/explore/search'),
    // "가볼 곳" 진입점 → d04 장소 목록(TRIP-453 entry 2). guest·SavableStayLane 양쪽이
    // base 를 spread 하므로 한 곳에 두면 두 경로 모두 배선된다.
    onPressPlaces: () => router.push('/explore/places'),
    // 가볼 곳 가로 레인(TRIP-470) — 카드 press → d06 상세.
    placeLane: {
      error: places.isError,
      cards: placeCards,
      onRetry: () => {
        void places.refetch();
      },
      onPressCard: (poiId) => router.push(`/explore/places/${poiId}`),
    },
    stayLane: {
      error: stay.isError,
      cards,
      onRetry: () => {
        void stay.refetch();
      },
      onSeeAll: () =>
        router.push(
          laneRegion
            ? `/stays?region=${encodeURIComponent(laneRegion)}`
            : '/stays'
        ),
      // 카드 탭(TRIP-457 AC-6) — 화면은 card VM 만 올린다(순수 뷰, `@/features/stay` import 금지).
      // 라우트가 key 로 원본 StayItem 을 역조회해 상세로 push 한다(객체형·raw stayKey·item JSON —
      // expo-router 자동 인코딩, 수동 encode 금지 ★F-3). 하트 press 는 이 콜백을 안 부른다(★F-4).
      onPressCard: (card) => {
        const item = items.find((it) => stayKey(it) === card.key);
        if (item) {
          router.push({
            pathname: '/stays/[stayId]',
            params: { stayId: card.key, item: JSON.stringify(item) },
          });
        }
      },
    },
    // 담은 곳 saved-menu FAB(TRIP-494) — 하트 FAB 을 누르면 두 미니 FAB 으로 펼쳐진다:
    // 담은 장소→d02(/explore/saved-places) · 저장한 숙소→e04(/stays/saved). 미니 press 는
    // 메뉴를 닫고 이동한다. 0곳이어도 FAB 은 유지돼 d02/e04 빈 상태로 간다(TRIP-448 계승).
    savedMenu: {
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
    },
  };

  // 로그인 사용자만 담기 훅을 태운다(조건부 자식). 게스트는 하트를 눌러도 요청 없이 로그인
  // 유도만 한다(BR-U1-03 · AC-7 — 서버 미호출 + login push).
  if (isAuthed) {
    return <SavableStayLane base={base} items={items} />;
  }

  return (
    <ExploreLandingScreen
      {...base}
      stayLane={{
        ...base.stayLane,
        savedKeys: [],
        pendingKeys: [],
        onToggleSave: () => router.push('/(auth)/login'),
        saveError: false,
      }}
    />
  );
}

/**
 * 로그인 사용자 전용 숙소 담기 배선(조건부 자식). `useSavedStays`(TRIP-417)를 물어 담김 집합·
 * 대기 집합·실패를 조립해 stayLane 에 얹는다 — `attemptToggle`·pendingKeys 형태는
 * `StaySearchPage`(TRIP-417) 선례를 그대로 계승한다. 게스트는 이 자식을 마운트하지 않으므로
 * 미인증 분기(로그인 유도)는 여기서 다시 다루지 않는다.
 */
function SavableStayLane({
  base,
  items,
}: {
  base: LandingBase;
  items: StayItem[];
}): ReactElement {
  const { isSaved, save, remove, savedKeys } = useSavedStays({
    isAuthed: true,
  });
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [saveError, setSaveError] = useState(false);

  async function attemptToggle(item: StayItem): Promise<void> {
    setSaveError(false);
    const key = stayKey(item);
    setPendingKeys((keys) => [...keys, key]);
    const outcome = isSaved(key) ? await remove(item) : await save(item);
    setPendingKeys((keys) => keys.filter((k) => k !== key));

    // 로그인 사용자라 unauthenticated 는 안 온다 — 남은 실패(404·network·saved-id-unknown)는
    // 침묵하지 않고 배너로 알린다(INV-4). 배너는 다음 하트 press(attemptToggle 첫 줄)로 소멸.
    if (outcome.kind === 'failed') {
      setSaveError(true);
    }
  }

  return (
    <ExploreLandingScreen
      {...base}
      stayLane={{
        ...base.stayLane,
        savedKeys,
        pendingKeys,
        onToggleSave: (card) => {
          const item = items.find((it) => stayKey(it) === card.key);
          if (item) void attemptToggle(item);
        },
        saveError,
        onDismissSaveError: () => setSaveError(false),
      }}
    />
  );
}
