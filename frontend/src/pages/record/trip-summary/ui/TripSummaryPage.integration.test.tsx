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
import type { ReactTestInstance } from 'react-test-renderer';
import { router } from 'expo-router';

import { server } from '@/mocks/server';
import type {
  TripSummary,
  TripSummaryEnvelope,
} from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { shellTabHref } from '@/shared/ui/BottomTabBar';
import { answerReduceMotionSynchronously } from '@/test-support/animatedProbe';
import {
  flushOsAnswer,
  holdReduceMotionOn,
} from '@/test-support/barMotionProbe';

import { TripSummaryPage } from './TripSummaryPage';

/**
 * TRIP-987 B · j04 여행 요약에서 방문 기록(j01)·일차 회고(j03)로 가는 진입 + 여행 이름 + 빈 상태.
 *
 * 무엇을 보장하나:
 *  - B-1 (TRIP-1591) 본문의 '방문 기록 보기' 버튼(`reflection-summary-records`)은 없다 — 기록으로 가는 길은 하단 바 기록 칸.
 *  - B-2 여행 기간 전체 일자마다 '{N}일차 회고'(`reflection-summary-day-reflection-{N}`, 1-기반) →
 *    `/trips/{id}/records/reflection/{YYYY-MM-DD}`. 지도·방문 목록 두 얼굴 모두, 방문 0곳이어도.
 *  - B-3 여행 이름(`reflection-summary-trip-title`) = `Trip.title` 원문.
 *  - B-4 위치 전무 + 방문 0곳 → "대신…" 문장 대신 빈 문구(QA #025 실화면 모양).
 *  - B-6 공유 진입은 되살아나지 않는다(TRIP-939 Q2 — 캡처 미장전).
 *  - B-7 여행 조회 실패 → 이름·일차 회고는 숨기고 요약 본문은 남는다(Seed Q3).
 *  - B-8 요약 대기(ready:false) 얼굴에도 '방문 기록 보기'(`reflection-summary-pending-records`, Q4).
 *  - B-9 요약 날짜 카드는 여전히 누를 수 없다(카드 일차 번호 ≠ 여행 일차 — Seed Q2).
 *
 * 왜 통합 버킷인가: 요약(`GET /trips/{id}/summary`)과 여행(`GET /trips/{id}`) 두 조회가 따로 도착하는
 * 조합에서 얼굴이 갈린다 — 훅을 목킹하면 그 조합이 테스트의 가정이 된다(LiveItineraryPage 선례).
 * 화면 prop 이름은 여기서 정하지 않는다 — testID·문구·push 문자열만 본다.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

// TRIP-1071 — [공유] 진입은 네이티브 캡처 모듈 3종이 이 빌드에 있을 때만(`isShareCaptureArmed`). jest-expo 는
// 세 모듈을 "있는 척"해서 실 판정이면 늘 true 가 된다 → 기본은 **재빌드 전 빌드**(false)로 고정하고
// (B-6 "공유 진입이 되살아나지 않는다"), 개통 짝(TRIP-574 AC-6a → j06 push)만 홀더를 true 로 올린다.
const mockShareArmed = { value: false };
jest.mock('@/features/share-trip-card/model/shareCapture', () => ({
  ...jest.requireActual('@/features/share-trip-card/model/shareCapture'),
  isShareCaptureArmed: () => mockShareArmed.value,
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
    back: jest.fn(),
    canGoBack: () => true,
  },
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const DURATION = /(\d+\s*분|\d+\s*시간|소요)/;

const trip = () => ({
  tripId: TRIP_ID,
  title: '강남구 여행',
  startDate: '2026-09-24',
  endDate: '2026-09-25',
  party: 1,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '강남구', nights: 1 }],
  status: 'ENDED',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-25T00:00:00Z',
  baseCount: 0,
  itineraryDayCount: 2,
});

const summary = (hasLocationData: boolean, visits: string[]): TripSummary => ({
  narrative: '좋은 여행이었어요',
  highlights:
    visits.length === 0
      ? []
      : [
          {
            date: '2026-09-24',
            dayOrder: 1,
            visitCount: visits.length,
            places: visits,
          },
        ],
  stats: {
    totalVisits: visits.length,
    totalDistanceKm: 0,
    distanceSource: 'VISIT_LINE',
    totalPhotos: 0,
    hasLocationData,
  },
  source: 'RULE',
  generatedAt: '2026-09-26T10:00:00Z',
});

const summaryHandler = (envelope: TripSummaryEnvelope) =>
  http.get(`${BASE}/trips/:tripId/summary`, () => HttpResponse.json(envelope));
const tripOk = () =>
  http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip()));
const tripFails = () =>
  http.get(
    `${BASE}/trips/:tripId`,
    () => new HttpResponse(null, { status: 500 })
  );

function renderPage(today?: string): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  render(<TripSummaryPage tripId={TRIP_ID} today={today} />, { wrapper });
  return client;
}

async function waitSummary(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen()
  );
}

function isTouchable(node: ReactTestInstance): boolean {
  return (
    typeof node.props.onStartShouldSetResponder === 'function' ||
    typeof node.props.onClick === 'function'
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  setAccessToken('a');
  mockShareArmed.value = false;
  // TRIP-1624 — 카운트업 숫자가 실제 타이머로 돌며 틱마다 act 밖에서 상태를 바꾸지 않게 "동작 줄이기 켜짐"을 동기로 답한다.
  answerReduceMotionSynchronously(true);
});
// 칸 이동은 연타 가드(모듈 전역 400ms 창)를 지난다 — 앞 테스트의 누름이 뒤 테스트를 막지 않게 파일 최상위에서 닫는다.
afterEach(() => {
  resetPressGuard();
  server.resetHandlers();
  clearAccessToken();
  mockPush.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
});
afterAll(() => server.close());

const FACES: [string, TripSummary][] = [
  ['지도 얼굴(MAP)', summary(true, ['코엑스', '봉은사'])],
  ['방문 목록 얼굴(VISIT_LIST)', summary(false, ['코엑스', '봉은사'])],
];

describe('🔴 TRIP-987 B-1·B-2·B-3 · 요약에서 기록·회고로 간다', () => {
  it.each(FACES)(
    '%s — 여행 이름 · 1일차·2일차 회고가 있고 각각 제 라우트로 가며 본문 「방문 기록 보기」는 없다',
    async (_face, data) => {
      server.use(summaryHandler({ ready: true, summary: data }), tripOk());

      renderPage();
      await waitSummary();

      // B-3 여행 이름(별도 조회라 늦게 올 수 있다).
      await waitFor(() =>
        expect(
          screen.getByTestId('reflection-summary-trip-title')
        ).toHaveTextContent('강남구 여행')
      );

      // B-2 기간 9/24~9/25 → 정확히 2개, 1-기반 번호.
      expect(
        screen.getAllByTestId(/^reflection-summary-day-reflection-\d+$/)
      ).toHaveLength(2);
      expect(
        screen.getByTestId('reflection-summary-day-reflection-1')
      ).toHaveTextContent('1일차 회고');
      expect(
        screen.getByTestId('reflection-summary-day-reflection-2')
      ).toHaveTextContent('2일차 회고');

      // B-1 (TRIP-1591) 본문의 '방문 기록 보기' 버튼은 없다 — 같은 화면에 회고 칩·통계가 서 있으니 부재가 공허하지 않다.
      expect(screen.queryByTestId('reflection-summary-records')).toBeNull();

      fireEvent.press(
        screen.getByTestId('reflection-summary-day-reflection-1')
      );
      fireEvent.press(
        screen.getByTestId('reflection-summary-day-reflection-2')
      );

      expect(mockPush.mock.calls).toEqual([
        [`/trips/${TRIP_ID}/records/reflection/2026-09-24`],
        [`/trips/${TRIP_ID}/records/reflection/2026-09-25`],
      ]);
      expect(mockReplace).not.toHaveBeenCalled();

      // INV-3 — 새 문구 어디에도 소요시간이 없다.
      expect(DURATION.test(JSON.stringify(screen.toJSON()))).toBe(false);
    }
  );
});

describe('🔴 TRIP-1489 · 서버가 준 summary.narrative 가 일차 카드 앞에 그대로 보인다', () => {
  it('문장은 서버 값 그대로이고 일차 카드(1일차)도 함께 있다', async () => {
    server.use(
      summaryHandler({
        ready: true,
        summary: {
          ...summary(true, ['A', 'B']),
          narrative: '비가 스친 날에도 바다를 따라 걸었다.',
        },
      }),
      tripOk()
    );

    renderPage();
    await waitSummary();

    expect(
      within(screen.getByTestId('reflection-summary-narrative')).getByText(
        '비가 스친 날에도 바다를 따라 걸었다.'
      )
    ).toBeOnTheScreen();
    expect(screen.getAllByTestId('reflection-summary-day-card')).toHaveLength(
      1
    );
  });
});

describe('🔴 TRIP-987 B-4 · 위치 전무 + 방문 0곳 (QA #025)', () => {
  it('빈 문구가 뜨고 "대신…" 문장은 없으며, 회고·방문 기록 진입은 그대로 있다', async () => {
    server.use(
      summaryHandler({ ready: true, summary: summary(false, []) }),
      tripOk()
    );

    renderPage();
    await waitSummary();

    expect(
      screen.getByText('위치 기록이 없어 지도를 표시할 수 없어요')
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('대신 방문 장소를 순서대로 보여드릴게요')
    ).toBeNull();
    expect(
      screen.getByTestId('reflection-summary-visit-empty')
    ).toHaveTextContent('기록된 방문 장소가 없어요');

    // 방문이 0곳이어도 회고는 쓸 수 있다(US-REC-07 예외 · BR-U5-36) — 막다른 화면이 아니다.
    await waitFor(() =>
      expect(
        screen.getAllByTestId(/^reflection-summary-day-reflection-\d+$/)
      ).toHaveLength(2)
    );
  });
});

describe('🔴 TRIP-987 B-7 · 여행 조회가 실패하면 이름·회고만 숨긴다 (Seed Q3)', () => {
  it('요약 본문은 남고, 여행 이름·일차 회고는 없다', async () => {
    server.use(
      summaryHandler({ ready: true, summary: summary(false, ['코엑스']) }),
      tripFails()
    );

    const client = renderPage();
    await waitSummary();
    // 여행 조회가 실패로 정착할 때까지 — 로딩 중 부재로 공허 통과하지 않게.
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .some((query) => query.state.status === 'error')
      ).toBe(true)
    );

    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-summary-trip-title')).toBeNull();
    expect(
      screen.queryAllByTestId(/^reflection-summary-day-reflection-/)
    ).toHaveLength(0);
  });
});

describe('🔴 TRIP-987 B-8 · 요약 대기 얼굴에도 방문 기록 진입 (Seed Q4)', () => {
  it('ready:false → 대기 안내 + "방문 기록 보기" 액션 → /trips/{id}/records', async () => {
    server.use(summaryHandler({ ready: false }), tripOk());

    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('reflection-summary-pending')).toBeOnTheScreen()
    );

    const action = screen.getByTestId('reflection-summary-pending-records');
    expect(action).toHaveTextContent('방문 기록 보기');
    fireEvent.press(action);

    expect(mockPush.mock.calls).toEqual([[`/trips/${TRIP_ID}/records`]]);
  });
});

describe('🟢 TRIP-987 B-6·B-9 · 되살리지 않는 것(회귀 앵커)', () => {
  it('캡처 미장전 빌드면 공유 진입이 없고(TRIP-939 Q2), 날짜 카드는 누를 수 없으며 "›" 가 없다(Seed Q2)', async () => {
    server.use(
      summaryHandler({ ready: true, summary: summary(true, ['코엑스']) }),
      tripOk()
    );

    renderPage();
    await waitSummary();

    expect(screen.queryByTestId('reflection-summary-share')).toBeNull();
    const card = screen.getByTestId('reflection-summary-day-card');
    expect(isTouchable(card)).toBe(false);
    expect(within(card).queryByText('›')).toBeNull();
  });
});

describe('🔴 TRIP-574 AC-6a · 공유 → j06 라우트 push (TRIP-939: 캡처 개통 시에만)', () => {
  it('캡처가 장전됐으면 [공유] press → /trips/{tripId}/records/share 로 push 한다(B-6 의 짝)', async () => {
    mockShareArmed.value = true;
    server.use(
      summaryHandler({ ready: true, summary: summary(true, ['코엑스']) }),
      tripOk()
    );

    renderPage();
    await waitSummary();
    fireEvent.press(screen.getByTestId('reflection-summary-share'));

    expect(mockPush.mock.calls).toEqual([[`/trips/${TRIP_ID}/records/share`]]);
  });
});

describe('🔴 TRIP-1584 · 하단 바 — 5칸 복제 탭바(옛 TRIP-1262 dismissTo 계약) 대신 3칸 바', () => {
  /**
   * 무엇을 보장하나: 대기·실패 얼굴에도 요약 활성 3칸 바가 서고(막다른 화면 금지, Q8) 5칸 탭바는 없다 · 회고 칸 목적지는 여행 기간 규칙(Q6 — 여행 중이면 오늘,
   * 끝났으면 마지막 일차, 시작 전이면 비활성) · 기록 칸은 날짜 없이 기록으로. (문맥 없는 이 파일은 스택에 기록 화면이 없다고 보므로 push — dismissTo 선택은 recordBarStack.)
   */
  const BAR = 'reflection-summary-bottom-bar';
  const REFLECTION = `${BAR}-tab-reflection`;

  it.each([
    ['요약 준비 중(ready:false)', () => summaryHandler({ ready: false })],
    [
      '조회 실패',
      () =>
        http.get(
          `${BASE}/trips/:tripId/summary`,
          () => new HttpResponse(null, { status: 500 })
        ),
    ],
  ])(
    '%s 얼굴에도 요약 활성 3칸 바가 서고 5칸 탭바는 없다',
    async (_label, handler) => {
      server.use(handler(), tripOk());

      renderPage();

      expect(await screen.findByTestId(BAR)).toBeOnTheScreen();
      // 활성 칸은 요약 응답이 없어도 꺼지지 않는다(막다른 화면 금지).
      expect(screen.getByTestId(`${BAR}-tab-summary`)).toBeSelected();
      expect(screen.getByTestId(`${BAR}-tab-summary`)).toBeEnabled();
      expect(screen.queryByTestId('shell-tabbar-root')).toBeNull();
    }
  );

  it.each([
    ['여행 중', '2026-09-25', '2026-09-25'],
    ['끝난 여행 → 마지막 일차', '2026-10-30', '2026-09-25'],
  ])(
    '회고 칸 · %s(오늘 %s) → %s 의 회고로 간다',
    async (_label, today, target) => {
      server.use(
        summaryHandler({ ready: true, summary: summary(true, ['코엑스']) }),
        tripOk()
      );

      renderPage(today);
      await waitFor(() => expect(screen.getByTestId(REFLECTION)).toBeEnabled());
      fireEvent.press(screen.getByTestId(REFLECTION));

      expect(mockPush.mock.calls).toEqual([
        [`/trips/${TRIP_ID}/records/reflection/${target}`],
      ]);
    }
  );

  // TRIP-1591 — 바 뒤로는 히스토리가 있어도(이 파일의 canGoBack 은 true) 이전 화면이 아니라 기록 탭이다. 실제 스택 결과는 recordBarStack.
  it('바 뒤로 → dismissTo(기록 탭) 1회이고 back·replace 는 없다', async () => {
    holdReduceMotionOn(); // 동작 줄이기 켜짐 — 모션 없이 즉시 이동
    server.use(summaryHandler({ ready: false }), tripOk());
    renderPage();
    await screen.findByTestId(`${BAR}-back`);
    await flushOsAnswer();

    fireEvent.press(screen.getByTestId(`${BAR}-back`));

    expect(mockDismissTo.mock.calls).toEqual([[shellTabHref('records')]]);
    expect(router.back).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
