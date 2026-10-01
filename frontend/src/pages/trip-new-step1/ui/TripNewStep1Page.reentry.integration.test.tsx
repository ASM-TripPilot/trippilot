import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  MustVisit,
  PreferenceView,
  Trip,
} from '@/shared/api/generated/schemas';
import type { MustVisitSeedItem } from '@/features/trip/model/mustVisitSeed';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-1113 — 이미 만든 여행이 있으면 「다음」은 여행을 새로 만들지 않고 고친다(실 HTTP 심판).
 *
 * 무엇을 보장하나:
 *  - `createdTripId` 가 있으면 새로 마운트된 step1 이든 같은 화면이든 `POST /trips` 대신
 *    `PATCH /trips/{id}` 를 보내고, 서버 꼭 갈 곳을 화면 시드에 맞춘 뒤(추가·삭제) step2 로 간다.
 *  - PATCH·동기화·조회 실패는 각자 배너로 드러나고, 다시 시도가 여행을 또 만들지 않는다(INV-4).
 *  - `createdTripId` 가 없으면 지금 그대로 새로 만든다(가드 c 무회귀).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청의 종류·횟수·본문"이다(msw 만 관찰).
 * 가짜 서버의 꼭 갈 곳 목록은 상태를 가진다(POST 는 더하고 DELETE 는 뺀다) — 재시도가 다시 조회하든
 * 남은 목록을 기억하든 테스트는 나간 요청만 본다.
 *
 * ⚠️ 요청 수는 완전 일치로 센다 — must-visits 경로가 `/api/v1/trips` 를 접두로 품는다.
 * ⚠️ 게스트로 돈다(담은목록 조회 없음). 모든 핸들러를 beforeEach 에 건다 — `onUnhandledRequest:'error'`.
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const BASE_DATE = '2026-06-10';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';

const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '전시'] },
  activities: { value: ['야경'] },
};

const TRIP: Trip = {
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

const CREATE = 'POST /api/v1/trips';
const PATCH = `PATCH /api/v1/trips/${TRIP_ID}`;
const MV_PATH = `/api/v1/trips/${TRIP_ID}/must-visits`;
const MV_GET = `GET ${MV_PATH}`;
const MV_ADD = `POST ${MV_PATH}`;
const mvDelete = (mustVisitId: string) => `DELETE ${MV_PATH}/${mustVisitId}`;

let observedHits: string[] = [];
let patchedBodies: Record<string, unknown>[] = [];
let addedBodies: Record<string, unknown>[] = [];
/** 가짜 서버에 등록된 꼭 갈 곳 — POST 가 더하고 DELETE 가 뺀다. */
let registered: MustVisit[] = [];
/** 실패 스위치 — 켠 것만 실패한다. 재시도 전에 끈다. */
let patchFailure: null | 'network' | number = null;
let failGet = false;
let failDelete = false;
let failAddFor = new Set<string>();
let conflictAddFor = new Set<string>();
/** push 가 불린 그 순간의 PATCH 수(AC-2b 순서 단언). */
let pushSnapshots: number[] = [];

const hits = (line: string) =>
  observedHits.filter((hit) => hit === line).length;
const mustVisitHits = () =>
  observedHits.filter((hit) => /\/must-visits(\/|$)/.test(hit)).length;

function mustVisit(poiId: string): MustVisit {
  return {
    mustVisitId: `mv-${poiId}`,
    poiSnapshotId: `snap-${poiId}`,
    sourcePoiId: poiId,
    type: 'ANYTIME',
  };
}

function seedItem(sourcePoiId: string): MustVisitSeedItem {
  return {
    sourcePoiId,
    name: `장소 ${sourcePoiId}`,
    imageUrl: null,
    region: null,
  };
}

const errorBody = (code: string) => ({ error: { code, message: code } });

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  patchedBodies = [];
  addedBodies = [];
  registered = [];
  patchFailure = null;
  failGet = false;
  failDelete = false;
  failAddFor = new Set();
  conflictAddFor = new Set();
  pushSnapshots = [];
  mockPush.mockReset();
  mockPush.mockImplementation(() => {
    pushSnapshots.push(hits(PATCH));
  });
  useTripWizardStore.getState().reset();

  server.use(
    http.get(`${BASE}/me/preferences`, () => HttpResponse.json(PREFERENCE)),
    http.post(`${BASE}/trips`, () => HttpResponse.json(TRIP, { status: 201 })),
    http.patch(`${BASE}/trips/:tripId`, async ({ request }) => {
      patchedBodies.push((await request.json()) as Record<string, unknown>);
      if (patchFailure === 'network') return HttpResponse.error();
      if (patchFailure !== null) {
        return HttpResponse.json(errorBody('REJECTED'), {
          status: patchFailure,
        });
      }
      return HttpResponse.json(TRIP);
    }),
    http.get(`${BASE}/trips/:tripId/must-visits`, () =>
      failGet
        ? HttpResponse.json(errorBody('INTERNAL'), { status: 500 })
        : HttpResponse.json(registered)
    ),
    http.post(`${BASE}/trips/:tripId/must-visits`, async ({ request }) => {
      const body = (await request.json()) as { poiId: string };
      addedBodies.push(body);
      if (failAddFor.has(body.poiId)) {
        return HttpResponse.json(errorBody('INTERNAL'), { status: 500 });
      }
      if (conflictAddFor.has(body.poiId)) {
        return HttpResponse.json(errorBody('CONFLICT'), { status: 409 });
      }
      const row = mustVisit(body.poiId);
      registered = [...registered, row];
      return HttpResponse.json(row, { status: 201 });
    }),
    http.delete(
      `${BASE}/trips/:tripId/must-visits/:mustVisitId`,
      ({ params }) => {
        if (failDelete) {
          return HttpResponse.json(errorBody('INTERNAL'), { status: 500 });
        }
        registered = registered.filter(
          (row) => row.mustVisitId !== params.mustVisitId
        );
        return new HttpResponse(null, { status: 204 });
      }
    )
  );
});

