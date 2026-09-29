import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-1113 결정 1 — 이미 만든 여행은 취향을 바꿀 수 없다(PATCH 계약에 취향 스냅숏이 없다).
 *
 * 무엇을 보장하나: `createdTripId` 가 있으면 요약 취향 행을 눌러도 시트가 열리지 않고, 그 이유를
 * 토스트 한 줄로 알린다(조용히 무시하면 INV-4). 없으면 지금처럼 시트가 열린다.
 *
 * ⚠️ 토스트는 모듈 싱글턴이다 — 파일 최상위 afterEach 에서 지우고, 누르기 전 "아직 없다"를 먼저 본다.
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TOAST = 'trip-wizard-pref-locked-toast';

const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '전시'] },
  activities: { value: ['야경'] },
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  useTripWizardStore.getState().reset();
  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE))
  );
});

afterEach(() => {
  resetToast();
  server.resetHandlers();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WithToastHost>{children}</WithToastHost>
      </QueryClientProvider>
    );
  }
  return render(<TripNewStep1Page baseDate="2026-06-10" />, {
    wrapper: Wrapper,
  });
}

function preferenceRow() {
  return screen.getByTestId('trip-wizard-summary-preference');
}

async function waitForPrefill(): Promise<void> {
  await waitFor(() => expect(preferenceRow()).toHaveTextContent(/미식/));
}

describe('AC-10 · 이미 만든 여행이면 취향 행이 잠긴다', () => {
  it('🔴 L-1 createdTripId 가 있으면 취향 행을 눌러도 시트가 안 열리고 안내 토스트가 뜬다', async () => {
    useTripWizardStore
      .getState()
      .setCreatedTripId('11111111-1111-1111-1111-111111111111');
    renderPage();
    await waitForPrefill();
    expect(screen.queryByTestId(TOAST)).toBeNull();

    fireEvent.press(preferenceRow());

    const toast = await screen.findByTestId(TOAST);
    expect(
      within(toast).getByText('이미 만든 여행은 취향을 바꿀 수 없어요')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();
  });

  it('🟢 L-2 createdTripId 가 없으면 지금처럼 시트가 열리고 토스트는 없다', async () => {
    renderPage();
    await waitForPrefill();
    expect(screen.queryByTestId(TOAST)).toBeNull();

    fireEvent.press(preferenceRow());

    expect(
      await screen.findByTestId('trip-wizard-pref-sheet')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(TOAST)).toBeNull();
  });
});
