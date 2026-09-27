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
 * TRIP-1017 (B) #091 · (C) #090 — l04 출발점 해제를 **실 페이지 + 실 화면 + 실 react-query + MSW** 로 잰다.
 *
 * 무엇을 보장하나:
 *  - AC-B1: 다이얼로그가 실제 동작(해제, 일정은 그대로)을 말하고 "다시 생성" 약속이 없다.
 *  - AC-B2: 확정하면 `DELETE /trips/{tripId}/bases/{baseAssignmentId}` 가 정확히 1회 나가고, 성공하면 행이
 *    "연결된 여행 없음"이 되고 "출발점" 배지가 사라진다.
 *  - AC-B3: 확정 전(취소)엔 DELETE 0회. 확정 뒤에도 DELETE 말고는 쓰기 요청이 없다(재생성·생성 세션 0) —
 *    쓰기 요청 목록을 완전일치로 잰다. 생성 화면으로 가는 이동도 0회.
 *  - AC-B4(INV-4): DELETE 가 500·404·네트워크로 실패하면 토스트로 알리고, 행은 출발점 그대로다.
 *  - AC-C1(렌더): LOCALDATA 저장 숙소 행은 "탐색에서 저장"이고 "OTA 예약"·"예약번호 미입력"이 없다.
 *
 * ★ 왜 새 파일인가(02a ★3): 기존 `MyStaysPage.integration.test.tsx` 는 화면을 props 캡처 목으로 바꾸고 mutate 목이
 *   **항상 onSuccess** 를 부른다 — 실패 경로(onError)가 원리적으로 안 뜨고, "성공하면 행이 실제로 바뀐다"도 못 본다.
 *   여기선 서버(MSW)가 실제로 204/500/404/끊김을 돌려주고, 페이지·화면·캐시가 전부 실물로 돈다.
 *
 * ★ 토스트는 모듈 싱글턴이다(02a ★4) — 리셋은 파일 최상위 afterEach, 실행 전 "아직 없다" 앵커.
 *
 * 3동작 뼈대: 준비(서버: 저장 숙소 1 · 여행 1 · 거점 1 → 등록 행 도착 대기) → 실행(토글 → 확정/취소) →
 *  단언(행 글자 · 토스트 · 서버로 나간 쓰기 요청 목록).
 *
 * ⚠️ jest 사각: 다이얼로그 딤이 화면을 실제로 덮는지·토스트가 실제로 보이는 위치는 6-b 몫(repo-traps 오버레이).
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

const DELETE_PATH = '/api/v1/trips/t1/bases/ba1';
const ERROR_TOAST_ID = 'my-stays-base-release-error';
const ERROR_COPY = '출발점을 해제하지 못했어요. 다시 시도해 주세요';

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

type DeleteOutcome = 'ok' | 500 | 404 | 'network';

// ── 서버 상태 ─────────────────────────────────────────────────────────────
let serverBases: BaseAssignment[] = [];
/** GET 이 아닌 요청 전부 — "`METHOD /path`". 재생성·생성 세션 같은 쓰기가 끼면 목록이 달라진다. */
let writes: string[] = [];
let started = 0;
let ended = 0;
let queryClient: QueryClient;

function installServer(outcome: DeleteOutcome): void {
  server.use(
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([STAY])),
    http.get(`${BASE}/trips`, () => HttpResponse.json([TRIP])),
    // 상태형 — DELETE 가 성공하면 재조회는 빈 거점 목록을 받는다.
    http.get(`${BASE}/trips/t1/bases`, () => HttpResponse.json(serverBases)),
    http.delete(`${BASE}/trips/t1/bases/ba1`, () => {
      if (outcome === 'network') return HttpResponse.error();
      if (outcome === 500)
        return HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR' } },
          { status: 500 }
        );
      if (outcome === 404)
        return HttpResponse.json(
          { error: { code: 'NOT_FOUND' } },
          { status: 404 }
        );
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

describe('🔴 TRIP-1017 AC-B1 · 다이얼로그가 실제 동작을 말한다 (결정1=(a) · Q2)', () => {
  it('토글을 누르면 "출발점을 해제할까요?" / "일정은 그대로예요." / [취소][해제] 가 뜨고 재생성 약속은 없다', async () => {
    // 준비
    installServer('ok');
    renderPage();
    await waitAssignedRow();

    // 실행
    fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));

    // 단언 — 같은 다이얼로그 안에서 긍정(제목·본문)을 먼저 찾는다(02a ★5).
    const dialog = screen.getByTestId('my-stays-base-dialog');
    expect(within(dialog).getByText('출발점을 해제할까요?')).toBeOnTheScreen();
    expect(within(dialog).getByText('일정은 그대로예요.')).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('my-stays-base-confirm')).getByText('해제')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('my-stays-base-cancel')).getByText('취소')
    ).toBeOnTheScreen();
    expect(within(dialog).queryAllByText(/다시 생성|재생성/)).toHaveLength(0);
    // 다이얼로그만 열었다 — 아직 아무 쓰기도 안 나갔다.
    expect(writes).toHaveLength(0);
  });
});