afterEach(() => {
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
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<TripNewStep1Page baseDate={BASE_DATE} />, {
    wrapper: Wrapper,
  });
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

/** 부산 3박 + 2026-06-10~13 — 「다음」이 열리는 최소 드래프트. */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

/** 이전 제출이 만든 여행이 남아 있는 재진입 상태. */
function seedReentry(): void {
  seedValidDraft();
  useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
}

/** 프리필이 도착한 눈금 — 요약 취향 행에 프리필 칩이 뜬다. */
async function waitForPrefill(): Promise<void> {
  await waitFor(() =>
    expect(
      screen.getByTestId('trip-wizard-summary-preference')
    ).toHaveTextContent(/미식/)
  );
}

async function pressNextAfterPrefill(): Promise<void> {
  await waitForPrefill();
  fireEvent.press(next());
}

describe('🔴 AC-1 · 이미 만든 여행이 있으면 새로 마운트된 step1 도 여행을 또 만들지 않는다', () => {
  it('R-1 새 여행을 만든 뒤 step1 이 새로 쌓여 「다음」을 누르면 PATCH 1회뿐이고 POST /trips 는 그대로 1회다', async () => {
    // 준비 — 처음 제출로 여행이 하나 만들어지고 step2 로 갔다.
    seedValidDraft();
    const first = renderPage();
    await pressNextAfterPrefill();
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(hits(CREATE)).toBe(1);

    // 실행 — 꼭 갈 곳 고르기 완료처럼 새 step1 인스턴스가 쌓인다.
    first.unmount();
    renderPage();
    await pressNextAfterPrefill();

    // 단언
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
    expect(hits(CREATE)).toBe(1);
    expect(hits(PATCH)).toBe(1);
    expect(mockPush).toHaveBeenLastCalledWith('/trips/new/step2');
  });

  it('R-2 재진입 상태로 처음 그려진 step1 은 POST /trips 0회 · PATCH 1회 뒤 step2 로 간다', async () => {
    seedReentry();
    renderPage();

    await pressNextAfterPrefill();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush.mock.calls).toEqual([['/trips/new/step2']]);
    expect(hits(CREATE)).toBe(0);
    expect(hits(PATCH)).toBe(1);
  });
});

