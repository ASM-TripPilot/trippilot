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
 * TRIP-670 g01 예산 편집 시트 — **배선 승인 테스트**(요약 "예산" 행 → 시트 오픈 → 드래프트 전이 → 적용 → 스토어/제출).
 *
 * 무엇을 보장하나: S1 이 남긴 예산 행 오픈 콜백(현 `openEditSheet` no-op)에 이 시트가 배선돼
 *  ① 예산 행 탭 → 시트 마운트(트리 존재, B-1) ② 금액 입력 → 드래프트 전이, **적용 전엔 스토어 불변**,
 *  적용에서만 `setBudgetText` 커밋 + 닫힘(★ 드래프트 계약, B-apply) ③ 금액을 편집·적용하면 제출
 *  `budgetTotal` 이 **사용자 입력값**으로 나간다(★회귀 복원, B-restore) ④ tier 를 바꿔 적용해도 제출
 *  바디에 **budgetTier/tier 키가 없고** budgetTotal 은 프리필 그대로다(★ tier 전송 0, B-tier0).
 *
 * ★ tier=순수 표시 계약: tier 는 스토어·요청 어디에도 안 간다(`CreateTripRequest` 에 budgetTier 없음 —
 * openapi 실측). tier 를 제출에 실으면 B-tier0 의 키 부재 단언이 red, tier 가 금액을 건드리면 budgetTotal
 * 불변 단언이 red.
 *
 * ★회귀 복원(01b D3): `budgetTotal = parseBudgetAmount(effectiveBudgetText)`, effective = 스토어 budgetText
 * 유효하면 그것, 아니면 프리필. 이 파일의 B-restore 가 "항상 프리필" 뮤턴트를, 기존
 * `TripNewStep1Page.integration.test.tsx` I-1(예산 미편집 → budgetTotal 800000)이 "항상 budgetText"
 * 뮤턴트를 각각 red 로 잡는다(양방향, 02a §4-3).
 *
 * 왜 통합 버킷인가: 시트는 props-only 무상태라 "탭→값 전이"·"적용→스토어/제출"은 배선이 드래프트를
 * 소유·커밋할 때만 일어난다 — 스토어·실제 나간 요청을 함께 관측해야 한다. 컴포넌트 단위(표식·콜백·노트
 * range)는 `BudgetEditSheet.test.tsx` 가 잠근다.
 *
 * ⚠️ 회원(토큰 목 주입)으로 돈다 — S3~S5 harness 계승. 무조건 발화하는 `useGetMePreferences`(프리필)만
 * `/me/preferences` 핸들러로 받고, 제출 케이스만 `POST /trips` 핸들러(바디 캡처)를 준다. `/regions`·
 * `/saved-*` 핸들러는 **일부러 안 준다**(남기면 신 배선이 그 훅을 물었다는 증거로 크래시 red).
 *
 * ⚠️ 바텀시트 통과형 목: 마운트하면 children 무조건 렌더 — "시트 오픈"은 **조건부 마운트 트리 존재/부재**
 * 뿐이다. 실제 슬라이드업·딤·터치 차단은 jest 사각(6-b 실기).
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

/** 프리필이 요약 예산 행 + 시트 초기 드래프트 + 제출 바디로 흐른다. rawAmount 800000·tier 중간. */
const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식'] },
  activities: { value: ['야경'] },
};

/** openapi `Trip.required` 10필드. */
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

function createHits(): number {
  return observedHits.filter((hit) => hit === 'POST /api/v1/trips').length;
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

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE)),
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

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 예산 요약 행을 눌러 시트를 연다(공통). */
async function openSheet(): Promise<void> {
  fireEvent.press(screen.getByTestId('trip-wizard-summary-budget'));
  await screen.findByTestId('trip-wizard-budget-sheet');
}

/** 정상 제출 가능한 스토어 선상태(부산 3박 + 3박 4일). */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

