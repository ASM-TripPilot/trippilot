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
import type { SavedStay } from '@/shared/api/generated/schemas';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';

import { TripNewStep1Page } from './TripNewStep1Page';

/**
 * TRIP-208 등록 숙소 날짜 연계 — **실 조회로 태우는 심판**(AC-8 · AC-9).
 *
 * 무엇을 보장하나: `GET /saved-stays`가 실제로 나가고, 그 결과가 얼굴로 이어지며,
 * **데이터가 도착한 뒤 재조회가 실패해도 그 얼굴이 지워지지 않는다**(01b D4).
 *
 * 왜 통합 버킷인가: 심판 대상이 **TanStack Query의 실제 잔존 거동**이다. 훅을 목킹하면
 * "재조회 실패 시 `data`가 남는다"가 테스트의 *가정*이 되어, 그 가정이 틀려도 아무도
 * 모른다. 여기서는 200 → 네트워크 실패 → 200으로 핸들러를 갈아 끼우며 세 갈래를 실제로
 * 태운다(문제로그 `2026-08-02 목이 성공만 흉내내 도달 불가 분기가 초록으로 남았다`).
 * 배선 자체(어느 상태가 어느 얼굴로 가는가)는 `TripNewStep1Page.stayImport.test.tsx`가 본다.
 *
 * 🔴 이 파일이 존재하는 진짜 이유 — 미해결 문제로그 `2026-08-04 화면 얼굴 전환이 잔존
 * 목록을 지운다`(TRIP-222·223에서 2회 반복). 첫 손이 자연스럽게 쓰는 `if (isError) return
 * <에러화면/>` 한 줄이 이미 받아 둔 목록을 지운다. **성공 경로만 태우면 절대 안 보인다.**
 *
 * ⚠️ 관측 타이밍 함정(02a ★1-b · §5-3 실측): `await act(async () => await refetch())`
 * **직후에** 상태를 읽으면 `status:'success' · isError:false`로 보인다 — 캐시는 이미
 * `status:'error'`인데 옵저버 알림이 배치 타이머에 걸려 아직 도달하지 않은 것이다. 반드시
 * `findBy*`/`waitFor`로 **렌더된 결과**를 기다린다.
 *
 * 3동작 뼈대: 준비=핸들러 응답 지정 → 실행=render / 핸들러 교체 + 재조회 → 단언=보이는 것.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 `@/shared/storage`를 정적으로
// 물고 있다 — expo-secure-store 실물 로드를 피하려면 목킹해야 한다(선례와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 바깥 변수를 못 본다 — 이름이 `mock`으로
// 시작하는 변수만 예외다(리포 확립 규칙).
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

/** `authWiring.integration.test.ts:59`와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';

/** 프리셋 계산 기준일 고정 — 실행일이 바뀌어도 날짜 단언이 흔들리지 않는다. */
const BASE_DATE = '2026-06-10';

/** openapi `SavedStay.required` 6필드를 그대로 채운다(상상해서 만들지 않는다). */
const DATED_STAY: SavedStay = {
  savedStayId: '22222222-2222-2222-2222-222222222222',
  name: '해운대 호텔',
  coordConfirmed: true,
  checkIn: '2026-06-10',
  checkOut: '2026-06-13',
  registerRoute: 'MAP_SEARCH',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

const IMPORT_TITLE = '등록 숙소에서 날짜 가져오기';
const READY_NOTE = '해운대 호텔 · 6.10~6.13';

/** 나간 요청의 `METHOD /경로` 누적 — 재시도가 **진짜 요청**을 냈는지 세는 데 쓴다. */
let observedHits: string[] = [];

function stayHits(): number {
  return observedHits.filter((hit) => hit === 'GET /api/v1/saved-stays').length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  mockPush.mockClear();
  useTripWizardStore.getState().reset();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

/** 성공 응답으로 돌려놓는다. 통합 버킷은 `onUnhandledRequest: 'error'`라 핸들러가 없으면
 * AC 실패가 아니라 **준비 단계에서 죽는다** — 매번 명시적으로 건다. */
function serveStays(stays: SavedStay[]): void {
  server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.json(stays)));
}

/** 응답 자체가 없는 실패(네트워크 끊김). 상태 코드로만 분기하는 구현이 조용히 미끄러지는
 * 자리다(TRIP-206 실측). */
function failStays(): void {
  server.use(http.get(`${BASE}/saved-stays`, () => HttpResponse.error()));
}

/**
 * `gcTime: 0` — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를 붙잡는다.
 * mutation 기본 gcTime은 5분이라 그쪽도 0으로 둔다(TRIP-203 실측).
 * `retry: false` — 실패를 즉시 실패로 본다(안 끄면 재시도 대기 때문에 테스트가 늘어진다).
 */
function createHarness() {
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
  return {
    client,
    render: () =>
      render(<TripNewStep1Page baseDate={BASE_DATE} />, { wrapper: Wrapper }),
  };
}

function block() {
  return screen.getByTestId('trip-wizard-stayimport-block');
}

