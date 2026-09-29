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
import type { PreferenceView, Trip } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-1091 g01 1/4 예산 행 — **적용한 금액에서 역산한 등급**이 요약 행과 시트 재오픈 칩에 붙는다.
 *
 * 무엇을 보장하나(QA A12 — 저가 30만원을 적용했는데 행이 "30만원 · 1인 총액 · 고급"):
 *  ① 스토어에 커밋된 금액이 0보다 크면 행 sub 의 등급은 `tierForAmount(금액)` 이다(온보딩 등급 아님).
 *  ② 시트를 다시 열면 같은 역산 등급 칩이 켜진다(행과 칩이 다른 말을 안 한다).
 *  ③ 한 번도 적용하지 않았거나 0 을 적용했으면 지금처럼 온보딩 등급이다(01b Q1·맹점② (a)).
 *  ④ 역산 등급은 요청 어디에도 안 싣고, 계정 취향(`/me/preferences`)을 쓰지 않는다(BR-U1-38).
 *
 * 판별력: 프리필 등급을 기대 등급과 **다르게** 둔다 — 같으면 "항상 온보딩 등급"인 옛 코드도 통과한다.
 * 경계 판정은 sub 완전 일치로만 한다 — main 은 만원 반올림이라 499,999 가 "50만원"으로 보인다.
 *
 * ⚠️ 바텀시트 목은 통과형 — "열림"은 조건부 마운트 트리 존재뿐이고, 칩 색·한 줄 들어감은 6-b 실기.
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
const PREFERENCES_PATH = '/api/v1/me/preferences';

/** openapi `Trip.required` 필드. */
const TRIP: Trip = {
  tripId: '11111111-1111-1111-1111-111111111111',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 1,
  companionType: null,
  budgetTotal: 1800000,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 3 }],
  status: 'PLANNED',
  createdAt: '2026-08-02T00:00:00Z',
  updatedAt: '2026-08-02T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 0,
};

const NO_BUDGET = { tier: null, rawAmount: null, isNeutralDefault: true };

let observedHits: string[] = [];
let postedBodies: Record<string, unknown>[] = [];

/** 프리필의 예산 축만 바꾼다(취향 styles 는 미식 — 도착 눈금). */
function preferenceWith(
  budget: NonNullable<PreferenceView['budget']>
): PreferenceView {
  return {
    pace: { value: '균형있게', isNeutralDefault: false },
    budget,
    styles: { value: ['미식'] },
    activities: { value: [] },
  };
}

function serveBudget(budget: NonNullable<PreferenceView['budget']>): void {
  server.use(
    http.get(`${BASE}/me/preferences`, () =>
      HttpResponse.json(preferenceWith(budget))
    )
  );
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
  useTripWizardStore.getState().reset();

  server.use(
    http.post(`${BASE}/trips`, async ({ request }) => {
      postedBodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(TRIP, { status: 201 });
    }),
    // 계정 취향 쓰기 — 불리면 안 되지만, 불렸을 때 흔적이 확실히 남도록 받아 준다.
    http.put(`${BASE}/me/preferences`, () =>
      HttpResponse.json(preferenceWith(NO_BUDGET))
    ),
    http.patch(`${BASE}/me/preferences`, () =>
      HttpResponse.json(preferenceWith(NO_BUDGET))
    )
  );
});

// 스토어는 모듈 싱글턴 — 앞 테스트의 budgetText 가 "적용 안 함" 케이스로 새지 않게 끝에서도 비운다.
afterEach(() => {
  useTripWizardStore.getState().reset();
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
  return render(<TripNewStep1Page baseDate="2026-06-10" />, {
    wrapper: createWrapper(),
  });
}

async function waitForPreferenceRow(): Promise<void> {
  await waitFor(() =>
    expect(
      screen.getByTestId('trip-wizard-summary-preference')
    ).toHaveTextContent(/미식/)
  );
}

const row = () => screen.getByTestId('trip-wizard-summary-budget');
const rowSub = () => screen.getByTestId('trip-wizard-summary-budget-sub');

async function openSheet(): Promise<void> {
  fireEvent.press(row());
  await screen.findByTestId('trip-wizard-budget-sheet');
}

async function applyAndClose(): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-budget-apply'));
  await waitFor(() =>
    expect(screen.queryByTestId('trip-wizard-budget-sheet')).toBeNull()
  );
}

