import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PreferenceView, Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/create-trip';
import { RegionPickerPage } from '@/pages/explore/region-picker';
import { TripNewStep1Page } from '@/pages/trip/trip-new-step1';

/**
 * TRIP-1027 AC-6 — **어떤 입력 순서로도** 박수 합과 기간이 어긋나 '다음'이 막히지 않는다.
 *
 * 무엇을 보장하나: 여행지 담기(지역 선택 화면)와 시작 날짜 고르기(1/4 기간 시트), 박수 바꾸기·삭제
 * (1/4 여행지 시트)를 어떤 순서로 섞어도, 끝 날짜는 늘 "시작 + 박수 합"이고 '다음'이 열린다.
 * TRIP-1010 경고-1′(서울 담기 → 기간 적용 → 부산 담기면 박수 합 3 > 기간 2로 막힘)이 C1이다.
 * 스토어 층의 무작위 순서 속성 테스트는 `tripWizardStore.periodFromNights.test.ts` P1 이 맡고,
 * 여기서는 실제 두 페이지를 잇는 대표 순서 셋을 잠근다.
 *
 * 왜 여기(`src/__tests__`)인가: 지역 선택 페이지와 1/4 페이지를 한 사슬로 잇는다. pages 형제
 * 슬라이스끼리는 import 가 막혀 있어 어느 한 페이지 폴더에 둘 수 없다.
 *
 * 왜 실제 스토어인가: 두 페이지가 주고받는 것이 스토어뿐이다 — 목으로 갈면 사슬이 끊긴다.
 * 라우터는 목이다(화면 이동은 unmount → 다음 페이지 render 로 흉내 낸다).
 *
 * ⚠️ 모듈 싱글턴 스토어 — 리셋을 파일 최상위 beforeEach·afterEach 둘 다에 건다.
 * ⚠️ `jest.mock` 팩토리 바깥 변수는 `mock` 접두어만 허용(호이스팅).
 *
 * 3동작: 준비(빈 스토어 · 카탈로그 서울·부산) → 실행(담기·시작 고르기·박수 바꾸기를 순서대로) →
 * 단언(스토어 기간 · 1/4 기간 행 · 다음 열림).
 */

let mockParams: { purpose?: string } = {};

jest.mock('expo-router', () => {
  const push = jest.fn();
  const back = jest.fn();
  const replace = jest.fn();
  const dismissTo = jest.fn();
  return {
    __esModule: true,
    useRouter: () => ({ push, back, replace, dismissTo }),
    router: { push, back, replace, dismissTo },
    useLocalSearchParams: () => ({ ...mockParams }),
  };
});

const mockSeoul: Region = {
  regionCode: '11',
  name: '서울특별시',
  level: RegionLevel.SIDO,
  sidoName: '서울특별시',
  selectable: true,
  poiCount: 120,
};

const mockBusan: Region = {
  regionCode: '26',
  name: '부산광역시',
  level: RegionLevel.SIDO,
  sidoName: '부산광역시',
  selectable: true,
  poiCount: 80,
};

jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => ({
    data: [mockSeoul, mockBusan],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

let mockPreference: PreferenceView | undefined;

jest.mock('@/pages/trip/trip-new-step1/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: mockPreference }),
}));

jest.mock('@/pages/trip/trip-new-step1/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
    reset: jest.fn(),
  }),
}));

jest.mock('@/features/save-place/model/savedPlaces', () => ({
  useSavedPlaces: () => ({
    savedPlaces: [],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
    remove: jest.fn(),
  }),
}));

/** 기준일 고정 — 6/10이 오늘이라 달력은 6/11부터 누를 수 있다. */
const BASE = '2026-06-10';

function store() {
  return useTripWizardStore.getState();
}

/** 지역 선택 화면을 열고 검색으로 좁혀 카드 하나를 누른 뒤 닫는다(= 위저드로 복귀). */
function pickRegion(query: string, regionCode: string): void {
  const view = render(<RegionPickerPage />);
  fireEvent.changeText(screen.getByTestId('explore-region-search'), query);
  fireEvent.press(screen.getByTestId(`explore-region-${regionCode}`));
  view.unmount();
}

/** 1/4 를 열어 기간 시트에서 시작 날짜 **한 번만** 누르고 적용한 뒤 닫는다. */
function pickStart(date: string): void {
  const view = render(<TripNewStep1Page baseDate={BASE} />);
  fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));
  fireEvent.press(screen.getByTestId(`trip-wizard-period-cell-${date}`));
  fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));
  view.unmount();
}

function period(): [string | undefined, string | undefined] {
  return [store().startDate, store().endDate];
}

beforeEach(() => {
  store().reset();
  mockParams = { purpose: 'trip' };
  mockPreference = {
    budget: { tier: '중간', rawAmount: 1200000, isNeutralDefault: false },
    styles: { value: ['미식', '전시'] },
    activities: { value: ['야경'] },
  };
});

afterEach(() => {
  store().reset();
});

describe('TRIP-1027 AC-6 · 입력 순서가 달라도 끝 날짜 = 시작 + 박수 합', () => {
  it('C1 (1010 경고-1′) 서울 담기 → 시작 6/11 → 부산 담기: 기간 6/11–6/13, 다음이 열린다', () => {
    // 준비 — "아직 0곳" 앵커.
    expect(store().destinations).toHaveLength(0);

    // 실행
    pickRegion('서울', '11');
    pickStart('2026-06-11');
    expect(period()).toEqual(['2026-06-11', '2026-06-12']);
    pickRegion('부산', '26');

    // 단언 ① — 두 곳 모두 1박, 기간은 부산을 담는 순간 하루 늘었다.
    expect(store().destinations.map((one) => one.nights)).toEqual([1, 1]);
    expect(period()).toEqual(['2026-06-11', '2026-06-13']);

    // 단언 ② — 1/4로 돌아오면 2박 3일, 다음 열림.
    render(<TripNewStep1Page baseDate={BASE} />);
    expect(screen.getByTestId('trip-wizard-summary-period')).toHaveTextContent(
      /2박 3일/
    );
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeEnabled();
  });

  it('C2 시작 6/11 먼저(당일) → 서울 → 부산: 기간 6/11–6/13, 다음이 열린다', () => {
    expect(store().destinations).toHaveLength(0);

    pickStart('2026-06-11');
    expect(period()).toEqual(['2026-06-11', '2026-06-11']);
    pickRegion('서울', '11');
    pickRegion('부산', '26');

    expect(period()).toEqual(['2026-06-11', '2026-06-13']);
    render(<TripNewStep1Page baseDate={BASE} />);
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeEnabled();
  });

  it('C3 서울 → 부산 → 시작 6/11 → 부산 +1 → 서울 삭제: 끝이 6/13 → 6/14 → 6/13 으로 따라가고 다음은 계속 열린다', () => {
    expect(store().destinations).toHaveLength(0);

    pickRegion('서울', '11');
    pickRegion('부산', '26');
    pickStart('2026-06-11');
    expect(period()).toEqual(['2026-06-11', '2026-06-13']);

    // 1/4 여행지 시트에서 부산(seq 2) +1, 이어서 서울(seq 1) 삭제.
    render(<TripNewStep1Page baseDate={BASE} />);
    fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-2'));
    expect(period()).toEqual(['2026-06-11', '2026-06-14']);
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeEnabled();

    fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-1'));
    expect(store().destinations.map((one) => one.nights)).toEqual([2]);
    expect(period()).toEqual(['2026-06-11', '2026-06-13']);
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeEnabled();
  });
});
