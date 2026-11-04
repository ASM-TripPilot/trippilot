import { http, HttpResponse } from 'msw';
import { onlineManager } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { getGetMePersonalizationQueryKey } from '@/shared/api/index.hooks';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { BASE } from '@/test-support/apiBase';
import { createGate } from '@/test-support/mswHookHarness';
import {
  createWrapper,
  newTestQueryClient,
  settle,
} from '@/test-support/queryRender';

import { PersonalizationPage } from './PersonalizationPage';

/**
 * TRIP-1755 · 개인화 조회 실패 — 실 QueryClient + msw 로 보는 재시도 윈도·회복(INV-4 · BR-U0-12).
 *
 * 왜 이 파일이 따로 있나: `PersonalizationPage.test.tsx` 는 생성 훅을 `jest.mock` 으로 바꿔 값을 직접 주입한다.
 * 그러면 "데이터 없는 쿼리를 다시 받으면 TanStack v5 가 status 를 pending 으로 되돌려 `isError` 가 꺼지는" 순간을
 * 재현할 수 없다 — 거짓 OFF 토글이 되살아나는 바로 그 틈이다. 이 틈은 실제 QueryClient 에서만 보인다.
 *
 * 무엇을 보장하나(3동작: 준비=GET 응답 큐·게이트 → 실행=렌더·다시 시도 → 단언=토글·카드·요청 수):
 *  - PI1 콜드 500 → 오류 카드·다시 시도, 토글·안내 없음, 동의 요청(`/terms`·`PATCH /me/consents/*`) 0회.
 *  - PI2 다시 시도를 누르고 둘째 응답이 **서버에 도착했지만 아직 안 돌아온** 윈도 → 토글·안내·동의 요청 없음(얼굴 종류는 자유).
 *  - PI3 둘째 응답 200 `APPLIED` → 토글 ON·오류 카드 사라짐, 조회는 총 2회.
 *  - PI4 (Q2a) 받아 둔 값이 있어도 재조회가 500 이면 오류 카드·토글 없음(옛 값을 토글로 보이지 않는다).
 *  - PI5 (Q4) 오프라인 첫 진입(요청이 나가지도 못함) → 로딩에 갇히지 않고 오류 카드, 토글 없음, 조회 0회.
 *
 * jest 사각: 카드 배치·룩, 앱 전역 재시도 3회(≈7초) 뒤의 실제 실패 타이밍(테스트 클라이언트는 retry:false) → 6-b.
 */

// authedClient 가 @/shared/storage 를 정적으로 문다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    useRouter: ['push', 'back', 'replace', 'canGoBack'],
  })
);

const ERROR = 'settings-personalization-load-error';
const RETRY = 'settings-personalization-load-retry';
const TOGGLE = 'settings-personalization-toggle';

type Reply = { status: 200 | 500; gate?: Promise<void> };
let replies: Reply[] = [];
let gets = 0;
let terms = 0;
let consentPatches = 0;
let releaseGate: () => void = () => {};

const APPLIED = {
  applied: true,
  reason: 'APPLIED',
  sharedItems: [{ item: '맛집 방문 기록', purpose: '다음 여행 맛집 추천' }],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  setAccessToken('a');
  replies = [];
  gets = 0;
  terms = 0;
  consentPatches = 0;
  releaseGate = () => {};
  server.use(
    http.get(`${BASE}/me/personalization`, async () => {
      gets += 1;
      const reply = replies.shift() ?? { status: 200 };
      if (reply.gate) await reply.gate;
      return reply.status === 500
        ? HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'x' } },
            { status: 500 }
          )
        : HttpResponse.json(APPLIED);
    }),
    http.get(`${BASE}/terms`, () => {
      terms += 1;
      return HttpResponse.json([]);
    }),
    http.patch(`${BASE}/me/consents/:type`, () => {
      consentPatches += 1;
      return new HttpResponse(null, { status: 204 });
    })
  );
});

afterEach(() => {
  // 중간에 실패해도 붙잡힌 요청을 남기지 않는다(파일 최상위).
  releaseGate();
  server.resetHandlers();
  clearAccessToken();
  // onlineManager 는 모듈 싱글턴 — 오프라인 케이스(PI5)가 어떻게 끝나든 다음 케이스는 온라인으로 시작한다.
  onlineManager.setOnline(true);
});

afterAll(() => server.close());

/** 동의 PATCH 가 한 번도 안 나갔다 — 거짓 OFF 를 눌러 GRANT 가 쌓이는 길이 없다. */
function expectNoConsentTraffic() {
  expect(consentPatches).toBe(0);
  expect(terms).toBe(0);
}

