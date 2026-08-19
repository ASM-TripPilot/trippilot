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
import ExploreRoute from '@/app/(tabs)/explore';

/**
 * (tabs)/탐색 진입 라우트 — 죽은 껍데기가 아니라 d01 탐색 랜딩(US-EXPL-01)을 배선한다.
 *
 * 무엇을 보장하나(칸1 AC-E1~E8):
 *  - 🔴 헤딩·검색·axisSeg·lane_stay·lane_itin 자리·bridgeBar 6구획을 그린다(AC-E1) ·
 *    nearby 는 안 그린다(AC-E8, 좌표 없음).
 *  - 🔴 검색 제출 → `/stays?region={입력}` 이동(AC-E2).
 *  - 🔴 lane_stay = `useStaySearch` items 를 가로 카드로, 금액은 `formatPrice` 정확 일치,
 *    "· 1박"(정확 1박가) 없음, "모두 보기" → `/stays`(AC-E3).
 *  - 🔴 lane_itin 은 준비중 자리(실카드·라우팅 0, AC-E4).
 *  - 🔴 bridgeBar: 담은 곳 ≥1 → CTA + 여행 만들기 이동 · 0 → 안내, CTA 미노출(AC-E5).
 *  - 🔴 lane_stay 쿼리 error 여도 나머지 구획은 살고 lane_stay 자리에 재시도(AC-E6, INV-4).
 *  - 🔴 axisSeg 4탭, '전체'만 selected, 나머지 눌러도 무동작(AC-E7).
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

const mockUseStaySearch = useStaySearch as jest.MockedFunction<
  typeof useStaySearch
>;
const mockUseSavedPlaces = useSavedPlaces as jest.MockedFunction<
  typeof useSavedPlaces
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

beforeEach(() => {
  mockPush.mockClear();
  mockUseStaySearch.mockReset();
  mockUseSavedPlaces.mockReset();
  // 기본값: 정상 데이터. 각 테스트가 필요한 축만 덮어쓴다.
  mockUseStaySearch.mockReturnValue(stayResults([CARD_A, CARD_B]));
  mockUseSavedPlaces.mockReturnValue(savedResult(['p1']));
});

describe('🔴 AC-E1 · AC-E8 — 6구획 렌더 + nearby 부재', () => {
  it('헤딩·검색·axisSeg·lane_stay·lane_itin·bridge 를 그리고, nearby 는 안 그린다', () => {
    render(<ExploreRoute />);

    // 긍정 — 6구획이 전부 있다.
    [
      'explore-landing',
      'explore-landing-heading',
      'explore-landing-search',
      'explore-axis-all',
      'explore-lane-stay',
      'explore-lane-itin',
      'explore-bridge-cta',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());

    // 부정 — 좌표 파라미터가 없어 '내 주변' 블록은 없다(AC-E8).
    expect(screen.queryByTestId('explore-nearby')).toBeNull();
  });
});

describe('🔴 AC-E2 — 검색창은 입력 불가 진입 버튼 → /explore/region (TRIP-412)', () => {
  it('검색창을 누르면 지역 선택(/explore/region)으로 이동한다 — 자유 문자열이 region 으로 새지 않는다', () => {
    render(<ExploreRoute />);

    // 검색창은 이제 TextInput 이 아니라 Pressable 진입 버튼이다 — 제출이 아니라 탭이다.
    fireEvent.press(screen.getByTestId('explore-landing-search'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toBe('/explore/region');
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

describe('🔴 AC-E5 — bridgeBar 분기 (긍/부정 짝)', () => {
  it('담은 곳 ≥1 이면 "담은 곳 N곳" CTA + 여행 만들기 이동, empty 는 없다', () => {
    mockUseSavedPlaces.mockReturnValue(savedResult(['p1', 'p2']));
    render(<ExploreRoute />);

    const cta = screen.getByTestId('explore-bridge-cta');
    // 부분 포함(regex) — "담은 곳 2곳 · 여행 만들기" 안의 조각(02a ★E-2).
    expect(cta).toHaveTextContent(/담은 곳 2곳/);
    expect(screen.queryByTestId('explore-bridge-empty')).toBeNull();

    fireEvent.press(cta);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toContain('/trips/new');
  });

  it('담은 곳 0 이면 안내(empty)만 있고 CTA 는 미노출이다', () => {
    mockUseSavedPlaces.mockReturnValue(savedResult([]));
    render(<ExploreRoute />);

    expect(screen.getByTestId('explore-bridge-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-bridge-cta')).toBeNull();
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
      'explore-axis-all',
      'explore-lane-itin',
      'explore-bridge-cta',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());

    // lane_stay 자리에 재시도(가시적 실패 신호).
    expect(screen.getByTestId('explore-lane-stay-retry')).toBeOnTheScreen();
  });
});

describe('🔴 AC-E7 — axisSeg 비활성', () => {
  it('4탭 중 전체만 selected 이고, 비활성 탭을 눌러도 무동작이다', () => {
    render(<ExploreRoute />);

    ['all', 'stay', 'place', 'itin'].forEach((k) =>
      expect(screen.getByTestId(`explore-axis-${k}`)).toBeOnTheScreen()
    );
    expect(screen.getByTestId('explore-axis-all')).toBeSelected();
    ['stay', 'place', 'itin'].forEach((k) =>
      expect(screen.getByTestId(`explore-axis-${k}`)).not.toBeSelected()
    );

    // 비활성 탭 press → 네비 없음 + 활성 불변(A9 무동작).
    fireEvent.press(screen.getByTestId('explore-axis-stay'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('explore-axis-all')).toBeSelected();
  });
});