/** 프리필이 예산 요약 행(80만원)까지 흘러온 것을 기다린다 — 시트 초기 드래프트·제출 바디를 보려면 필요. */
async function waitForPrefill(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('trip-wizard-summary-budget')).toHaveTextContent(
      /80만원/
    )
  );
}

describe('B-1 · 예산 행 탭이 시트를 연다', () => {
  it('탭 전엔 시트가 없고, 탭하면 마운트된다', async () => {
    renderPage();
    await waitForPrefill();
    expect(screen.queryByTestId('trip-wizard-budget-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-summary-budget'));

    expect(
      await screen.findByTestId('trip-wizard-budget-sheet')
    ).toBeOnTheScreen();
  });
});

describe('B-apply · ★ 드래프트 계약 — 적용 전 store 불변, 적용에서만 setBudgetText 커밋 + 닫힘', () => {
  it('시트는 effective 문자열로 열리고, 금액 전이는 store 를 안 건드리며 적용에서만 커밋된다', async () => {
    renderPage();
    await waitForPrefill();
    await openSheet();

    // D3 프리필 — 열자마자 입력에 effective(프리필 포맷) 값이 시드된다.
    expect(screen.getByTestId('trip-wizard-budget-input')).toHaveDisplayValue(
      '800,000'
    );

    // 금액 편집 → 드래프트 전이(입력 표시값 변화). store budgetText 는 아직 초기값.
    fireEvent.changeText(
      screen.getByTestId('trip-wizard-budget-input'),
      '500000'
    );
    expect(screen.getByTestId('trip-wizard-budget-input')).toHaveDisplayValue(
      '500000'
    );

    // 적용 전 — 즉시반영이 아니라 드래프트다(즉시커밋 뮤턴트가 이걸로 red).
    expect(useTripWizardStore.getState().budgetText).toBe('');

    // 적용 → 커밋 + 닫힘.
    fireEvent.press(screen.getByTestId('trip-wizard-budget-apply'));

    await waitFor(() =>
      expect(useTripWizardStore.getState().budgetText).toBe('500000')
    );
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-budget-sheet')).toBeNull()
    );
  });
});

describe('B-restore · ★회귀 제출 budgetTotal = 사용자 입력(프리필 아님)', () => {
  it('금액을 편집·적용하면 POST 바디 budgetTotal 이 사용자 값으로 나간다', async () => {
    seedValidDraft();
    renderPage();
    await waitForPrefill();
    await openSheet();

    fireEvent.changeText(
      screen.getByTestId('trip-wizard-budget-input'),
      '500000'
    );
    fireEvent.press(screen.getByTestId('trip-wizard-budget-apply'));
    await waitFor(() =>
      expect(useTripWizardStore.getState().budgetText).toBe('500000')
    );

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    // "항상 프리필" 뮤턴트면 800000 으로 red.
    expect(postedBodies[0]).toMatchObject({ budgetTotal: 500000 });
  });
});

describe('B-tier0 · ★ tier 전송 0 + tier 가 금액을 안 건드린다', () => {
  it('tier 를 고급으로 바꿔 적용해도 제출 바디에 budgetTier/tier 가 없고 budgetTotal 은 프리필 그대로다', async () => {
    seedValidDraft();
    renderPage();
    await waitForPrefill();
    await openSheet();

    // 프리필 tier(중간)와 다른 tier 선택 — 금액은 손대지 않는다.
    fireEvent.press(screen.getByTestId('trip-wizard-budget-tier-high'));
    fireEvent.press(screen.getByTestId('trip-wizard-budget-apply'));
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-budget-sheet')).toBeNull()
    );

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    const body = postedBodies[0];
    // tier 는 어디에도 안 간다(honest — CreateTripRequest 에 budgetTier 없음). 실으면 red.
    expect(Object.keys(body)).not.toContain('budgetTier');
    expect(Object.keys(body)).not.toContain('tier');
    // tier 가 금액을 건드리는 뮤턴트면 budgetTotal 이 프리필(800000)에서 벗어나 red.
    expect(body).toMatchObject({ budgetTotal: 800000 });
  });
});

