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
