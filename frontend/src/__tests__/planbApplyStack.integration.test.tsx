import { useState, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  waitFor,
} from 'expo-router/testing-library';

import { server } from '@/mocks/server';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { liveItinerary, liveSlot } from '@/test-support/liveHubFixtures';
import PlanbDraftRoute from '@routes/trips/[tripId]/planb/draft';
import { newTestQueryClient } from '@/test-support/queryRender';

/**
 * TRIP-1418 (QA Q-106) · 재계획안 [적용하기] 뒤 허브가 스택에 **한 장**만 남는가.
 *
 * 왜 실물 라우터인가: 결함은 "어떤 함수를 불렀나"가 아니라 "그 결과 스택이 어떤 모양인가"다. 페이지 테스트
 * (`PlanbDraftPage.integration`)는 expo-router 를 목으로 바꿔 `dismissTo` 를 어떤 인자로 불렀는지까지만 본다 —
 * 그 파일엔 `jest.mock('expo-router')` 가 파일 전체에 걸려 있어 여기 둘 수 없다(`generatingEntryStack.integration` 선례).
 * 옛 `replace` 는 스택 밑의 원래 허브 위에 허브를 한 장 더 쌓아 `[홈, 허브, 허브]` 를 남겼다 — ‹ 를 두 번 눌러야 나간다.
 *
 * *(개념)* `renderRouter(경로표, { initialUrl })` — expo-router 가 주는 테스트용 앱. 진짜 라우터가 돌고,
 *   `getRouterState()` 가 스택을 그대로 돌려준다. `router.back()` 은 ‹·스와이프가 결국 보내는 "맨 위 한 장 빼기"다.
 *
 * 무엇이 실물이고 무엇이 대역인가:
 *  - 실물: 재계획안 라우트(`PlanbDraftRoute` → `PlanbDraftPage`, 가짜 서버 위). 고치는 대상이다. 뒤로 가로채기
 *    (`usePreventRemove`)도 실물이라 "적용 성공의 허브 복귀가 이탈 확인에 붙잡히지 않는가"(AC-3)도 함께 본다.
 *  - 대역: 허브(`HubProbe` — 누른 횟수를 세는 `useState` 하나. 같은 인스턴스로 돌아왔는지를 그 숫자로 본다),
 *    홈·진행 화면. 실물 허브의 로컬 상태 맞추기는 `LiveItineraryPage.integration` 「재사용 허브」가 본다.
 *  - 루트는 `SplashGate` 대신 맨 `<Stack />` — 앱에서도 허브·재계획 화면은 루트 Stack 의 형제라 스택 모양이 같다.
 *    요청 시트(투명 모달 push) → 진행(replace) → 재계획안(replace) 사슬은 "진행 push → 재계획안 replace"로 줄였다 —
 *    `dismissTo` 는 라우트 **이름**만 보므로 표현 방식은 결과를 바꾸지 않는다(02a ★12·★13).
 *
 * 3동작: 준비 = 홈 → 허브(누름 1) → 진행 → 재계획안까지 쌓은 앱 → 실행 = [적용하기] → 단언 = 루트 스택·허브 숫자·params.
 * 통합 버킷 이유: 실물 expo-router 는 node 버킷(`--experimental-vm-modules`)에서 로드가 실패한다.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const SESSION_ID = 's9';
// 오늘이 아닌 날을 다시 짠 세션 — 허브 params 에 day 가 실리는지도 함께 본다(TRIP-1195).
const TARGET_DAY = '2999-01-02';

const HOME = 'index';
const LIVE = 'trips/[tripId]/live/index';
const SOLVING = 'trips/[tripId]/planb/solving';
const DRAFT = 'trips/[tripId]/planb/draft';
const APPLY = 'sheet-cta-button-1';
const DRAFT_LEAVE = 'planb-draft-leave-confirm';

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

/** 허브 대역 — 누른 횟수를 기억한다. 원래 허브로 돌아오면 숫자가 남고, 새로 만들어지면 0 이다. */
function HubProbe() {
  const [count, setCount] = useState(0);
  return (
    <>
      <Text testID="hub-probe-count">{String(count)}</Text>
      <Pressable
        testID="hub-probe-bump"
        onPress={() => setCount((value) => value + 1)}
      />
    </>
  );
}

