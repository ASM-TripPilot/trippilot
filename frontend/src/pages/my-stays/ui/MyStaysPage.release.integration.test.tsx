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
  BaseAssignment,
  SavedStay,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { MyStaysPage } from './MyStaysPage';

/**
 * l04 출발점 버튼을 **실 페이지 + 실 화면 + 실 react-query + MSW** 로 잰다.
 *
 * TRIP-1076 결정 2(A)로 이 파일의 대상이 바뀌었다. TRIP-1017 은 버튼을 「출발점 해제」(다이얼로그 → DELETE)로
 * 잠갔는데, 사용자 결정으로 Figma l04 대로 「출발점 변경」 → 그 여행의 거점 화면 이동이 됐다. 그래서
 *  - 옛 AC-B1(해제 다이얼로그 문구) → **반전**: 누르면 다이얼로그 없이 거점 화면으로 push, 쓰기 요청 0.
 *  - 옛 AC-B2·B3(확정 → DELETE 성공·취소)·AC-B4(DELETE 실패 토스트) → **삭제**: 이 화면에 DELETE 경로 자체가 없다.
 *    "쓰기 0" 은 새 AC-6 케이스가 서버에 나간 요청 목록으로 잰다.
 *  - AC-C1(렌더): LOCALDATA 저장 숙소 행은 "탐색에서 저장"이고 "OTA 예약"·"예약번호 미입력"이 없다 — 유지.
 * 파일 이름(release)은 이력 연속을 위해 그대로 둔다.
 *
 * ★ DELETE 핸들러는 남겨 둔다(02a ★12) — 잘못 나간 DELETE 가 `onUnhandledRequest` 에러가 아니라
 *   "쓰기 목록 불일치"로 읽혀야 원인이 바로 보인다.
 * ★ 토스트는 모듈 싱글턴이다 — 리셋은 파일 최상위 afterEach(케이스를 지워도 장치는 둔다).
 *
 * 3동작 뼈대: 준비(서버: 저장 숙소 1 · 여행 1 · 거점 1 → 등록 행 도착 대기) → 실행(「출발점 변경」 press) →
 *  단언(서버로 나간 쓰기 요청 목록 · push 인자 · 행 글자).
 */

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

