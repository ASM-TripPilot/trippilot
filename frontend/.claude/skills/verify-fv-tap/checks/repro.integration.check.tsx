/**
 * verify-fv-tap 반례 재현 — TLC 가 낸 가장 짧은 반례를 **실제 페이지** 위에서 한 단계씩 다시 밟는다.
 * 첫 실행(sync f153fe2)에선 R1~R3 이 그대로 일어났고(결함 FV-TAP-01·02), TRIP-1688 에서 고친 뒤
 * "고쳐진 동작"을 단언하도록 뒤집었다(SKILL.md 「결과 읽기」 3). 이 it 이 red 면 고친 결함이 되살아난 것이다.
 *
 *  R1 confirm · OnceOnly + NoFalseFailure — 확정 응답이 400ms 보다 늦을 때 다시 눌러도 POST 는 1건이고
 *     (요청 중 CTA 비활성), 확정된 화면에 「확정 실패」 안내가 없고 확정 토스트가 뜬다.
 *  R2 confirm · NoPassThrough — 같은 반례 경로에서 첫 응답의 호출별 onSuccess 가 창을 다시 열어,
 *     CTA 가 [일정 수정]으로 바뀐 지 400ms 안의 탭은 편집 화면으로 들어가지 않는다.
 *  R3 allow · OnceOnly — 위치 권한이 이미 허용된 기기에서 [허용]을 같은 프레임에 두 번 눌러도 권한 조회 1회 ·
 *     푸시 안내로 replace 1회.
 *
 * 시간은 `Date.now` 를 손으로 움직여 만든다(가드가 보는 유일한 시계). 응답 시점은 MSW 핸들러의 문(gate)으로 정한다.
 */
import type { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetToast, WithToastHost } from '@/test-support/toastHarness';
import { itinerary, trip, TRIP_ID, DAY2 } from '@/test-support/itineraryFixtures';
import { serveItinerary } from '@/test-support/mswItinerary';
import { createWrapper, newTestQueryClient } from '@/test-support/queryRender';
import { ItineraryPlanPage } from '@/pages/itinerary/itinerary-plan/ui/ItineraryPlanPage';
import { LocationPage } from '@/pages/onboarding/onboarding-location';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));
jest.mock('@/shared/storage/idSet', () => ({
  readIdSet: jest.fn(() => Promise.resolve([])),
  writeIdSet: jest.fn(() => Promise.resolve()),
}));
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@/shared/storage', () => ({
  ...require('@/test-support/storageMock'),
  ...require('@/shared/storage/idSet'),
}));
/* eslint-enable @typescript-eslint/no-require-imports */

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    dismissTo: mockDismissTo,
    canGoBack: () => true,
  }),
}));

const mockRequestForeground = jest.fn();
const mockGetForeground = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...a: unknown[]) => mockRequestForeground(...a),
  getForegroundPermissionsAsync: (...a: unknown[]) => mockGetForeground(...a),
}));
jest.mock('expo-linking', () => ({ openSettings: jest.fn(() => Promise.resolve()) }));

const T0 = 1_790_000_000_000;
let now = T0;
let clock: jest.SpyInstance;

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
beforeEach(() => {
  now = T0;
  clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  resetPressGuard();
  jest.clearAllMocks();
});
afterEach(() => {
  cleanup();
  clock.mockRestore();
  resetToast();
});

