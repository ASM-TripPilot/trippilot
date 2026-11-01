/**
 * verify-fv-tap 반례 재현 — TLC 가 낸 가장 짧은 반례를 **실제 페이지** 위에서 한 단계씩 다시 밟는다.
 * 재현되면 결함, 안 되면 모델 오류를 먼저 의심한다. 각 it 은 "지금 코드에서 반례가 그대로 일어난다"를 단언한다 —
 * 결함을 고치면 이 it 이 red 가 되고, 그때 "고쳐진 동작"을 단언하도록 뒤집는다(SKILL.md 「결과 읽기」 3).
 *
 *  R1 confirm · OnceOnly + NoFalseFailure — 확정 응답이 400ms 보다 늦을 때 다시 누르면 POST 가 두 번 나가고,
 *     첫 요청이 확정을 해내도 둘째의 409 가 「확정 실패」 안내를 확정된 화면에 남긴다(확정 토스트도 안 뜬다).
 *  R2 confirm · NoPassThrough — 그 두 번째 탭 때문에 첫 응답의 호출별 onSuccess(창 다시 열기)가 돌지 않아,
 *     CTA 가 [일정 수정]으로 바뀐 지 400ms 안의 탭이 편집 화면으로 들어간다.
 *  R3 allow · OnceOnly — 위치 권한이 이미 허용된 기기에서 [허용]을 같은 프레임에 두 번 누르면 권한 조회 2회 ·
 *     푸시 안내로 replace 2회.
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
describe('confirm — ItineraryPlanPage [일정 확정하기] (guardPress 만, 잠금 없음)', () => {
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

  it('R1 — 400ms 뒤 다시 누르면 POST 2건, 확정된 화면에 「확정 실패」 안내가 남고 확정 토스트는 없다', async () => {
    await openPlanned();
    tap(); // 0ms — 요청 1
    now = T0 + 400;
    tap(); // 400ms — 창이 닫혔고 잠금이 없어 요청 2
    await waitFor(() => expect(calls).toBe(2));

    gates[0].open(); // 서버가 요청 1 을 받아들인다(확정)
    await waitConfirmedFace();
    gates[1].open(); // 요청 2 는 409
    await waitFor(() => expect(screen.getByTestId('itinerary-confirm-error')).toBeOnTheScreen());

    expect(calls).toBe(2);
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(/^확정됨 · /);
    expect(screen.queryByTestId('itinerary-confirmed-toast')).toBeNull();
  });

  it('R2 — 첫 응답이 창을 다시 열지 못해, CTA 가 바뀐 지 300ms 뒤의 탭이 [일정 수정]으로 편집에 들어간다', async () => {
    await openPlanned();
    tap(); // 0ms
    now = T0 + 400;
    tap(); // 400ms
    await waitFor(() => expect(calls).toBe(2));

    now = T0 + 500;
    gates[0].open(); // 500ms — 확정, CTA 가 [일정 수정]으로 바뀐다
    await waitConfirmedFace();
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent('일정 수정');

    now = T0 + 800; // 바뀐 지 300ms — 연타의 남은 탭
    tap();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/trips/[tripId]/itinerary/edit' })
    );
  });
});

// ── R3 위치 허용 ─────────────────────────────────────────────────────────────
describe('allow — LocationPage default [허용] (가드·잠금 없음)', () => {
  it('R3 — 이미 허용된 기기에서 같은 프레임 두 번 누르면 권한 조회 2회 · 푸시 안내 replace 2회', async () => {
    mockGetForeground.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
    mockRequestForeground.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
    render(<LocationPage />);
    const allow = screen.getByTestId('onboarding-location-allow');
    fireEvent.press(allow);
    fireEvent.press(allow);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(2));
    expect(mockRequestForeground).toHaveBeenCalledTimes(2);
    expect(mockReplace).toHaveBeenNthCalledWith(2, '/(onboarding)/push');
  });
});

// MSW 핸들러 정의가 없는 기본 요청(거점 등)은 빈 목록 — 파일 안에서만.
beforeEach(() => {
  server.use(http.get('http://localhost:8080/api/v1/trips/:tripId/bases', () => HttpResponse.json([])));
});