// 토큰 저장소 — 기기 저장소를 건드리지 않게 배럴만 바꾼다(StayDetailPage 통합 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = `${
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8080'
}/api/v1`;

const STAY: SavedStay = {
  savedStayId: 's1',
  name: '해운대 오션뷰',
  lat: 35.1587,
  lng: 129.1604,
  coordConfirmed: true,
  linkedTripIds: ['t1'],
  checkIn: '2026-06-10',
  checkOut: '2026-06-13',
  // ♥ 저장(탐색 카탈로그) 숙소 — #090 의 실제 재현 데이터(지자체 인허가 원천).
  externalSource: 'LOCALDATA',
  externalId: 'L-0001',
  registerRoute: 'MAP_SEARCH',
  memo: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const TRIP = {
  tripId: 't1',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-13',
  party: 2,
  preferenceSnapshot: {},
  destinations: [],
  status: 'PLANNED',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  baseCount: 1,
  itineraryDayCount: 3,
} as unknown as Trip;

const BASE_ROW: BaseAssignment = {
  baseAssignmentId: 'ba1',
  savedStayId: 's1',
  dateFrom: '2026-06-10',
  dateTo: '2026-06-13',
};

// ── 서버 상태 ─────────────────────────────────────────────────────────────
let serverBases: BaseAssignment[] = [];
/** GET 이 아닌 요청 전부 — "`METHOD /path`". 재생성·생성 세션 같은 쓰기가 끼면 목록이 달라진다. */
let writes: string[] = [];
let started = 0;
let ended = 0;
let queryClient: QueryClient;

function installServer(): void {
  server.use(
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([STAY])),
    http.get(`${BASE}/trips`, () => HttpResponse.json([TRIP])),
    // 상태형 — DELETE 가 성공하면 재조회는 빈 거점 목록을 받는다.
    http.get(`${BASE}/trips/t1/bases`, () => HttpResponse.json(serverBases)),
    // 이 화면은 DELETE 를 쏘지 않는다 — 잘못 나가면 writes 에 찍혀 단언이 가른다.
    http.delete(`${BASE}/trips/t1/bases/ba1`, () => {
      serverBases = [];
      return new HttpResponse(null, { status: 204 });
    })
  );
}

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <WithToastHost>
        <MyStaysPage />
      </WithToastHost>
    </QueryClientProvider>
  );
}

/** 시작한 요청이 모두 끝나고 그 결과가 화면에 반영될 때까지 흘린다. */
async function settleNetwork(): Promise<void> {
  await waitFor(() => expect(ended).toBe(started));
  await act(async () => {});
}

const row = () => screen.getByTestId('my-stays-row-s1');

/** 거점 조회가 도착해 s1 이 등록(출발점) 행으로 그려질 때까지 기다린다. */
async function waitAssignedRow(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByTestId('my-stays-base-toggle-s1')).toBeOnTheScreen()
  );
  await settleNetwork();
  // 앵커 — 등록 행의 두 표지(배지·연결 여행)가 있다(아래 "사라진다"가 공허하지 않게).
  expect(within(row()).getByText('출발점')).toBeOnTheScreen();
  expect(within(row()).getByText('연결 여행 · 부산 여행')).toBeOnTheScreen();
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    started += 1;
    if (request.method !== 'GET') {
      writes.push(`${request.method} ${new URL(request.url).pathname}`);
    }
  });
  server.events.on('request:end', () => {
    ended += 1;
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  serverBases = [BASE_ROW];
  writes = [];
  started = 0;
  ended = 0;
  queryClient = newClient();
  setAccessToken('valid-access');
});

// 토스트 스토어는 모듈 싱글턴이라 테스트 사이로 샌다 — 파일 최상위에서 비운다(02a ★4).
afterEach(() => {
  resetToast();
  server.resetHandlers();
  clearAccessToken();
  queryClient.clear();
});

afterAll(() => server.close());

describe('🔴 TRIP-1076 AC-6 · 「출발점 변경」 → 거점 화면, 이 화면은 거점을 쓰지 않는다 (결정 2(A))', () => {
  it('누르면 다이얼로그 없이 /trips/[tripId]/bases 로 push 1회, 서버 쓰기 요청 0, 행은 출발점 그대로', async () => {
    // 준비
    installServer();
    renderPage();
    await waitAssignedRow();

    // 실행 — 버튼은 역할·이름으로 찾는다(글자 반전이 함께 잠긴다).
    fireEvent.press(screen.getByRole('button', { name: '출발점 변경' }));
    await settleNetwork();

    // 단언 ① — 그 여행의 거점 화면으로 한 번.
    // TRIP-1082 — l04 입구는 거점 **편집 모드**로 연다(진행바·생성 CTA 없이 [완료] 하나). h04 입구는 mode 없음.
    expect(mockPush.mock.calls).toEqual([
      [
        {
          pathname: '/trips/[tripId]/bases',
          params: { tripId: 't1', mode: 'edit' },
        },
      ],
    ]);
    // 단언 ② — 확인 없이 거점을 바꾸거나 재생성하지 않는다(BR-U6-21 금지 조항): 쓰기 요청이 하나도 없다.
    expect(writes).toEqual([]);
    expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
    // 단언 ③ — 행은 그대로 등록 상태다.
    expect(within(row()).getByText('출발점')).toBeOnTheScreen();
    expect(within(row()).getByText('연결 여행 · 부산 여행')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1017 AC-C1 · 탐색에서 저장한 숙소는 예약이라고 말하지 않는다 (렌더)', () => {
  it('LOCALDATA 저장 숙소 행에 "탐색에서 저장"이 있고 "OTA 예약"·"예약번호 미입력"은 없다', async () => {
    installServer();
    renderPage();
    await waitAssignedRow();

    expect(within(row()).getByText('탐색에서 저장')).toBeOnTheScreen();
    expect(within(row()).queryByText('OTA 예약')).toBeNull();
    expect(within(row()).queryByText('예약번호 미입력')).toBeNull();
  });
});
