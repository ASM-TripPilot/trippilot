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
import { day, itinerary, slot } from '@/test-support/itineraryFixtures';
import { createRequestLog, serveItinerary } from '@/test-support/mswItinerary';
import {
  photoOf,
  recordOf,
  serveCoverPhotos,
  visitOf,
} from '@/test-support/coverPhotoFixtures';
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
 *  - TRIP-1666 매거진형: 표지 → 인용문 → 일차 카드 → 숫자 → 동선 순서, 일차 거리 줄, 일정 조회 실패에도 카드 유지, 목록 얼굴에도 카드,
 *    요약 대기·오류 얼굴은 일정 조회를 안 보낸다(데이터 얼굴은 1번). 색·생김새는 단언하지 않는다 — 팔레트 키는 `summaryMagazineVM.test.ts`.
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
  // TRIP-1781 — 표지 사진 훅이 "이 기기 id"를 묻는다(후보 방문이 있을 때만).
  getInstallId: jest.fn().mockResolvedValue('me'),
}));

// TRIP-1781 — 기기 앨범에서 사진 주소를 푸는 입구. `gone…` 으로 시작하는 앨범 id 는 앨범에 없는 것으로 친다.
jest.mock('@/shared/photo', () => ({
  resolvePhotoUri: async (id: string) =>
    id.startsWith('gone') ? null : `file://${id}`,
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

// TRIP-1666 — 일정 조회 횟수를 센다(요약 대기·오류 얼굴에서 0번, 데이터 얼굴에서 1번).
const requests = createRequestLog(server);
const ITINERARY_HIT = `GET /api/v1/trips/${TRIP_ID}/itinerary`;
const hits = (path: string) =>
  requests.all().filter((hit) => hit === path).length;

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  requests.attach();
});
beforeEach(() => {
  requests.reset();
  // TRIP-1666 — 데이터 얼굴이 일정 조회(`GET /trips/:id/itinerary`)를 1번 보낸다. 통합은 `onUnhandledRequest:'error'` 이고 각 테스트 뒤 `resetHandlers`
  // 가 it 안 `server.use` 를 지우므로 기본 핸들러는 describe 안이 아니라 **파일 최상위** beforeEach 여야 한다(나중에 `use` 한 핸들러가 이긴다).
  serveItinerary(server, {
    itinerary: () =>
      itinerary({
        tripId: TRIP_ID,
        days: [
          day('2026-09-24', [
            slot('p1', { nameKo: '코엑스', category: '맛집' }),
            slot('p2', { nameKo: '봉은사', category: '문화' }),
          ]),
        ],
      }),
  });
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

// B안(2026-11-01) — 옛 `TripSummaryScreen.test.tsx`(뷰 단위)가 보던 화면 동작을 요약 응답만 바꿔 이 페이지 위에서 본다.
// 모션(카운트업·등장 순서)은 가짜 타이머로 화면을 직접 재는 게 맞아 `TripSummaryScreen.test.tsx` 에 남겼다.
describe('화면 동작 — 통계 세 칸·거리 출처·요약 문장·일차 카드·방문 목록 (옛 뷰 단위 흡수)', () => {
  const withStats = (
    base: TripSummary,
    over: Partial<TripSummary>
  ): TripSummaryEnvelope => ({
    ready: true,
    summary: { ...base, ...over, stats: { ...base.stats, ...over.stats } },
  });

  it('지도 얼굴 — 통계 세 칸이 서버 값이고 거리 칸에 출처 라벨이 붙으며, 일차 카드는 "1일차"·"· N곳"', async () => {
    const base = summary(true, ['코엑스', '봉은사']);
    server.use(
      tripOk(),
      summaryHandler(
        withStats(base, {
          stats: { ...base.stats, totalDistanceKm: 3, totalPhotos: 5 },
        })
      )
    );
    renderPage();
    await waitSummary();

    const stats = within(screen.getByTestId('reflection-summary-stats'));
    expect(stats.getByText('2')).toBeOnTheScreen();
    expect(stats.getByText('5')).toBeOnTheScreen();
    expect(stats.getByText('근사')).toBeOnTheScreen();
    const card = within(screen.getByTestId('reflection-summary-day-card'));
    expect(card.getByText('1일차')).toBeOnTheScreen();
    expect(card.getByText('· 2곳')).toBeOnTheScreen();
  });

  it('요약 문장이 공백뿐이면 문장 카드를 그리지 않는다 — 일차 카드는 있다', async () => {
    const base = summary(true, ['코엑스']);
    server.use(tripOk(), summaryHandler(withStats(base, { narrative: '   ' })));
    renderPage();
    await waitSummary();

    expect(screen.queryByTestId('reflection-summary-narrative')).toBeNull();
    expect(screen.getByTestId('reflection-summary-day-card')).toBeOnTheScreen();
  });

  it('방문 목록 얼굴 — 방문마다 한 줄씩 "N일차"·장소명이 서고, 측정 못 한 거리엔 출처 라벨이 없다', async () => {
    server.use(
      tripOk(),
      summaryHandler({
        ready: true,
        summary: summary(false, ['코엑스', '봉은사']),
      })
    );
    renderPage();
    await waitSummary();

    const rows = screen.getAllByTestId('reflection-summary-visit-item');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('1일차')).toBeOnTheScreen();
    expect(within(rows[0]).getByText('코엑스')).toBeOnTheScreen();
    expect(within(rows[1]).getByText('봉은사')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('reflection-summary-stats')).queryByText('근사')
    ).toBeNull();
  });
});

// ───────────────────────── TRIP-1666 · j04 매거진형 ─────────────────────────
// 준비(요약·여행·일정 응답) → 실행(페이지 렌더) → 단언(testID·텍스트·순서·요청 횟수). 색(팔레트 키)·배치 수치는 VM 단위 테스트와 실화면 QA 몫이다.
describe('TRIP-1666 · 매거진형 j04', () => {
  const MAGAZINE: TripSummary = {
    ...summary(true, ['코엑스', '봉은사', '롯데월드']),
    narrative: '바다를 보며, 혼자만의 하루',
    highlights: [
      {
        date: '2026-09-24',
        dayOrder: 1,
        visitCount: 2,
        places: ['코엑스', '봉은사'],
        distanceKm: 1.929,
        distanceSource: 'VISIT_LINE',
      },
      {
        date: '2026-09-25',
        dayOrder: 2,
        visitCount: 1,
        places: ['롯데월드'],
        distanceKm: 0,
        distanceSource: 'VISIT_LINE',
      },
    ],
    stats: {
      totalVisits: 3,
      totalDistanceKm: 3,
      distanceSource: 'VISIT_LINE',
      totalPhotos: 5,
      hasLocationData: true,
    },
  };

  async function renderMagazine(data: TripSummary = MAGAZINE) {
    server.use(summaryHandler({ ready: true, summary: data }), tripOk());
    const client = renderPage();
    await waitSummary();
    await waitFor(() =>
      expect(
        screen.getByTestId('reflection-summary-trip-title')
      ).toBeOnTheScreen()
    );
    return client;
  }
  /** 화면에 그려진 testID 를 위에서 아래(트리 순서)로 모은다. */
  function testIdsInOrder(): string[] {
    const out: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      const n = node as { props?: { testID?: unknown }; children?: unknown };
      if (typeof n.props?.testID === 'string') out.push(n.props.testID);
      walk(n.children);
    };
    walk(screen.toJSON());
    return out;
  }
  /** 여행 조회가 실패로 정착할 때까지(로딩 중 부재로 공허 통과하지 않게). */
  const waitSettledError = (client: QueryClient) =>
    waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .some((query) => query.state.status === 'error')
      ).toBe(true)
    );

  it('AC-12 표지·인용문 — 제목·지역·기간·"N곳 · 사진 M장"이 표지에 서고, 인용문은 서버 문장 그대로이며 머리말이 `이번 여행`', async () => {
    await renderMagazine();

    const cover = within(screen.getByTestId('reflection-summary-cover'));
    expect(
      screen.getByTestId('reflection-summary-trip-title')
    ).toHaveTextContent('강남구 여행');
    expect(cover.getByText('강남구')).toBeOnTheScreen();
    expect(cover.getByText('2026.09.24 ~ 09.25')).toBeOnTheScreen();
    expect(cover.getByText('3곳 · 사진 5장')).toBeOnTheScreen();

    // 형광펜으로 나뉜 두 중첩 Text 의 합이 서버 문장과 완전히 같다(toHaveTextContent 는 완전 일치 — 부분 포함이 아니다).
    expect(
      screen.getByTestId('reflection-summary-narrative')
    ).toHaveTextContent('바다를 보며, 혼자만의 하루');
    expect(screen.getByText('이번 여행')).toBeOnTheScreen();
  });

  it('AC-12·AC-8 일차 카드 — 카드마다 `N일차`·`· M곳`·방문지 칩이 서고, 거리는 서버 km 가 있고 방문 2곳 이상인 날에만 `1.9km · 근사` 로 선다', async () => {
    await renderMagazine();

    const cards = screen.getAllByTestId('reflection-summary-day-card');
    expect(cards).toHaveLength(2);
    const [first, second] = cards.map((card) => within(card));
    expect(first.getByText('1일차')).toBeOnTheScreen();
    expect(first.getByText('· 2곳')).toBeOnTheScreen();
    expect(first.getByText('코엑스')).toBeOnTheScreen();
    expect(first.getByText('봉은사')).toBeOnTheScreen();
    expect(first.getByText('1.9km · 근사')).toBeOnTheScreen(); // 긍정 짝
    expect(second.getByText('2일차')).toBeOnTheScreen();
    expect(second.getByText('· 1곳')).toBeOnTheScreen();
    expect(second.getByText('롯데월드')).toBeOnTheScreen();
    expect(second.queryByText(/km/)).toBeNull(); // 방문 1곳이면 서버 값 0 이어도 거리 줄 없음
  });

  it('AC-8 경로 출처 — 서버가 `ROUTE` 로 준 날은 `경로` 라벨이다', async () => {
    await renderMagazine({
      ...MAGAZINE,
      highlights: [
        { ...MAGAZINE.highlights[0], distanceKm: 12, distanceSource: 'ROUTE' },
      ],
    });
    expect(
      within(screen.getByTestId('reflection-summary-day-card')).getByText(
        '12km · 경로'
      )
    ).toBeOnTheScreen();
  });

  it('AC-9·AC-10 숫자 타일과 동선 — 방문·사진·이동 값이 서버 통계이고, 동선은 일차를 넘어 번호가 이어지며 `여행 동선` 머리말', async () => {
    await renderMagazine();

    const stats = within(screen.getByTestId('reflection-summary-stats'));
    expect(stats.getByText('3')).toBeOnTheScreen();
    expect(stats.getByText('5')).toBeOnTheScreen();
    expect(stats.getByText('3km')).toBeOnTheScreen();
    expect(stats.getByText('근사')).toBeOnTheScreen();

    expect(screen.getByText('여행 동선')).toBeOnTheScreen();
    const stops = screen.getAllByTestId('reflection-summary-visit-item');
    expect(stops).toHaveLength(3);
    expect(within(stops[0]).getByText('1')).toBeOnTheScreen();
    expect(within(stops[0]).getByText('1일차')).toBeOnTheScreen();
    expect(within(stops[0]).getByText('코엑스')).toBeOnTheScreen();
    expect(within(stops[2]).getByText('3')).toBeOnTheScreen();
    expect(within(stops[2]).getByText('2일차')).toBeOnTheScreen();
    expect(within(stops[2]).getByText('롯데월드')).toBeOnTheScreen();
  });

  it('배치 순서 — 표지 → 인용문 → 일차 카드 → 숫자 → 동선 → 일차 회고 칩', async () => {
    await renderMagazine();
    await waitFor(() =>
      expect(
        screen.getByTestId('reflection-summary-day-reflection-1')
      ).toBeOnTheScreen()
    );

    const ids = testIdsInOrder();
    const at = (id: string) => ids.indexOf(id);
    const order = [
      'reflection-summary-cover',
      'reflection-summary-narrative',
      'reflection-summary-day-card',
      'reflection-summary-stats',
      'reflection-summary-route',
      'reflection-summary-day-reflection-1',
    ];
    for (const id of order) expect(at(id)).toBeGreaterThanOrEqual(0); // 모집단이 비어 공허 통과하지 않게
    expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
  });

  it('여행 조회가 실패하면 표지는 `이번 여행` 폴백이고 제목 testID·지역·기간은 없다 — 요약 본문(인용문 머리말·카드·동선)은 남는다', async () => {
    server.use(summaryHandler({ ready: true, summary: MAGAZINE }), tripFails());
    const client = renderPage();
    await waitSummary();
    await waitSettledError(client);

    const cover = within(screen.getByTestId('reflection-summary-cover'));
    expect(cover.getByText('이번 여행')).toBeOnTheScreen();
    expect(cover.queryByText('강남구')).toBeNull();
    expect(cover.queryByText(/2026\./)).toBeNull();
    expect(screen.queryByTestId('reflection-summary-trip-title')).toBeNull();
    // 같은 글자가 인용문 머리말에도 있다(표지 + 머리말 = 2) — 범위를 좁히지 않고 센다.
    expect(screen.getAllByText('이번 여행')).toHaveLength(2);
    expect(screen.getAllByTestId('reflection-summary-day-card')).toHaveLength(
      2
    );
  });

  it.each([
    ['일정 없음(404)', 404],
    ['서버 오류(500)', 500],
  ])(
    'AC-13 일정 조회가 %s 여도 오류 얼굴로 떨어지지 않고 일차 카드·동선은 그대로 선다 (색은 중립 — VM 단위가 지킨다)',
    async (_label, status) => {
      server.use(
        http.get(
          `${BASE}/trips/:tripId/itinerary`,
          () => new HttpResponse(null, { status })
        )
      );
      const client = await renderMagazine();
      await waitSettledError(client);

      expect(hits(ITINERARY_HIT)).toBe(1); // 실제로 물었고 실패했다 — 안 물어서 통과한 게 아니다
      expect(screen.queryByTestId('reflection-summary-error')).toBeNull();
      expect(screen.getAllByTestId('reflection-summary-day-card')).toHaveLength(
        2
      );
      expect(
        screen.getAllByTestId('reflection-summary-visit-item')
      ).toHaveLength(3);
    }
  );

  it('AC-14·(a) 방문 목록 얼굴(위치 기록 없음)에도 일차 카드가 서고 동선 행이 이어진다 — 점선 안내는 그대로', async () => {
    server.use(
      summaryHandler({
        ready: true,
        summary: {
          ...MAGAZINE,
          stats: { ...MAGAZINE.stats, hasLocationData: false },
        },
      }),
      tripOk()
    );
    renderPage();
    await waitSummary();

    expect(
      screen.getByText('위치 기록이 없어 지도를 표시할 수 없어요')
    ).toBeOnTheScreen();
    expect(screen.getAllByTestId('reflection-summary-day-card')).toHaveLength(
      2
    );
    expect(screen.getAllByTestId('reflection-summary-visit-item')).toHaveLength(
      3
    );
    expect(screen.queryByTestId('reflection-summary-visit-empty')).toBeNull();
  });

  it('방문 0곳이면 동선 박스는 없고 빈 문구가 대신 선다(B-4 의 짝)', async () => {
    server.use(
      summaryHandler({ ready: true, summary: summary(false, []) }),
      tripOk()
    );
    renderPage();
    await waitSummary();

    expect(
      screen.getByTestId('reflection-summary-visit-empty')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-summary-route')).toBeNull();
    expect(
      screen.queryAllByTestId('reflection-summary-visit-item')
    ).toHaveLength(0);
    // TRIP-1666 5-b W1 · 칠할 일차 카드가 없으면 일정을 묻지 않는다(데이터 얼굴 1번은 「AC-15⒜」 짝이 잰다).
    expect(hits(ITINERARY_HIT)).toBe(0);
  });

  describe('AC-15⒜ · 요약 대기·오류 얼굴은 매거진도 일정 조회도 없다', () => {
    it.each([
      [
        '요약 준비 중(ready:false)',
        summaryHandler({ ready: false }),
        'reflection-summary-pending',
      ],
      [
        '요약 조회 실패(500)',
        http.get(
          `${BASE}/trips/:tripId/summary`,
          () => new HttpResponse(null, { status: 500 })
        ),
        'reflection-summary-error',
      ],
    ])('%s', async (_label, handler, faceId) => {
      server.use(handler, tripOk());
      renderPage();
      await screen.findByTestId(faceId);
      // 여행 조회가 끝날 때까지 기다린 뒤에도 일정 요청이 없어야 "아직 안 보낸 것"이 아니라 "보내지 않는 것"이다.
      await waitFor(() => expect(hits(`GET /api/v1/trips/${TRIP_ID}`)).toBe(1));

      expect(screen.queryByTestId('reflection-summary-cover')).toBeNull();
      expect(hits(ITINERARY_HIT)).toBe(0);
    });

    it('긍정 짝 — 데이터 얼굴은 같은 파일에서 일정을 정확히 1번 묻고 표지가 선다', async () => {
      await renderMagazine();
      await waitFor(() => expect(hits(ITINERARY_HIT)).toBe(1));
      expect(screen.getByTestId('reflection-summary-cover')).toBeOnTheScreen();
    });
  });
});

