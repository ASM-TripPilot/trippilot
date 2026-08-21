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
import type { PreferenceView, Trip } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { usePreferenceStore } from '@/features/onboarding/model/preferenceStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-484 g01 취향 '바꾸기' 배선 — 여행 단위 override(정책 A: 스냅숏 전송).
 *
 * 무엇을 보장하나(01b AC):
 *  - **P-1 (AC-1)** 무반응이던 '바꾸기'가 취향 선택 시트를 **연다**.
 *  - **P-2 (AC-2)** 시트에서 고른 값이 취향 칩에 **반영**되고, 계정 취향(`preferenceStore`)은
 *    불변이며 `PUT /me/preferences`가 나가지 않는다(override는 여행 로컬).
 *  - **P-3 (AC-3)** override 값이 `POST /trips` 바디의 `preferenceSnapshot`으로 **실제 전송**된다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "화면 조작 → 실제 나간 요청/칩"이다(page↔screen↔wire 왕복).
 * 화면 단위 테스트만으론 poiCount 어댑터류의 배선 사각(repo-traps)을 못 잠근다. 형제
 * `TripNewStep1Page.integration.test.tsx`와 같은 셋업(실 QueryClientProvider + msw).
 *
 * ⚠️ 시트는 **조건부 마운트**여야 한다 — `@gorhom/bottom-sheet` 목이 children을 무조건 렌더하므로,
 * 무조건 마운트하면 시트 testID가 열림 여부와 무관하게 항상 present라 P-1(before null)이 못 선다.
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

/** 프리필 칩이 뜨는 취향. `styles`에 '휴양'이 **없어야** override 지문('휴양')이 유효하다(02a ★2). */
const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '전시'] },
  activities: { value: ['야경'] },
};

const TRIP: Trip = {
  tripId: '11111111-1111-1111-1111-111111111111',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
};

let observedHits: string[] = [];
let postedBodies: Record<string, unknown>[] = [];

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}
function createHits(): number {
  return hitCount('POST /api/v1/trips');
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  postedBodies = [];
  mockPush.mockClear();
  mockBack.mockClear();
  useTripWizardStore.getState().reset();
  usePreferenceStore.getState().reset();

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE)),
    // 계정 취향 변경 요청이 실수로 나가면 조용히 500이 아니라 이 permissive 핸들러가 받아
    // 관찰만 한다 — P-2의 "0회" 단언이 크래시가 아니라 깨끗한 실패로 드러나게 한다.
    http.put(`${BASE}/me/preferences`, () =>
      HttpResponse.json(PREFERENCE, { status: 200 })
    ),
    http.post(`${BASE}/trips`, async ({ request }) => {
      postedBodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(TRIP, { status: 201 });
    })
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

/** 프리필이 끝나 칩이 뜰 때까지 기다린다. */
async function waitForPrefill(): Promise<void> {
  await screen.findByText('미식');
}

/** 도시 추가 시트를 열어 지역 하나를 N박으로 확정(형제 파일과 같은 3동작 묶음). */
async function addDestination(
  regionCode: string,
  nights: number
): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-destination-add'));
  fireEvent.press(
    await screen.findByTestId(`trip-wizard-destination-region-${regionCode}`)
  );
  for (let i = 1; i < nights; i += 1) {
    fireEvent.press(screen.getByTestId('trip-wizard-destination-nights-inc'));
  }
  fireEvent.press(screen.getByTestId('trip-wizard-destination-confirm'));
}

/** 정상 제출 가능한 상태(부산 3박 + 3박4일). */
async function fillValidDraft(): Promise<void> {
  await addDestination('busan', 3);
  fireEvent.press(screen.getByTestId('trip-wizard-period-preset-3n4d'));
  await waitForPrefill();
}

/** 시트를 열어 style 옵션 'rest'(→'휴양')를 고르고 확정하는 3동작 묶음. */
async function overrideRestStyle(): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-pref-change'));
  fireEvent.press(await screen.findByTestId('trip-wizard-pref-option-rest'));
  fireEvent.press(screen.getByTestId('trip-wizard-pref-sheet-confirm'));
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

describe('P-1 · AC-1 — 바꾸기가 취향 선택 시트를 연다', () => {
  it('열기 전엔 시트가 트리에 없고, 바꾸기를 누르면 나타난다', async () => {
    renderPage();
    await waitForPrefill();

    // 앵커 — 열기 전엔 시트가 트리에 없다(조건부 마운트). 이게 없으면 "늘 떠 있는" 구현이 통과한다.
    expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-pref-change'));

    // 단언 — 시트가 열린다.
    expect(
      await screen.findByTestId('trip-wizard-pref-sheet')
    ).toBeOnTheScreen();
  });
});

describe('P-2 · AC-2 — 고른 값이 칩에 반영되고 계정 취향은 불변이다', () => {
  it('옵션을 고르면 칩에 뜨고, 온보딩 스토어와 PUT 취향은 그대로다', async () => {
    renderPage();
    await waitForPrefill();

    // 앵커 — 조작 전 계정(온보딩) 취향 스토어는 초기값(전부 null)이다.
    expect(usePreferenceStore.getState().styles).toBeNull();
    expect(usePreferenceStore.getState().activities).toBeNull();

    await overrideRestStyle();

    // 단언 ① — 고른 '휴양'이 취향 카드 칩에 반영된다.
    const card = screen.getByTestId('trip-wizard-pref-card');
    expect(within(card).getByText('휴양')).toBeOnTheScreen();

    // 단언 ② (짝) — 확정이 시트를 닫는다.
    expect(screen.queryByTestId('trip-wizard-pref-sheet')).toBeNull();

    // 단언 ③ — **계정 취향 불변(하드 제약 BR-U1-38)**. 온보딩 스토어를 재사용한 구현이면 여기서 걸린다.
    expect(usePreferenceStore.getState().styles).toBeNull();
    expect(usePreferenceStore.getState().activities).toBeNull();

    // 단언 ④ — 서버 계정 취향도 안 건드린다.
    expect(hitCount('PUT /api/v1/me/preferences')).toBe(0);
  });
});

describe('P-3 · AC-3 — override 값이 POST 바디 preferenceSnapshot으로 나간다', () => {
  it('override 후 [다음]을 누르면 스냅숏 styles에 고른 값이 실린다', async () => {
    renderPage();
    await fillValidDraft();
    await overrideRestStyle();

    // 앵커 — 아직 아무 여행도 안 만들었다.
    expect(createHits()).toBe(0);
    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    expect(postedBodies).toHaveLength(1);

    // 단언 — 스냅숏이 실렸고 그 styles에 override 지문('휴양')이 있다. 프리필 styles(미식·전시)엔
    // '휴양'이 없으므로 이 값은 오직 override 토글에서만 올 수 있다(02a ★2).
    expect(Object.keys(postedBodies[0])).toContain('preferenceSnapshot');
    expect(
      (postedBodies[0].preferenceSnapshot as { styles?: string[] }).styles
    ).toEqual(expect.arrayContaining(['휴양']));
  });
});