describe('B-summary · ★ 편집이 요약 "예산" 행에 반영된다(자매 4행과 정합, 5-c)', () => {
  it('금액을 50만원으로 편집·적용하면 요약 행이 프리필(80만원)이 아니라 편집값(50만원)을 보인다', async () => {
    // Arrange: 프리필 80만원이 요약 행까지 도착한 상태에서 시트를 연다.
    seedValidDraft();
    renderPage();
    await waitForPrefill();
    await openSheet();

    // Act: 금액을 500000 으로 바꿔 적용.
    fireEvent.changeText(
      screen.getByTestId('trip-wizard-budget-input'),
      '500000'
    );
    fireEvent.press(screen.getByTestId('trip-wizard-budget-apply'));

    // Assert: 요약 행이 편집값을 반영한다. summaryBudget 에 프리필 rawAmount 를
    // 넘기는 뮤턴트(=버그)면 여전히 80만원이라 red(편집이 화면에 안 먹는 것을 잡는다).
    await waitFor(() =>
      expect(
        screen.getByTestId('trip-wizard-summary-budget')
      ).toHaveTextContent(/50만원/)
    );
    expect(
      screen.getByTestId('trip-wizard-summary-budget')
    ).not.toHaveTextContent(/80만원/);
  });
});

/**
 * TRIP-677 · S6G — 프리필 async 갭(예산). 취향(S5G)과 대칭 — `openBudgetSheet` 진입 가드
 * `if (preference.isPending) return;`. 예산은 자가치유(빈 적용→프리필 재도출)라 손실은 없으나,
 * 빈 드래프트로 여는 것을 막아 결을 맞춘다(01b 구현). 신호는 preference.isPending(★3).
 * deferred(비해결) 프리필로 pending 재현(★1, 02a §5-A).
 */
describe('B-guard · ★ AC-S6G-1 프리필 미해결 중 예산 행 탭은 시트를 안 연다', () => {
  it('preference 쿼리가 pending 이면 예산 요약 행을 눌러도 BudgetEditSheet 가 안 열린다', () => {
    server.use(http.get(`${BASE}/me/preferences`, () => new Promise(() => {})));

    renderPage();

    // pending 확증 — 예산 값 자리가 스켈레톤(가드 신호 활성).
    expect(
      screen.getByTestId('trip-wizard-summary-skeleton-5')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-wizard-summary-budget'));

    // 현행(결함): 가드 부재 → 빈 드래프트로 시트가 열린다. 가드 후엔 안 열린다.
    expect(screen.queryByTestId('trip-wizard-budget-sheet')).toBeNull();
  });
});

/**
 * TRIP-677 · S6D — 예산 표시↔제출 대칭(★4·★6). 현행은 프리필 rawAmount=0 이면 요약은 "예산 선택"
 * (summaryBudget(0)=null)인데 제출은 `budgetTotal:0` 을 보낸다 — **표시=미선택, 제출=0** 의 비대칭.
 * 봉합: 제출 삼항을 `kind==='amount' && amount>0 ? amount : undefined` 로 좁혀 요약 규칙과 맞춘다.
 * AC-S6D-1(0=키 부재)과 AC-S6D-2(양수=전송)를 짝으로 둬 방향이 뒤집히는 뮤턴트를 잡는다.
 */
describe('S6D · ★ 표시=제출 대칭 (예산 0 / 양수)', () => {
  it('AC-S6D-1 · rawAmount=0·미입력이면 제출 바디에 budgetTotal 키가 없고 요약은 "예산 선택"이다', async () => {
    // rawAmount=0 프리필. 예산 요약이 안 바뀌므로 프리필 도착은 취향(미식)으로 잰다.
    server.use(
      http.get(`${BASE}/me/preferences`, () =>
        HttpResponse.json({
          pace: { value: '균형있게', isNeutralDefault: false },
          budget: { tier: '저가', rawAmount: 0, isNeutralDefault: false },
          styles: { value: ['미식'] },
          activities: { value: [] },
        })
      )
    );
    seedValidDraft();
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByTestId('trip-wizard-summary-preference')
      ).toHaveTextContent(/미식/)
    );

    // 요약은 미선택 — summaryBudget(0)=null → "예산 선택"(표시축은 이미 맞다).
    expect(screen.getByTestId('trip-wizard-summary-budget')).toHaveTextContent(
      /예산 선택/
    );

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    // 현행(결함): budgetTotal:0 을 보낸다 → 키가 있어 red. `>0` 가드 후엔 키 자체가 없다.
    expect(Object.keys(postedBodies[0])).not.toContain('budgetTotal');
  });

  it('AC-S6D-2 · 양수 프리필(1,200,000)은 budgetTotal:1200000 을 보내고 요약에 표시한다 (무회귀)', async () => {
    server.use(
      http.get(`${BASE}/me/preferences`, () =>
        HttpResponse.json({
          pace: { value: '균형있게', isNeutralDefault: false },
          budget: { tier: '고급', rawAmount: 1200000, isNeutralDefault: false },
          styles: { value: ['미식'] },
          activities: { value: [] },
        })
      )
    );
    seedValidDraft();
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByTestId('trip-wizard-summary-budget')
      ).toHaveTextContent(/120만원/)
    );

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    // 양수는 여전히 전송 — `>0` 가드가 정상 경로를 막지 않는다(★8 회귀 방어).
    expect(postedBodies[0]).toMatchObject({ budgetTotal: 1200000 });
  });
});

