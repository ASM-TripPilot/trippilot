import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import { RegionPickerPage } from './RegionPickerPage';

/**
 * TRIP-445 — e00·d1b 지역 선택 배선. 화면이 올려보낸 선택을 **실제 목적지**로 잇고,
 * 서버 카탈로그(`useRegions`)를 소비하며, 조회 실패를 실패 얼굴로 그린다.
 *
 * 무엇이 바뀌었나(현행 대비): '내 주변'이 사라져 `expo-location`·`@/shared/storage`·
 * `saved-stays`(msw) 목이 전부 없어졌다. 대신 **`useRegions` 목 seam** 하나로 서버 상태를
 * 제어한다 — `useStaySearch`/`useSavedStays` 선례의 "코드젠 경로가 흔들려도 목 대상 한 곳
 * 고정"과 같은 자리다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 호이스팅된다 — 팩토리가 참조하는 바깥 변수는 이름이
 * `mock`으로 시작해야 예외를 받는다(리포 확립 규칙). 이 이름을 바꾸지 마라(★9).
 */

const mockPush = jest.fn();
const mockRefetch = jest.fn();
let mockParams: { purpose?: string } = {};
let mockRegionsResult: {
  data: Region[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

// useRegions 만 갈아끼우고 filterRegions·regionTint 는 실물을 쓴다(requireActual).
jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => mockRegionsResult,
}));

/** 서버 `Region` 표본 도우미. */
function region(
  over: Partial<Region> & Pick<Region, 'regionCode' | 'name'>
): Region {
  return {
    sidoName: over.sidoName ?? '',
    level: over.level ?? RegionLevel.SIGUNGU,
    selectable: over.selectable ?? true,
    poiCount: over.poiCount ?? 5,
    ...over,
  };
}

const BUSAN = region({ regionCode: '26', name: '부산광역시', poiCount: 12 });
const JEJU = region({ regionCode: '50', name: '제주특별자치도', poiCount: 8 });

// TRIP-499 큐레이션(AC-5/6) 픽스처 — 7개(상한 6 초과)여야 "앞 6개만"과 "전량 렌더"가 갈린다.
// 6개면 둘 다 6개 보여 공허 통과. 배열 순서 = 서버 대표순(limitRegionsWhenEmpty 가 앞 6개 slice).
// 이름에 공통 토큰 '시' 를 심어 AC-6 이 "7개 다 매칭되는 검색"으로 6개 상한 미적용을 증명한다.
// 전부 selectable·poiCount>0 이라 RegionPickerScreen 이 SelectableCard(testID explore-region-{code})로 그린다.
const SEVEN_REGIONS: Region[] = [
  region({ regionCode: 'R01', name: '부산시' }),
  region({ regionCode: 'R02', name: '대구시' }),
  region({ regionCode: 'R03', name: '인천시' }),
  region({ regionCode: 'R04', name: '광주시' }),
  region({ regionCode: 'R05', name: '대전시' }),
  region({ regionCode: 'R06', name: '울산시' }),
  region({ regionCode: 'R07', name: '세종시' }),
];

beforeEach(() => {
  mockPush.mockClear();
  mockRefetch.mockClear();
  mockParams = {};
  mockRegionsResult = {
    data: [BUSAN, JEJU],
    isPending: false,
    isError: false,
    refetch: mockRefetch,
  };
});

describe('AC-1/AC-4 · 서버 카탈로그를 그린다', () => {
  it('useRegions가 준 지역을 카드로 그린다', () => {
    render(<RegionPickerPage />);

    expect(screen.getByTestId('explore-region-26')).toBeTruthy();
    expect(screen.getByTestId('explore-region-50')).toBeTruthy();
  });
});