describe('🔴 AC-2 · PATCH 본문은 화면 값 전체다(대체 의미)', () => {
  it('R-3 인원·동반·예산을 바꾼 재진입이면 본문이 정확히 그 6개 키이고 취향 스냅숏·제목은 없다', async () => {
    seedReentry();
    const store = useTripWizardStore.getState();
    store.setParty(3);
    store.selectCompanion('가족');
    store.setBudgetText('1,200,000');
    renderPage();

    await pressNextAfterPrefill();

    await waitFor(() => expect(hits(PATCH)).toBe(1));
    expect(patchedBodies).toEqual([
      {
        startDate: '2026-06-10',
        endDate: '2026-06-13',
        destinations: [{ seq: 1, region: '부산', nights: 3 }],
        party: 3,
        companionType: '가족',
        budgetTotal: 1200000,
      },
    ]);
  });

  it('R-4 예산이 0 이면 POST 와 같이 budgetTotal 키를 싣지 않는다', async () => {
    seedReentry();
    useTripWizardStore.getState().setBudgetText('0');
    renderPage();

    await pressNextAfterPrefill();

    await waitFor(() => expect(hits(PATCH)).toBe(1));
    expect(patchedBodies).toEqual([
      {
        startDate: '2026-06-10',
        endDate: '2026-06-13',
        destinations: [{ seq: 1, region: '부산', nights: 3 }],
        party: 1,
        companionType: '혼자',
      },
    ]);
  });
});

describe('🔴 AC-2b · 같은 화면으로 돌아와 값을 바꾸면 요청 없이 넘어가지 않는다', () => {
  it('R-5 step2 에 한 번 갔다 온 화면에서 기간을 바꿔 「다음」을 누르면 PATCH 가 먼저 나가고 그 뒤에 이동한다', async () => {
    // 준비 — 같은 화면에서 새 여행을 만들고 step2 로 갔다.
    seedValidDraft();
    renderPage();
    await pressNextAfterPrefill();
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(hits(CREATE)).toBe(1);

    // 돌아와서 시작일을 바꾼다(끝은 3박에 맞춰 파생된다).
    act(() => {
      useTripWizardStore.getState().setStartDate('2026-06-20');
    });

    // 실행
    fireEvent.press(next());

    // 단언 — 바뀐 값이 서버로 가고, 이동은 그 뒤다.
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(2));
    expect(hits(PATCH)).toBe(1);
    expect(patchedBodies[0]).toMatchObject({
      startDate: '2026-06-20',
      endDate: '2026-06-23',
    });
    expect(pushSnapshots).toEqual([0, 1]);
    expect(hits(CREATE)).toBe(1);
  });
});

describe('🔴 AC-3 · 서버 꼭 갈 곳을 화면 시드에 맞춘다', () => {
  it('R-6 서버 A·B, 시드 B·C 면 C 만 추가하고 A 만 지우며 B 는 건드리지 않는다', async () => {
    registered = [mustVisit('poi-A'), mustVisit('poi-B')];
    seedReentry();
    useTripWizardStore
      .getState()
      .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
    renderPage();

    await pressNextAfterPrefill();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
    expect(addedBodies).toEqual([{ poiId: 'poi-C', type: 'ANYTIME' }]);
    expect(hits(MV_ADD)).toBe(1);
    expect(hits(mvDelete('mv-poi-A'))).toBe(1);
    expect(hits(mvDelete('mv-poi-B'))).toBe(0);
    // 동기화는 PATCH 성공 뒤다.
    expect(observedHits.indexOf(PATCH)).toBeGreaterThanOrEqual(0);
    expect(observedHits.indexOf(PATCH)).toBeLessThan(
      observedHits.indexOf(MV_GET)
    );
    expect(hits(CREATE)).toBe(0);
  });
});

