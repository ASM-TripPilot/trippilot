import { fireEvent, render, screen } from '@testing-library/react-native';

import type {
  Place,
  Region,
  StayItem,
  StayPrice,
} from '@/shared/api/generated/schemas';
import { stayKey } from '@/features/stay/model/stayKey';
import { useRegions } from '@/features/explore/model/regions';
import { useGetPlaces } from '@/shared/api/generated/places/places';
import { useStaySearch } from '@/features/stay/model/useStaySearch';

import { UnifiedSearchPage } from './UnifiedSearchPage';

/**
 * d05 통합 검색 배선 — 검색어 하나로 지역·장소·숙소 **3소스를 각각** 팬아웃하고, 결과를 세
 * 섹션으로 그린다(TRIP-450 · US-EXPL-01~04 · INV-4).
 *
 * 무엇을 보장하나(Seed AC):
 *  - 🔴 AC-1  검색어 → 지역·장소·숙소 3섹션이 각 카드와 함께 뜨고, 숙소는 **특정된 카탈로그
 *            지역명**(2단 조회)으로만 조회된다.
 *  - 🔴 AC-2  장소 카드 탭 → `/explore/places/{poiId}`(카드마다 자기 poiId — 하드코딩 방지).
 *  - 🔴 AC-지역탭(Seed Q4) 지역 행 탭 → `/stays?region={지역 정식명}`(검색어가 아니라 카탈로그명).
 *  - 🔴 AC-4  지역 0매치 → 숙소 섹션 "지역 못 찾음" 안내 **그리고** 숙소 쿼리가 검색어를 region=
 *            으로 안 싣고 `enabled:false`로 꺼진다(헛호출 차단).
 *  - 🔴 AC-실패 한 소스 실패 → 그 섹션만 실패를 알리고 나머지는 산다(세 방향 대칭, INV-4).
 *  - 🔴 AC-금지 자유 문자열이 `region=`으로 **날문자열 직송되지 않는다**(TRIP-412 되돌림의 경계).
 *
 * 왜 이렇게 테스트하나(02a §0): 화면(`features/explore`)은 `placeExploreStructure` 재귀 스캔이
 * `@/features/stay` import·훅을 0건 강제하는 순수 프레젠테이션이라, 3소스 조회·조합은 **페이지**가
 * 진다. 그래서 세 훅을 seam으로 목하고 **페이지가 어떤 인자로 부르나**를 관찰한다 — 특히
 * `useStaySearch`의 호출 인자가 이 티켓의 핵심 트립와이어다(자유 문자열이 region=으로 새는지).
 * `visiblePlaces`·`stayKey`는 순수 함수라 목하지 않고 실값으로 대조한다. 전 훅을 목하므로
 * `QueryClientProvider`가 필요 없다(훅 목이 없으면 `No QueryClient`로 죽는다 — 브리프 배치 함정).
 *
 * msw가 아니라 훅 목인 이유: `enabled:false`면 요청 자체가 안 나가 msw는 "region= 주입하고 껐다"와
 * "아예 안 주입"을 구분 못 한다. 호출 인자 관찰이 그 트립와이어를 정확히 잰다(02a §0).
 */

const mockPush = jest.fn();
let mockParams: { q?: string } = {};

