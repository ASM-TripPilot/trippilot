import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
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
 * TRIP-1107 g01 1/4 예산 시트 — 온보딩에서 **등급만** 고른 계정(금액 없음)은 시트를 처음 열 때
 * 그 등급의 대표 금액이 금액 칸에 채워진다(칩을 눌렀을 때와 같은 값).
 *
 * 무엇을 보장하나(QA 5회차 #9 — 저가 칩은 켜졌는데 금액이 비어 「적용」이 비활성):
 *  ① 등급만 있으면 첫 열림 금액 = 칩 대표 금액이고 「적용」이 열린다(AC-1·2), 적용하면 그 금액이 커밋된다(AC-3).
 *  ② 온보딩 금액·이미 적용한 금액이 있으면 그 금액이 이긴다(AC-4·5).
 *  ③ 등급이 4값 밖이거나 없으면 지금처럼 빈칸이다(AC-6).
 *  ④ 채움은 시트 드래프트뿐이다 — 적용 전엔 요약 행·제출 바디·계정 취향이 안 바뀐다(AC-7·8, 결정 1=A).
 *
 * 판별력: 등급 대표 금액과 비교 금액을 **다르게** 둔다(고급 2,000,000 vs 1,200,000·1,800,000) — 같으면
 * "등급 금액이 덮는다" 뮤턴트도 통과한다. AC-7·8 은 열자마자 금액이 차 있음을 먼저 확인해야
 * "새어 나갈 값이 실제로 있는 상태에서 안 샜다"가 된다.
 *
 * ⚠️ 바텀시트 목은 통과형 — "열림/닫힘"은 조건부 마운트 트리 존재뿐이고, 칩 색·정렬은 6-b 실기.
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
  budgetTotal: null,
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

/** 등급만 있는 온보딩 계정(운영 모양 — budget_raw_amount NULL). */
function serveTierOnly(tier: string | null): void {
  serveBudget({ tier, rawAmount: null, isNeutralDefault: false });
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

// 스토어는 모듈 싱글턴 — 적용한 budgetText 가 다음 케이스의 "스토어 금액 있음" 갈래로 새지 않게 끝에서도 비운다.
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

/** 예산 행이 "예산 선택"·등급 얼굴일 수 있어 도착은 취향 행(미식)으로 잰다. */
async function waitForPreferenceRow(): Promise<void> {
  await waitFor(() =>
    expect(
      screen.getByTestId('trip-wizard-summary-preference')
    ).toHaveTextContent(/미식/)
  );
}

const row = () => screen.getByTestId('trip-wizard-summary-budget');
const rowSub = () => screen.getByTestId('trip-wizard-summary-budget-sub');
const input = () => screen.getByTestId('trip-wizard-budget-input');
const apply = () => screen.getByTestId('trip-wizard-budget-apply');
const activeChips = () =>
  screen.queryAllByTestId(/^trip-wizard-budget-tier-active-/);

async function openSheet(): Promise<void> {
  fireEvent.press(row());
  await screen.findByTestId('trip-wizard-budget-sheet');
}

/** 적용 없이 닫기 — 딤 탭·아래로 끌기가 부르는 라이브러리 `onClose` 를 대신 부른다(StayPriceSheet 선례). */
function closeSheetWithoutApply(): void {
  const panNodes = screen.UNSAFE_root.findAll(
    (node) => node.props?.enablePanDownToClose === true
  );
  expect(panNodes.length).toBeGreaterThan(0);
  act(() => {
    (panNodes[panNodes.length - 1].props.onClose as () => void)();
  });
  // 짝 — 정말 예산 시트가 닫혔다(엉뚱한 노드의 onClose 를 불렀다면 여기서 red).
  expect(screen.queryByTestId('trip-wizard-budget-sheet')).toBeNull();
}

/** 제출 가능한 스토어 선상태(부산 3박 + 3박 4일). */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

describe('AC-1 · 등급만 있는 저가 계정 — 첫 열림에 300,000 이 채워지고 적용이 열린다', () => {
  it('저가·금액 없음으로 시트를 열면 300,000 · 저가 칩 · 적용 활성 · 빈칸 안내 없음', async () => {
    // 준비
    serveTierOnly('저가');
    renderPage();
    await waitForPreferenceRow();

    // 실행
    await openSheet();

    // 단언
    expect(input()).toHaveDisplayValue('300,000');
    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-low')
    ).toBeOnTheScreen();
    expect(activeChips()).toHaveLength(1);
    expect(apply()).not.toBeDisabled();
    expect(screen.queryByTestId('trip-wizard-error-budget')).toBeNull();
  });
});

describe('AC-2 · 중간·고급·럭셔리 — 첫 열림 금액 = 그 칩을 눌렀을 때의 금액', () => {
  it.each([
    ['중간', 'mid', '1,000,000'],
    ['고급', 'high', '2,000,000'],
    ['럭셔리', 'luxury', '4,000,000'],
  ] as const)(
    '%s 로 열면 %s 칩이 켜지고 %s 이며, 같은 칩을 눌러도 값이 같다',
    async (tier, code, expected) => {
      serveTierOnly(tier);
      renderPage();
      await waitForPreferenceRow();

      await openSheet();

      expect(input()).toHaveDisplayValue(expected);
      expect(
        screen.getByTestId(`trip-wizard-budget-tier-active-${code}`)
      ).toBeOnTheScreen();
      expect(apply()).not.toBeDisabled();

      // 칩 press 경로와 같은 출처인지 — 눌러도 값이 그대로여야 한다.
      fireEvent.press(screen.getByTestId(`trip-wizard-budget-tier-${code}`));
      expect(input()).toHaveDisplayValue(expected);
    }
  );
});

describe('AC-3 · 프리필로 연 시트를 그대로 적용하면 커밋되고 행이 역산 등급을 보인다', () => {
  it('저가 프리필 300,000 을 적용하면 store 에 커밋되고 행은 "30만원 · 1인 총액 · 저가"', async () => {
    serveTierOnly('저가');
    renderPage();
    await waitForPreferenceRow();
    await openSheet();

    fireEvent.press(apply());

    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-budget-sheet')).toBeNull()
    );
    expect(useTripWizardStore.getState().budgetText).toBe('300,000');
    expect(row()).toHaveTextContent(/30만원/);
    expect(rowSub()).toHaveTextContent('1인 총액 · 저가');
  });
});