/** 앱 루트 — 쿼리 캐시를 한 번만 만들어 스택 전체가 공유한다(실물 재계획안이 조회 훅을 쓴다). */
function RootLayout(): ReactNode {
  const [client] = useState(() => newTestQueryClient({ gcTime: 0 }));
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const ROUTES = {
  _layout: RootLayout,
  [HOME]: stub('home-root'),
  [LIVE]: HubProbe,
  [SOLVING]: stub('solving-root'),
  [DRAFT]: PlanbDraftRoute,
};

type StackRoute = { name: string; params?: Record<string, unknown> };

let app: ReturnType<typeof renderRouter>;

/** 루트 Stack 의 화면들(아래→위). `getRouterState()` 맨 위는 expo-router 의 `__root` 포장이라 한 겹 내려간다. */
function rootStack(): StackRoute[] {
  const state = app.getRouterState() as
    { routes: { state?: { routes: StackRoute[] } }[] } | undefined;
  return state?.routes[0]?.state?.routes ?? [];
}

function rootNames(): string[] {
  return rootStack().map((route) => route.name);
}

// ── 가짜 서버(openapi ReplanSession · ReplanDiff · Itinerary) ─────────────────────────────────
function replanSession(status: string) {
  return {
    sessionId: SESSION_ID,
    tripId: TRIP_ID,
    itineraryId: 'it1',
    scope: 'PARTIAL_SLOTS',
    targetDate: TARGET_DAY,
    fromInstant: `${TARGET_DAY}T01:00:00Z`,
    originKind: 'GPS',
    originLat: 35.1587,
    originLng: 129.1604,
    originEstimated: false,
    status,
    createdAt: `${TARGET_DAY}T00:59:00Z`,
  };
}

const diffSlot = {
  slotKey: `${TARGET_DAY}#p1`,
  startAt: '10:00:00',
  endAt: '11:00:00',
  isFixed: false,
  endsNextDay: false,
  nameKo: '해운대 시장',
};

const READY_DIFF = {
  ready: true,
  status: 'DRAFT',
  date: TARGET_DAY,
  before: [diffSlot],
  after: [diffSlot],
  entries: [
    {
      slotKey: diffSlot.slotKey,
      change: 'UNCHANGED',
      beforeStart: '10:00:00',
      afterStart: '10:00:00',
    },
  ],
  impact: {
    visitCountDelta: 0,
    returnTimeDeltaMinutes: 0,
    totalDistanceDeltaM: null,
    totalDistanceKm: 1.2,
  },
};

/** 확정 POST 횟수 — 적용이 실제로 서버까지 갔는지의 앵커. */
let applyPosts = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  applyPosts = 0;
  resetPressGuard();
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId/replan-sessions/:sessionId`, () =>
      HttpResponse.json(replanSession('DRAFT'))
    ),
    http.get(`${BASE}/trips/:tripId/replan-sessions/:sessionId/diff`, () =>
      HttpResponse.json(READY_DIFF)
    ),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(
        liveItinerary(
          [
            {
              date: TARGET_DAY,
              slots: [liveSlot('p1', '해운대 시장', '10:00:00')],
            },
          ],
          TRIP_ID
        )
      )
    ),
    http.post(`${BASE}/trips/:tripId/replan-sessions/:sessionId/apply`, () => {
      applyPosts += 1;
      return HttpResponse.json(replanSession('APPLIED'));
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** 재계획안이 초안을 받아 [적용하기]가 풀릴 때까지 기다린다(실물은 세션·초안 조회가 끝나야 풀린다 — 02a ★15). */
async function waitForApplyEnabled(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(APPLY)).toBeEnabled());
}

/** 실행 — [적용하기]를 누르고, 확정 POST 가 끝나 재계획안이 스택에서 빠질 때까지 기다린다. */
async function applyAndLeaveDraft(): Promise<void> {
  fireEvent.press(screen.getByTestId(APPLY));
  await waitFor(() => expect(rootNames()).not.toContain(DRAFT));
}

describe('🔴 TRIP-1418 AC-1·AC-3·AC-11 (Q-106) — 허브에서 시작한 재계획을 적용하면 원래 허브 한 장으로 돌아간다', () => {
  it('S1 루트 스택은 [홈, 허브] 이고 허브는 같은 인스턴스(누른 숫자 유지) · params 는 새 적용 신호 · ‹ 한 번이면 홈이다', async () => {
    // 준비 — 홈 → 허브(한 번 눌러 둠) → 진행 → 재계획안.
    app = renderRouter(ROUTES, { initialUrl: '/' });
    act(() => {
      router.push({
        pathname: '/trips/[tripId]/live',
        params: { tripId: TRIP_ID },
      } as never);
    });
    fireEvent.press(screen.getByTestId('hub-probe-bump'));
    expect(screen.getByTestId('hub-probe-count')).toHaveTextContent('1');
    act(() => {
      router.push({
        pathname: '/trips/[tripId]/planb/solving',
        params: { tripId: TRIP_ID, sessionId: SESSION_ID },
      } as never);
    });
    act(() => {
      router.replace({
        pathname: '/trips/[tripId]/planb/draft',
        params: { tripId: TRIP_ID, sessionId: SESSION_ID },
      } as never);
    });
    await waitForApplyEnabled();
    // 앵커 — 적용 전 스택은 정말로 원래 허브를 품고 있다(아래 "한 장"이 공짜로 통과하지 않게).
    expect(rootNames()).toEqual([HOME, LIVE, DRAFT]);

    // 실행
    await applyAndLeaveDraft();

    // 단언 ① — 허브 한 장(옛 replace 면 [홈, 허브, 허브]).
    expect(applyPosts).toBe(1);
    expect(rootNames()).toEqual([HOME, LIVE]);
    // 단언 ② — 원래 허브 인스턴스로 돌아왔다(새로 만들어졌으면 0). 이탈 확인에 붙잡히지 않았다(AC-3).
    expect(screen.getByTestId('hub-probe-count')).toHaveTextContent('1');
    expect(screen.queryByTestId(DRAFT_LEAVE)).toBeNull();
    // 단언 ③ — params 는 통째로 새 적용 신호다(i08 신호 applied · 그 날 day).
    expect(rootStack()[1]?.params).toEqual({
      tripId: TRIP_ID,
      applied: SESSION_ID,
      day: TARGET_DAY,
    });

    // 실행 ② — ‹ 한 번.
    act(() => {
      router.back();
    });

    // 단언 ④ — 허브 이전 화면(홈). 같은 허브가 또 나오면 Q-106 재발이다.
    expect(rootNames()).toEqual([HOME]);
    expect(screen.getByTestId('home-root')).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1418 AC-10 — 스택에 허브가 없는 딥링크 착지면 지금 화면 자리에 허브가 선다 (선제 green)', () => {
  it('S3 재계획안에 바로 들어와 적용하면 루트 스택은 [허브] 한 장 · 새 허브(숫자 0) · 뒤로 갈 곳 없음', async () => {
    // 준비 — 알림·딥링크로 재계획안에 바로 착지(아래에 허브가 없다).
    app = renderRouter(ROUTES, {
      initialUrl: `/trips/${TRIP_ID}/planb/draft?sessionId=${SESSION_ID}`,
    });
    await waitForApplyEnabled();
    // 앵커 — 아래에 허브가 없다.
    expect(rootNames()).not.toContain(LIVE);

    // 실행
    await applyAndLeaveDraft();

    // 단언 — 재계획안 자리에 허브가 섰다. "없으면 위에 쌓기"면 재계획안이 아래 남아 뒤로가 재계획안으로 간다.
    expect(applyPosts).toBe(1);
    expect(rootNames()).toEqual([LIVE]);
    expect(screen.getByTestId('hub-probe-count')).toHaveTextContent('0');
    expect(rootStack()[0]?.params).toEqual({
      tripId: TRIP_ID,
      applied: SESSION_ID,
      day: TARGET_DAY,
    });
    expect(router.canGoBack()).toBe(false);
  });
});