/**
 * TRIP-677 · S6E — budgetError 배선(신규 생산자) + applyBudget invalid 무커밋. `BudgetEditSheet` 는
 * `budgetError` 슬롯을 이미 가졌으나(props-only) 페이지가 이 prop 을 안 내려준다(생산자 부재). 봉합:
 * 페이지가 `parseBudgetAmount(draftAmountText).kind==='invalid'` 를 도출해 시트에 내리고, applyBudget 이
 * invalid 면 커밋·닫기를 건너뛴다(조용한 소멸 방지). 카피는 오케 확정값 '숫자만 입력해 주세요'.
 */
describe('S6E · ★ budgetError 배선 + applyBudget invalid 무커밋', () => {
  it('AC-S6E-1 · 시트에 invalid("abc")를 입력하면 오류 노드(trip-wizard-error-budget)가 렌더된다', async () => {
    renderPage();
    await waitForPrefill();
    await openSheet();

    fireEvent.changeText(screen.getByTestId('trip-wizard-budget-input'), 'abc');

    // 현행(결함): 페이지가 budgetError 를 도출·전달 안 해 오류 노드가 없다 → red.
    // 가드(page 도출→시트 슬롯) 후엔 렌더된다.
    expect(screen.getByTestId('trip-wizard-error-budget')).toBeOnTheScreen();
  });

  it('AC-S6E-2 · invalid 상태에서 "적용"을 눌러도 커밋되지 않고 시트가 닫히지 않는다 (조용한 소멸 방지)', async () => {
    renderPage();
    await waitForPrefill();
    await openSheet();

    fireEvent.changeText(screen.getByTestId('trip-wizard-budget-input'), 'abc');
    fireEvent.press(screen.getByTestId('trip-wizard-budget-apply'));

    // 현행(결함): applyBudget 이 무조건 setBudgetText+닫기 → 시트 닫힘 & store 'abc' 커밋 → red.
    // 가드(invalid 면 커밋·닫기 skip) 후엔 시트 유지 + store 불변.
    expect(screen.getByTestId('trip-wizard-budget-sheet')).toBeOnTheScreen();
    expect(useTripWizardStore.getState().budgetText).toBe('');
  });
});