// ── R1 · R2 일정 확정 ────────────────────────────────────────────────────────
describe('confirm — ItineraryPlanPage [일정 확정하기] (guardPress + 요청 중 비활성)', () => {
  let client: QueryClient | null = null;
  let calls = 0;
  /** 요청 n 번째의 응답을 쥔 문 — release(n) 로 연다. */
  const gates: Array<{ open: () => void; wait: Promise<void> }> = [];
  const gate = () => {
    let open = () => {};
    const wait = new Promise<void>((r) => (open = r));
    return { open, wait };
  };

  beforeEach(() => {
    calls = 0;
    gates.length = 0;
    gates.push(gate(), gate());
    setAccessToken('valid-access');
    serveItinerary(server, {
      trip: () => trip({ title: '제주 여행', endDate: DAY2 }),
      itinerary: () => itinerary({ status: calls > 0 ? 'CONFIRMED' : 'PLANNED' }),
      confirm: async () => {
        const n = calls;
        calls += 1;
        await gates[n].wait;
        // 서버(ConfirmItineraryService): 첫 확정은 200, 이미 확정이면 409.
        return n === 0
          ? HttpResponse.json(itinerary({ status: 'CONFIRMED' }))
          : HttpResponse.json({ code: 'CONFLICT', message: '이미 확정된 일정입니다.' }, { status: 409 });
      },
    });
  });
  afterEach(async () => {
    gates.forEach((g) => g.open());
    await client?.cancelQueries();
    client?.clear();
    client = null;
    server.resetHandlers();
    act(() => clearAccessToken());
  });

  async function openPlanned(): Promise<void> {
    client = newTestQueryClient({ gcTime: 0 });
    render(
      <WithToastHost>
        <ItineraryPlanPage tripId={TRIP_ID} />
      </WithToastHost>,
      { wrapper: createWrapper(client) }
    );
    const cta = await screen.findByTestId('sheet-cta-button-0');
    expect(cta).toHaveTextContent('일정 확정하기');
  }
  const tap = () => fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
  const waitConfirmedFace = () =>
    waitFor(() => expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(/^확정됨 · /));

  it('R1 — 400ms 뒤 다시 눌러도 POST 1건, 확정된 화면에 「확정 실패」 안내가 없고 확정 토스트가 뜬다', async () => {
    await openPlanned();
    tap(); // 0ms — 요청 1
    await waitFor(() => expect(calls).toBe(1));
    now = T0 + 400;
    tap(); // 400ms — 창은 닫혔지만 요청 중이라 CTA 비활성

    gates[0].open(); // 서버가 요청 1 을 받아들인다(확정)
    await waitConfirmedFace();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80)); // 둘째 요청이 나갔다면 도착할 틈
    });

    expect(calls).toBe(1);
    expect(screen.queryByTestId('itinerary-confirm-error')).toBeNull();
    expect(screen.getByTestId('itinerary-confirmed-toast')).toBeOnTheScreen();
  });

  it('R2 — 첫 응답이 창을 다시 열어, CTA 가 바뀐 지 300ms 뒤의 탭은 [일정 수정]으로 들어가지 않는다', async () => {
    await openPlanned();
    tap(); // 0ms
    await waitFor(() => expect(calls).toBe(1));
    now = T0 + 400;
    tap(); // 400ms — 비활성이라 요청이 안 나간다

    now = T0 + 500;
    gates[0].open(); // 500ms — 확정, CTA 가 [일정 수정]으로 바뀐다
    await waitConfirmedFace();
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent('일정 수정');

    now = T0 + 800; // 바뀐 지 300ms — 연타의 남은 탭
    tap();
    expect(mockPush).toHaveBeenCalledTimes(0);
    expect(calls).toBe(1);
  });
});

// ── R3 위치 허용 ─────────────────────────────────────────────────────────────
describe('allow — LocationPage default [허용] (진행 중 잠금)', () => {
  it('R3 — 이미 허용된 기기에서 같은 프레임 두 번 눌러도 권한 조회 1회 · 푸시 안내 replace 1회', async () => {
    mockGetForeground.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
    mockRequestForeground.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
    render(<LocationPage />);
    const allow = screen.getByTestId('onboarding-location-allow');
    fireEvent.press(allow);
    fireEvent.press(allow);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/push'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50)); // 둘째 요청·이동이 있었다면 도착할 틈
    });
    expect(mockRequestForeground).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });
});

// MSW 핸들러 정의가 없는 기본 요청(거점 등)은 빈 목록 — 파일 안에서만.
beforeEach(() => {
  server.use(http.get('http://localhost:8080/api/v1/trips/:tripId/bases', () => HttpResponse.json([])));
});