describe('지역 선택 → 목적지 라우팅', () => {
  it('카드를 누르면 지역명을 쿼리에 실어 /stays로 간다 (stay)', () => {
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-50'));

    // 서버 `region`은 자유 문자열 계약이라 한글 이름을 그대로 보낸다(코드가 아니다).
    expect(mockPush).toHaveBeenCalledWith(
      `/stays?region=${encodeURIComponent('제주특별자치도')}`
    );
  });

  it("purpose='trip'이면 regionCode로 여행지 상세로 간다 (D2)", () => {
    mockParams = { purpose: 'trip' };
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-50'));

    // D2 — 목적지 상세 경로의 식별자 자리는 regionCode('50')다.
    expect(mockPush).toHaveBeenCalledWith('/explore/destination/50');
  });

  it('검색으로 좁힌 뒤에도 같은 목적지로 간다', () => {
    render(<RegionPickerPage />);

    fireEvent.changeText(screen.getByTestId('explore-region-search'), '부산');
    fireEvent.press(screen.getByTestId('explore-region-26'));

    expect(mockPush).toHaveBeenCalledWith(
      `/stays?region=${encodeURIComponent('부산광역시')}`
    );
    // 좁혀졌는지도 함께 본다 — 필터가 안 걸리면 이 단언이 무의미해진다.
    expect(screen.queryByTestId('explore-region-50')).toBeNull();
  });
});

describe('AC-5/AC-6 · 큐레이션 (TRIP-499 · 빈 검색어면 앞 6개만, 검색 시 상한 미적용)', () => {
  it('AC-5 · 빈 검색어면 앞 6개만 렌더하고 7번째 지역은 부재다', () => {
    // 준비 — 대표순 7개 지역(상한 6 초과). 검색어는 입력하지 않는다(빈 문자열).
    mockRegionsResult.data = SEVEN_REGIONS;

    // 실행 — 초기 렌더 그대로(빈 검색어) 관찰.
    render(<RegionPickerPage />);

    // 단언 — 1번째·6번째는 있고, 7번째는 없다. 지금 페이지는 상한 없이 filterRegions 결과를 전량
    // 그리므로 7번째가 present → "부재" 단언이 실패해 red. 배선(limitRegionsWhenEmpty) 후 6개로
    // 잘려 green. 6번째 present 는 상한이 6임을 잠근다(5로 낮아지면 red).
    expect(screen.getByTestId('explore-region-R01')).toBeTruthy();
    expect(screen.getByTestId('explore-region-R06')).toBeTruthy();
    expect(screen.queryByTestId('explore-region-R07')).toBeNull();
  });

  it('AC-6 · 검색어를 넣으면 매칭 지역이 6개 상한 없이 전량 렌더된다(선제 green)', () => {
    // 준비 — 이름에 공통 토큰 '시' 를 가진 7개.
    mockRegionsResult.data = SEVEN_REGIONS;
    render(<RegionPickerPage />);

    // 실행 — '시' 는 7개 전부에 포함되므로 filterRegions 가 7개를 다 돌려준다.
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '시');

    // 단언 — 7개가 다 매칭되는데 7번째가 보이면 6개 상한이 안 걸린 것. 무조건 slice(0,6)
    // (검색 중에도 자름) 뮤테이션이면 7번째가 잘려 red 가 된다.
    expect(screen.getByTestId('explore-region-R01')).toBeTruthy();
    expect(screen.getByTestId('explore-region-R07')).toBeTruthy();
  });
});

describe('AC-6 · 조회 실패 (INV-4)', () => {
  it('isError면 실패 얼굴을 그리고 "검색 결과가 없어요"로 뭉개지 않으며, 재시도는 refetch를 부른다', () => {
    mockRegionsResult = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mockRefetch,
    };
    render(<RegionPickerPage />);

    expect(screen.getByTestId('explore-region-error')).toBeTruthy();
    expect(screen.queryByText('검색 결과가 없어요')).toBeNull();

    fireEvent.press(screen.getByTestId('explore-region-error-retry'));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("AC-7 · '내 주변' 배선이 렌더에 없다", () => {
  it("purpose='stay'에서도 '내 주변' 진입이 없다", () => {
    render(<RegionPickerPage />);

    expect(screen.queryByTestId('explore-region-nearby')).toBeNull();
    expect(screen.queryByText('내 주변')).toBeNull();
  });
});