describe('AC-4 · 무회귀 — 온보딩 금액이 있으면 등급 대표 금액으로 덮지 않는다', () => {
  it('고급 + 1,200,000 으로 열면 1,200,000 이다 (고급 대표 2,000,000 아님)', async () => {
    serveBudget({ tier: '고급', rawAmount: 1200000, isNeutralDefault: false });
    renderPage();
    await waitFor(() => expect(row()).toHaveTextContent(/120만원/));

    await openSheet();

    expect(input()).toHaveDisplayValue('1,200,000');
    expect(
      screen.getByTestId('trip-wizard-budget-tier-active-high')
    ).toBeOnTheScreen();
  });
});

describe('AC-5 · 무회귀 — 이미 적용한 금액은 다시 열어도 그 금액', () => {
  it('고급(금액 없음)에서 1,800,000 을 적용한 뒤 다시 열면 1,800,000 이다 (2,000,000 으로 되돌리지 않는다)', async () => {
    serveTierOnly('고급');
    renderPage();
    await waitForPreferenceRow();
    await openSheet();
    fireEvent.changeText(input(), '1,800,000');
    fireEvent.press(apply());
    await waitFor(() =>
      expect(useTripWizardStore.getState().budgetText).toBe('1,800,000')
    );

    await openSheet();

    expect(input()).toHaveDisplayValue('1,800,000');
  });
});

describe('AC-6 · 경계 — 등급이 4값 밖이거나 없으면 지금처럼 빈칸', () => {
  it.each([['LOW'], [null]] as const)(
    '등급 %j · 금액 없음으로 열면 빈칸 · 켜진 칩 0 · 적용 비활성이고 시트는 정상으로 열린다',
    async (tier) => {
      serveTierOnly(tier);
      renderPage();
      await waitForPreferenceRow();

      await openSheet();

      expect(screen.getByTestId('trip-wizard-budget-sheet')).toBeOnTheScreen();
      expect(input()).toHaveDisplayValue('');
      expect(activeChips()).toHaveLength(0);
      expect(apply()).toBeDisabled();
    }
  );
});

describe('AC-7 · 결정 1=A — 적용 전엔 요약 행·제출 바디가 그대로', () => {
  it('중간(금액 없음)으로 연 시트를 적용 없이 닫으면 행은 "중간 · 1인 총액 · 온보딩" 이고 바디에 budgetTotal 이 없다', async () => {
    // 준비
    seedValidDraft();
    serveTierOnly('중간');
    renderPage();
    await waitForPreferenceRow();
    expect(useTripWizardStore.getState().budgetText).toBe('');

    // 실행 — 열어서 프리필을 확인(새어 나갈 값이 실제로 있다)하고 적용 없이 닫은 뒤 [다음].
    await openSheet();
    expect(input()).toHaveDisplayValue('1,000,000');
    closeSheetWithoutApply();

    // 단언 — 요약 행은 tier-only 얼굴, 스토어는 비어 있다.
    expect(row()).toHaveTextContent(/중간/);
    expect(rowSub()).toHaveTextContent('1인 총액 · 온보딩');
    expect(useTripWizardStore.getState().budgetText).toBe('');

    fireEvent.press(screen.getByTestId('trip-wizard-step1-next'));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(Object.keys(postedBodies[0])).not.toContain('budgetTotal');
  });
});

describe('AC-8 · 금지 — 시트를 열고 닫아도 계정 취향을 쓰지 않는다', () => {
  it('저가 프리필로 열고 닫고, 다시 열어 럭셔리를 누르고 닫아도 /me/preferences 쓰기는 0회다', async () => {
    serveTierOnly('저가');
    renderPage();
    await waitForPreferenceRow();
    expect(useTripWizardStore.getState().budgetText).toBe('');

    await openSheet();
    expect(input()).toHaveDisplayValue('300,000');
    closeSheetWithoutApply();
    await openSheet();
    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-luxury'));
    closeSheetWithoutApply();

    // 관측기 짝 — 같은 기록기가 프리필 GET 은 봤다(리스너가 죽어 0 이 된 게 아니다).
    expect(observedHits).toContain(`GET ${PREFERENCES_PATH}`);
    const preferenceWrites = observedHits.filter(
      (hit) => hit.endsWith(` ${PREFERENCES_PATH}`) && !hit.startsWith('GET ')
    );
    expect(preferenceWrites).toEqual([]);
    expect(useTripWizardStore.getState().budgetText).toBe('');
  });
});