describe('🟢 TRIP-1017 AC-B2·B3 · 확정 → DELETE 1회 → 행이 미연결로 바뀐다, 다른 쓰기 0', () => {
  it('확정하면 DELETE 만 정확히 1회 나가고, 행은 "연결된 여행 없음"·배지 없음이 된다', async () => {
    installServer('ok');
    renderPage();
    await waitAssignedRow();

    fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));
    fireEvent.press(screen.getByTestId('my-stays-base-confirm'));

    // 단언 — 재조회가 빈 거점을 받아 행이 미연결로 바뀐다(당겨서 새로고침 없이).
    await waitFor(() =>
      expect(within(row()).getByText('연결된 여행 없음')).toBeOnTheScreen()
    );
    await settleNetwork();
    expect(within(row()).queryByText('출발점')).toBeNull();
    expect(screen.queryByTestId('my-stays-base-toggle-s1')).toBeNull();
    // 급소 — 쓰기 요청은 이 DELETE 하나뿐이다(일정 재생성·생성 세션 진입 0, 결정1=(a)).
    expect(writes).toEqual([`DELETE ${DELETE_PATH}`]);
    // 생성 화면으로 가는 이동도 없다.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('취소하면 DELETE 가 나가지 않고 행은 출발점 그대로다(짝)', async () => {
    installServer('ok');
    renderPage();
    await waitAssignedRow();

    fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));
    fireEvent.press(screen.getByTestId('my-stays-base-cancel'));
    await settleNetwork();

    expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
    expect(writes).toHaveLength(0);
    expect(within(row()).getByText('출발점')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1017 AC-B4 · DELETE 실패 → 토스트로 알리고 행은 출발점 그대로 (INV-4 · Q3)', () => {
  it.each([
    ['500 서버 오류', 500 as const],
    ['404 없음', 404 as const],
    ['네트워크 끊김', 'network' as const],
  ])(
    '%s 이면 실패 토스트가 뜨고 행은 바뀌지 않는다',
    async (_title, outcome) => {
      // 준비
      installServer(outcome);
      renderPage();
      await waitAssignedRow();
      // 앵커 — 실행 전엔 실패 토스트가 없다(앞 테스트의 토스트가 새어 거짓 green 이 되는 것을 가른다).
      expect(screen.queryByTestId(ERROR_TOAST_ID)).toBeNull();

      // 실행
      fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));
      fireEvent.press(screen.getByTestId('my-stays-base-confirm'));

      // 단언 — 실패가 사용자에게 드러난다(다이얼로그만 닫히고 아무 일도 없는 상태 금지).
      await waitFor(() =>
        expect(screen.getByTestId(ERROR_TOAST_ID)).toBeOnTheScreen()
      );
      expect(
        within(screen.getByTestId(ERROR_TOAST_ID)).getByText(ERROR_COPY)
      ).toBeOnTheScreen();
      await settleNetwork();
      // 단언 — 서버가 거부했으니 행은 출발점 그대로다.
      expect(within(row()).getByText('출발점')).toBeOnTheScreen();
      expect(
        within(row()).getByText('연결 여행 · 부산 여행')
      ).toBeOnTheScreen();
      expect(within(row()).queryByText('연결된 여행 없음')).toBeNull();
      // 요청은 한 번 나갔다(재시도로 여러 번 치지 않는다).
      expect(writes).toEqual([`DELETE ${DELETE_PATH}`]);
    }
  );
});

describe('🔴 TRIP-1017 AC-C1 · 탐색에서 저장한 숙소는 예약이라고 말하지 않는다 (렌더)', () => {
  it('LOCALDATA 저장 숙소 행에 "탐색에서 저장"이 있고 "OTA 예약"·"예약번호 미입력"은 없다', async () => {
    installServer('ok');
    renderPage();
    await waitAssignedRow();

    expect(within(row()).getByText('탐색에서 저장')).toBeOnTheScreen();
    expect(within(row()).queryByText('OTA 예약')).toBeNull();
    expect(within(row()).queryByText('예약번호 미입력')).toBeNull();
  });
});
