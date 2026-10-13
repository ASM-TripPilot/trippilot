import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, Tabs } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { server } from '@/mocks/server';
import { useTripWizardStore } from '@/features/create-trip';
import { clearAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import TripWizardLayout from '@routes/trips/new/_layout';
import TripWizardStep1Route from '@routes/trips/new/step1';

/**
 * TRIP-1272 (QA B-16) · 위저드 1/4 에서 iOS 가장자리 스와이프·Android 하드웨어 뒤로도 ‹ 와 같이 이탈 확인을 거친다.
 *
 * 증상: 2/4 에 다녀와 서버에 초안이 생긴 뒤(`createdTripId`) 1/4 에서 스와이프로 나가면 다이얼로그 없이 홈으로
 * 빠지고 초안이 고아로 남는다. ‹ 만 다이얼로그를 열었다.
 *
 * 왜 실물 라우터인가: 계약이 "어느 함수를 불렀나"가 아니라 "그 이동이 스택을 어떻게 바꾸나"다. 막힌 이동을 다시
 * 보내는 순간 같은 화면이 또 막히는지(무한 다이얼로그), 계정 경계 이동이 조용히 삼켜지는지는 라우터만 안다.
 * 페이지 통합 파일(`TripNewStep1Page.integration.test.tsx`)은 expo-router 를 파일 전체에서 목으로 바꿔 여기 둘 수
 * 없다 — 그래서 라우트 묶음 테스트로 둔다(`generatingEntryStack.integration` 선례).
 *
 * *(개념)* `renderRouter` — expo-router 가 주는 테스트용 앱. 경로 → 화면 표를 넘기면 진짜 라우터가 돈다.
 *   스와이프·하드웨어 뒤로가 보내는 액션은 각각 `router.dismiss()`(POP)·`router.back()`(GO_BACK)으로 흉내 낸다.
 *   실제 손가락 제스처는 jest 가 못 본다(6-b).
 *
 * 무엇이 실물이고 무엇이 대역인가:
 *  - 실물: 위저드 셸(`app/trips/new/_layout`)·1/4 라우트(→ `TripNewStep1Page`, 가짜 서버 위). 고치는 대상이 이것이다.
 *  - 대역: 홈 탭·2/4·로그인. 2/4 는 "다녀왔다"는 사실만 필요하다 — `createdTripId` 는 셸이 마운트된 뒤 스토어에
 *    직접 심는다(셸은 마운트 때 그 값을 비우므로 순서가 중요하다, 02a ★3).
 *
 * 3동작 뼈대: 준비 = 홈 → 1/4(→ 2/4 → 1/4)를 쌓고 초안 id 를 심는다 → 실행 = 뒤로 계열/다이얼로그 버튼 →
 * 단언 = 다이얼로그 유무·도착 경로·루트 스택·DELETE 횟수.
 *
 * 통합 버킷 이유: 실물 expo-router 는 node 버킷(`--experimental-vm-modules`)에서 로드가 실패한다.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(MustVisitListPage 선례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const STEP1 = '/trips/new/step1';
const STEP2 = '/trips/new/step2';
const DELETE_TRIP = `DELETE /api/v1/trips/${TRIP_ID}`;

const DIALOG = 'trip-wizard-leave-dialog';
const HEADER_BACK = 'trip-wizard-step1-back';

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

/** 앱 루트 — 쿼리 캐시를 한 번만 만들어 스택 전체가 공유한다(실물 페이지·이탈 다이얼로그가 쿼리 클라이언트를 쓴다). */
function RootLayout(): ReactNode {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 0 },
          mutations: { retry: false, gcTime: 0 },
        },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const ROUTES = {
  _layout: RootLayout,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/index': stub('home-root'),
  '(auth)/login': stub('login-root'),
  'trips/new/_layout': TripWizardLayout,
  'trips/new/step1': TripWizardStep1Route,
  'trips/new/step2': stub('step2-root'),
  'trips/[tripId]/itinerary/method': stub('method-root'),
  'trips/[tripId]/itinerary/generating': stub('generating-root'),
};

/** 지금 그려진 테스트 앱 — 경로·스택 조회는 `screen` 이 아니라 `renderRouter` 결과가 준다. */
let app: ReturnType<typeof renderRouter>;
let observedHits: string[] = [];

const hits = (line: string): number =>
  observedHits.filter((hit) => hit === line).length;

