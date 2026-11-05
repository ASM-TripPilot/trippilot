import { http, HttpResponse } from 'msw';
import { onlineManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { getGetTripsQueryKey } from '@/shared/api/index.hooks';
import type { Trip } from '@/shared/api/index.schemas';
import { BASE } from '@/test-support/apiBase';
import { routerSpies } from '@/test-support/expoRouterMock';
import { freezeDate } from '@/test-support/freezeDate';
import { trip as tripFixture } from '@/test-support/itineraryFixtures';
import { CONFIRMED_COLS } from '@/test-support/myPageItineraries';
import {
  newTestQueryClient,
  renderWithQueryClient,
  settle,
} from '@/test-support/queryRender';
import {
  NO_ITINERARY,
  itineraryHits,
  listHits,
} from '@/test-support/tripItineraryCols';

import { RecordsCalendarPage } from './RecordsCalendarPage';

/**
 * TRIP-1638 · 기록 탭 — 오프라인으로 처음 켜면(캐시 없음) 스피너가 영원히 돌던 문제(INV-4).
 *
 * 무엇을 보장하나:
 *  - 오프라인 + 빈 캐시 → 스피너 대신 "인터넷에 연결되어 있지 않아요" 얼굴(버튼 없음). 요청은 한 번도 안 나갔다.
 *  - 온라인으로 돌아오면 사용자가 아무것도 안 해도 캘린더·지난 여행이 채워진다(요청 1회).
 *  - 받아 둔 목록이 있으면 오프라인이어도 캘린더 그대로. 온라인 느림(fetching)·온라인 500 은 오프라인이 아니다.
 *
 * 왜 새 통합 파일인가: 이 화면의 통합 버킷 파일이 없고, `RecordsCalendarPage.test.tsx` 는 `useGetTrips` 를 목으로 갈아 끼워
 * `paused`(오프라인 보류)라는 실제 라이브러리 상태를 만들 수 없다. 여기서는 실제 react-query + MSW 로 "요청이 안 나갔다"까지 잰다.
 * 레이스(NetInfo 가 늦게 알림 → 요청 1회 실패 뒤 paused)는 retry:false 클라이언트로 재현할 수 없다 — jest 사각, 6-b.
 */

// 생성 클라이언트의 인증 계층이 @/shared/storage 를 정적으로 문다(expo-secure-store 실물 로드 회피, 리포 관례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push'],
  })
);

const OFFLINE = 'record-calendar-offline';
const TITLE_OFFLINE = '인터넷에 연결되어 있지 않아요';
const DESC_OFFLINE = '연결되면 자동으로 불러올게요';
const TRIPS_GET = 'GET /api/v1/trips';

/** status ENDED 라 오늘과 무관하게 "지난 여행" 카드가 선다(결정론). */
const TRIP_T1 = {
  tripId: 't1',
  title: '부산 여행',
  startDate: '2026-05-10',
  endDate: '2026-05-12',
  status: 'ENDED',
  party: 2,
  destinations: [],
  preferenceSnapshot: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...NO_ITINERARY,
} as unknown as Trip;

/** 나간 요청 `METHOD /경로` 누적. */
let hits: string[] = [];
const count = (needle: string): number =>
  hits.filter((hit) => hit === needle).length;
