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
 * TRIP-666 g01 여행지 편집 시트 — **배선 승인 테스트**(요약 행 → 시트 오픈 → 콜백 → 스토어/라우트).
 *
 * 무엇을 보장하나: S1 이 남긴 요약 행 오픈 콜백(현 `openEditSheet` 스텁)에 이 시트가 배선돼
 *  ① 여행지 행 탭 → 시트 마운트(트리 존재) ② 스테퍼 → `setNights` 로 **즉시** 스토어 반영(로컬
 *  드래프트 아님, 01b D3) ③ "도시 추가" → `router.push('/explore/region?purpose=trip')`
 *  ④ 삭제× → `removeDestination(seq)` ⑤ "적용" → 닫기(스토어 재커밋 없음).
 *
 * 왜 통합 버킷인가: 심판 대상이 "페이지가 시트 콜백을 무엇에 배선했나"다 — 스토어 실반영과 실제
 * router 인자를 관측해야 한다. 스토어 뮤테이션·router 목이 필요.
 *
 * ⚠️ 게스트(토큰 미주입)로 돈다 — `useSavedPlaces`/`useSavedStays` 가 `enabled:false` 라 안 나가고
 * (01b 비회원 예외), 무조건 발화하는 `useGetMePreferences`(프리필)만 `/me/preferences` 핸들러로 받는다.
 * `/regions`·`/saved-stays`·`/saved-places` 핸들러는 **일부러 안 준다**(남기면 신 페이지가 그 훅을
 * 게스트에서 물었다는 증거로 `onUnhandledRequest:'error'` 크래시 red). 제출을 안 하므로 POST /trips 불필요.
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 을 무조건 렌더한다 — 여기서 관측하는 "시트 오픈"은
 * **조건부 마운트 트리 존재/부재**뿐이다. 실제 슬라이드업·딤·중앙정렬·터치차단은 jest 사각(6-b 실기).
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
const BASE_DATE = '2026-06-10';

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
  // 두 도시를 담아 시트가 그릴 행을 만든다(부산 2박·경주 1박).
  useTripWizardStore.getState().addDestination('부산', 2);
  useTripWizardStore.getState().addDestination('경주', 1);

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

/** 여행지 요약 행을 눌러 시트를 연다(공통). */
async function openSheet(): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));
  await screen.findByTestId('trip-wizard-destination-sheet');
}

describe('W-1 · 여행지 행 탭이 시트를 연다', () => {
  it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
    renderPage();
    // 아직 안 눌렀다 — 조건부 마운트라 트리에 없다.
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-summary-destination'));

    expect(
      await screen.findByTestId('trip-wizard-destination-sheet')
    ).toBeOnTheScreen();
  });
});

describe('W-2 · 스테퍼가 setNights 로 즉시 반영된다 (01b D3)', () => {
  it('+ 를 누른 그 순간(적용 전) 스토어 박수가 바뀐다 = 로컬 드래프트가 아니다', async () => {
    renderPage();
    await openSheet();

    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc-1'));
    await waitFor(() =>
      expect(useTripWizardStore.getState().destinations[0].nights).toBe(3)
    );

    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-dec-1'));
    await waitFor(() =>
      expect(useTripWizardStore.getState().destinations[0].nights).toBe(2)
    );
  });
});

describe('W-3 · 도시 추가가 explore/region 라우트를 연다 (AC-3)', () => {
  it('press 가 router.push("/explore/region?purpose=trip") 를 부른다', async () => {
    renderPage();
    await openSheet();

    fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/explore/region?purpose=trip')
    );
  });
});

describe('W-4 · 삭제× 가 removeDestination(seq) 로 배선된다 (AC-4/5)', () => {
  it('경주(seq 2) 삭제 → 부산만 남고 seq 가 다시 1..N 으로 매겨진다', async () => {
    renderPage();
    await openSheet();

    fireEvent.press(screen.getByTestId('trip-wizard-destination-remove-2'));

    await waitFor(() =>
      expect(useTripWizardStore.getState().destinations).toEqual([
        { seq: 1, region: '부산', nights: 2 },
      ])
    );
  });
});

describe('W-5 · 적용은 닫기뿐 — 스토어를 더 안 건드린다 (01b D3·AC-4)', () => {
  it('적용 press 가 시트를 닫고, destinations 는 적용 직전 스냅숏 그대로다', async () => {
    renderPage();
    await openSheet();

    // 스냅숏 — 즉시반영이라 이 시점 값이 곧 최종값이다(적용은 커밋이 아니다).
    const snapshot = useTripWizardStore.getState().destinations;

    fireEvent.press(screen.getByTestId('trip-wizard-destination-apply'));

    // 닫힘(조건부 마운트 해제)
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull()
    );
    // 스토어 불변 — "적용=커밋" 구현이면 여기서 값이 달라져 red.
    expect(useTripWizardStore.getState().destinations).toEqual(snapshot);
  });
});