/** 루트 Stack 의 화면 이름들(아래→위). `getRouterState()` 맨 위는 expo-router 의 `__root` 포장이라 한 겹 내려간다. */
function rootNames(): string[] {
  const state = app.getRouterState() as
    { routes: { state?: { routes: { name: string }[] } }[] } | undefined;
  return (state?.routes[0]?.state?.routes ?? []).map((route) => route.name);
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  resetPressGuard();
  // 게스트로 돈다 — 담은 목록 조회(`enabled: isAuthed`)가 안 나가 `/saved-places` 핸들러가 필요 없다.
  clearAccessToken();
  server.use(
    http.delete(
      `${BASE}/trips/:tripId`,
      () => new HttpResponse(null, { status: 204 })
    )
  );
});

// 모듈 싱글턴(위저드 스토어·누름 가드)은 파일 최상위에서 되돌린다 — describe 안에만 걸면 앞 테스트의 초안 id 가 샌다.
afterEach(() => {
  server.resetHandlers();
  useTripWizardStore.getState().reset();
  resetPressGuard();
});

afterAll(() => {
  server.events.removeAllListeners('request:start');
  server.close();
});

/**
 * 요청이 출발·도착할 시간을 준다. `renderRouter` 는 jest 가짜 시계를 켠다 — 진짜 `setTimeout` 을 기다리면 영원히
 * 안 깬다(02a ★2 실측: 5초 타임아웃). 그래서 가짜 시계를 비동기로 밀어 약속(Promise)까지 함께 흘려보낸다.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });
}

/** 사람이 따로 누른 탭 — 400ms 누름 가드 창을 닫고 누른다. */
function tap(testID: string): void {
  resetPressGuard();
  fireEvent.press(screen.getByTestId(testID));
}

/**
 * 준비 — 홈에서 위저드 1/4 를 열고, 2/4 에 다녀온 뒤 1/4 로 돌아온 앱(B-16 재현 절차).
 * `withDraft` 가 참이면 셸이 마운트된 뒤 서버 초안 id 를 심는다(=2/4 로 넘어가며 POST 가 성공한 상태).
 */
async function openStep1({ withDraft }: { withDraft: boolean }) {
  app = renderRouter(ROUTES, { initialUrl: '/' });
  act(() => {
    router.push(STEP1);
  });
  await screen.findByTestId('trip-wizard-step1-root');
  if (withDraft) {
    act(() => {
      useTripWizardStore.getState().addDestination('부산', 3);
      useTripWizardStore.getState().setCreatedTripId(TRIP_ID);
    });
  }
  act(() => {
    router.push(STEP2);
  });
  await screen.findByTestId('step2-root');
  act(() => {
    router.back();
  });
  await screen.findByTestId('trip-wizard-step1-root');
  await settle();
  // 앵커 — 지금 1/4 에 있고, 루트엔 홈 탭 위에 위저드 한 장이 쌓여 있다(아래 단언이 공짜로 통과하지 않게).
  expect(app.getPathname()).toBe(STEP1);
  expect(rootNames()).toEqual(['(tabs)', 'trips/new']);
  expect(useTripWizardStore.getState().createdTripId).toBe(
    withDraft ? TRIP_ID : undefined
  );
  expect(screen.queryByTestId(DIALOG)).toBeNull();
}

type Gesture = 'swipe' | 'hardware';

/** 스와이프 = POP(`router.dismiss`) · 하드웨어 뒤로 = GO_BACK(`router.back`). */
function goBackBy(gesture: Gesture): void {
  act(() => {
    if (gesture === 'swipe') router.dismiss();
    else router.back();
  });
}

const GESTURES: [string, Gesture][] = [
  ['iOS 가장자리 스와이프(POP)', 'swipe'],
  ['Android 하드웨어 뒤로(GO_BACK)', 'hardware'],
];

/** 위저드를 빠져나와 홈 탭에 닿았다 — 위저드가 스택에 남지 않는다. */
function expectLandedHome(): void {
  expect(app.getPathname()).toBe('/');
  expect(rootNames()).toEqual(['(tabs)']);
  // 가려진 화면은 기본 쿼리에 안 잡힌다 — 잡히면 지금 보이는 화면이다.
  expect(screen.getByTestId('home-root')).toBeOnTheScreen();
}