/** 시트를 열어 금액을 손으로 넣고 적용한다(칩 안 누름). */
async function applyTyped(text: string): Promise<void> {
  await openSheet();
  fireEvent.changeText(screen.getByTestId('trip-wizard-budget-input'), text);
  await applyAndClose();
}

describe('AC4 · A12 — 저가 칩을 적용하면 행 등급도 저가다', () => {
  it('온보딩 고급 계정에서 저가(30만원)를 적용하면 행은 "30만원 · 1인 총액 · 저가"이고 고급은 없다', async () => {
    // 준비 — 운영 모양: 온보딩 등급만 있고 금액은 없다(행은 tier-only 얼굴).
    serveBudget({ tier: '고급', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();
    // 앵커 — 적용 전엔 아직 온보딩 얼굴이다(역산 결과가 미리 보이면 안 된다).
    expect(rowSub()).toHaveTextContent('1인 총액 · 온보딩');

    // 실행
    await openSheet();
    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-low'));
    await applyAndClose();

    // 단언
    expect(row()).toHaveTextContent(/30만원/);
    expect(rowSub()).toHaveTextContent('1인 총액 · 저가');
    expect(row()).not.toHaveTextContent(/고급/);
  });
});

describe('AC5 · 칩 없이 손으로 넣은 금액도 역산한다', () => {
  it('온보딩 중간에서 1,800,000 을 적용하면 행 등급은 고급이다', async () => {
    serveBudget({ tier: '중간', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();

    await applyTyped('1,800,000');

    expect(row()).toHaveTextContent(/180만원/);
    expect(rowSub()).toHaveTextContent('1인 총액 · 고급');
  });
});

describe('AC6 · 경계 배선 — 하한은 자기 구간', () => {
  it('온보딩 저가에서 500,000 · 1,500,000 · 3,000,000 을 차례로 적용하면 중간 · 고급 · 럭셔리다', async () => {
    serveBudget({ tier: '저가', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();

    await applyTyped('500000');
    expect(rowSub()).toHaveTextContent('1인 총액 · 중간');

    await applyTyped('1500000');
    expect(rowSub()).toHaveTextContent('1인 총액 · 고급');

    await applyTyped('3000000');
    expect(rowSub()).toHaveTextContent('1인 총액 · 럭셔리');
  });

  it('온보딩 럭셔리에서 499,999 를 적용하면 저가다', async () => {
    serveBudget({ tier: '럭셔리', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();

    await applyTyped('499999');

    expect(rowSub()).toHaveTextContent('1인 총액 · 저가');
  });
});

describe('AC7 · 한 번도 적용하지 않으면 지금처럼 온보딩 등급 (무회귀)', () => {
  it('프리필 고급 + 1,200,000 이면 행은 "120만원 · 1인 총액 · 고급" 이다 — 프리필 금액은 역산하지 않는다', async () => {
    // 1,200,000 을 역산하면 중간이다 — 프리필 금액까지 역산하면 여기서 갈린다(01b 맹점② (a)).
    serveBudget({ tier: '고급', rawAmount: 1200000, isNeutralDefault: false });
    renderPage();
    await waitFor(() => expect(row()).toHaveTextContent(/120만원/));

    expect(rowSub()).toHaveTextContent('1인 총액 · 고급');

    // 시트 쪽도 같은 출처여야 한다(결정 2) — 적용 없이 열면 역산 중간이 아니라 프리필 고급 칩(5-b 경고 1).
    await openSheet();
    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-high')
    ).toBeTruthy();
    expect(
      screen.queryByTestId('trip-wizard-budget-tier-active-mid')
    ).toBeNull();
  });

  it('금액 없이 등급만 있으면 tier-only 얼굴 "중간 · 1인 총액 · 온보딩" 그대로다', async () => {
    serveBudget({ tier: '중간', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();

    expect(row()).toHaveTextContent(/중간/);
    expect(rowSub()).toHaveTextContent('1인 총액 · 온보딩');
  });
});

describe('AC8 · 0 을 적용하면 행은 "예산 선택", 재오픈 칩은 온보딩 등급 (01b Q1)', () => {
  it('0 을 적용하면 행에 등급이 없고, 다시 열면 저가가 아니라 온보딩 고급 칩이 켜진다', async () => {
    serveBudget({ tier: '고급', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();

    await applyTyped('0');

    expect(row()).toHaveTextContent(/예산 선택/);
    expect(screen.queryByTestId('trip-wizard-summary-budget-sub')).toBeNull();

    // 0 에 역산을 태우면 저가가 켜져 "예산 선택" 행과 다른 말을 한다.
    await openSheet();
    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-high')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-budget-tier-active-low')
    ).toBeNull();
  });
});

describe('AC9 · 결정 2 — 저가를 적용하고 다시 열면 저가 칩이 켜진다', () => {
  it('온보딩 고급에서 저가를 적용한 뒤 다시 열면 active-low 하나만 켜진다', async () => {
    serveBudget({ tier: '고급', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();
    await openSheet();
    // 앵커 — 첫 오픈은 온보딩 등급(고급)이다.
    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-high')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-budget-tier-active-low')
    ).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-low'));
    await applyAndClose();
    await openSheet();

    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-low')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-budget-tier-active-high')
    ).toBeNull();
    expect(
      screen.queryAllByTestId(/^trip-wizard-budget-tier-active-/)
    ).toHaveLength(1);
  });
});

describe('AC10 · 결정 2 — 손으로 넣은 금액도 재오픈 칩은 역산 등급', () => {
  it('온보딩 중간에서 1,800,000 을 적용한 뒤 다시 열면 고급 칩이 켜지고 중간은 꺼져 있다', async () => {
    serveBudget({ tier: '중간', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();

    await applyTyped('1,800,000');
    await openSheet();

    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-high')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-budget-tier-active-mid')
    ).toBeNull();
  });
});

describe('AC12 · AC13 · 금지 — 역산 등급은 요청에 안 싣고 계정 취향을 안 쓴다', () => {
  it('칩·손 입력·재오픈을 거쳐 제출해도 바디·스냅숏에 등급이 없고 /me/preferences 쓰기는 0회다', async () => {
    // 준비 — 제출 가능한 부산 3박, 온보딩 고급.
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 3);
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
    serveBudget({ tier: '고급', rawAmount: null, isNeutralDefault: false });
    renderPage();
    await waitForPreferenceRow();

    // 실행 — 저가 칩 적용 → 다시 열어 손으로 1,800,000 → 적용 → [다음].
    await openSheet();
    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-low'));
    await applyAndClose();
    await applyTyped('1,800,000');
    fireEvent.press(screen.getByTestId('trip-wizard-step1-next'));

    // 단언 — 등록은 1회, 바디 최상위와 스냅숏 안 어디에도 등급이 없다.
    await waitFor(() => expect(postedBodies).toHaveLength(1));
    const body = postedBodies[0];
    expect(Object.keys(body)).not.toContain('tier');
    expect(Object.keys(body)).not.toContain('budgetTier');
    expect(body).toMatchObject({ budgetTotal: 1800000 });
    const snapshot = (body.preferenceSnapshot ?? {}) as Record<string, unknown>;
    ['tier', 'budgetTier', 'budget'].forEach((key) => {
      expect(Object.keys(snapshot)).not.toContain(key);
    });

    // 관측기 짝 — 같은 기록기가 프리필 GET 은 봤다(리스너가 죽어 0 이 된 게 아니다).
    expect(observedHits).toContain(`GET ${PREFERENCES_PATH}`);
    const preferenceWrites = observedHits.filter(
      (hit) => hit.endsWith(` ${PREFERENCES_PATH}`) && !hit.startsWith('GET ')
    );
    expect(preferenceWrites).toEqual([]);
  });
});