describe('TRIP-1755 · 개인화 조회 실패 — 실 QueryClient', () => {
  it('PI1 콜드 500 → 오류 카드·다시 시도가 있고, 토글·안내·동의 요청은 없다', async () => {
    replies = [{ status: 500 }];

    render(<PersonalizationPage />, { wrapper: createWrapper() });

    // 긍정 앵커 — 실패가 화면에 도착했다. 그 위에서 "없음"을 잰다.
    expect(await screen.findByTestId(ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(RETRY)).toBeOnTheScreen();
    expect(screen.queryByTestId(TOGGLE)).toBeNull();
    expect(screen.queryByText(/동의하면/)).toBeNull();
    expect(gets).toBe(1);
    expectNoConsentTraffic();
  });

  it('PI2 다시 시도 중(둘째 요청이 도착했고 응답 전)에도 거짓 OFF 토글이 되살아나지 않는다', async () => {
    // 준비 — 둘째 GET 은 문 뒤에서 기다린다.
    const gate = createGate();
    releaseGate = gate.release;
    replies = [{ status: 500 }, { status: 200, gate: gate.opened }];
    render(<PersonalizationPage />, { wrapper: createWrapper() });
    await screen.findByTestId(ERROR);

    // 실행 — 다시 시도. 둘째 요청이 서버에 도착한 것을 확인한 뒤에야 윈도다(그 전엔 누르기 전 화면이다).
    fireEvent.press(screen.getByTestId(RETRY));
    await waitFor(() => expect(gets).toBe(2));
    await settle();

    // 단언 — v5 는 이 순간 status 를 pending 으로 되돌려 isError 가 꺼진다. 그래도 토글이 없다.
    expect(screen.queryByTestId(TOGGLE)).toBeNull();
    expect(screen.queryByText(/동의하면/)).toBeNull();
    expectNoConsentTraffic();
  });

  it('PI3 다시 시도가 성공하면 토글이 서버 값(ON)대로 나타나고 오류 카드는 사라진다', async () => {
    replies = [{ status: 500 }, { status: 200 }];
    render(<PersonalizationPage />, { wrapper: createWrapper() });
    await screen.findByTestId(ERROR);

    fireEvent.press(screen.getByTestId(RETRY));

    await waitFor(() => expect(screen.getByTestId(TOGGLE)).toBeChecked());
    expect(screen.queryByTestId(ERROR)).toBeNull();
    expect(screen.queryByTestId(RETRY)).toBeNull();
    expect(gets).toBe(2);
    expectNoConsentTraffic();
  });

  it('PI4 (Q2a) 받아 둔 값이 있어도 재조회가 실패하면 오류 카드이고 옛 값의 토글은 없다', async () => {
    // 준비 — 첫 응답 성공(ON), 이후 재조회 500.
    replies = [{ status: 200 }, { status: 500 }];
    const client = newTestQueryClient();
    render(<PersonalizationPage />, { wrapper: createWrapper(client) });
    await waitFor(() => expect(screen.getByTestId(TOGGLE)).toBeChecked());

    // 실행 — 저장 뒤 무효화처럼 밖에서 다시 받게 한다.
    await act(async () => {
      await client.invalidateQueries({
        queryKey: getGetMePersonalizationQueryKey(),
      });
    });

    // 단언 — 앵커: 실패가 캐시에 실제로 도착했다. 그 위에서 옛 값 토글이 없다.
    expect(
      client.getQueryState(getGetMePersonalizationQueryKey())?.status
    ).toBe('error');
    await waitFor(() => expect(screen.getByTestId(ERROR)).toBeOnTheScreen());
    expect(screen.queryByTestId(TOGGLE)).toBeNull();
    expect(
      screen.queryAllByTestId('settings-personalization-item')
    ).toHaveLength(0);
  });

  it('PI5 (Q4) 오프라인으로 처음 켜면(요청이 나가지도 못함) 로딩에 갇히지 않고 오류 카드로 알린다', async () => {
    // 준비 — 앞 케이스의 오프라인이 새지 않았다는 앵커.
    expect(onlineManager.isOnline()).toBe(true);
    onlineManager.setOnline(false);

    render(<PersonalizationPage />, { wrapper: createWrapper() });

    // 단언 — isError 도 errorUpdateCount 도 없는 pending+paused 라 오프라인 판정만이 잡는다.
    expect(await screen.findByTestId(ERROR)).toBeOnTheScreen();
    expect(screen.queryByTestId(TOGGLE)).toBeNull();
    expect(gets).toBe(0);
    expectNoConsentTraffic();
  });
});
