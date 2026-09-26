import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { RegionPickerPage } from './RegionPickerPage';

/**
 * TRIP-1010(D7 · 03b 경고-1 대응) — 지역 선택은 **기간이 있어도** 새 여행지를 늘 1박으로 담는다.
 *
 * 무엇을 보장하나: 위저드(purpose=trip)에서 지역을 고르면 스토어 기간과 상관없이 1박으로 담긴다.
 * 한때(01b Q1 권고) "기간이 있고 첫 여행지면 박수 = 기간"으로 담았는데, 그러면 기간 → 서울 → 부산
 * 순서에서 합이 기간 + 1이 되어 '다음'이 막혔다(순서 의존 회귀, 03b 경고-1). 그래서 되돌렸다 —
 * 남은 밤은 2/4 채움과 1/4 안내 한 줄이 맡는다. (1/4 기간 시트 "적용"의 단일 여행지 동기화는 D7 본문이라 유지.)
 *
 * 왜 실제 스토어인가: 형제 `RegionPickerPage.integration.test.tsx` 는 스토어를 목으로 갈아 끼워
 * `addDestination` 호출 인자만 본다. 여기서는 "담긴 결과"를 스토어에서 직접 읽는다.
 * 순서 사슬(기간 → 두 곳 → 1/4 안내·다음)은 페이지 두 개를 잇는 일이라
 * `src/__tests__/tripNightsPeriodOrder.test.tsx` 에 있다(pages 형제 import 금지).
 *
 * ⚠️ 모듈 싱글턴 스토어 — 리셋을 파일 최상위 beforeEach·afterEach 둘 다에 건다(02a ★9).
 * ⚠️ `jest.mock` 팩토리 바깥 변수는 `mock` 접두어만 허용(호이스팅, ★10).
 *
 * 3동작: 준비(스토어 선상태 + 카탈로그) → 실행(검색 '서울' → 카드 press) → 단언(스토어 destinations).
 */

const mockBack = jest.fn();
let mockParams: { purpose?: string } = {};
let mockRegionsResult: {
  data: Region[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: mockBack,
    dismissTo: jest.fn(),
  }),
  useLocalSearchParams: () => ({ ...mockParams }),
}));

jest.mock('@/features/explore/model/regions', () => ({
  ...jest.requireActual('@/features/explore/model/regions'),
  useRegions: () => mockRegionsResult,
}));

const SEOUL: Region = {
  regionCode: '11',
  name: '서울특별시',
  level: RegionLevel.SIDO,
  sidoName: '서울특별시',
  selectable: true,
  poiCount: 120,
};

function store() {
  return useTripWizardStore.getState();
}

/** 검색으로 좁혀 서울 카드를 누른다(검색 경로는 드릴다운 없이 평면 카드 — 형제 파일 선례). */
function pickSeoul(): void {
  fireEvent.changeText(screen.getByTestId('explore-region-search'), '서울');
  fireEvent.press(screen.getByTestId('explore-region-11'));
}

beforeEach(() => {
  store().reset();
  mockBack.mockClear();
  mockParams = { purpose: 'trip' };
  mockRegionsResult = {
    data: [SEOUL],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  };
});

afterEach(() => {
  store().reset();
});

describe('TRIP-1010 · 지역 선택은 기간과 상관없이 1박으로 담는다 (Q1 동기화 철회)', () => {
  it('기간 2박(6/10–6/12) · 여행지 0곳에서 서울을 고르면 서울 1박으로 담기고 위저드로 돌아간다', () => {
    // 준비 — 기간 먼저. "아직 0곳" 앵커로 앞 테스트 누수가 아님을 확인한다.
    store().setPeriod(undefined, '2026-06-10', '2026-06-12');
    expect(store().destinations).toHaveLength(0);
    render(<RegionPickerPage />);

    // 실행
    pickSeoul();

    // 단언 — 필드를 하나씩(객체 통째 비교 금지, 02a ★4).
    const [seoul] = store().destinations;
    expect(store().destinations).toHaveLength(1);
    expect(seoul.region).toBe('서울특별시');
    // 기간(2박)을 따라가지 않는다 — 남은 1박은 1/4 안내·2/4 채움이 맡는다.
    expect(seoul.nights).toBe(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('이미 여행지가 1곳 있으면 두 번째 여행지는 1박으로 담기고, 첫 여행지 박수도 그대로다', () => {
    // 준비 — 부산 1박 + 기간 3박.
    store().addDestination('부산', 1);
    store().setPeriod(undefined, '2026-06-10', '2026-06-13');
    render(<RegionPickerPage />);

    pickSeoul();

    expect(store().destinations).toHaveLength(2);
    expect(store().destinations[0].region).toBe('부산');
    expect(store().destinations[0].nights).toBe(1);
    expect(store().destinations[1].region).toBe('서울특별시');
    expect(store().destinations[1].nights).toBe(1);
  });

  it('기간이 아직 없으면 첫 여행지도 1박으로 담긴다 (옛 동작 유지)', () => {
    expect(store().destinations).toHaveLength(0);
    render(<RegionPickerPage />);

    pickSeoul();

    expect(store().destinations).toHaveLength(1);
    expect(store().destinations[0].nights).toBe(1);
  });
});