/** 1/4 에 그대로 머물러 있다. */
function expectStillOnStep1(): void {
  expect(app.getPathname()).toBe(STEP1);
  expect(rootNames()).toEqual(['(tabs)', 'trips/new']);
  expect(screen.getByTestId('trip-wizard-step1-root')).toBeOnTheScreen();
}

describe('🟢 RT-0 · AC-4 · 서버 초안이 없으면 스와이프·하드웨어 뒤로는 지금처럼 바로 나간다 (결정 1=B, 선제 green)', () => {
  it.each(GESTURES)(
    '%s → 다이얼로그 없이 홈, DELETE 0',
    async (_label, gesture) => {
      // 준비
      await openStep1({ withDraft: false });

      // 실행
      goBackBy(gesture);
      await settle();

      // 단언 — 이 픽스처가 "이탈"을 볼 수 있다는 기준점이기도 하다(초안이 있을 때 이 모양이면 B-16 버그다).
      expectLandedHome();
      expect(screen.queryByTestId(DIALOG)).toBeNull();
      expect(hits(DELETE_TRIP)).toBe(0);
    }
  );
});

describe('🔴 AC-1 · AC-5 · 서버 초안이 있으면 스와이프·하드웨어 뒤로도 이탈 다이얼로그가 뜨고 나가지 않는다', () => {
  it.each(GESTURES)(
    '%s → 1/4 에 머물고 다이얼로그가 뜬다, 이동·DELETE 0',
    async (_label, gesture) => {
      // 준비
      await openStep1({ withDraft: true });

      // 실행
      goBackBy(gesture);
      await settle();

      // 단언 — 고아 초안을 남기며 홈으로 빠지지 않는다(B-16).
      expectStillOnStep1();
      expect(screen.getByTestId(DIALOG)).toBeOnTheScreen();
      expect(hits(DELETE_TRIP)).toBe(0);
      expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
    }
  );
});

describe('🔴 AC-2 · 스와이프로 연 다이얼로그에서 [계속 작성]은 위저드에 머물고, 다음 스와이프도 다시 묻는다', () => {
  it('[계속 작성] → 다이얼로그가 닫히고 1/4·입력·초안 id 그대로, 한 번 더 스와이프하면 또 뜬다', async () => {
    // 준비
    await openStep1({ withDraft: true });
    goBackBy('swipe');
    expect(screen.getByTestId(DIALOG)).toBeOnTheScreen();

    // 실행 ①
    tap('trip-wizard-leave-stay');
    await settle();

    // 단언 ①
    expect(screen.queryByTestId(DIALOG)).toBeNull();
    expectStillOnStep1();
    expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
    expect(useTripWizardStore.getState().destinations).toHaveLength(1);

    // 실행 ② · 단언 ② — 가로채기가 한 번 쓰고 꺼지지 않았다.
    goBackBy('swipe');
    await settle();
    expectStillOnStep1();
    expect(screen.getByTestId(DIALOG)).toBeOnTheScreen();
  });
});

describe('🔴 AC-6 · 스와이프·하드웨어 뒤로로 연 다이얼로그에서 [저장하고 나가기]는 한 번에 나간다 (무한 다이얼로그 금지)', () => {
  it.each(GESTURES)(
    '%s → [저장하고 나가기] → 홈, 다이얼로그 없음, 초안 id 유지·DELETE 0',
    async (_label, gesture) => {
      // 준비
      await openStep1({ withDraft: true });
      goBackBy(gesture);
      expect(screen.getByTestId(DIALOG)).toBeOnTheScreen();

      // 실행 — 나가는 이동이 다시 가로채지면 여기서 1/4 에 갇히거나 React 가 "Maximum update depth" 로 던진다.
      tap('trip-wizard-leave-save');
      await settle();

      // 단언 — 저장은 요청 없이 나가고 초안 id 를 지우지 않는다(이어 짜기 재료).
      expectLandedHome();
      expect(screen.queryByTestId(DIALOG)).toBeNull();
      expect(hits(DELETE_TRIP)).toBe(0);
      expect(useTripWizardStore.getState().createdTripId).toBe(TRIP_ID);
    }
  );
});