// 정적 `router` 싱글턴과 `useRouter()` 훅을 **둘 다** 같은 목으로 준다 — 배선이 어느 쪽을 쓰든
// 이 파일의 단언은 같다(리포에 두 선례 공존: StaySearchPage vs RegionPickerPage). `router.push`는
// 화살표로 한 겹 감싸 **지연 참조**한다(hoist된 팩토리가 `const mockPush`보다 먼저 도는 함정 회피 —
// PlaceExplorePage.integration 선례).
jest.mock('expo-router', () => ({
  router: { push: (href: string) => mockPush(href) },
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

jest.mock('@/features/explore/model/regions', () => ({
  useRegions: jest.fn(),
}));
jest.mock('@/shared/api/generated/places/places', () => ({
  useGetPlaces: jest.fn(),
}));
jest.mock('@/features/stay/model/useStaySearch', () => ({
  useStaySearch: jest.fn(),
}));

const mockUseRegions = useRegions as jest.MockedFunction<typeof useRegions>;
const mockUseGetPlaces = useGetPlaces as jest.MockedFunction<
  typeof useGetPlaces
>;
const mockUseStaySearch = useStaySearch as jest.MockedFunction<
  typeof useStaySearch
>;

function region(regionCode: string, name: string): Region {
  return {
    regionCode,
    name,
    sidoName: name,
    level: 'SIDO',
    selectable: true,
    poiCount: 120,
  };
}

function place(poiId: string, nameKo: string, savedCount: number): Place {
  return {
    poiId,
    nameKo,
    category: '맛집',
    lat: 35.1587,
    lng: 129.1604,
    region: '부산',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount,
    dataStatus: 'ACTIVE',
  };
}

function stay(
  externalSource: string,
  externalId: string,
  regionName: string,
  name: string,
  price: StayPrice | null
): StayItem {
  return {
    externalSource,
    externalId,
    name,
    lat: 0,
    lng: 0,
    region: regionName,
    amenities: [],
    stayType: 'HOTEL',
    price,
  };
}

// 지역 정식명("부산광역시")을 일부러 검색어("부산")와 다르게 둔다 — 숙소 2단 조회가 **날문자열이
// 아니라 특정된 카탈로그명**을 region=으로 싣는지, 지역 탭이 그 정식명으로 이동하는지 잠근다.
const REGION_BUSAN = region('26', '부산광역시');
const PLACE_A = place('poi-1', '부산 감천문화마을', 30);
const PLACE_B = place('poi-2', '부산 광안리해변', 10);
const STAY_A = stay('yanolja', '1', '부산광역시', '해운대 호텔', {
  amount: 145000,
  currency: 'KRW',
});
const STAY_B = stay('agoda', '2', '부산광역시', '광안리 게스트하우스', null);

/** 각 훅이 읽는 필드(data·isError·isPending·refetch)만 채운 조회 결과. */
function regionsResult(list: Region[]) {
  return {
    data: list,
    isError: false,
    isPending: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useRegions>;
}
function placesResult(list: Place[]) {
  return {
    data: list,
    isError: false,
    isPending: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useGetPlaces>;
}
function stayResult(items: StayItem[]) {
  return {
    data: { items, degraded: false, filterZeroReasons: [] },
    isError: false,
    isPending: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useStaySearch>;
}
/** 세 훅 공용 오류 결과 — 각 호출부에서 해당 훅의 ReturnType 으로 좁힌다(`as unknown as`). */
function errorResult() {
  return {
    data: undefined,
    isError: true,
    isPending: false,
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseRegions.mockReset();
  mockUseGetPlaces.mockReset();
  mockUseStaySearch.mockReset();
  mockParams = { q: '부산' };
  // 기본값: 세 소스 전부 성공. 각 테스트가 필요한 축만 덮어쓴다.
  mockUseRegions.mockReturnValue(regionsResult([REGION_BUSAN]));
  mockUseGetPlaces.mockReturnValue(placesResult([PLACE_A, PLACE_B]));
  mockUseStaySearch.mockReturnValue(stayResult([STAY_A, STAY_B]));
});

describe('🔴 AC-1 — 검색어 → 지역·장소·숙소 3섹션이 각 카드와 함께 뜬다', () => {
  it('3섹션·카드·검색 입력을 그리고, 숙소는 특정된 카탈로그 지역명(2단 조회)으로만 조회된다', () => {
    render(<UnifiedSearchPage />);

    // 3섹션 컨테이너 + 검색 입력 + 헤딩(검색어 되비침, regex=부분포함).
    [
      'explore-search-section-region',
      'explore-search-section-place',
      'explore-search-section-stay',
      'explore-search-input',
    ].forEach((id) => expect(screen.getByTestId(id)).toBeOnTheScreen());
    expect(screen.getByTestId('explore-search-heading')).toHaveTextContent(
      /부산/
    );

    // 각 섹션의 카드가 실제로 그려진다.
    expect(screen.getByTestId('explore-search-region-26')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-search-place-poi-1')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-search-place-poi-2')).toBeOnTheScreen();
    expect(
      screen.getByTestId(`explore-search-stay-${stayKey(STAY_A)}`)
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(`explore-search-stay-${stayKey(STAY_B)}`)
    ).toBeOnTheScreen();

    // ★ 2단 조회 — 숙소는 검색어('부산')가 아니라 **특정된 정식명('부산광역시')**으로 나간다.
    const staySearchCalls = mockUseStaySearch.mock.calls;
    expect(
      staySearchCalls.some(([params]) => params?.region === '부산광역시')
    ).toBe(true);
    expect(staySearchCalls.every(([params]) => params?.region !== '부산')).toBe(
      true
    );
  });
});

describe('🔴 AC-2 — 장소 카드 탭 → /explore/places/{poiId} (하드코딩 방지)', () => {
  it('두 카드가 각자의 poiId 로 상세로 간다', () => {
    render(<UnifiedSearchPage />);

    fireEvent.press(screen.getByTestId('explore-search-place-poi-1'));
    fireEvent.press(screen.getByTestId('explore-search-place-poi-2'));

    // 각 카드가 **자기 poiId**로 push — 리터럴 하드코딩이면 둘째가 첫째와 같아져 red.
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(String(mockPush.mock.calls[0][0])).toBe('/explore/places/poi-1');
    expect(String(mockPush.mock.calls[1][0])).toBe('/explore/places/poi-2');
  });
});

describe('🔴 AC-지역탭 (Seed Q4) — 지역 행 탭 → /stays?region={지역 정식명}', () => {
  it('지역 행을 누르면 검색어가 아니라 카탈로그 정식명을 실어 숙소 목록으로 간다', () => {
    render(<UnifiedSearchPage />);

    fireEvent.press(screen.getByTestId('explore-search-region-26'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    // region.name('부산광역시')을 실어 보낸다 — 검색어('부산')가 아니다(★ AC-금지의 양성 짝).
    // decodeURIComponent — encodeURIComponent 인코딩 관례.
    expect(decodeURIComponent(String(mockPush.mock.calls[0][0]))).toBe(
      '/stays?region=부산광역시'
    );
  });
});

describe('🔴 AC-4 — 지역 0매치 → 숙소 섹션 안내 + region= 미직송 + enabled:false', () => {
  it('지역을 못 찾으면 숙소 섹션이 이유를 알리고, 검색어를 region= 으로 안 싣고 쿼리를 끈다', () => {
    mockParams = { q: '부산맛집' };
    mockUseRegions.mockReturnValue(regionsResult([])); // 지역 0매치
    mockUseGetPlaces.mockReturnValue(placesResult([]));
    render(<UnifiedSearchPage />);

    // ① 숙소 섹션이 조용히 비지 않고 이유를 알린다.
    expect(
      screen.getByTestId('explore-search-stay-no-region')
    ).toBeOnTheScreen();

    // ② 검색어가 region= 으로 **날문자열 직송되지 않는다**(모든 호출 검사).
    const staySearchCalls = mockUseStaySearch.mock.calls;
    expect(
      staySearchCalls.every(([params]) => params?.region !== '부산맛집')
    ).toBe(true);

    // ③ 지역 미특정이면 숙소 쿼리가 꺼진다(헛호출 차단). calls.length>0 앵커로 공허 통과 방지.
    expect(staySearchCalls.length).toBeGreaterThan(0);
    expect(
      staySearchCalls.every(([, options]) => options?.enabled === false)
    ).toBe(true);
  });
});

describe('🔴 AC-실패 (INV-4) — 한 소스 실패 → 그 섹션만, 나머지는 산다', () => {
  it('(a) 장소 실패: 장소 섹션에 재시도가 뜨고 지역·숙소는 살아 있다', () => {
    mockUseGetPlaces.mockReturnValue(
      errorResult() as unknown as ReturnType<typeof useGetPlaces>
    );
    render(<UnifiedSearchPage />);

    // 장소 섹션 실패 신호 + 장소 카드 부재.
    expect(screen.getByTestId('explore-search-place-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-search-place-poi-1')).toBeNull();

    // 나머지 두 섹션 생존(전역 error 접기면 사라져 red).
    expect(screen.getByTestId('explore-search-region-26')).toBeOnTheScreen();
    expect(
      screen.getByTestId(`explore-search-stay-${stayKey(STAY_A)}`)
    ).toBeOnTheScreen();
  });

  it('(b) 지역 실패: 지역 섹션에 재시도가 뜨고 장소는 살아 있다(숙소는 지역 미특정 안내)', () => {
    mockUseRegions.mockReturnValue(
      errorResult() as unknown as ReturnType<typeof useRegions>
    );
    render(<UnifiedSearchPage />);

    // 지역 섹션 실패 신호.
    expect(screen.getByTestId('explore-search-region-retry')).toBeOnTheScreen();

    // 장소는 진짜 독립이라 생존(INV-4 독립성의 핵심 증명 — 전역 접기면 사라져 red).
    expect(screen.getByTestId('explore-search-place-poi-1')).toBeOnTheScreen();

    // 숙소는 2단 조회라 지역 이름이 선행돼야 한다 — 지역 오류면 no-region 안내로 정직하게 생존
    // (크래시 아님, 02a ★6). 지역 오류에서 region= 날문자열도 안 샌다.
    expect(
      screen.getByTestId('explore-search-stay-no-region')
    ).toBeOnTheScreen();
    expect(
      mockUseStaySearch.mock.calls.every(
        ([, options]) => options?.enabled === false
      )
    ).toBe(true);
  });

  it('(c) 숙소 실패: 숙소 섹션에 재시도가 뜨고 지역·장소는 살아 있다', () => {
    // 지역은 특정됨(enabled) → 숙소 쿼리가 실제로 나가 오류가 났다.
    mockUseStaySearch.mockReturnValue(
      errorResult() as unknown as ReturnType<typeof useStaySearch>
    );
    render(<UnifiedSearchPage />);

    // 숙소 섹션 실패 신호(no-region 이 아니라 retry — 지역은 특정됐으므로).
    expect(screen.getByTestId('explore-search-stay-retry')).toBeOnTheScreen();
    expect(screen.queryByTestId('explore-search-stay-no-region')).toBeNull();

    // 나머지 두 섹션 생존.
    expect(screen.getByTestId('explore-search-region-26')).toBeOnTheScreen();
    expect(screen.getByTestId('explore-search-place-poi-1')).toBeOnTheScreen();
  });
});

describe('🔴 AC-금지 — 자유 문자열이 region= 으로 날문자열 직송되지 않는다 (TRIP-412 경계)', () => {
  it('지역 아닌 검색어(성산일출봉)는 region= 에도 어떤 push 에도 날문자열로 새지 않는다', () => {
    mockParams = { q: '성산일출봉' }; // 장소지 지역 아님 → 지역 0매치
    mockUseRegions.mockReturnValue(regionsResult([]));
    render(<UnifiedSearchPage />);

    const staySearchCalls = mockUseStaySearch.mock.calls;

    // ① region= 에 검색어가 안 닿는다 + ② 미특정이라 쿼리가 꺼진다.
    expect(staySearchCalls.length).toBeGreaterThan(0);
    expect(
      staySearchCalls.every(([params]) => params?.region !== '성산일출봉')
    ).toBe(true);
    expect(
      staySearchCalls.every(([, options]) => options?.enabled === false)
    ).toBe(true);

    // ③ 렌더만으로 자동 내비가 없고, 어떤 목적지 문자열에도 검색어가 안 샌다
    //    (/stays?region=성산일출봉 · /explore/destination/["성산일출봉"] 0건).
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      mockPush.mock.calls.every(
        ([href]) => !String(href).includes('성산일출봉')
      )
    ).toBe(true);
  });
});