let tripsReplies: ('ok' | 500 | 'gate')[] = [];
let tripsGate: (() => void)[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    hits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  hits = [];
  tripsReplies = [];
  tripsGate = [];
  clearAccessToken();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips`, async () => {
      const reply = tripsReplies.shift() ?? 'ok';
      if (reply === 500) {
        return HttpResponse.json(
          { error: { code: 'INTERNAL', message: '서버 오류' } },
          { status: 500 }
        );
      }
      if (reply === 'gate') {
        await new Promise<void>((resolve) => tripsGate.push(resolve));
      }
      return HttpResponse.json([TRIP_T1]);
    }),
    // TRIP-1677 · 페이지는 여행마다 일정을 묻지 않는다(목록 칸만 읽는다). 혹시 묻는 구현이 있어도 죽지 않게 404 로 받고,
    // 요청 수(`itineraryHits`)를 단언으로 잡는다.
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(
        { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
        { status: 404 }
      )
    )
  );
});

// onlineManager 는 모듈 싱글턴 — 오프라인 케이스가 어떻게 끝나든 다음 케이스는 온라인으로 시작한다(02a ★1, 파일 최상위).
afterEach(() => {
  onlineManager.setOnline(true);
  resetPressGuard();
  // 단언이 문을 열기 전에 실패해도 붙잡힌 요청을 남기지 않는다.
  const waiting = tripsGate;
  tripsGate = [];
  waiting.forEach((open) => open());
  server.resetHandlers();
});

afterAll(() => server.close());

function renderPage(seed?: Trip[]) {
  const client = newTestQueryClient({ gcTime: 0 });
  if (seed) client.setQueryData(getGetTripsQueryKey(), seed);
  return renderWithQueryClient(<RecordsCalendarPage />, client);
}

/** 오프라인으로 만든다. 앞 케이스의 오프라인이 새지 않았음을 먼저 확인한다. */
function goOffline(): void {
  expect(onlineManager.isOnline()).toBe(true);
  onlineManager.setOnline(false);
}

function axes(client: ReturnType<typeof renderPage>['client']) {
  const state = client.getQueryState(getGetTripsQueryKey());
  return { status: state?.status, fetchStatus: state?.fetchStatus };
}

describe('TRIP-1638 · 기록 탭 오프라인 콜드스타트', () => {
  it('R1 오프라인으로 처음 켜면 스피너 대신 오프라인 얼굴이 뜨고, 요청은 한 번도 안 나간다', async () => {
    // 준비
    goOffline();

    // 실행
    const { client } = renderPage();

    // 단언 — 얼굴이 먼저 도착해야 아래 "없음" 단언이 의미가 있다.
    const face = await screen.findByTestId(OFFLINE);
    expect(within(face).getByText(TITLE_OFFLINE)).toBeOnTheScreen();
    expect(within(face).getByText(DESC_OFFLINE)).toBeOnTheScreen();
    // 보류 요청에 refetch 는 무동작이다 — 버튼을 두면 "눌렀는데 아무 일도 없는" 새 침묵 실패(D4).
    expect(within(face).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByTestId('record-calendar-loading')).toBeNull();
    expect(screen.queryByTestId('record-calendar-error')).toBeNull();
    expect(screen.queryByTestId('record-calendar-month')).toBeNull();
    // 증거 — 요청이 안 나갔고(보류), 데이터는 못 받았다.
    expect(count(TRIPS_GET)).toBe(0);
    expect(axes(client)).toEqual({ status: 'pending', fetchStatus: 'paused' });
  });

  it('R2 온라인으로 돌아오면 사용자가 아무것도 안 해도 캘린더가 채워지고 오프라인 얼굴은 사라진다', async () => {
    // 준비 — 오프라인 얼굴이 떠 있는 상태가 출발점(앵커).
    goOffline();
    renderPage();
    await screen.findByTestId(OFFLINE);
    expect(count(TRIPS_GET)).toBe(0);

    // 실행 — 입력 없이 연결만 돌아온다.
    act(() => {
      onlineManager.setOnline(true);
    });

    // 단언 — 복귀 후 화면 갱신은 비동기라 보일 때까지 기다린다(02a ★6).
    expect(
      await screen.findByTestId('record-calendar-month')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('record-calendar-past-trip-t1')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    await settle();
    expect(count(TRIPS_GET)).toBe(1);
  });

  it('R3 (선제 green) 받아 둔 목록이 있으면 오프라인이어도 캘린더 그대로 — 오프라인 얼굴은 없다', async () => {
    // 준비 — 다른 탭이 이미 받아 둔 목록. 상태는 success + paused(데이터 있음 + 보류).
    goOffline();

    // 실행
    const { client } = renderPage([TRIP_T1]);

    // 단언
    expect(
      await screen.findByTestId('record-calendar-month')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('record-calendar-past-trip-t1')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
    // 앵커 — "데이터가 있고 보류 중"이라는 바로 그 상태를 시험했다.
    await settle();
    expect(axes(client)).toEqual({ status: 'success', fetchStatus: 'paused' });
    expect(count(TRIPS_GET)).toBe(0);
  });

  it('R4 (선제 green) 온라인에서 응답이 느린 것은 오프라인이 아니다 — 스피너가 정상이고 얼굴은 없다', async () => {
    // 준비 — 응답을 붙잡아 fetching 상태를 만든다.
    tripsReplies = ['gate'];

    // 실행
    const { client } = renderPage();
    await waitFor(() => expect(count(TRIPS_GET)).toBe(1));

    // 단언 — 요청이 나가는 중이다(앵커: fetching ≠ paused). 스피너가 *있음* = R1 의 "스피너 없음"이 항상 참이 아님을 대조한다.
    expect(axes(client)).toEqual({
      status: 'pending',
      fetchStatus: 'fetching',
    });
    expect(screen.queryByTestId('record-calendar-loading')).not.toBeNull();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();

    // 실행 — 응답이 오면 캘린더로 바뀐다.
    act(() => {
      tripsGate.forEach((open) => open());
    });
    expect(
      await screen.findByTestId('record-calendar-month')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
  });

  it('R5 (선제 green) 온라인 500 은 오프라인 얼굴이 아니라 기존 오류 얼굴이다', async () => {
    // 준비
    tripsReplies = [500];

    // 실행
    renderPage();

    // 단언
    expect(
      await screen.findByTestId('record-calendar-error')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(OFFLINE)).toBeNull();
  });
});

// B안(2026-11-01) — 옛 `RecordsCalendarScreen.test.tsx`(뷰 단위)가 보던 화면 동작을 여행·일정 응답과 오늘 날짜만 바꿔 이 페이지 위에서 본다.
// 오늘 = 2026-06-15(KST). 같은 기간 둘(부산·제주) + 지난 둘 + 진행 중 하나(일정 확정) + 미래 하나 → legend 5줄(앞 3줄 + 더 보기 2).
describe('화면 동작 — 캘린더·legend·진행 중 카드·지난 여행·빈 상태 (옛 뷰 단위 흡수)', () => {
  const ended = (tripId: string, title: string, start: string, end: string) =>
    tripFixture({
      tripId,
      title,
      startDate: start,
      endDate: end,
      status: 'ENDED',
      itineraryDayCount: 2,
    });
  const G1 = ended('g1', '부산 여행', '2026-06-01', '2026-06-03');
  const G2 = ended('g2', '제주 여행', '2026-06-01', '2026-06-03');
  const P3 = ended('p3', '여수 여행', '2026-06-05', '2026-06-06');
  const P4 = ended('p4', '경주 여행', '2026-06-08', '2026-06-09');
  const NOW = tripFixture({
    tripId: 'now',
    title: '서울 여행',
    startDate: '2026-06-14',
    endDate: '2026-06-16',
    status: 'ACTIVE',
    itineraryDayCount: 3,
    ...CONFIRMED_COLS,
  });
  const FUT = tripFixture({
    tripId: 'fut',
    title: '강릉 여행',
    startDate: '2026-06-25',
    endDate: '2026-06-27',
    status: 'PLANNED',
    itineraryDayCount: 3,
  });
  const ALL = [G1, G2, P3, P4, NOW, FUT];
  const GROUP = 'record-calendar-legend-group-2026-06-01_2026-06-03';
  const { push: mockPush } = routerSpies;

  function serveTrips(trips: Trip[]) {
    server.use(
      http.get(`${BASE}/trips`, () => HttpResponse.json(trips)),
      // 일정 단건은 안 묻는 게 맞다 — 묻는 구현이 있어도 죽지 않게 404 로 받고 `itineraryHits` 로 잡는다.
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: '일정이 없어요' } },
          { status: 404 }
        )
      )
    );
  }

  async function renderReady(trips: Trip[] = ALL) {
    serveTrips(trips);
    renderPage();
    await settle();
  }

  beforeEach(() => {
    freezeDate('2026-06-15T03:00:00Z');
    mockPush.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('캘린더 — 앱바·월 라벨, 여행 날만 선택 표시, 지난 여행 건수', async () => {
    await renderReady();

    expect(screen.getByText('여행 캘린더')).toBeOnTheScreen();
    expect(screen.getByTestId('record-calendar-month-label')).toHaveTextContent(
      '2026년 6월'
    );
    expect(screen.getByTestId('record-calendar-day-2026-06-02')).toBeSelected();
    expect(
      screen.getByTestId('record-calendar-day-2026-06-11')
    ).not.toBeSelected();
    expect(screen.getByText('4건')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-past-empty')).toBeNull();
  });

  // TRIP-1765 — 날짜 칸 이름은 그 칸의 날짜뿐(기록 내용은 안 싣는다). `name` 은 라벨·글자 중 하나만 맞아도 찾으므로
  // 낭독기가 실제로 읽는 한 값(라벨 우선)은 toHaveAccessibleName(완전 일치)로 따로 본다.
  it('날짜 칸은 그날 날짜만으로 읽히는 버튼이다 — 여행 제목은 이름에 없다', async () => {
    await renderReady();

    expect(screen.getByRole('button', { name: '6월 5일' })).toHaveProp(
      'testID',
      'record-calendar-day-2026-06-05'
    );
    expect(
      screen.getByTestId('record-calendar-day-2026-06-05')
    ).toHaveAccessibleName('6월 5일');
    // 기록 없는 날도 버튼이다(누름 동작 불변 — 페이지가 무시한다).
    expect(screen.getByRole('button', { name: '6월 11일' })).toHaveProp(
      'testID',
      'record-calendar-day-2026-06-11'
    );
  });

  it('legend — 앞 3줄 + "더 보기 2", 누르면 5줄과 "접기", 다시 누르면 접힌다 · 박수가 줄에 붙는다', async () => {
    await renderReady();

    expect(screen.getByTestId(GROUP)).toBeOnTheScreen();
    expect(screen.getByTestId('record-calendar-legend-p3')).toHaveTextContent(
      /1박/
    );
    expect(screen.queryByTestId('record-calendar-legend-now')).toBeNull();
    expect(screen.getByText('더 보기 2')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('record-calendar-legend-more'));
    expect(screen.getByTestId('record-calendar-legend-now')).toBeOnTheScreen();
    expect(screen.getByTestId('record-calendar-legend-fut')).toBeOnTheScreen();
    expect(screen.getByText('접기')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('record-calendar-legend-more'));
    expect(screen.queryByTestId('record-calendar-legend-fut')).toBeNull();
  });

  it('같은 기간 묶음 — "대표 외 1" 한 줄, 누르면 구성원 줄이 펼쳐지고 어디로도 가지 않으며, 달을 넘겼다 오면 접혀 있다', async () => {
    await renderReady();

    const group = screen.getByTestId(GROUP);
    expect(group).toHaveTextContent(/^부산 여행 외 1/);
    expect(screen.queryByTestId('record-calendar-legend-g2')).toBeNull();

    fireEvent.press(group);
    expect(screen.getByTestId('record-calendar-legend-g1')).toBeOnTheScreen();
    expect(screen.getByTestId('record-calendar-legend-g2')).toBeOnTheScreen();
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('record-calendar-next'));
    expect(screen.getByTestId('record-calendar-month-label')).toHaveTextContent(
      '2026년 7월'
    );
    fireEvent.press(screen.getByTestId('record-calendar-prev'));
    fireEvent.press(screen.getByTestId('record-calendar-prev'));
    expect(screen.getByTestId('record-calendar-month-label')).toHaveTextContent(
      '2026년 5월'
    );
    fireEvent.press(screen.getByTestId('record-calendar-next'));
    expect(screen.queryByTestId('record-calendar-legend-g2')).toBeNull();
  });

  it('legend `›` 는 갈 수 있는 줄에만 — 지난·진행 줄과 지난 묶음엔 있고 미래 줄엔 없으며, 그 줄만 기록으로 간다', async () => {
    await renderReady();
    fireEvent.press(screen.getByTestId('record-calendar-legend-more'));

    expect(
      screen.getByTestId('record-calendar-legend-chevron-p3')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('record-calendar-legend-chevron-now')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId(
        'record-calendar-legend-group-chevron-2026-06-01_2026-06-03'
      )
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('record-calendar-legend-chevron-fut')
    ).toBeNull();

    fireEvent.press(screen.getByTestId('record-calendar-legend-fut'));
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('record-calendar-legend-p3'));
    expect(mockPush.mock.calls).toEqual([['/trips/p3/records']]);
  });

  it('누름 — 마킹 날짜는 그 여행 기록으로, 지난 여행 카드는 그 여행 요약으로 간다', async () => {
    await renderReady();

    fireEvent.press(screen.getByTestId('record-calendar-day-2026-06-05'));
    fireEvent.press(screen.getByTestId('record-calendar-past-trip-p4'));

    expect(mockPush.mock.calls).toEqual([
      ['/trips/p3/records'],
      ['/trips/p4/records/summary'],
    ]);
  });

  it('진행 중 카드 — 제목·"여행 중"·"기간 · N일차", [오늘 기록 보기]는 기록으로 · [일정 허브로]는 여행 중 허브로', async () => {
    await renderReady();

    const card = await screen.findByTestId('record-calendar-ongoing');
    // TRIP-1677 AC-1 — 진행 중 판정은 목록 칸에서 했다: 일정 단건 요청 0.
    expect(itineraryHits(hits)).toBe(0);
    expect(within(card).getByText('서울 여행')).toBeOnTheScreen();
    expect(within(card).getByText('여행 중')).toBeOnTheScreen();
    expect(within(card).getByText('2026.6.14–6.16 · 2일차')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('record-calendar-ongoing-records'));
    fireEvent.press(screen.getByTestId('record-calendar-ongoing-hub'));
    expect(mockPush.mock.calls).toEqual([
      ['/trips/now/records'],
      ['/trips/now/live'],
    ]);
  });

  it('달을 걸친 미래 묶음 — `›` 가 없고, 펼친 채 다음 달로 넘기면 같은 묶음도 접혀 있다', async () => {
    const span = (tripId: string, title: string) =>
      tripFixture({
        tripId,
        title,
        startDate: '2026-06-30',
        endDate: '2026-07-02',
        status: 'PLANNED',
        itineraryDayCount: 3,
      });
    await renderReady([span('s1', '목포 여행'), span('s2', '광주 여행')]);
    const SPAN = 'record-calendar-legend-group-2026-06-30_2026-07-02';

    expect(
      screen.queryByTestId(
        'record-calendar-legend-group-chevron-2026-06-30_2026-07-02'
      )
    ).toBeNull();
    fireEvent.press(screen.getByTestId(SPAN));
    expect(screen.getByTestId('record-calendar-legend-s2')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('record-calendar-next'));
    expect(screen.getByTestId(SPAN)).toBeOnTheScreen(); // 앵커 — 7월에도 같은 묶음
    expect(screen.queryByTestId('record-calendar-legend-s2')).toBeNull();
  });

  it('지난 여행이 0개면 안내 박스가 뜬다(캘린더는 그대로)', async () => {
    await renderReady([FUT]);

    expect(screen.getByTestId('record-past-empty')).toBeOnTheScreen();
    expect(screen.getByText('0건')).toBeOnTheScreen();
  });

  it('여행이 하나도 없으면 캘린더 대신 안내 + [새 여행 만들기] → 위저드', async () => {
    await renderReady([]);

    expect(screen.getByText('아직 기록된 여행이 없어요')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-calendar-month')).toBeNull();
    fireEvent.press(screen.getByTestId('record-calendar-empty-create'));
    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });

  // TRIP-1775 — 창 안의 둘째 탭은 위저드를 한 번 더 쌓지 않는다.
  it('[새 여행 만들기]를 빠르게 두 번 눌러도 step1 은 한 번만 쌓인다', async () => {
    await renderReady([]);
    const button = screen.getByTestId('record-calendar-empty-create');

    fireEvent.press(button);
    fireEvent.press(button);

    expect(mockPush.mock.calls).toEqual([['/trips/new/step1']]);
  });
});

// TRIP-1677 · 일정 상태를 목록(`GET /trips`)의 네 칸에서 읽는다 — 진입 요청 수와 폴링 틱 실패.
describe('🔴 TRIP-1677 · 기록 캘린더는 여행별 일정을 묻지 않고, 폴링 틱이 실패해도 받아 둔 목록을 유지한다', () => {
  const NOW = tripFixture({
    tripId: 'now',
    title: '서울 여행',
    startDate: '2026-06-14',
    endDate: '2026-06-16',
    status: 'ACTIVE',
    itineraryDayCount: 3,
    ...CONFIRMED_COLS,
  });
  const PAST = tripFixture({
    tripId: 'past',
    title: '부산 여행',
    startDate: '2026-06-01',
    endDate: '2026-06-03',
    status: 'ENDED',
    itineraryDayCount: 2,
    ...CONFIRMED_COLS,
  });
  const DRAFT = tripFixture({
    tripId: 'draft',
    title: '초안 여행',
    startDate: '2026-06-14',
    endDate: '2026-06-16',
    status: 'ACTIVE',
  });

  beforeEach(() => {
    freezeDate('2026-06-15T03:00:00Z');
    mockPush.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  const { push: mockPush } = routerSpies;

  /** 서버가 지금 내려 주는 목록. `failNext` 가 켜져 있으면 다음 한 번만 500 이다. */
  let failNext = false;
  function serveTrips(trips: Trip[]): void {
    failNext = false;
    server.use(
      http.get(`${BASE}/trips`, () => {
        if (failNext) {
          failNext = false;
          return HttpResponse.json(
            { error: { code: 'INTERNAL', message: '서버 오류' } },
            { status: 500 }
          );
        }
        return HttpResponse.json(trips);
      })
    );
  }

  it('C1 진입하면 목록 GET 1 · 일정 GET 0 — 진행 중 카드는 확정 여행(목록 칸)만 뜬다', async () => {
    // 준비 — 확정 진행 중 · 확정 지난 · 오늘이 기간 안인 일정 없는 여행.
    serveTrips([NOW, PAST, DRAFT]);

    // 실행
    renderPage();
    await settle();

    // 단언 — 앵커: 카드가 떴다(= 목록 칸을 읽었다). 그리고 요청은 목록 1번뿐이다.
    const card = screen.getByTestId('record-calendar-ongoing');
    expect(within(card).getByText('서울 여행')).toBeOnTheScreen();
    expect(listHits(hits)).toBe(1);
    expect(itineraryHits(hits)).toBe(0);
  });

  it('C2 [일정 허브로]는 여행 중 허브로 가고, 누르는 순간에도 일정 GET 은 0 이다', async () => {
    serveTrips([NOW, PAST]);
    renderPage();
    await settle();

    fireEvent.press(screen.getByTestId('record-calendar-ongoing-hub'));

    expect(mockPush.mock.calls).toEqual([['/trips/now/live']]);
    expect(itineraryHits(hits)).toBe(0);
  });

  it('C3 첫 응답 뒤 재조회(폴링 틱)가 500 이어도 캘린더·진행 중 카드를 그대로 둔다 — 오류 얼굴로 뒤집지 않는다', async () => {
    // 준비 — 첫 목록은 정상.
    serveTrips([NOW, PAST]);
    const { client } = renderPage();
    await settle();
    expect(screen.getByTestId('record-calendar-ongoing')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-calendar-error')).toBeNull();

    // 실행 — 다음 목록 요청은 500(셸의 폴링 틱이 실패한 상황을 같은 쿼리를 다시 받아 흉내 낸다).
    failNext = true;
    await act(async () => {
      await client.refetchQueries({ queryKey: getGetTripsQueryKey() });
    });
    await settle();

    // 단언 — 앵커: 실패 요청이 실제로 나갔다(목록 GET 2). 그래도 받아 둔 목록으로 계속 그린다.
    expect(listHits(hits)).toBe(2);
    expect(client.getQueryState(getGetTripsQueryKey())?.status).toBe('error');
    expect(screen.queryByTestId('record-calendar-error')).toBeNull();
    expect(screen.getByTestId('record-calendar-month')).toBeOnTheScreen();
    expect(screen.getByTestId('record-calendar-ongoing')).toBeOnTheScreen();
  });
});
