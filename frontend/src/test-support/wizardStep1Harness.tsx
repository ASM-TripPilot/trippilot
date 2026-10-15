import type { ComponentType, ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type { PreferenceView, Trip } from '@/shared/api/index.schemas';
import { useTripWizardStore } from '@/features/create-trip';
import { TripNewStep1Page } from '@/pages/trip/trip-new-step1';

/**
 * g01 여행 만들기 1/4(`TripNewStep1Page`) 통합 테스트 공용 하네스(TRIP-1353).
 *
 * 옛 `TripNewStep1Page.integration.test.tsx` 는 바깥 describe 14개가 각자 `BASE`·`PREFERENCE`·`TRIP`·`createWrapper`·
 * `renderPage`·`next`·`seedValidDraft`·`openSheet`·`waitForPrefill` 와 "요청 관찰자(`observedHits`) 켜고 끄기"를 다시 선언했다
 * (옛 12파일 합본의 흔적). 같은 모양을 한 곳에 모았다 — 단언은 그대로 두고 **준비물만** 옮겼다.
 *
 * 쓰는 법: describe 본문에서 `wizardStep1Harness(옵션)` 를 한 번 부른다. 이 호출이 `beforeAll`(관찰자 켜기)·`afterAll`
 * (관찰자 떼기)·`beforeEach`(관찰 기록 비우기) 를 그 describe 에 건다 — 그러니 **describe 본문에서만** 부른다.
 * describe 마다 미세하게 다른 것(오늘 날짜 `baseDate`, 예산 프리필 GET 의 응답, 생성 응답 `Trip`)은 옵션/인자로 받는다.
 *
 * jest.mock 팩토리 안에서는 쓰지 않는다 — 이 모듈은 JSX 를 가지므로 NativeWind babel 이 주입하는
 * `_ReactNativeCSSInterop` 참조가 팩토리 스코프로 걸리지 않게 **별도 모듈 파일**이어야 한다(`queryRender` 와 같은 이유).
 */

export const BASE = 'http://localhost:8080/api/v1';

/** 프리필이 요약 예산·취향 행 + 제출 바디로 흐른다(예산 칩 `80만원`·취향 칩 `미식` 이 프리필 도착의 눈금). rawAmount 800000. */
export const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '전시'] },
  activities: { value: ['야경'] },
};

export const TRIP_ID = '11111111-1111-1111-1111-111111111111';

/** openapi `Trip.required` 10필드를 그대로 채운 생성 응답(부산 3박). */
export const TRIP: Trip = {
  tripId: TRIP_ID,
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
  baseCount: 0,
  itineraryDayCount: 0,
};

/** 기본 프리필에서 일부 축만 바꾼다. */
export function makePreference(over: Partial<PreferenceView>): PreferenceView {
  return { ...PREFERENCE, ...over };
}

/** 예산 축이 비어 있는 프리필(온보딩에서 예산을 안 고른 계정). */
export const NO_BUDGET = {
  tier: null,
  rawAmount: null,
  isNeutralDefault: true,
};

/** 프리필의 예산 축만 바꾼다 — 취향 styles 는 미식 하나(요약 취향 행 `미식` 이 도착 눈금). */
export function budgetPreference(
  budget: NonNullable<PreferenceView['budget']>
): PreferenceView {
  return {
    pace: { value: '균형있게', isNeutralDefault: false },
    budget,
    styles: { value: ['미식'] },
    activities: { value: [] },
  };
}

/** 기본 생성 응답에서 일부 필드만 바꾼다. */
export function makeTrip(over: Partial<Trip>): Trip {
  return { ...TRIP, ...over };
}

type SheetKind =
  | 'destination'
  | 'period'
  | 'daywindow'
  | 'companion'
  | 'preference'
  | 'budget';

/** 요약 행 → 시트 testID. 취향 시트만 `pref` 접두다. */
const SHEET_TEST_IDS: Record<SheetKind, string> = {
  destination: 'trip-wizard-destination-sheet',
  period: 'trip-wizard-period-sheet',
  daywindow: 'trip-wizard-daywindow-sheet',
  companion: 'trip-wizard-companion-sheet',
  preference: 'trip-wizard-pref-sheet',
  budget: 'trip-wizard-budget-sheet',
};

export interface WizardStep1HarnessOptions {
  /** 달력·기간 파생의 "오늘" — 페이지 prop `baseDate`. */
  baseDate?: string;
  /** `QueryClientProvider` 안쪽에 한 겹 더 씌운다(토스트 호스트·"내 여행" 목록 관찰자). */
  Inner?: ComponentType<{ children: ReactNode }>;
}