describe('🔴 AC-3 · AC-6 · 스와이프로 연 다이얼로그에서 [삭제하고 나가기]는 초안을 지우고 한 번에 나간다', () => {
  it('[삭제하고 나가기] → DELETE 1회 → 홈, createdTripId 가 빈다', async () => {
    // 준비
    await openStep1({ withDraft: true });
    goBackBy('swipe');
    expect(screen.getByTestId(DIALOG)).toBeOnTheScreen();

    // 실행
    tap('trip-wizard-leave-delete');
    await settle();

    // 단언
    expect(hits(DELETE_TRIP)).toBe(1);
    expectLandedHome();
    expect(useTripWizardStore.getState().createdTripId).toBeUndefined();
  });
});

describe('🟢 AC-6 · ‹ 로 연 다이얼로그의 나가기도 가로채기에 다시 걸리지 않는다 (선제 green — 가로채기 추가 뒤 루프 감시)', () => {
  // ‹ 경로의 나가기는 새 `router.back()` 을 만든다 — 가로채기가 그것을 또 막으면 다이얼로그에 갇힌다.
  it.each<[string, string, number]>([
    ['[저장하고 나가기]', 'trip-wizard-leave-save', 0],
    ['[삭제하고 나가기]', 'trip-wizard-leave-delete', 1],
  ])(
    '‹ → %s(%s) → 홈, DELETE %i회',
    async (_label, buttonTestID, expectedDeletes) => {
      // 준비
      await openStep1({ withDraft: true });
      tap(HEADER_BACK);
      expect(screen.getByTestId(DIALOG)).toBeOnTheScreen();

      // 실행
      tap(buttonTestID);
      await settle();

      // 단언
      expectLandedHome();
      expect(screen.queryByTestId(DIALOG)).toBeNull();
      expect(hits(DELETE_TRIP)).toBe(expectedDeletes);
    }
  );
});

describe('🟢 AC-6 · 뒤로가 아닌 이동은 가로채지 않는다 (선제 green)', () => {
  it('계정 경계(dismissAll → replace(/login))는 다이얼로그 없이 로그인으로 간다', async () => {
    // 준비
    await openStep1({ withDraft: true });

    // 실행 ① — `useAccountBoundaryReset` 의 첫 줄(POP_TO_TOP).
    act(() => {
      router.dismissAll();
    });
    await settle();

    // 단언 ① — POP_TO_TOP 을 뒤로 계열로 잘못 분류하면 여기서 위저드가 남고 다이얼로그가 뜬다. 다음 줄의 replace 가
    // 위저드를 덮어 버려 끝 모습만 보면 그 오분류가 가려진다(02a ★7 — 뮤테이션 생존 실측).
    expect(rootNames()).toEqual(['(tabs)']);
    expect(screen.queryByTestId(DIALOG)).toBeNull();

    // 실행 ② — 둘째 줄.
    act(() => {
      router.replace('/login');
    });
    await settle();

    // 단언 ②
    expect(app.getPathname()).toBe('/login');
    expect(screen.getByTestId('login-root')).toBeOnTheScreen();
    expect(screen.queryByTestId(DIALOG)).toBeNull();
    expect(hits(DELETE_TRIP)).toBe(0);
  });

  it('탭 이동(dismissTo(/(tabs)))은 다이얼로그 없이 홈에 닿는다', async () => {
    // 준비
    await openStep1({ withDraft: true });

    // 실행 — 자체 탭바·생성 완료 화면들이 쓰는 이동(TRIP-1262).
    act(() => {
      router.dismissTo('/(tabs)');
    });
    await settle();

    // 단언
    expectLandedHome();
    expect(screen.queryByTestId(DIALOG)).toBeNull();
  });

  it('2/4 로 나아가는 push 는 그대로 쌓인다', async () => {
    // 준비
    await openStep1({ withDraft: true });

    // 실행
    act(() => {
      router.push(STEP2);
    });

    // 단언
    expect(await screen.findByTestId('step2-root')).toBeOnTheScreen();
    expect(app.getPathname()).toBe(STEP2);
    expect(screen.queryByTestId(DIALOG)).toBeNull();
  });
});

