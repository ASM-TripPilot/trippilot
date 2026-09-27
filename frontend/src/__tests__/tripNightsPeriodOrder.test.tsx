import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PreferenceView, Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { RegionPickerPage } from '@/pages/region-picker/ui/RegionPickerPage';
import { TripNewStep1Page } from '@/pages/trip-new-step1/ui/TripNewStep1Page';

/**
 * TRIP-1010 · 03b 경고-1 — **기간을 먼저 고르고 여행지 두 곳을 담는 순서**가 '다음'을 막지 않는다.
 *
 * 무엇을 보장하나: 1/4에서 2박 기간을 적용 → 지역 선택에서 서울 → 다시 지역 선택에서 부산 →
 * 1/4로 돌아오면 박수 합 2 = 기간 2라 불일치 안내가 없고 '다음'이 열린다. 한때 지역 선택이
 * "첫 여행지 = 기간만큼"으로 담아 이 순서에서만 합 3 > 2로 막혔다(순서에 따라 결과가 갈림).
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
 * 3동작: 준비(빈 스토어 · 카탈로그 서울·부산) → 실행(기간 적용 → 서울 담기 → 부산 담기) →
 * 단언(스토어 박수 하나씩 · 1/4 안내 없음 · 다음 열림).
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

jest.mock('@/features/trip/model/usePreferencePrefill', () => ({
  usePreferencePrefill: () => ({ data: mockPreference }),
}));

jest.mock('@/features/trip/model/useCreateTrip', () => ({
  useCreateTrip: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
    reset: jest.fn(),
  }),
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
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
const NOTE = 'trip-wizard-nights-mismatch-note';

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

describe('TRIP-1010 경고-1 · 기간 → 서울 → 부산 순서', () => {
  it('2박 기간을 먼저 적용하고 서울·부산을 차례로 담으면 합 2박 = 기간이라 안내 없이 다음이 열린다', () => {
    // 준비 — "아직 0곳" 앵커(앞 테스트 누수가 아님을 확인).
    expect(store().destinations).toHaveLength(0);

    // 실행 ① — 1/4에서 기간 6/11–6/13(2박) 적용. 여행지 0곳이라 동기화 대상 없음.
    const step1 = render(<TripNewStep1Page baseDate={BASE} />);
    fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-11'));
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-13'));
    fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));
    step1.unmount();
    expect(store().endDate).toBe('2026-06-13');

    // 실행 ② — 지역 선택에서 서울, 다시 지역 선택에서 부산.
    pickRegion('서울', '11');
    pickRegion('부산', '26');

    // 단언 ① — 스토어: 두 곳 모두 1박(요소 하나씩).
    const [first, second] = store().destinations;
    expect(store().destinations).toHaveLength(2);
    expect(first.region).toBe('서울특별시');
    expect(first.nights).toBe(1);
    expect(second.region).toBe('부산광역시');
    expect(second.nights).toBe(1);

    // 단언 ② — 1/4로 돌아오면 합 = 기간: 안내 없음(짝: 화면은 실제로 그려짐) · 다음 열림.
    render(<TripNewStep1Page baseDate={BASE} />);
    expect(screen.getByTestId('trip-wizard-step1-root')).toBeOnTheScreen();
    expect(screen.queryByTestId(NOTE)).toBeNull();
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeEnabled();
  });
});