/** 프리필 도착의 눈금 — `budget`: 요약 예산 행 `80만원`, `preference`: 요약 취향 행 `미식`. */
type PrefillMark = 'budget' | 'preference';

export function wizardStep1Harness({
  baseDate = '2026-06-10',
  Inner,
}: WizardStep1HarnessOptions = {}) {
  const tracker = {
    /** 나간 요청 `METHOD /경로`(발사 순서) — 핸들러 없는 요청도 기록된다. */
    hits: [] as string[],
    /** `createTripHandler` 가 받은 `POST /trips` 본문(도착 순서). */
    postedBodies: [] as Record<string, unknown>[],
    /** 완전 일치로 센다 — 접두가 겹치는 경로(`/trips`·`/trips/{id}/must-visits`)가 섞이지 않게. */
    count(line: string): number {
      return tracker.hits.filter((hit) => hit === line).length;
    },
  };

  beforeAll(() => {
    server.events.on('request:start', ({ request }) => {
      tracker.hits.push(`${request.method} ${new URL(request.url).pathname}`);
    });
  });

  // 이 describe 의 관찰자만 떼어 낸다 — 다음 describe 의 요청이 이 배열로 새지 않게.
  afterAll(() => server.events.removeAllListeners('request:start'));

  beforeEach(() => {
    tracker.hits = [];
    tracker.postedBodies = [];
  });

  /** `GET /me/preferences` — 온보딩 취향 프리필. 인자는 기본 프리필 위에 덮는 축이다. */
  function preferenceHandler(over: Partial<PreferenceView> = {}) {
    return http.get(`${BASE}/me/preferences`, () =>
      HttpResponse.json(makePreference(over))
    );
  }

  /** `/me/preferences` 를 주어진 예산 축으로 덮어쓴다(예산 프리필 GET 이 describe 마다 다른 자리). */
  function serveBudget(budget: NonNullable<PreferenceView['budget']>): void {
    server.use(
      http.get(`${BASE}/me/preferences`, () =>
        HttpResponse.json(budgetPreference(budget))
      )
    );
  }

  /** `POST /trips` → 201. 받은 본문을 `tracker.postedBodies` 에 쌓는다. */
  function createTripHandler(trip: Trip = TRIP) {
    return http.post(`${BASE}/trips`, async ({ request }) => {
      tracker.postedBodies.push(
        (await request.json()) as Record<string, unknown>
      );
      return HttpResponse.json(trip, { status: 201 });
    });
  }

  function createWrapper() {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>
          {Inner ? <Inner>{children}</Inner> : children}
        </QueryClientProvider>
      );
    };
  }

  function renderPage() {
    return render(<TripNewStep1Page baseDate={baseDate} />, {
      wrapper: createWrapper(),
    });
  }

  function next() {
    return screen.getByTestId('trip-wizard-step1-next');
  }

  /** 정상 제출 가능한 스토어 선상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
  function seedValidDraft(): void {
    const store = useTripWizardStore.getState();
    store.addDestination('부산', 3);
    store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
  }

  /** 요약 행을 눌러 시트를 연다. */
  async function openSheet(kind: SheetKind): Promise<void> {
    fireEvent.press(screen.getByTestId(`trip-wizard-summary-${kind}`));
    await screen.findByTestId(SHEET_TEST_IDS[kind]);
  }

  /**
   * 프리필이 도착해 요약 행에 흘러온 것을 기다린다. 첫 테스트가 냉시작(모듈 첫 로드)을 흡수한다 — CI 에서
   * 기본 1000ms 를 넘겨 red 였던 적이 있어(PR #857 CI 2회) 5000ms 로 기다린다(대기 상한일 뿐 결과는 안 바뀐다).
   */
  async function waitForPrefill(mark: PrefillMark = 'budget'): Promise<void> {
    const [testID, text] =
      mark === 'budget'
        ? (['trip-wizard-summary-budget', /80만원/] as const)
        : (['trip-wizard-summary-preference', /미식/] as const);
    await waitFor(
      () => expect(screen.getByTestId(testID)).toHaveTextContent(text),
      { timeout: 5000 }
    );
  }

  return {
    tracker,
    preferenceHandler,
    serveBudget,
    createTripHandler,
    renderPage,
    next,
    seedValidDraft,
    openSheet,
    waitForPrefill,
  };
}
