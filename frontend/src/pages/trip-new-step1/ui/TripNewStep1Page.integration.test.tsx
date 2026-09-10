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
import type { PreferenceView, Trip } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-665 g01 default 재작성 — **제출·예외 배선 보존**(실 HTTP 심판).
 *
 * 무엇을 보장하나: 신 default 에서도 제출 계약이 그대로다.
 *  - 정상 제출이 `POST /trips` **1회**로 나가고(바디 계약대로) 201 뒤 `/trips/new/step2` 로 이동한다.
 *  - 국내 밖 400 은 다이얼로그, 네트워크·미상 실패는 배너로 드러나고 입력이 남는다(INV-4).
 *  - 제출 중 두 번째 press 가 두 번째 요청을 만들지 않는다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청과 그 횟수"다(msw 만 관찰). 뮤테이션을 쓰므로 실
 * QueryClientProvider 필요.
 *
 * 왜 재작성인가: 옛 테스트는 인라인 시트·프리셋을 눌러 드래프트를 만들었다. 신 default 엔 그 컨트롤이
 * 없어(편집은 S2~S6 스텁), 드래프트를 **스토어 선상태로 주입**한다. canProceed 는 스토어 선상태에서만 참이
 * 될 수 있다(맹점①). 인라인 오류 표면(I-2/I-3)·달력 파생(I-9)은 대응물이 사라져 삭제했다(02a §3).
 *
 * ⚠️ 게스트(토큰 없음)로 돈다 — 담은목록 조회가 `enabled:isAuthed` 라 안 나가고 `savedPlacesLoading`
 * (=isAuthed && isPending)이 false 라 게이트를 막지 않는다(01b 비회원 예외). 그래서 /saved-places 핸들러가
 * 필요 없다. `/regions`·`/saved-stays` 핸들러도 안 준다 — 신 페이지가 그 훅을 드롭했음을 강제한다(02a ★9,
 * 남기면 onUnhandledRequest:'error' 로 크래시해 red).
 *
 * ⚠️ 매처 함정(02a §5-2): `toHaveTextContent('문자열')` 완전 일치, 부분은 정규식/`within(x).getByText`.
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

/** 프리필이 요약 예산·취향 행 + 제출 바디로 흐른다(칩이 뜨면 프리필 도착의 눈금). rawAmount 800000. */
const PREFERENCE: PreferenceView = {
  pace: { value: '균형있게', isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 800000, isNeutralDefault: false },
  styles: { value: ['미식', '전시'] },
  activities: { value: ['야경'] },
};

/** openapi `Trip.required` 10필드를 그대로 채운다. */
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

/** 정상 제출 가능한 스토어 선상태(부산 3박 + 3박 4일 = 박수 3 ≤ 기간 3). */
function seedValidDraft(): void {
  const store = useTripWizardStore.getState();
  store.addDestination('부산', 3);
  store.setPeriod('3n4d', '2026-06-10', '2026-06-13');
}

/** 프리필이 예산 요약 행(80만원)까지 흘러온 것을 기다린다 — budgetTotal·스냅숏이 실린 요청을 보려면 필요. */
async function waitForPrefill(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('trip-wizard-summary-budget')).toHaveTextContent(
      /80만원/
    )
  );
}

