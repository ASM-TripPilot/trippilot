import { useState } from 'react';
import { useRouter } from 'expo-router';

import {
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { useGetPlaces } from '@/shared/api/index.hooks';
import { isNotFound } from '@/shared/api';
import { seoulDate } from '@/shared/lib/seoulDate';
import { formatNightsLabel } from '@/entities/trip';
import { formatTripRange } from '@/entities/trip';
import { pickTrendingPlaces } from '@/entities/place';
import { usePlaceSaveToggle } from '@/features/save-place';
import { useSavedPlaces } from '@/features/save-place';
import { regionPickerHref } from '@/features/explore';
import { useSavedStays } from '@/features/save-stay';
import {
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary';
import { HOME_DEFAULT_PROPS } from '../model/homeFixtures';
import { applyItineraryTarget, resolveHomePhase } from '../model/homePhase';
import type { HomePhase, HomeSpotsLane } from '../model/homeTypes';
import { HomeScreen } from './HomeScreen';
import { useTripWizardStore } from '@/features/create-trip';

interface HomeNav {
  onPressCreateTrip: () => void;
  onPressSavedPlaces: () => void;
  onPressSavedStays: () => void;
  onPressSpotsMore: () => void;
  onPressSearch: () => void;
  onPressBell: () => void;
  savedPlacesCount: number;
  savedStaysCount: number;
  savedMenuOpen: boolean;
  onToggleSavedMenu: () => void;
  spotsLane: HomeSpotsLane;
}

// 지배 planning 여행이 있을 때만 마운트되는 자식 — 여기서만 지배 여행의 itinerary GET 을 문다.
// 지배 여행이 없는 렌더(discovery·빈 목록·로딩·오류)는 이 자식을 안 그려 훅이 아예 호출되지
// 않는다 → 이 훅을 목하지 않는 렌더(tabsShell 빈 목록)도 크래시하지 않는다(조건부-자식, 02a §7).
function PlanningHome({
  dominantTripId,
  phase,
  nav,
}: {
  dominantTripId: string;
  phase: Extract<HomePhase, { kind: 'planning' }>;
  nav: HomeNav;
}) {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(dominantTripId);

  // 지배 여행 일정 상태 → 목적지. 홈 카드 CTA 가 그 화면으로 push 하고(일정 탭과 같은
  // resolveItineraryDestination 규칙 공유), 라벨·부제도 같은 목적지로 덮어쓴다(TRIP-986 D1 — 한 판정).
  // itinerary GET 이 미정착(로딩·비-404 오류)이면 목적지를 모르므로 push 하지 않고 라벨도 여행 상태
  // 폴백 그대로 둔다 — 정착 전 오이동 금지(형제 itinerary.tsx 의 INV-4 처리와 대칭, Q2).
  const notFound = isNotFound(itinerary.error);
  const settled = !itinerary.isPending && (!itinerary.isError || notFound);
  const destination = settled
    ? resolveItineraryDestination({
        notFound,
        generationState: itinerary.data?.generationState,
        status: itinerary.data?.status,
        generationMode: itinerary.data?.generationMode,
      })
    : null;

  const onPressTripHeroCta = () => {
    if (destination === null) return;
    router.push(
      itineraryDestinationHref(
        dominantTripId,
        destination,
        itinerary.data?.days
      )
    );
  };

  return (
    <HomeScreen
      {...HOME_DEFAULT_PROPS}
      phase={
        destination === null ? phase : applyItineraryTarget(phase, destination)
      }
      onPressTripHeroCta={onPressTripHeroCta}
      {...nav}
    />
  );
}

// 홈 page — CTA 라우팅(TRIP-370)에 더해 GET /trips 실데이터로 여행 유무를 판정한다(TRIP-371).
// HomeScreen 은 서버·라우터를 모르는 순수 화면이라, 조회·판정·라우팅은 이
// page 만 물고 화면엔 phase/콜백만 내린다(ExploreLandingPage 선례). 라우트 `(tabs)/index.tsx` 는
// 이 page 를 꽂기만 한다(TRIP-1142).
//
// meta 문자열(기간·박수·인원)은 features/trip·itinerary 포맷터 조립이라 feature 경계를 넘는다 —
// resolveHomePhase 는 경계 안에 순수하게 두고, 조립 함수를 이 page 가 주입한다(02a §4-★1).
export function HomePage() {
  const router = useRouter();
  const trips = useGetTrips();
  // 홈은 (tabs) 라 로그인 뒤에만 열린다(SplashGate HOME 가드) — 게스트 분기 없이 로그인으로 넘긴다(TRIP-1164).
  const savedPlaces = useSavedPlaces({ isAuthed: true });
  const { savedPoiIds } = savedPlaces;
  // 담은 곳 미니 FAB 개수 배지(TRIP-695) — 담은 장소 수·전체 저장 숙소 수를 실데이터에서 뽑아
  // 화면에 주입한다. useSavedStays 는 features/stay 것(savedCount 노출) — features/trip 동명 훅 아님.
  const { savedCount: savedStaysCount } = useSavedStays({ isAuthed: true });

  // 담은 곳 saved-menu 열림 상태(TRIP-494) — 순수 화면이 useState 0건이라 page 가 소유한다
  // (탐색 랜딩 선례와 동형). 미니 FAB press 는 메뉴를 닫고 각각 d02/e04 로 이동한다.
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);

  // 데이터 도착 후에만 여행 유무를 판정한다(대기·실패면 data 가 없어 undefined). 비-ENDED 지배 여행이
  // 있으면 planning, 없으면 undefined→discovery. 스팟 조회 지역이 이 판정을 써서 early return 위에 둔다.
  const phase = resolveHomePhase({
    trips: trips.data ?? [],
    today: seoulDate(new Date()),
    savedCount: savedPoiIds.length,
    formatTripMeta: (trip) =>
      `${formatTripRange(trip.startDate, trip.endDate)} · ${formatNightsLabel(
        trip.startDate,
        trip.endDate
      )} · ${trip.party}명`,
  });

  // '지금 뜨는 장소'(TRIP-1049) — 여행 중이면 지배 여행 첫 목적지 지역, 아니면 전국에서 200곳을
  // 받아 담긴 수 순 4장. 서버엔 인기순 정렬이 없어 클라가 고른다(pickTrendingPlaces).
  const spotsRegion =
    phase?.kind === 'planning' && phase.showSpots
      ? trips.data?.find((t) => t.tripId === phase.dominantTripId)
          ?.destinations[0]?.region
      : undefined;
  // 여행 조회 대기 중엔 지역을 모르므로 보내지 않는다(여행 중 사용자에게 전국 200행 낭비 방지).
  // 실패면 발견 얼굴로 폴백하므로 전국 조회를 켠다(끄면 스팟이 영원히 스켈레톤).
  const places = useGetPlaces(
    { ...(spotsRegion ? { region: spotsRegion } : {}), limit: 200 },
    { query: { enabled: !trips.isPending } }
  );
  const trending = pickTrendingPlaces(places.data?.items ?? [], 4);
  const placeSave = usePlaceSaveToggle({
    isAuthed: true,
    savedPoiIds,
    save: savedPlaces.save,
    remove: savedPlaces.remove,
    places: trending,
    onRequireLogin: () => {},
  });
  const spotsLane: HomeSpotsLane = {
    status: places.isPending ? 'loading' : places.isError ? 'error' : 'ready',
    cards: trending.map((place) => ({
      poiId: place.poiId,
      title: place.nameKo,
      tag: `#${place.tags[0] || place.category}`,
      imageUrl: place.imageUrl,
    })),
    onRetry: () => void places.refetch(),
    savedPoiIds,
    ...placeSave,
  };

  const nav: HomeNav = {
    // 새 여행 진입 — 직전 여행 드래프트를 이동 전에 비운다(TRIP-1012 #074).
    onPressCreateTrip: () => {
      useTripWizardStore.getState().reset();
      router.push('/trips/new/step1');
    },
    onPressSavedPlaces: () => {
      setSavedMenuOpen(false);
      router.push('/explore/saved-places');
    },
    onPressSavedStays: () => {
      setSavedMenuOpen(false);
      router.push('/stays/saved');
    },
    onPressSpotsMore: () => router.push('/explore/places'),
    onPressSearch: () => router.push(regionPickerHref('explore')),
    // TRIP-935 R1 — 매거진(a02) 진입을 막는다: onPressMagazine 을 넘기지 않아 page0 은 버튼이 아니다.
    // 매거진 화면은 고정 샘플에 무반응 요소뿐이라(심사 2.1) 실데이터가 생기면 여기서 다시 잇는다.
    // TRIP-939 AC-9 — 인사 헤더 종 press → l01 알림함(/notifications, U6 "어디서든 종 아이콘으로 진입").
    onPressBell: () => router.push('/notifications'),
    savedPlacesCount: savedPoiIds.length,
    savedStaysCount,
    savedMenuOpen,
    onToggleSavedMenu: () => setSavedMenuOpen((v) => !v),
    spotsLane,
  };

  // 조회 진행 중 — 섹션만 로딩 스켈레톤, phase 미전달. no-trip(discovery)으로 확정하지 않는다(INV-4).
  if (trips.isPending) {
    return (
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        sections={{ kind: 'loading' }}
        {...nav}
      />
    );
  }

  // 조회 실패 — discovery(상록 랜딩)는 그대로 두되 그 위에 오류 안내 + [다시 시도]를 띄운다.
  // 안내 없이 discovery 만 그리면 "여행 없음"과 구별되지 않는다(INV-4, TRIP-935).
  // 캐시된 여행이 있으면(재조회만 실패 — v5 는 data 를 남긴 채 error) 그 여행으로 계속 그린다.
  if (trips.isError && !trips.data) {
    return (
      <HomeScreen
        {...HOME_DEFAULT_PROPS}
        tripsError={{
          onRetry: () => void trips.refetch(),
          retrying: trips.isFetching,
        }}
        {...nav}
      />
    );
  }

  // planning 이면 지배 여행 일정을 물어 카드 CTA 목적지를 정하는 자식으로 그린다(조건부-자식 —
  // 위 로딩·오류·빈 목록 렌더는 이 itinerary 훅을 아예 호출하지 않는다).
  if (phase?.kind === 'planning' && phase.dominantTripId !== undefined) {
    return (
      <PlanningHome
        dominantTripId={phase.dominantTripId}
        phase={phase}
        nav={nav}
      />
    );
  }

  return <HomeScreen {...HOME_DEFAULT_PROPS} phase={phase} {...nav} />;
}
