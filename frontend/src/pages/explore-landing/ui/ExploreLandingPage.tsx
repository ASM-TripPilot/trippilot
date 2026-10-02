import type { ReactElement } from 'react';
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { Place, StayItem } from '@/shared/api/generated/schemas';
import { getAccessToken } from '@/shared/api/tokenManager';
import { guardPress } from '@/shared/press/pressGuard';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { stayKey } from '@/features/stay/model/stayKey';
import { useSavedStays } from '@/features/stay/model/savedStays';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { usePlaceSaveToggle } from '@/features/save-place/model/placeSaveToggle';
import { useRegions } from '@/features/explore/model/regions';
import { useSavedPlaces } from '@/features/save-place/model/savedPlaces';
import { regionPickerHref } from '@/features/explore/model/regionPickerPurpose';
import { useGetPlaces } from '@/shared/api/generated/places/places';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import {
  ExploreLandingScreen,
  type ExploreLandingScreenProps,
  type PlaceCardVM,
  type StayCardVM,
} from './ExploreLandingScreen';

/**
 * 탐색 page — 죽은 껍데기가 아니라 d01 탐색 랜딩(US-EXPL-01)을 배선한다. 라우트 `(tabs)/explore.tsx`
 * 는 이 page 를 꽂기만 한다(TRIP-1142).
 *
 * 왜 page 가 훅을 무는가: 랜딩 화면(`ExploreLandingScreen`)은 `features/explore` 라
 * `@/features/stay` import·훅·zustand 를 두지 않는 순수 프레젠테이션이다. 그래서 조회 두 개(`useStaySearch`·`useSavedPlaces`)와
 * `formatPrice`/`stayKey` 카드 매핑, 그리고 숙소 담기 하트(`useSavedStays`) 배선은 스캔 밖인
 * 이 page 가 진다 — `itinerary.tsx` 승격과 동형(브리프 §0-1).
 *
 * 검색창 탭 → `regionPickerHref('explore')`(입력 불가 진입 버튼 — 여행지 선택 정본으로 진입,
 * TRIP-499 통합검색 은퇴) · 모두 보기 → `/stays?region={레인 지역}`(첫 카드 지역을 실어 부산 폴백 회피) ·
 * 담은 곳 saved-menu FAB(TRIP-494) → 펼치면 담은 장소 `/explore/saved-places`(d02) · 저장한 숙소
 * `/stays/saved`(e04), 0곳이어도 유지 — TRIP-448 계승). 구획별 독립 쿼리라 숙소 레인 실패가
 * 나머지 구획을 안 죽인다(INV-4).
 *
 * 지역 필터(TRIP-1105): 지역 선택(purpose=explore)이 `region`(지역 **코드**) 파라미터를 싣고 이 탭으로
 * 돌아온다(옛 목적지 상세 화면을 합쳤다 — 진짜 탭바라 진입 경로와 상관없이 '탐색'이 켜진다). 두 조회는
 * **이름** 기반 서버 파라미터라, 이름은 `useRegions()` 캐시에서 코드로 역인덱스하고 풀리기 전엔 조회를
 * 꺼 둔다(코드 문자열을 region 에 실으면 아무 것도 안 걸린다). 꺼진 쿼리는 영원히 대기라, 카탈로그
 * 실패·코드 없음은 로딩이 아니라 재시도(카탈로그 재조회)로 드러낸다(INV-4). `useRegions` 는 필터 자식
 * 에서만 부른다 — 필터 없는 d01 은 카탈로그 조회를 태우지 않는다. 칩 ✕ 는 `setParams` 로 region 을 비운다.
 *
 * 담기 하트(TRIP-447): `useSavedStays`(react-query)는 `QueryClientProvider` 아래서만 돈다.
 * 게스트는 훅을 아예 안 태우고 로그인 유도만 하고, 로그인 사용자만 조건부 자식
 * `SavableStayLane` 에서 훅을 돌린다 — `HomePage` 의 `PlanningHome` 선례(조건부 자식
 * 으로 훅 실행을 격리)와 동형. 이 격리가 없으면 프로바이더 없이 page 를 렌더하는 동결
 * 테스트(`ExploreLandingPage.test.tsx`)가 "No QueryClient" 로 깨진다.
 */

type LandingBase = Pick<
  ExploreLandingScreenProps,
  | 'heading'
  | 'onPressSearch'
  | 'onPressPlaces'
  | 'onPressCreateTrip'
  | 'isLoading'
  | 'regionFilter'
  | 'placeLane'
  | 'savedMenu'
> & {
  stayLane: Pick<
    ExploreLandingScreenProps['stayLane'],
    'error' | 'cards' | 'onRetry' | 'onSeeAll' | 'onPressCard'
  >;
};