describe('I-1 · 정상 제출이 계약대로 나가고 step2 로 이동한다', () => {
  it('[다음]을 누르면 POST /trips 가 정확히 1회 나가고 201 뒤 이동한다', async () => {
    seedValidDraft();
    renderPage();
    await waitForPrefill();

    expect(createHits()).toBe(0);
    expect(next()).toBeEnabled();

    fireEvent.press(next());

    await waitFor(() => expect(createHits()).toBe(1));
    expect(postedBodies).toHaveLength(1);
    expect(postedBodies[0]).toMatchObject({
      startDate: '2026-06-10',
      endDate: '2026-06-13',
      party: 1,
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
      budgetTotal: 800000,
    });
    // 취향 스냅숏(정책 A) — override 없이도 프리필 스냅숏이 실린다.
    expect(Object.keys(postedBodies[0])).toContain('preferenceSnapshot');
    expect(postedBodies[0].preferenceSnapshot).toMatchObject({
      styles: ['미식', '전시'],
      activities: ['야경'],
    });

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('I-4 · 국내 밖 400 은 다이얼로그로 뜨고 드래프트가 남는다', () => {
  it('국내 차단 안내가 뜨고 요약 여행지 행이 그대로 남으며 이동하지 않는다', async () => {
    // 'OVERSEAS_DESTINATION' 은 발명값(openapi enum 부재) — 상수 import 로 비교하면 동어반복이라 직접 박는다.
    server.use(
      http.post(`${BASE}/trips`, () =>
        HttpResponse.json(
          { error: { code: 'OVERSEAS_DESTINATION', message: 'outside KR' } },
          { status: 400 }
        )
      )
    );

    seedValidDraft();
    renderPage();
    await waitForPrefill();
    fireEvent.press(next());

    const dialog = await screen.findByTestId('trip-wizard-overseas-dialog');
    expect(
      within(dialog).getByText('지금은 국내 여행만 지원해요')
    ).toBeOnTheScreen();
    // 배너와 이중으로 뜨지 않는다.
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
    // 드래프트가 그대로다 — 요약 여행지 행이 살아 있다.
    expect(
      screen.getByTestId('trip-wizard-summary-destination')
    ).toHaveTextContent(/부산 3박/);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('I-5 · 네트워크 실패는 배너로 드러나고 다시 시도가 재요청한다 (INV-4)', () => {
  it('배너가 뜨고, 다시 시도가 실제로 요청 수를 늘린다', async () => {
    // 응답 자체가 없는 실패 — axios 에러에 response 가 아예 없다(상태코드 분기가 미끄러지는 자리).
    server.use(http.post(`${BASE}/trips`, () => HttpResponse.error()));

    seedValidDraft();
    renderPage();
    await waitForPrefill();
    fireEvent.press(next());

    const banner = await screen.findByTestId('trip-wizard-submit-banner');
    expect(
      within(banner).getByText('여행을 만들지 못했어요')
    ).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();

    const before = createHits();
    expect(before).toBe(1);
    fireEvent.press(
      within(banner).getByTestId('trip-wizard-submit-banner-retry')
    );
    await waitFor(() => expect(createHits()).toBe(before + 1));
  });
});

describe('I-7 · 미상 실패도 조용히 삼키지 않는다 (INV-4)', () => {
  it('처음 보는 error.code 가 와도 배너로 떨어지고, 국내 차단으로 오인하지 않는다', async () => {
    server.use(
      http.post(`${BASE}/trips`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'SOMETHING_WE_NEVER_SAW',
              message: 'unmapped',
              fields: [{ field: 'zzz', reason: 'nope' }],
            },
          },
          { status: 400 }
        )
      )
    );

    seedValidDraft();
    renderPage();
    await waitForPrefill();
    fireEvent.press(next());

    const banner = await screen.findByTestId('trip-wizard-submit-banner');
    expect(
      within(banner).getByText('여행을 만들지 못했어요')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('I-6 · 제출 중 두 번째 press 는 두 번째 요청을 만들지 않는다', () => {
  it('응답이 오기 전 다시 눌러도 요청은 1건이고, 풀리면 정상 완주한다', async () => {
    let release: () => void = () => {};
    let createStarted = false;
    server.use(
      http.post(`${BASE}/trips`, async ({ request }) => {
        postedBodies.push((await request.json()) as Record<string, unknown>);
        await new Promise<void>((resolve) => {
          release = resolve;
          createStarted = true;
        });
        return HttpResponse.json(TRIP, { status: 201 });
      })
    );

    seedValidDraft();
    renderPage();
    await waitForPrefill();

    fireEvent.press(next());
    await waitFor(() => expect(createStarted).toBe(true));
    expect(createHits()).toBe(1);

    // 아직 응답이 안 온 상태에서 한 번 더 누른다.
    fireEvent.press(next());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(createHits()).toBe(1);
    expect(postedBodies).toHaveLength(1);

    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/trips/new/step2')
    );
    expect(createHits()).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
