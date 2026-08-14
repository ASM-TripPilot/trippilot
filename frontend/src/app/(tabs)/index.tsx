import { useRouter } from 'expo-router';

import { useGetTrips } from '@/shared/api/generated/trips/trips';
import { getAccessToken } from '@/shared/api/tokenManager';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { formatNightsLabel } from '@/features/itinerary/model/planState';
import { formatTripRange } from '@/features/trip/model/baseScreen';
import { HOME_NO_TRIP_PROPS } from '@/features/home/model/homeFixtures';
import { resolveHomePhase } from '@/features/home/model/homePhase';
import { HomeScreen } from '@/features/home/ui/HomeScreen';

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

  const nav = {
    onPressCreateTrip: () => router.push('/trips/new/step1'),
    onPressSavedPlaces: () => router.push('/explore/saved-places'),
    onPressSpotsMore: () => router.push('/explore/places'),
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

  return <HomeScreen {...HOME_NO_TRIP_PROPS} phase={phase} {...nav} />;
}
