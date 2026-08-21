import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { StayItem, StayPrice } from '@/shared/api/generated/schemas';
import { formatPrice } from '@/features/stay/model/formatPrice';
import { stayKey } from '@/features/stay/model/stayKey';
import { useStaySearch } from '@/features/stay/model/useStaySearch';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { useGetPlaces } from '@/shared/api/generated/places/places';
import ExploreRoute from '@/app/(tabs)/explore';

/**
 * (tabs)/탐색 진입 라우트 — 죽은 껍데기가 아니라 d01 탐색 랜딩(US-EXPL-01)을 배선한다.
 *
 * 무엇을 보장하나(칸1 AC-E1~E6·E8 — TRIP-447 로 축 세그먼트 제거, AC-E7 삭제):
 *  - 🔴 헤딩·검색·lane_stay·lane_itin 자리·담은 곳 FAB 5구획을 그린다(AC-E1) ·
 *    nearby 는 안 그린다(AC-E8, 좌표 없음). 축 세그먼트(axisSeg)는 걷어냈다(TRIP-447 AC-1,
 *    소스 0건은 `exploreLandingAxisRemoval.test.ts` 가 별도로 잠근다).
 *  - 🔴 검색창 탭(입력 불가 진입 버튼) → `/explore/region?purpose=trip`(여행지 선택 정본,
 *    TRIP-499 재배선 — 입력은 RegionPicker 에서 받아 자유 문자열이 region 으로 새지 않는다, AC-E2).
 *    #2(submitEditing 무동작) 유지.
 *  - 🔴 lane_stay = `useStaySearch` items 를 가로 카드로, 금액은 `formatPrice` 정확 일치,
 *    "· 1박"(정확 1박가) 없음, "모두 보기" → `/stays`(AC-E3).
 *  - 🔴 lane_itin 은 준비중 자리(실카드·라우팅 0, AC-E4).
 *  - 🔴 담은 곳 FAB(우하단 하트): 담은 곳(d02)으로, 0곳이어도 유지(AC-E5, TRIP-494/448).
 *  - 🔴 lane_stay 쿼리 error 여도 나머지 구획은 살고 lane_stay 자리에 재시도(AC-E6, INV-4).
 *
 * 왜 이렇게 테스트하나(02a §0-1): 라우트는 router 가 렌더해 props 를 못 받으므로, 두 훅을
 * seam 으로 목한다 — `useStaySearch`(features/stay)·`useSavedPlaces`(features/explore). 조합·
 * `formatPrice`/`stayKey` 매핑은 **라우트**가 진다(랜딩 화면은 `placeExploreStructure` 재귀
 * 스캔이 `@/features/stay` import·훅·zustand 를 0건 강제하는 순수 프레젠테이션이라 화면이
 * 부를 수 없다). `formatPrice`·`stayKey` 는 순수 함수라 목하지 않고 실값으로 대조한다.
 *
 * 목 seam 경로는 라우트의 import 경로와 정확히 같아야 한다(02a ★E-4): 배럴이 아니라
 * `@/features/stay/model/useStaySearch`·`@/features/explore/model/savedPlaces`.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: jest.fn(),
}));
jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: jest.fn(),
}));
// 가볼 곳 레인(TRIP-470)은 라우트가 useGetPlaces 를 문다 — 이 unit 버킷엔 QueryClientProvider 가
// 없어 실훅이 크래시하므로 목 seam 으로 고정한다(useStaySearch·useSavedPlaces 선례와 동형).
jest.mock('@/shared/api/generated/places/places', () => ({
  useGetPlaces: jest.fn(),
}));

const mockUseStaySearch = useStaySearch as jest.MockedFunction<
  typeof useStaySearch
>;
const mockUseSavedPlaces = useSavedPlaces as jest.MockedFunction<
  typeof useSavedPlaces
>;
const mockUseGetPlaces = useGetPlaces as jest.MockedFunction<
  typeof useGetPlaces
>;

function item(
  externalSource: string,
  externalId: string,
  region: string,
  name: string,
  price: StayPrice | null
): StayItem {
  return {
    externalSource,
    externalId,
    name,
    lat: 0,
    lng: 0,
    region,
    amenities: [],
    stayType: 'HOTEL',
    price,
  };
}

// 두 카드 지역을 일부러 다르게 둔다(서울 vs 제주) — "모두 보기"가 **레인 첫 카드**의 지역을
// 데이터에서 파생해 싣는지(TRIP-412)를 잠근다. 둘이 같으면 region 을 리터럴로 하드코딩하거나
// items[1] 로 잘못 집어도 통과해(무증명), 첫 카드 지역이라는 계약이 심판에 안 물린다(code-critic W-1).
// region 없이 push 하면 착지 화면이 부산 폴백에 떨어지므로, 첫 카드 지역(서울)을 실어야 통과한다.
const CARD_A = item('yanolja', '1', '서울', '명동 시티 호텔', {
  amount: 145000,
  currency: 'KRW',
});
const CARD_B = item('agoda', '2', '제주', '성산 게스트하우스', null);

/** 라우트가 읽는 필드(data·isError·isPending)만 채운 조회 결과. */
function stayResults(items: StayItem[]) {
  return {
    data: { items, degraded: false, filterZeroReasons: [] },
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useStaySearch>;
}
function stayError() {
  return {
    data: undefined,
    isError: true,
    isPending: false,
  } as unknown as ReturnType<typeof useStaySearch>;
}

/** bridgeBar 는 savedPoiIds 개수만 읽는다. */
function savedResult(savedPoiIds: string[]) {
  return { savedPoiIds } as unknown as ReturnType<typeof useSavedPlaces>;
}

/** 가볼 곳 레인(TRIP-470) — 라우트는 data(장소 배열)·isError·refetch 만 읽는다. */
function placesResult() {
  return {
    data: [],
    isError: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useGetPlaces>;
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseStaySearch.mockReset();
  mockUseSavedPlaces.mockReset();
  mockUseGetPlaces.mockReset();
  // 기본값: 정상 데이터. 각 테스트가 필요한 축만 덮어쓴다.
  mockUseStaySearch.mockReturnValue(stayResults([CARD_A, CARD_B]));
  mockUseSavedPlaces.mockReturnValue(savedResult(['p1']));
  mockUseGetPlaces.mockReturnValue(placesResult());
});

describe('🔴 AC-E1 · AC-E8 — 5구획 렌더 + nearby 부재', () => {
  it('헤딩·검색·lane_stay·lane_itin·담은 곳 FAB 5구획을 그리고, nearby·축 세그먼트는 안 그린다', () => {
    render(<ExploreRoute />);

    // 긍정 — 5구획이 전부 있다(축 세그먼트는 TRIP-447 로 제거).
    [
      'explore-landing',
      'explore-landing-heading',
      'explore-landing-search',
      'explore-lane-stay',
      'explore-lane-itin',
      'explore-saved-menu-toggle',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());

    // 부정 — 축 세그먼트는 렌더되지 않는다(AC-1, 렌더 층 확인 — 소스 0건은 별도 스캔).
    expect(screen.queryByTestId('explore-axis-all')).toBeNull();

    // 부정 — 좌표 파라미터가 없어 '내 주변' 블록은 없다(AC-E8).
    expect(screen.queryByTestId('explore-nearby')).toBeNull();
  });
});

describe('🔴 AC-E2(TRIP-499) — 검색창은 입력 불가 진입 버튼 → /explore/region?purpose=trip', () => {
  it('검색창을 누르면 여행지 선택(RegionPicker, trip)으로 이동한다 — 자유 문자열이 region 으로 새지 않는다', () => {
    render(<ExploreRoute />);

    // 검색창은 여전히 TextInput 이 아니라 Pressable 진입 버튼이다 — 제출이 아니라 탭이다.
    // TRIP-499 로 목적지를 통합 검색(/explore/search)에서 여행지 선택 정본(/explore/region?purpose=trip)
    // 으로 재배선한다. 입력은 RegionPicker searchBar 에서 받으므로 d01 은 여전히 문자열을 안
    // 다룬다(TRIP-412 가드 그대로 산다). 지금 소스는 옛 목적지라 red. #2(submitEditing 무동작)는 무변경 green.
    fireEvent.press(screen.getByTestId('explore-landing-search'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe(
      '/explore/region?purpose=trip'
    );
  });

  it('자유 문자열이 region 으로 새지 않는다 — 제출(submitEditing)에는 반응하지 않는다', () => {
    render(<ExploreRoute />);

    // 편집 가능한 입력이 되살아나 submitEditing→region push 누출이 재개방되면 이 단언이 red
    // (code-critic W-2). 진입 버튼은 제출 이벤트를 무시해야 한다.
    fireEvent(screen.getByTestId('explore-landing-search'), 'submitEditing', {
      nativeEvent: { text: '성산일출봉' },
    });

    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🔴 AC-E3 — lane_stay 데이터·가격 규칙·모두 보기', () => {
  it('items 를 가로 카드로 그리고, 금액은 formatPrice 정확 일치, 1박가 표기가 없다', () => {
    render(<ExploreRoute />);

    [CARD_A, CARD_B].forEach((it) => {
      const card = screen.getByTestId(`explore-stay-card-${stayKey(it)}`);
      expect(card).toBeOnTheScreen();
      // 금액 정확 일치 — 독립 Text 노드여야 통과(getByText=exact, 02a ★E-2·§5-⑥).
      // 145000 → '145,000원~', null → '가격 미확인'(BR-U1-12/14).
      expect(within(card).getByText(formatPrice(it.price))).toBeOnTheScreen();
      // 지역 표기는 부분 포함(regex).
      expect(card).toHaveTextContent(new RegExp(it.region));
      // 정확 1박가 표기 금지(BR-U1-12).
      expect(within(card).queryByText(/1박/)).toBeNull();
    });
  });

  it('"모두 보기" 를 누르면 레인이 보여준 지역을 실어 /stays 로 이동한다 (TRIP-412)', () => {
    render(<ExploreRoute />);

    fireEvent.press(screen.getByTestId('explore-lane-stay-seeall'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    // 레인 첫 카드 지역(서울)을 실어 보낸다 — items[1]='제주'와 달라야 "첫 카드"임이 증명된다.
    // 파라미터 없이 push 하면 착지 화면이 부산 폴백에 걸린다(TRIP-412 재현).
    // decodeURIComponent — encodeURIComponent 인코딩 관례.
    expect(decodeURIComponent(String(mockPush.mock.calls[0][0]))).toBe(
      '/stays?region=서울'
    );
  });
});

describe('🔴 AC-E4 — lane_itin 자리만', () => {
  it('준비중 안내만 있고 실 카드·상세 라우팅이 없다', () => {
    render(<ExploreRoute />);

    const laneItin = screen.getByTestId('explore-lane-itin');
    expect(laneItin).toBeOnTheScreen();
    // 준비중 자리 문구(BR-U1-05).
    expect(within(laneItin).getByText(/준비\s*중/)).toBeOnTheScreen();
    // 실 카드 없음 — 숙소 카드 testID 규약이 일정 자리 안에 새어들지 않는다.
    expect(within(laneItin).queryByTestId(/explore-stay-card/)).toBeNull();
  });
});

describe('🔴 AC-E5 — 담은 곳 saved-menu FAB → 장소(d02)·숙소(e04)로 펼침 (TRIP-494/448)', () => {
  it('하트 FAB 을 펼치면 담은 장소→d02, 저장한 숙소→e04 두 미니 FAB 이 뜬다', () => {
    mockUseSavedPlaces.mockReturnValue(savedResult(['p1', 'p2']));
    render(<ExploreRoute />);

    // 풀폭 핑크 CTA 바에서 우하단 하트 saved-menu FAB 로 교체됐다(TRIP-494, Figma a01 3012:1731).
    const toggle = screen.getByTestId('explore-saved-menu-toggle');
    expect(toggle).toHaveAccessibleName(/담은 곳 2곳/);
    // 옛 풀폭 CTA 는 더 이상 없다.
    expect(screen.queryByTestId('explore-bridge-cta')).toBeNull();
    // 닫힌 상태엔 미니 FAB 이 없다.
    expect(screen.queryByTestId('explore-saved-places-fab')).toBeNull();
    expect(screen.queryByTestId('explore-saved-stays-fab')).toBeNull();

    // 펼친다 — 두 미니 FAB 이 나타난다.
    fireEvent.press(toggle);
    expect(mockPush).not.toHaveBeenCalled();

    // 담은 장소 → d02.
    fireEvent.press(screen.getByTestId('explore-saved-places-fab'));
    expect(mockPush).toHaveBeenLastCalledWith('/explore/saved-places');

    // 저장한 숙소 → e04(다시 펼쳐서).
    fireEvent.press(screen.getByTestId('explore-saved-menu-toggle'));
    fireEvent.press(screen.getByTestId('explore-saved-stays-fab'));
    expect(mockPush).toHaveBeenLastCalledWith('/stays/saved');
  });

  it('담은 곳 0 곳이어도 FAB 는 유지되고, 펼쳐 d02/e04 빈 상태로 갈 수 있다', () => {
    mockUseSavedPlaces.mockReturnValue(savedResult([]));
    render(<ExploreRoute />);

    // FAB 가 사라지지 않는다 — 0곳 분기로 없애면 d02/e04 빈 상태 도달 경로가 사라진다(TRIP-448).
    const toggle = screen.getByTestId('explore-saved-menu-toggle');
    expect(toggle).toBeOnTheScreen();
    expect(toggle).toHaveAccessibleName(/담은 곳 0곳/);

    fireEvent.press(toggle);
    fireEvent.press(screen.getByTestId('explore-saved-places-fab'));
    expect(mockPush).toHaveBeenLastCalledWith('/explore/saved-places');
  });
});

describe('🔴 AC-E6 — 부분 실패 · 독립 쿼리', () => {
  it('lane_stay 가 error 여도 나머지 구획은 살고 lane_stay 자리에 재시도가 뜬다', () => {
    mockUseStaySearch.mockReturnValue(stayError());
    mockUseSavedPlaces.mockReturnValue(savedResult(['p1']));
    render(<ExploreRoute />);

    // 나머지 구획 생존(침묵 실패 없음, INV-4).
    [
      'explore-landing-heading',
      'explore-landing-search',
      'explore-lane-itin',
      'explore-saved-menu-toggle',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());

    // lane_stay 자리에 재시도(가시적 실패 신호).
    expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();
  });
});

// ── TRIP-453 · entry 2 d01 랜딩 → d04 장소 목록 진입점 ──────────────────────────
describe('🔴 453-AC-2a — "가볼 곳" 구획에 장소 목록(d04) 진입점', () => {
  it('장소 둘러보기 진입점을 누르면 /explore/places 로 이동한다', () => {
    // d01 랜딩은 완성된 d04 장소 목록으로 가는 링크가 없었다(딥링크로만 도달). "가볼 곳" 구획에
    // 최소 진입 링크(조회 없음, Q1=②)를 추가한다. 지금은 explore-lane-place-cta 미존재라
    // getByTestId 가 throw → red. 배선 뒤엔 정확히 /explore/places 로 1회 push.
    render(<ExploreRoute />);

    const placeCta = screen.getByTestId('explore-lane-place-cta');
    expect(placeCta).toBeOnTheScreen();

    fireEvent.press(placeCta);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/explore/places');
  });
});

// ── TRIP-470 · 가볼 곳 가로 레인(장소 카드) ─────────────────────────────────────
describe('🟢 470 — 가볼 곳 레인: 장소 카드 렌더 + press → d06', () => {
  function placesWith(list: unknown[]) {
    return {
      data: list,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useGetPlaces>;
  }

  it('장소가 있으면 카드를 그리고, 카드 press → /explore/places/{poiId}', () => {
    mockUseGetPlaces.mockReturnValue(
      placesWith([
        { poiId: 'poi-1', nameKo: '감천문화마을', region: '사하구' },
        { poiId: 'poi-2', nameKo: '광안리 해변', region: '수영구' },
      ])
    );

    render(<ExploreRoute />);

    expect(screen.getByTestId('explore-place-card-poi-1')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('explore-place-card-poi-2'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/explore/places/poi-2');
  });

  it('장소 조회 오류면 레인 자리에 다시 시도(explore-lane-place-retry)를 그린다', () => {
    mockUseGetPlaces.mockReturnValue({
      data: undefined,
      isError: true,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useGetPlaces>);

    render(<ExploreRoute />);

    expect(screen.getByTestId('explore-lane-place-retry')).toBeOnTheScreen();
  });
});