describe('🔴 AC-4 · 추가가 409(이미 있음)면 실패로 세지 않는다', () => {
  it('R-7 C 추가가 409 여도 배너 없이 step2 로 간다', async () => {
    registered = [mustVisit('poi-A'), mustVisit('poi-B')];
    conflictAddFor = new Set(['poi-C']);
    seedReentry();
    useTripWizardStore
      .getState()
      .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
    renderPage();

    await pressNextAfterPrefill();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
    expect(hits(MV_ADD)).toBe(1);
    expect(screen.queryByTestId('trip-wizard-mustvisit-banner')).toBeNull();
  });
});

describe('🔴 AC-5 · PATCH 실패는 제출 배너로 드러나고 여행을 새로 만들지 않는다', () => {
  it.each([
    ['400', 400],
    ['409 (종료·삭제된 여행)', 409],
    ['500', 500],
    ['네트워크', 'network' as const],
  ])(
    'R-8 PATCH 가 %s 로 실패하면 배너가 뜨고 POST /trips·동기화·이동이 0회다',
    async (_label, failure) => {
      patchFailure = failure;
      seedReentry();
      renderPage();

      await pressNextAfterPrefill();

      const banner = await screen.findByTestId('trip-wizard-submit-banner');
      expect(within(banner).getByText('저장하지 못했어요')).toBeOnTheScreen();
      expect(hits(PATCH)).toBe(1);
      expect(hits(CREATE)).toBe(0);
      expect(mustVisitHits()).toBe(0);
      expect(mockPush).not.toHaveBeenCalled();
    }
  );

  it('R-9 배너의 다시 시도는 PATCH 를 다시 보내고(POST 아님) 성공하면 step2 로 간다', async () => {
    patchFailure = 'network';
    seedReentry();
    renderPage();
    await pressNextAfterPrefill();
    const banner = await screen.findByTestId('trip-wizard-submit-banner');

    patchFailure = null;
    fireEvent.press(
      within(banner).getByTestId('trip-wizard-submit-banner-retry')
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
    expect(hits(PATCH)).toBe(2);
    expect(hits(CREATE)).toBe(0);
  });
});

describe('🔴 AC-6 · 동기화 일부 실패는 꼭 갈 곳 배너로 드러나고 다시 시도는 남은 차이만 맞춘다', () => {
  it('R-10 A 삭제는 되고 C 추가가 실패하면 "2곳 중 1곳" 배너가 뜨고 이동하지 않는다', async () => {
    registered = [mustVisit('poi-A')];
    failAddFor = new Set(['poi-C']);
    seedReentry();
    useTripWizardStore.getState().initMustVisits([seedItem('poi-C')]);
    renderPage();

    await pressNextAfterPrefill();

    const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
    expect(
      within(banner).getByText('꼭 갈 곳 2곳 중 1곳을 등록하지 못했어요')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('R-11 다시 시도는 여행을 만들지 않고 실패한 C 만 다시 추가한 뒤 step2 로 간다', async () => {
    registered = [mustVisit('poi-A')];
    failAddFor = new Set(['poi-C']);
    seedReentry();
    useTripWizardStore.getState().initMustVisits([seedItem('poi-C')]);
    renderPage();
    await pressNextAfterPrefill();
    const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
    expect(hits(mvDelete('mv-poi-A'))).toBe(1);

    failAddFor = new Set();
    fireEvent.press(
      within(banner).getByTestId('trip-wizard-mustvisit-banner-retry')
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
    expect(hits(CREATE)).toBe(0);
    expect(hits(MV_ADD)).toBe(2);
    expect(addedBodies.map((body) => body.poiId)).toEqual(['poi-C', 'poi-C']);
    expect(hits(mvDelete('mv-poi-A'))).toBe(1);
  });

  it('R-12 삭제 실패도 같은 배너로 센다 — 시드를 비웠는데 A 삭제가 실패하면 "1곳 중 1곳"', async () => {
    registered = [mustVisit('poi-A')];
    failDelete = true;
    seedReentry();
    renderPage();

    await pressNextAfterPrefill();

    const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
    expect(
      within(banner).getByText('꼭 갈 곳 1곳 중 1곳을 등록하지 못했어요')
    ).toBeOnTheScreen();
    expect(hits(mvDelete('mv-poi-A'))).toBe(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🟢 AC-7 · 이미 만든 여행이 없으면 지금처럼 새로 만든다 (가드 c 무회귀)', () => {
  it('R-13 새 여행이면 POST /trips 1회 · PATCH 0 · 꼭 갈 곳 조회 0 · 시드 C 등록 1회 뒤 step2 로 간다', async () => {
    seedValidDraft();
    useTripWizardStore.getState().initMustVisits([seedItem('poi-C')]);
    renderPage();

    await pressNextAfterPrefill();

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
    expect(hits(CREATE)).toBe(1);
    expect(observedHits.filter((hit) => hit.startsWith('PATCH '))).toEqual([]);
    expect(hits(MV_GET)).toBe(0);
    expect(addedBodies).toEqual([{ poiId: 'poi-C', type: 'ANYTIME' }]);
  });
});

describe('🔴 AC-9 · 고치는 중 다시 눌러도 요청이 늘지 않는다', () => {
  it('R-14 PATCH 응답 전 두 번째 press 는 PATCH·POST·must-visits 를 더 만들지 않는다', async () => {
    let release: () => void = () => {};
    let started = false;
    server.use(
      http.patch(`${BASE}/trips/:tripId`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
          started = true;
        });
        return HttpResponse.json(TRIP);
      })
    );
    seedReentry();
    renderPage();
    await pressNextAfterPrefill();
    await waitFor(() => expect(started).toBe(true));

    fireEvent.press(next());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(hits(PATCH)).toBe(1);
    expect(hits(CREATE)).toBe(0);
    expect(mustVisitHits()).toBe(0);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(hits(PATCH)).toBe(1);
    expect(hits(CREATE)).toBe(0);
  });

  it('R-15 꼭 갈 곳 조회 응답 전 두 번째 press 도 요청을 더 만들지 않는다', async () => {
    let release: () => void = () => {};
    let started = false;
    server.use(
      http.get(`${BASE}/trips/:tripId/must-visits`, async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
          started = true;
        });
        return HttpResponse.json([]);
      })
    );
    seedReentry();
    renderPage();
    await pressNextAfterPrefill();
    await waitFor(() => expect(started).toBe(true));

    fireEvent.press(next());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(hits(PATCH)).toBe(1);
    expect(hits(MV_GET)).toBe(1);
    expect(hits(CREATE)).toBe(0);

    await act(async () => {
      release();
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(hits(PATCH)).toBe(1);
    expect(hits(MV_GET)).toBe(1);
  });
});

describe('🔴 AC-11 · 꼭 갈 곳 조회 실패는 배너로 드러나고 다시 시도는 조회부터 한다', () => {
  it('R-16 조회가 실패하면 "2곳 중 2곳" 꼭 갈 곳 배너가 뜨고 이동·여행 생성이 0회다', async () => {
    failGet = true;
    seedReentry();
    useTripWizardStore
      .getState()
      .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
    renderPage();

    await pressNextAfterPrefill();

    const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
    expect(
      within(banner).getByText('꼭 갈 곳 2곳 중 2곳을 등록하지 못했어요')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
    expect(hits(CREATE)).toBe(0);
    expect(hits(MV_ADD)).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('R-17 다시 시도는 조회를 다시 하고 B·C 를 추가한 뒤 step2 로 간다', async () => {
    failGet = true;
    seedReentry();
    useTripWizardStore
      .getState()
      .initMustVisits([seedItem('poi-B'), seedItem('poi-C')]);
    renderPage();
    await pressNextAfterPrefill();
    const banner = await screen.findByTestId('trip-wizard-mustvisit-banner');
    expect(hits(MV_GET)).toBe(1);

    failGet = false;
    fireEvent.press(
      within(banner).getByTestId('trip-wizard-mustvisit-banner-retry')
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/trips/new/step2');
    expect(hits(MV_GET)).toBe(2);
    expect(addedBodies.map((body) => body.poiId).sort()).toEqual([
      'poi-B',
      'poi-C',
    ]);
    expect(hits(CREATE)).toBe(0);
  });
});
