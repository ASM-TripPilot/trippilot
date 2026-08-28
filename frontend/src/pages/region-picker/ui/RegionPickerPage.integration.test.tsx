import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import { RegionPickerPage } from './RegionPickerPage';

/**
 * TRIP-597 — e00·d1b 지역 선택 배선(표면 A 드릴다운). 페이지는 전체 카탈로그를 화면에 내리고
 * (6개 상한 `limitRegionsWhenEmpty` 제거 → 그룹 접기가 대체), 화면이 시/도→구/군 드릴다운으로
 * 접는다. 선택은 **실제 목적지 라우팅**으로 잇고, 조회 실패를 실패 얼굴로 그린다.
 *
 * 무엇이 바뀌었나(현행 TRIP-499 대비):
 *  · 빈 검색어 초기 뷰가 "앞 6개 카드"가 아니라 **시/도 행(그룹)**이다 — 6-cap 테스트를 그룹핑
 *    테스트로 교체했다(02a §1). 라우팅은 초기 카드 press 가 아니라 **검색 경로·드릴다운 경로**로 한다.
 *
 * ⚠️ `jest.mock` 팩토리는 최상단으로 호이스팅된다 — 팩토리가 참조하는 바깥 변수는 이름이 `mock`으로
 * 시작해야 예외를 받는다(리포 확립 규칙). 이 이름을 바꾸지 마라(★9). `useRegions`만 갈아끼우고
 * `filterRegions`·`regionTint`·`groupRegionsBySido`는 requireActual 실물을 쓴다(순수라 안전, ★1).
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

// 시도·시군구 혼재 카탈로그(법정동 앞자리 현실값). 인천 28(시도) / 미추홀 28177 / 연수 28185 /
// 강원 51(시도) / 춘천 51110. 1단이 인천·강원 두 시/도로 접혀야 한다.
//
// ⚠️ 크기·순서 계약(TRIP-597 심판 무결성): 이 티켓의 헤드라인은 페이지가 빈 검색어 6개 상한
// (`limitRegionsWhenEmpty`, 기본 limit=6)을 **걷고 전체 카탈로그를 내리는 것**이다. 그 상한이
// 실수로 되살아나면 `slice(0, 6)`가 앞 6개만 남긴다 — 이를 심판이 잡으려면 **테스트가 실제로
// 누르는 시군구가 flat 인덱스 6 이상**에 있어야 한다(5개짜리 카탈로그에선 `slice(0, 6)`가 항등이라
// 상한 회귀를 구분조차 못 한다 — 옛 `SEVEN_REGIONS`가 7개였던 이유, code-critic 03b 차단-1).
// 그래서 시/도 행 5개로 앞자리를 채우고 인천의 시군구(미추홀 28177·연수 28185)를 **꼬리(인덱스
// 6·7)**로 밀었다. 상한이 되살면 두 시군구가 잘려 AC-3 드릴다운-stay(미추홀구 press)가 red 가 된다.
const INCHEON = region({
  regionCode: '28',
  name: '인천광역시',
  level: RegionLevel.SIDO,
  sidoName: '인천광역시',
  selectable: true,
  poiCount: 50,
});
const SEOUL = region({
  regionCode: '11',
  name: '서울특별시',
  level: RegionLevel.SIDO,
  sidoName: '서울특별시',
  selectable: true,
  poiCount: 120,
});
const BUSAN = region({
  regionCode: '26',
  name: '부산광역시',
  level: RegionLevel.SIDO,
  sidoName: '부산광역시',
  selectable: true,
  poiCount: 80,
});
const DAEGU = region({
  regionCode: '27',
  name: '대구광역시',
  level: RegionLevel.SIDO,
  sidoName: '대구광역시',
  selectable: true,
  poiCount: 40,
});
const GANGWON = region({
  regionCode: '51',
  name: '강원특별자치도',
  level: RegionLevel.SIDO,
  sidoName: '강원특별자치도',
  selectable: false,
  poiCount: 30,
});
const CHUNCHEON = region({
  regionCode: '51110',
  name: '춘천시',
  level: RegionLevel.SIGUNGU,
  sidoName: '강원특별자치도',
  poiCount: 12,
});
const MICHUHOL = region({
  regionCode: '28177',
  name: '미추홀구',
  level: RegionLevel.SIGUNGU,
  sidoName: '인천광역시',
  poiCount: 8,
});
const YEONSU = region({
  regionCode: '28185',
  name: '연수구',
  level: RegionLevel.SIGUNGU,
  sidoName: '인천광역시',
  poiCount: 5,
});

// 인덱스: 0 인천 · 1 서울 · 2 부산 · 3 대구 · 4 강원 · 5 춘천 · 6 미추홀구 · 7 연수구.
// 인천 시군구(미추홀·연수)가 인덱스 6·7 — 상한(6) 되살면 이 둘이 잘려 인천 드릴다운이 빈다.
const CATALOG: Region[] = [
  INCHEON,
  SEOUL,
  BUSAN,
  DAEGU,
  GANGWON,
  CHUNCHEON,
  MICHUHOL,
  YEONSU,
];

beforeEach(() => {
  mockPush.mockClear();
  mockRefetch.mockClear();
  mockParams = {};
  mockRegionsResult = {
    data: CATALOG,
    isPending: false,
    isError: false,
    refetch: mockRefetch,
  };
});

describe('AC-1 · 페이지가 전체 카탈로그를 내리고 화면이 시/도로 접는다 (6-cap 아님)', () => {
  it('빈 검색어 초기 뷰는 시/도 행이고, 구/군(미추홀구)은 접혀 부재다', () => {
    render(<RegionPickerPage />);

    // 시/도 행이 보인다 — 페이지가 6개로 자르지 않고 전량을 내려 화면이 접었다.
    expect(screen.getByTestId('explore-region-sido-28')).toBeTruthy();
    expect(screen.getByTestId('explore-region-sido-51')).toBeTruthy();
    // 구/군은 시/도 안으로 접힘 — 1단에 없다(그룹 접기가 6-cap 을 대체).
    expect(screen.queryByTestId('explore-region-28177')).toBeNull();
  });
});

describe('AC-6 · 검색 경로 → 원본 카탈로그 이름으로 라우팅 (TRIP-387 성질)', () => {
  it('검색으로 좁힌 뒤 구/군 카드를 누르면 그 지역명을 쿼리에 실어 /stays로 간다 (stay)', () => {
    render(<RegionPickerPage />);

    // 검색 — '춘천'으로 좁히면 평면 카드(드릴다운 우회).
    fireEvent.changeText(screen.getByTestId('explore-region-search'), '춘천');
    fireEvent.press(screen.getByTestId('explore-region-51110'));

    // 서버 `region`은 자유 문자열 계약이라 원본 카탈로그의 한글 이름을 그대로 보낸다(코드 아님).
    expect(mockPush).toHaveBeenCalledWith(
      `/stays?region=${encodeURIComponent('춘천시')}`
    );
    // 좁혀졌는지도 함께 본다 — 필터가 안 걸리면 이 단언이 무의미해진다.
    expect(screen.queryByTestId('explore-region-28177')).toBeNull();
  });
});

describe('AC-3/AC-2 · 드릴다운 경로 → 목적지 라우팅', () => {
  it("purpose='trip' 에서 '인천 전체'를 누르면 regionCode 로 여행지 상세로 간다", () => {
    mockParams = { purpose: 'trip' };
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 인천 드릴인
    fireEvent.press(screen.getByTestId('explore-region-28')); // '인천 전체' 행

    // 전체(SIDO Region) 선택 → 목적지 상세 경로의 식별자 자리는 regionCode('28')다.
    expect(mockPush).toHaveBeenCalledWith('/explore/destination/28');
  });

  it('드릴다운 안 구/군 카드를 누르면 그 구/군 이름으로 /stays로 간다 (stay)', () => {
    render(<RegionPickerPage />);

    fireEvent.press(screen.getByTestId('explore-region-sido-28')); // 인천 드릴인
    fireEvent.press(screen.getByTestId('explore-region-28177')); // 미추홀구

    expect(mockPush).toHaveBeenCalledWith(
      `/stays?region=${encodeURIComponent('미추홀구')}`
    );
  });
});

describe('INV-4 · 조회 실패 (이월 유지)', () => {
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

describe("AC · '내 주변' 배선이 렌더에 없다 (이월 유지)", () => {
  it("purpose='stay'에서도 '내 주변' 진입이 없다", () => {
    render(<RegionPickerPage />);

    expect(screen.queryByTestId('explore-region-nearby')).toBeNull();
    expect(screen.queryByText('내 주변')).toBeNull();
  });
});
