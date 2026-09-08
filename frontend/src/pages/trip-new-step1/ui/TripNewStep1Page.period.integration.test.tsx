import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-667 g01 기간 편집 시트 — **배선 승인 테스트**(요약 "기간" 행 → 시트 오픈 → 범위 전이 → 적용 → 스토어).
 *
 * 무엇을 보장하나: S1 이 남긴 기간 행 오픈 콜백(현 `openEditSheet` 스텁)에 이 시트가 배선돼
 *  ① 기간 행 탭 → 시트 마운트(트리 존재) ② 셀 탭 → 배선이 `applyRangePick`으로 range 를 갱신해
 *  재렌더 → 범위 표식이 실제로 바뀐다(셀 탭→표식 변화, 무상태 시트라 이 전이는 여기서만 관측된다)
 *  ③ "적용" **누르기 전엔** 스토어 기간 불변, 누르면 `setPeriod(undefined, start, end)` 로 커밋 + 닫힘.
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "셀 탭→표식 변화"는 배선이 range 를 소유·갱신할 때만
 * 일어난다 — 스토어 실반영과 전이를 함께 관측해야 한다. 컴포넌트 단위(표식 렌더·콜백)는 별 파일이 잠근다.
 *
 * ⚠️ 게스트(토큰 미주입)로 돈다 — `useSavedPlaces`/`useSavedStays` 가 `enabled:false` 라 안 나가고
 * (01b 비회원 예외), 무조건 발화하는 `useGetMePreferences`(프리필)만 `/me/preferences` 핸들러로 받는다.
 * `/regions`·`/saved-stays`·`/saved-places` 핸들러는 **일부러 안 준다**(남기면 신 페이지가 그 훅을
 * 게스트에서 물었다는 증거로 `onUnhandledRequest:'error'` 크래시 red). 제출을 안 하므로 POST /trips 불필요.
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 을 무조건 렌더한다 — 여기서 관측하는 "시트 오픈"은
 * **조건부 마운트 트리 존재/부재**뿐이다. 실제 슬라이드업·딤·범위 하이라이트 실렌더는 jest 사각(6-b 실기).
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
// 결정론적 today 주입 — 6/1 이라 6월 전 칸이 활성이다(과거 없음).
const BASE_DATE = '2026-06-01';

const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식'] },
  activities: { value: ['야경'] },
};

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  useTripWizardStore.getState().reset();

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE))
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

function renderPage() {
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: createWrapper(),
  });
}

/** 기간 요약 행을 눌러 시트를 연다(공통). */
async function openSheet(): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));
  await screen.findByTestId('trip-wizard-period-sheet');
}

describe('W-1 · 기간 행 탭이 시트를 연다', () => {
  it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
    renderPage();
    // 아직 안 눌렀다 — 조건부 마운트라 트리에 없다.
    expect(screen.queryByTestId('trip-wizard-period-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-summary-period'));

    expect(
      await screen.findByTestId('trip-wizard-period-sheet')
    ).toBeOnTheScreen();
  });
});

describe('W-2 · 셀 탭 → 배선의 applyRangePick 으로 범위 표식이 전이한다', () => {
  it('시작 탭 → 시작 표식 / 뒤 셀 탭 → 완성(사이·종료) / 완성 뒤 탭 → 재시작', async () => {
    renderPage();
    await openSheet();

    // 시작(10) 탭 → 시작 표식만.
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
    expect(
      await screen.findByTestId('trip-wizard-period-cell-start-2026-06-10')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-period-cell-end-2026-06-13')
    ).toBeNull();

    // 뒤 셀(13) 탭 → 완성(사이 11·12 + 종료 13).
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-13'));
    expect(
      await screen.findByTestId('trip-wizard-period-cell-end-2026-06-13')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-period-cell-between-2026-06-11')
    ).toBeOnTheScreen();

    // 완성 뒤 새 셀(20) 탭 → 재시작(옛 범위 표식 소멸, last-wins).
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-20'));
    expect(
      await screen.findByTestId('trip-wizard-period-cell-start-2026-06-20')
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(
        screen.queryByTestId('trip-wizard-period-cell-end-2026-06-13')
      ).toBeNull()
    );
  });
});

describe('W-3 · 적용 = setPeriod(undefined, start, end) 커밋 + 닫기 (01b D6·AC-4)', () => {
  it('적용 전엔 스토어 기간 불변, 적용 후 커밋(presetCode=undefined) + 시트 닫힘', async () => {
    renderPage();
    await openSheet();

    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));
    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-13'));
    await screen.findByTestId('trip-wizard-period-cell-end-2026-06-13');

    // 적용 전 — 아직 커밋 안 됨(즉시반영이 아니라 적용에서만 커밋).
    expect(useTripWizardStore.getState().startDate).toBeUndefined();
    expect(useTripWizardStore.getState().endDate).toBeUndefined();

    fireEvent.press(screen.getByTestId('trip-wizard-period-apply'));

    // 커밋 — 값·프리셋 undefined 동시 확인(프리셋 코드를 넘긴 뮤턴트가 presetCode 로 red).
    await waitFor(() =>
      expect(useTripWizardStore.getState().startDate).toBe('2026-06-10')
    );
    expect(useTripWizardStore.getState().endDate).toBe('2026-06-13');
    expect(useTripWizardStore.getState().presetCode).toBeUndefined();

    // 닫힘(조건부 마운트 해제).
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-period-sheet')).toBeNull()
    );
  });
});