describe('🟢 AC-6 · 위저드를 지나 나아간 뒤에도 — 스택 아래 깔린 1/4 가 위저드 종료 이동을 막지 않는다 (선제 green)', () => {
  /**
   * 2/4 는 끝나면 `back()` 뒤 방식 선택(3/4)을 push 한다 — 그래서 1/4 는 초안 id 를 든 채 3/4 아래 깔려 남는다.
   * 생성으로 넘어갈 때(`MustVisitListPage.goToGenerating` · `TripBasesPage.regenerate`)는 `dismissTo('/(tabs)')` →
   * push(생성)이다(TRIP-1263). 그 `dismissTo` 가 1/4 를 걷어내는 순간 1/4 의 가로채기가 불린다 — 통과시키지 못하면
   * 사용자는 생성으로 못 가고 3/4 에 갇힌다(02a ★5 — 화면 navigation 으로 재전송하면 조용히 사라진다, 실측).
   */
  async function openMethodOverStep1(): Promise<void> {
    await openStep1({ withDraft: true });
    act(() => {
      router.push({
        pathname: '/trips/[tripId]/itinerary/method',
        params: { tripId: TRIP_ID },
      } as never);
    });
    await screen.findByTestId('method-root');
    // 앵커 — 1/4(위저드 한 장)가 3/4 아래 깔려 있다.
    expect(rootNames()).toEqual([
      '(tabs)',
      'trips/new',
      'trips/[tripId]/itinerary/method',
    ]);
  }

  it('3/4 에서 dismissTo(/(tabs)) → push(생성) 하면 생성 화면이 뜨고, 루트는 (tabs) 위에 생성 한 장이다', async () => {
    // 준비
    await openMethodOverStep1();

    // 실행 — 생성 진입 정리와 같은 두 줄.
    act(() => {
      router.dismissTo('/(tabs)');
      router.push({
        pathname: '/trips/[tripId]/itinerary/generating',
        params: { tripId: TRIP_ID },
      } as never);
    });
    await settle();

    // 단언
    expect(rootNames()).toEqual([
      '(tabs)',
      'trips/[tripId]/itinerary/generating',
    ]);
    expect(screen.getByTestId('generating-root')).toBeOnTheScreen();
    expect(screen.queryByTestId(DIALOG)).toBeNull();
  });

  it('3/4 에서 하드웨어 뒤로는 1/4 로 한 칸 돌아올 뿐 다이얼로그를 띄우지 않는다', async () => {
    // 준비
    await openMethodOverStep1();

    // 실행 — 이 뒤로가 빼는 것은 3/4 한 장이다(1/4 는 안 빠진다).
    act(() => {
      router.back();
    });
    await settle();

    // 단언
    expectStillOnStep1();
    expect(screen.queryByTestId(DIALOG)).toBeNull();
  });
});

describe('🔴 D1 · iOS 스와이프를 네이티브에서 취소하는 신호가 위저드 화면에 실린다 (raw beforeRemove 기각)', () => {
  /**
   * 1/4 요소에서 조상으로 올라가며 만나는 화면(RNSScreen)들의 `preventNativeDismiss` 값 — 안쪽(위저드 스택의 1/4)부터
   * 바깥(루트 스택의 위저드 한 장)까지. iOS 가장자리 스와이프는 바깥 화면을 끌어내리므로 둘 다 봐야 한다(02a ★6).
   */
  function preventNativeDismissChain(testID: string): unknown[] {
    const values: unknown[] = [];
    let node: { props: Record<string, unknown>; parent: unknown } | null =
      screen.getByTestId(testID, { includeHiddenElements: true });
    while (node !== null) {
      if ('preventNativeDismiss' in node.props) {
        values.push(node.props.preventNativeDismiss);
      }
      node = node.parent as typeof node;
    }
    return values;
  }

  it('초안이 있으면 1/4 를 감싼 화면이 안쪽·바깥 모두 preventNativeDismiss=true', async () => {
    // 준비 · 실행 — 쌓기만 한다.
    await openStep1({ withDraft: true });

    // 단언 — 화면 두 겹(위저드 스택 1/4 · 루트 스택 위저드)을 모두 만났고, 모두 막는다.
    const chain = preventNativeDismissChain('trip-wizard-step1-root');
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain).toEqual(chain.map(() => true));
  });

  it('초안이 없으면 어느 겹도 막지 않는다 (결정 1=B — 스와이프로 바로 나간다)', async () => {
    // 준비 · 실행
    await openStep1({ withDraft: false });

    // 단언 — 짝: 탐지기가 아무 화면에나 true 를 돌려주는 게 아니다.
    const chain = preventNativeDismissChain('trip-wizard-step1-root');
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain.filter((value) => value === true)).toEqual([]);
  });
});