describe('I-1 · AC-9 → AC-1 — 조회 중에는 자리만, 도착하면 얼굴 A', () => {
  it('처음엔 얼굴 문구가 없고, 응답이 오면 부제까지 그려진다', async () => {
    serveStays([DATED_STAY]);
    const harness = createHarness();
    harness.render();

    // 단언 ① — 아직 응답 전이다. 이 순간 대안 UI(`등록한 숙소가 없어요`)를 그리면
    // 등록 숙소가 있는 사용자에게 "없어요"를 잠깐 보여주게 된다(01b가 기각한 선택지).
    expect(block()).not.toHaveTextContent(/등록한 숙소가 없어요/);
    expect(block()).not.toHaveTextContent(/가져오기/);

    // 단언 ② — 도착하면 얼굴 A가 선다.
    expect(await screen.findByText(IMPORT_TITLE)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-wizard-stayimport-note')).getByText(
        READY_NOTE
      )
    ).toBeOnTheScreen();
    expect(stayHits()).toBe(1);
  });
});

describe('I-2 · AC-8 — 데이터 도착 뒤 재조회가 실패해도 얼굴이 남는다 (D4 · INV-4)', () => {
  it('🔴 잔존 목록으로 판정한 얼굴 A가 그대로이고 재시도 행만 덧붙는다', async () => {
    // 준비 ① — 먼저 **정상적으로 데이터를 받는다.** 이 단계가 없으면 "잔존"이라는 말
    // 자체가 성립하지 않는다.
    serveStays([DATED_STAY]);
    const harness = createHarness();
    harness.render();
    await screen.findByText(IMPORT_TITLE);
    expect(stayHits()).toBe(1);

    // 준비 ② — 이제 서버가 죽는다.
    failStays();

    // 실행 — 배경 재조회(화면 복귀·무효화 등으로 실제 앱에서 늘 일어나는 일)를 태운다.
    await act(async () => {
      await harness.client.refetchQueries();
    });

    // 단언 ① — ⚠️ **렌더된 결과를 기다려서** 본다. act 직후 상태를 읽으면 옵저버 알림이
    // 아직 도착하지 않아 "실패가 안 났다"고 잘못 읽는다(02a ★1-b 실측).
    expect(
      await screen.findByTestId('trip-wizard-stayimport-retry')
    ).toBeOnTheScreen();

    // 단언 ② — **이 세 줄이 이 사이클의 심판이다.** 실패했다고 얼굴을 갈아 끼우면
    // 이미 받아 둔 숙소 정보가 사라지고, 사용자는 방금까지 보이던 가져오기 버튼을 잃는다.
    expect(screen.getByText(IMPORT_TITLE)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-wizard-stayimport-note')).getByText(
        READY_NOTE
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-fetch-staydates')).toBeEnabled();

    // 단언 ③ — 대안 얼굴로 미끄러지지도 않았다(빈 목록 판정으로 떨어지면 여기서 걸린다).
    expect(screen.queryByText('등록한 숙소가 없어요')).toBeNull();
    expect(stayHits()).toBe(2);
  });

  it('짝 — 다시 시도가 진짜 요청을 내고, 성공하면 재시도 행이 걷힌다', async () => {
    serveStays([DATED_STAY]);
    const harness = createHarness();
    harness.render();
    await screen.findByText(IMPORT_TITLE);

    failStays();
    await act(async () => {
      await harness.client.refetchQueries();
    });
    const retry = await screen.findByTestId('trip-wizard-stayimport-retry');
    expect(stayHits()).toBe(2);

    // 실행 — 서버가 살아난 뒤 사용자가 직접 누른다.
    serveStays([DATED_STAY]);
    fireEvent.press(retry);

    // 표시만 하고 아무 일도 안 하면 위반이다 — 요청 수가 실제로 늘어야 한다.
    await waitFor(() => expect(stayHits()).toBe(3));
    await waitFor(() =>
      expect(screen.queryByTestId('trip-wizard-stayimport-retry')).toBeNull()
    );
    expect(screen.getByText(IMPORT_TITLE)).toBeOnTheScreen();
  });
});

describe('I-3 · 첫 조회부터 실패 — 스켈레톤에 갇히지 않는다 (BR-U1-55 침묵 실패 금지)', () => {
  it('대안 얼굴로 떨어지고 재시도 행이 함께 뜬다', async () => {
    // 잔존이 아예 없는 갈래. 여기서 로딩을 계속 그리면 사용자가 할 수 있는 일이 하나도
    // 없다 — 자리표시가 영원히 도는 것이 정확히 침묵 실패다.
    failStays();
    const harness = createHarness();
    harness.render();

    expect(await screen.findByText('등록한 숙소가 없어요')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-stayimport-retry')
    ).toBeOnTheScreen();
    // 할 수 있는 일이 남아 있다 — 직접 입력 경로.
    expect(screen.getByTestId('trip-wizard-manual-dates')).toBeOnTheScreen();
  });
});