// TRIP-1781 · j04 표지에 기기 사진 — 페이지가 훅(`useTripCoverPhoto`)을 부르고 그 결과가 표지 사진 노드가 된다. 사진 고르는 규칙은 훅 통합이,
// 표지 구조(사진·스크림 존재/부재)는 `TripSummaryScreen.test` 가 따로 잰다. 여기서는 "요약 사진 수 → 요청 → 표지" 배선과 요청 수만 본다.
describe('🔴 TRIP-1781 · 표지 기기 사진', () => {
  const PHOTO_SUMMARY: TripSummary = {
    ...summary(true, ['코엑스', '봉은사']),
    stats: {
      totalVisits: 2,
      totalDistanceKm: 1,
      distanceSource: 'VISIT_LINE',
      totalPhotos: 3,
      hasLocationData: true,
    },
  };
  const recordsHits = () => requests.hitsFor('GET', '/trips/trip-1/records');
  const photoHits = () => requests.hitsFor('GET', '/photos');

  async function renderCover(data: TripSummary = PHOTO_SUMMARY) {
    server.use(summaryHandler({ ready: true, summary: data }), tripOk());
    renderPage();
    await screen.findByTestId('reflection-summary-cover');
  }

  it('TP-1 · AC-7·12 사진이 있으면 표지에 이 기기 앨범의 사진·스크림이 뜨고 records 는 1건이며 소요시간 문자열은 없다', async () => {
    serveCoverPhotos(server, {
      record: () => recordOf([visitOf('v1', 3)]),
      photos: { v1: () => [photoOf('a')] },
    });
    await renderCover();

    const photo = await screen.findByTestId('reflection-summary-cover-photo');
    expect(photo.props.source).toEqual([{ uri: 'file://a' }]);
    expect(
      screen.getByTestId('reflection-summary-cover-scrim')
    ).toBeOnTheScreen();
    expect(recordsHits()).toBe(1);
    expect(photoHits()).toBe(1);
    expect(DURATION.test(JSON.stringify(screen.toJSON()))).toBe(false);
  });

  it('TP-2 · AC-9 기록이 비어 후보가 없으면 표지는 서고 사진·스크림은 없다(색 표지) — 앨범·기기 id 도 묻지 않는다', async () => {
    await renderCover(); // records 기본 핸들러 = 빈 기록
    await waitFor(() => expect(recordsHits()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByTestId('reflection-summary-cover')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-summary-cover-photo')).toBeNull();
    expect(screen.queryByTestId('reflection-summary-cover-scrim')).toBeNull();
    expect(photoHits()).toBe(0);
  });

  it('TP-3 · AC-3 요약의 사진이 0장이면 records 를 아예 묻지 않고 표지는 색이다', async () => {
    await renderCover(summary(true, ['코엑스', '봉은사']));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(recordsHits()).toBe(0);
    expect(screen.queryByTestId('reflection-summary-cover-photo')).toBeNull();
  });

  it('TP-4 · AC-6 records 가 500 이어도 오류 얼굴 없이 요약이 서고 표지는 색이다', async () => {
    server.use(
      http.get(
        `${BASE}/trips/:tripId/records`,
        () => new HttpResponse(null, { status: 500 })
      )
    );
    await renderCover();
    await waitFor(() => expect(recordsHits()).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByTestId('reflection-summary-error')).toBeNull();
    expect(screen.getByTestId('reflection-summary-stats')).toBeOnTheScreen();
    expect(screen.queryByTestId('reflection-summary-cover-photo')).toBeNull();
  });
});
