import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { getAccessToken } from '@/shared/api/tokenManager';
import { formatPrice } from '@/features/stay/model/formatPrice';
import { stayKey } from '@/features/stay/model/stayKey';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import {
  ExploreLandingScreen,
  type StayCardVM,
} from '@/features/explore/ui/ExploreLandingScreen';

/**
 * (tabs) 탐색 진입 라우트 — 죽은 껍데기가 아니라 d01 탐색 랜딩(US-EXPL-01)을 배선한다.
 *
 * 왜 라우트가 훅을 무는가: 랜딩 화면(`ExploreLandingScreen`)은 `features/explore` 라
 * `placeExploreStructure` 재귀 스캔이 `@/features/stay` import·훅·zustand 를 0건 강제하는
 * 순수 프레젠테이션이다. 그래서 조회 두 개(`useStaySearch`·`useSavedPlaces`)와
 * `formatPrice`/`stayKey` 카드 매핑은 스캔 밖인 이 라우트(app 층)가 진다 — `itinerary.tsx`
 * 승격과 동형(브리프 §0-1).
 *
 * 검색창 탭 → `/explore/region`(입력 불가 진입 버튼, 자유 문자열이 region 으로 새는 걸 막는다,
 * TRIP-412) · 모두 보기 → `/stays?region={레인 지역}`(첫 카드 지역을 실어 부산 폴백 회피) ·
 * bridge CTA → `/trips/new/step1`(일정 탭 빈상태 CTA 목적지와 정합). 구획별 독립 쿼리라
 * 숙소 레인 실패가 나머지 구획을 안 죽인다(INV-4).
 */
export default function ExploreRoute(): ReactElement {
  const router = useRouter();
  const stay = useStaySearch();
  const isAuthed = getAccessToken() !== null;
  const { savedPoiIds } = useSavedPlaces({ isAuthed });

  const cards: StayCardVM[] = (stay.data?.items ?? []).map((item) => ({
    key: stayKey(item),
    name: item.name,
    region: item.region,
    priceText: formatPrice(item.price),
  }));

  // "모두 보기"가 실어 보낼 지역 — 레인 첫 카드의 지역(TRIP-412). 없으면 지역 없이 push 하고
  // 착지 화면의 폴백에 맡긴다. 지역을 실어야 부산 폴백(빈 목록)에 안 걸린다.
  const laneRegion = stay.data?.items?.[0]?.region;

  return (
    <ExploreLandingScreen
      heading={{
        title: '무엇을 둘러볼까요?',
        subtitle: '숙소·장소·여행자 일정을 둘러보고 담아요',
      }}
      onPressSearch={() => router.push('/explore/region')}
      stayLane={{
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
      }}
      bridge={{
        savedCount: savedPoiIds.length,
        onPressCreateTrip: () => router.push('/trips/new/step1'),
      }}
    />
  );
}