// 가볼 곳 가로 레인에 그릴 카드 수 = 서버에 요청할 limit(TRIP-500). 레인 개수와 요청 개수의 단일 출처.
const PLACE_LANE_LIMIT = 8;

/** 레인 한 칸의 조회 결과 — 전국·지역 필터 두 조회 모양을 한 모양으로 편다. */
interface LaneQuery<T> {
  items: T[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/** 지역 필터 상태(TRIP-1105). `regionName` 은 카탈로그에서 풀린 이름(없으면 미해결). */
interface RegionFilter {
  label: string;
  regionName: string | undefined;
}

export function ExploreLandingPage(): ReactElement {
  const { region } = useLocalSearchParams<{ region?: string }>();
  // 피커의 `dismissTo` 는 이 탭을 재마운트하지 않고 params 만 바꿔 넣는다(traps-explore) — 지역이
  // 바뀌거나 비워지면 key 로 본문을 새로 만들어 이전 지역의 배너·대기 표식·saved-menu 열림을 버린다.
  return region ? (
    <RegionExplore key={region} regionCode={region} />
  ) : (
    <NationwideExplore key="" />
  );
}

/** 필터 없는 d01 — 전국 조회(지금 그대로). 장소 조회는 인자 하나로 부른다. */
function NationwideExplore(): ReactElement {
  const stay = useStaySearch();
  // 가로 레인은 개수 제한으로 통일(TRIP-500) — 전량(약 2MB)을 받아 8장만 쓰던 것을, 서버에
  // limit 을 실어 필요한 개수만 받는다(계약 TRIP-503). '모두 보기'(세로 목록)만 무한 스크롤이다.
  const places = useGetPlaces({ limit: PLACE_LANE_LIMIT });
  return (
    <ExploreLanding
      stay={{
        items: stay.data?.items ?? [],
        isPending: stay.isPending,
        isError: stay.isError,
        refetch: () => void stay.refetch(),
      }}
      places={{
        items: places.data?.items ?? [],
        isPending: places.isPending,
        isError: places.isError,
        refetch: () => void places.refetch(),
      }}
    />
  );
}

/** 지역 필터 d01(TRIP-1105) — 코드 → 이름 역인덱스 후 이름으로 두 조회를 켠다. */
function RegionExplore({ regionCode }: { regionCode: string }): ReactElement {
  const regions = useRegions();
  const regionName = regions.data?.find(
    (r) => r.regionCode === regionCode
  )?.name;
  const enabled = regionName !== undefined;
  const stay = useStaySearch({ region: regionName }, { enabled });
  const places = useGetPlaces(
    { region: regionName, limit: PLACE_LANE_LIMIT },
    { query: { enabled } }
  );

  // 이름이 안 풀렸으면 꺼진 조회 대신 카탈로그 상태로 두 레인을 채운다: 조회 중 → 로딩, 실패·코드
  // 없음 → 재시도(카탈로그 재조회). 꺼진 쿼리의 영원한 isPending 을 그대로 쓰면 스켈레톤이 안 끝난다.
  const unresolved = {
    items: [],
    isPending: regions.isPending,
    isError: !regions.isPending,
    refetch: () => void regions.refetch(),
  };

  return (
    <ExploreLanding
      filter={{ label: regionName ?? regionCode, regionName }}
      stay={
        enabled
          ? {
              items: stay.data?.items ?? [],
              isPending: stay.isPending,
              isError: stay.isError,
              refetch: () => void stay.refetch(),
            }
          : unresolved
      }
      places={
        enabled
          ? {
              items: places.data?.items ?? [],
              isPending: places.isPending,
              isError: places.isError,
              refetch: () => void places.refetch(),
            }
          : unresolved
      }
    />
  );
}

/** d01 공통 배선 — 담기 하트·FAB·카드·모두 보기. 전국·지역 필터가 같은 한 벌을 쓴다. */
function ExploreLanding({
  stay,
  places,
  filter,
}: {
  stay: LaneQuery<StayItem>;
  places: LaneQuery<Place>;
  filter?: RegionFilter;
}): ReactElement {
  const router = useRouter();
  const isAuthed = getAccessToken() !== null;
  const savedPlaces = useSavedPlaces({ isAuthed });
  const { savedPoiIds } = savedPlaces;
  // 장소 담기 하트(TRIP-1049) — useState 만 쓰는 훅이라 게스트/로그인 분기 위에서 한 번 부르고
  // base.placeLane 으로 두 경로에 함께 내린다. 게스트 press → 로그인(숙소 하트와 동일).
  const placeSave = usePlaceSaveToggle({
    isAuthed,
    savedPoiIds,
    save: savedPlaces.save,
    remove: savedPlaces.remove,
    places: places.items,
    onRequireLogin: () => router.push('/(auth)/login'),
  });

  // 담은 곳 saved-menu 열림 상태(TRIP-494) — 순수 화면이 useState 0건이라 page 가 소유해
  // 화면에 내린다(sheet 열림을 페이지가 쥐는 선례와 동형).
  const [savedMenuOpen, setSavedMenuOpen] = useState(false);

  // 가볼 곳 레인(TRIP-470) — 앞쪽 소수만(가로 레인이라 전량 필요 없음). 카드 press → d06.
  // 서버가 이미 limit 으로 잘라 주므로 slice 는 방어선(서버가 limit 을 무시해도 레인 개수 고정).
  const placeCards: PlaceCardVM[] = places.items
    .slice(0, PLACE_LANE_LIMIT)
    .map((place) => ({
      poiId: place.poiId,
      name: place.nameKo,
      region: place.region ?? '',
      imageUrl: place.imageUrl ?? null,
    }));

  const items = stay.items;
  const cards: StayCardVM[] = items.map((item) => ({
    key: stayKey(item),
    name: item.name,
    region: item.region,
    priceText: formatPrice(item.price),
  }));

  // "모두 보기"가 실어 보낼 지역 — 필터 중이면 필터 지역 이름, 아니면 레인 첫 카드의 지역(TRIP-412).
  // 없으면 지역 없이 push 하고 착지 화면의 폴백에 맡긴다. 지역을 실어야 부산 폴백(빈 목록)에 안 걸린다.
  const laneRegion = filter ? filter.regionName : items[0]?.region;

  const base: LandingBase = {
    heading: {
      title: '무엇을 둘러볼까요?',
      subtitle: '숙소·장소를 둘러보고 담아요',
    },
    onPressSearch: () => router.push(regionPickerHref('explore')),
    // "가볼 곳" 진입점 → d04 장소 목록(TRIP-453 entry 2). guest·SavableStayLane 양쪽이
    // base 를 spread 하므로 한 곳에 두면 두 경로 모두 배선된다.
    // 필터 중이면 그 지역 이름을 싣는다(TRIP-1105 Q7) — 빈 레인 폴백도 같은 콜백이다.
    onPressPlaces: () =>
      router.push(
        filter?.regionName
          ? `/explore/places?region=${encodeURIComponent(filter.regionName)}`
          : '/explore/places'
      ),
    // ＋ 여행 만들기 FAB → g01 위저드(TRIP-703). 화면은 순수 뷰라 라우터를 모르므로 목적지를
    // 여기(page)가 잇는다. base 스프레드라 guest·SavableStayLane 두 경로 모두 배선된다.
    // 새 여행 진입이라 직전 드래프트를 이동 전에 비운다(TRIP-1012 #074).
    onPressCreateTrip: () => {
      useTripWizardStore.getState().reset();
      router.push('/trips/new/step1');
    },
    // 조회 대기 얼굴(TRIP-704) — 숙소·장소 둘 중 하나라도 첫 조회 중이면 로딩 스켈레톤을 보인다.
    isLoading: stay.isPending || places.isPending,
    // 지역 필터 칩(TRIP-1105) — ✕ 는 URL 의 region 을 비운다(키를 직접 실어야 지워진다). 비워지면
    // page 가 key 로 전국 d01 을 새로 그린다.
    regionFilter: filter && {
      label: filter.label,
      onClear: () => router.setParams({ region: undefined }),
    },
    // 가볼 곳 가로 레인(TRIP-470) — 카드 press → d06 상세.
    placeLane: {
      error: places.isError,
      cards: placeCards,
      onRetry: places.refetch,
      onPressCard: (poiId) => router.push(`/explore/places/${poiId}`),
      savedPoiIds,
      ...placeSave,
    },
    stayLane: {
      error: stay.isError,
      cards,
      onRetry: stay.refetch,
      // TRIP-1013 #012 — 연타의 두 번째 탭이 숙소 검색의 첫 카드를 관통하지 않게 창을 연다
      // (옛 목적지 상세에서 이관, TRIP-1105).
      onSeeAll: guardPress(() =>
        router.push(
          laneRegion
            ? `/stays?region=${encodeURIComponent(laneRegion)}`
            : '/stays'
        )
      ),
      // 카드 탭(TRIP-457 AC-6) — 화면은 card VM 만 올린다(순수 뷰, `@/features/stay` import 금지).
      // page 가 key 로 원본 StayItem 을 역조회해 상세로 push 한다(객체형·raw stayKey 만 — 상세가
      // GET /stays/{stayId} 로 스스로 조회, TRIP-940. expo-router 자동 인코딩, 수동 encode 금지 ★F-3). 하트 press 는 이 콜백을 안 부른다(★F-4).
      onPressCard: (card) => {
        const item = items.find((it) => stayKey(it) === card.key);
        if (item) {
          router.push({
            pathname: '/stays/[stayId]',
            params: { stayId: card.key },
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
