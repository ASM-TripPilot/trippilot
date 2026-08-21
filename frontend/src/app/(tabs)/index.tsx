import { useState } from 'react';
import { useRouter } from 'expo-router';

import {
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { getAccessToken } from '@/shared/api/tokenManager';
import { isNotFound } from '@/shared/api/isNotFound';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import {
  formatNightsLabel,
  itineraryDestinationHref,
  resolveItineraryDestination,
} from '@/features/itinerary/model/planState';
import { formatTripRange } from '@/features/trip/model/baseScreen';
import { HOME_NO_TRIP_PROPS } from '@/features/home/model/homeFixtures';
import { resolveHomePhase } from '@/features/home/model/homePhase';
import type { HomePhase } from '@/features/home/model/homeTypes';
import { HomeScreen } from '@/features/home/ui/HomeScreen';

interface HomeNav {
  onPressCreateTrip: () => void;
  onPressSavedPlaces: () => void;
  onPressSavedStays: () => void;
  onPressSpotsMore: () => void;
  onPressSearch: () => void;
  savedMenuOpen: boolean;
  onToggleSavedMenu: () => void;
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
  phase: HomePhase;
  nav: HomeNav;
}) {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(dominantTripId);

  // 지배 여행 일정 상태 → 목적지 문자열. 홈 카드 CTA 가 그 화면으로 push 한다(일정 탭과 같은
  // resolveItineraryDestination 규칙 공유). itinerary GET 이 미정착(로딩·비-404 오류)이면 목적지를
  // 모르므로 push 하지 않는다 — 정착 전 오이동 금지(형제 itinerary.tsx 의 INV-4 처리와 대칭).
  const onPressTripHeroCta = () => {
    const notFound = isNotFound(itinerary.error);
    if (itinerary.isPending || (itinerary.isError && !notFound)) return;
    router.push(
      itineraryDestinationHref(
        dominantTripId,
        resolveItineraryDestination({
          notFound,
          generationState: itinerary.data?.generationState,
          status: itinerary.data?.status,
        })
      )
    );
  };

  return (
    <HomeScreen
      {...HOME_NO_TRIP_PROPS}
      phase={phase}
      onPressTripHeroCta={onPressTripHeroCta}
      {...nav}
    />
  );
}

// 홈 탭 라우트 — CTA 라우팅(TRIP-370)에 더해 GET /trips 실데이터로 여행 유무를 판정한다(TRIP-371).
// HomeScreen 은 서버·라우터를 모르는 순수 화면(homeStructure D-1)이라, 조회·판정·라우팅은 이
// app 층 라우트만 물고 화면엔 phase/콜백만 내린다(explore.tsx 선례).
//
// meta 문자열(기간·박수·인원)은 features/trip·itinerary 포맷터 조립이라 feature 경계를 넘는다 —
// resolveHomePhase 는 경계 안에 순수하게 두고, 조립 함수를 이 라우트가 주입한다(02a §4-★1).
export default function HomeRoute() {
  const router = useRouter();
  const trips = useGetTrips();
  const isAuthed = getAccessToken() !== null;
  const { savedPoiIds } = useSavedPlaces({ isAuthed });

  // 담은 곳 saved-menu 열림 상태(TRIP-494) — 순수 화면이 useState 0건이라 라우트가 소유한다
  // (탐색 랜딩 선례와 동형). 미니 FAB press 는 메뉴를 닫고 각각 d02/e04 로 이동한다.
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);

  const nav: HomeNav = {
    onPressCreateTrip: () => router.push('/trips/new/step1'),
    onPressSavedPlaces: () => {
      setSavedMenuOpen(false);
      router.push('/explore/saved-places');
    },
    onPressSavedStays: () => {
      setSavedMenuOpen(false);
      router.push('/stays/saved');
    },
    onPressSpotsMore: () => router.push('/explore/places'),
    onPressSearch: () => router.push('/explore/search'),
    savedMenuOpen,
    onToggleSavedMenu: () => setSavedMenuOpen((v) => !v),
  };

  // 조회 진행 중 — 섹션만 로딩 스켈레톤, phase 미전달. no-trip(discovery)으로 확정하지 않는다(INV-4).
  if (trips.isPending) {
    return (
      <HomeScreen
        {...HOME_NO_TRIP_PROPS}
        sections={{ kind: 'loading' }}
        {...nav}
      />
    );
  }

  // 조회 실패 — phase 미전달로 discovery(상록 랜딩) 폴백. 오류를 로딩·여행 없음으로 뭉개지 않는다(INV-4).
  if (trips.isError) {
    return <HomeScreen {...HOME_NO_TRIP_PROPS} {...nav} />;
  }

  // 데이터 도착 후에만 여행 유무를 판정한다. 비-ENDED 지배 여행이 있으면 planning, 없으면 undefined→discovery.
  const phase = resolveHomePhase({
    trips: trips.data ?? [],
    today: new Date().toISOString().slice(0, 10),
    savedCount: savedPoiIds.length,
    formatTripMeta: (trip) =>
      `${formatTripRange(trip.startDate, trip.endDate)} · ${formatNightsLabel(
        trip.startDate,
        trip.endDate
      )} · ${trip.party}명`,
  });

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

  return <HomeScreen {...HOME_NO_TRIP_PROPS} phase={phase} {...nav} />;
}
