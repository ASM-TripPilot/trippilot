import { useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, Tabs } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { server } from '@/mocks/server';
import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import { useTripWizardStore } from '@/features/create-trip';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { resetPressGuard } from '@/shared/lib/pressGuard';
import { API_BASE, settingsHandlers } from '@/test-support/settingsHandlers';
import { TRIP, TRIP_ID } from '@/test-support/mustVisitFixtures';
import { newTestQueryClient } from '@/test-support/queryRender';
import SettingsRoute from '@routes/settings/index';
import SettingsPersonalizationRoute from '@routes/settings/personalization';
import SavedStaysRoute from '@routes/stays/saved';
import PlaceDetailRoute from '@routes/explore/places/[poiId]';
import TripWizardLayout from '@routes/trips/new/_layout';
import TripWizardStep1Route from '@routes/trips/new/step1';
import TripWizardStep2Route from '@routes/trips/new/step2';
import ItineraryMethodRoute from '@routes/trips/[tripId]/itinerary/method';
import LivePlaceRoute from '@routes/trips/[tripId]/live/place/[poiId]';
import ShareCardRoute from '@routes/trips/[tripId]/records/share';
import TermsViewerRoute from '@routes/terms/[termsType]';

/**
 * TRIP-1685 · 공용 뒤로 헬퍼 `goBackOr` — "돌아갈 화면이 없으면 폴백으로, 있으면 한 장 뒤로"를 실물 라우터로 지킨다.
 *
 * 증상(FM-L6-01): 딥링크·새로고침으로 화면 하나만 열린 채(스택 1장) ‹ 를 누르면 아무 일도 안 일어났다.
 * 고친 뒤에는 ① 스택이 1장이면 그 화면의 폴백 경로로 갈아 끼우고(`replace`) ② 스택이 있으면 지금처럼 직전 화면으로 간다.
 *
 * 왜 실물 라우터인가: 계약이 "어떤 함수를 불렀나"가 아니라 "누른 뒤 어느 화면에 닿았나"다. 라우터 목은 호출 순서까지만 보고
 * (README §테스트 전략 판정 5), 스택이 1장일 때의 `canGoBack()===false` 는 실물 라우터만 만든다. 그래서 라우트 묶음 테스트로
 * 따로 둔다(`generatingEntryStack.integration` 선례 — 라우터 목 파일엔 `jest.mock('expo-router')` 가 걸려 있어 여기 둘 수 없다).
 *
 * *(개념)* `renderRouter(경로표, { initialUrl })` — expo-router 가 주는 테스트용 앱. `initialUrl` 하나만 스택에 올리고 시작하므로
 *   "딥링크 콜드 진입·웹 새로고침"(스택 1장)과 같은 상태다. 부모 화면에서 `router.push` 로 쌓으면 "스택 있음"이 된다.
 *
 * 무엇이 실물이고 무엇이 대역인가:
 *  - 실물: 폴백을 바꾸는 페이지들(설정·개인화·저장 숙소·장소 상세·위저드 1/4·2/4·방식 선택·여행 중 장소·공유 카드·약관 보기).
 *    가짜 서버(MSW) 위에서 돈다.
 *  - 대역: 폴백 도착 화면(홈·탐색·마이·일정 목록·허브·기록 목록·로그인 등) — 어디에 닿았는지만 글자로 보이는 스텁.
 *  - 루트는 `SplashGate` 대신 맨 `<Stack />` — 부팅 가드는 이 칸의 관심사가 아니다. 약관 폴백이 보는 "게이트 목적지"는
 *    `publishGateDestination` 으로 직접 정한다.
 *
 * 3동작: 준비 = 콜드(initialUrl 하나) 또는 웜(부모에서 push) 앱 → 실행 = 화면 ‹ 누름 → 단언 = 닿은 경로·루트 스택.
 *
 * 통합 버킷 이유: 실물 expo-router 는 node 버킷(`--experimental-vm-modules`)에서 로드가 실패한다.
 * 실기에서만 보이는 것(웹 새로고침 자체·네이티브 딥링크 콜드 스타트·투명 모달이 실제로 닫히는지)은 jest 밖(6-b).
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));

const T = TRIP_ID;

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

/** 앱 루트 — 쿼리 캐시를 한 번만 만들어 스택 전체가 공유한다(실물 페이지가 조회 훅을 쓴다). */
function RootLayout(): ReactNode {
  const [client] = useState(() => newTestQueryClient({ gcTime: 0 }));
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

/** 폴백 도착 화면 대역들 + 실물 라우트 묶음. `over` 로 한 라우트만 스텁으로 바꾼다(예: 설정 루트). */
function routes(over: Record<string, () => ReactNode> = {}) {
  return {
    _layout: RootLayout,
    '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
    '(tabs)/index': stub('home-root'),
    '(tabs)/explore': stub('explore-root'),
    '(tabs)/my': stub('my-root'),
    '(tabs)/itinerary': stub('itinerary-tab-root'),
    '(auth)/login': stub('login-root'),
    '(onboarding)/terms': stub('onboarding-terms-root'),
    reconsent: stub('reconsent-root'),
    'force-update': stub('force-update-root'),
    'settings/index': SettingsRoute,
    'settings/personalization': SettingsPersonalizationRoute,
    'stays/saved': SavedStaysRoute,
    'explore/places/[poiId]': PlaceDetailRoute,
    'trips/new/_layout': TripWizardLayout,
    'trips/new/step1': TripWizardStep1Route,
    'trips/new/step2': TripWizardStep2Route,
    'trips/[tripId]/itinerary/index': stub('trip-itinerary-root'),
    'trips/[tripId]/itinerary/method': ItineraryMethodRoute,
    'trips/[tripId]/live/index': stub('live-hub-root'),
    'trips/[tripId]/live/place/[poiId]': LivePlaceRoute,
    'trips/[tripId]/records/index': stub('records-list-root'),
    'trips/[tripId]/records/share': ShareCardRoute,
    'terms/[termsType]': TermsViewerRoute,
    ...over,
  };
}

/** 지금 그려진 테스트 앱 — 경로·스택 조회는 `screen` 이 아니라 `renderRouter` 결과가 준다. */
let app: ReturnType<typeof renderRouter>;

type StackRoute = { name: string };

/** 루트 Stack 의 화면 이름들(아래→위). `getRouterState()` 맨 위는 expo-router 의 `__root` 포장이라 한 겹 내려간다. */
function rootNames(): string[] {
  const state = app.getRouterState() as
    { routes: { state?: { routes: StackRoute[] } }[] } | undefined;
  return (state?.routes[0]?.state?.routes ?? []).map((route) => route.name);
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  resetPressGuard();
  resetGateDestination();
  setAccessToken('valid-access');
  server.use(
    ...settingsHandlers(),
    http.get(`${API_BASE}/saved-stays`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/saved-places`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/places/:poiId`, () =>
      HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    ),
    http.get(`${API_BASE}/trips/:tripId`, () => HttpResponse.json(TRIP)),
    http.get(`${API_BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    ),
    http.get(`${API_BASE}/trips/:tripId/summary`, () =>
      HttpResponse.json({ ready: false })
    ),
    http.get(`${API_BASE}/terms/:termsType`, () =>
      HttpResponse.json({
        termsType: 'SERVICE',
        version: 'v1',
        body: '약관 본문',
        effectiveAt: '2026-01-01',
        reconsentRequired: false,
      })
    )
  );
});

// 모듈 싱글턴(위저드 스토어·누름 가드·게이트 목적지)은 파일 최상위에서 되돌린다 — describe 안에만 걸면 앞 테스트 값이 샌다.
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  useTripWizardStore.getState().reset();
  resetPressGuard();
  resetGateDestination();
});

afterAll(() => server.close());

/** 콜드 진입(스택 1장) — 딥링크 콜드 스타트·웹 새로고침과 같은 상태. */
function openCold(url: string, over?: Record<string, () => ReactNode>) {
  app = renderRouter(routes(over), { initialUrl: url });
}

/** 웜 진입(스택 있음) — 부모 화면에서 `router.push` 로 대상 화면을 쌓는다. */
function openWarm(
  parent: string,
  href: string,
  over?: Record<string, () => ReactNode>
) {
  app = renderRouter(routes(over), { initialUrl: parent });
  act(() => {
    router.push(href as never);
  });
}

/** ‹ 를 사람이 따로 누른 탭처럼 누른다(누름 가드 창을 닫고). */
function tap(testID: string): void {
  resetPressGuard();
  fireEvent.press(screen.getByTestId(testID));
}

const TAB_HOME = '/';

/**
 * 대표 화면 표 — 브리프 §11 커밋 7묶음마다 최소 1화면. `cold` 는 콜드 진입 URL, `back` 은 ‹ testID(얼굴이 뜬 뒤),
 * `fallback` 은 승인된 폴백 경로, `parent`/`push` 는 웜 진입(스택 있음) 모양.
 */
const ROWS = [
  {
    label: '① 설정 루트 — FM-L6-01 (D1: 마이 탭)',
    cold: '/settings',
    face: 'settings-back',
    back: 'settings-back',
    fallback: '/my',
    landed: 'my-root',
    parent: '/my',
    over: undefined,
  },
  {
    label: '① 설정 하위(개인화)',
    cold: '/settings/personalization',
    face: 'settings-personalization-back',
    back: 'settings-personalization-back',
    fallback: '/settings',
    landed: 'settings-stub-root',
    parent: '/settings',
    over: { 'settings/index': stub('settings-stub-root') },
  },
  {
    label: '② 숙소(저장한 숙소)',
    cold: '/stays/saved',
    face: 'saved-stay-back',
    back: 'saved-stay-back',
    fallback: '/explore',
    landed: 'explore-root',
    parent: '/explore',
    over: undefined,
  },
  {
    label: '③ 탐색 장소 상세 ✱ 홈 → 탐색 탭',
    cold: '/explore/places/poi-1',
    face: 'explore-place-notfound-back',
    back: 'explore-place-notfound-back',
    fallback: '/explore',
    landed: 'explore-root',
    parent: '/explore',
    over: undefined,
  },
  {
    label: '⑤ 여행 안 일정(방식 선택)',
    cold: `/trips/${T}/itinerary/method`,
    face: 'itinerary-method-back',
    back: 'itinerary-method-back',
    fallback: `/trips/${T}/itinerary`,
    landed: 'trip-itinerary-root',
    parent: `/trips/${T}/itinerary`,
    over: undefined,
  },
  {
    label: '⑥ 여행 중 장소(허브로)',
    cold: `/trips/${T}/live/place/poi-1`,
    face: 'execution-place-notfound-back',
    back: 'execution-place-notfound-back',
    fallback: `/trips/${T}/live`,
    landed: 'live-hub-root',
    parent: `/trips/${T}/live`,
    over: undefined,
  },
  {
    label: '⑦ 기록 공유 카드 ✱ 폴백 신설',
    cold: `/trips/${T}/records/share`,
    face: 'reflection-share-not-ready-back',
    back: 'reflection-share-not-ready-back',
    fallback: `/trips/${T}/records`,
    landed: 'records-list-root',
    parent: `/trips/${T}/records`,
    over: undefined,
  },
] as const;

describe('🔴 AC1·AC2 · 콜드 진입(스택 1장) — ‹ 는 폴백으로 갈아 끼우고 화면에 갇히지 않는다', () => {
  it.each(ROWS)('$label', async (row) => {
    // 준비 — 이 화면 하나만 스택에 올린다. 얼굴이 뜰 때까지 기다린다(로딩 중엔 ‹ 가 없는 화면이 있다).
    openCold(row.cold, row.over as never);
    await screen.findByTestId(row.face);
    // 앵커 — 정말 스택이 1장이다(이게 아니면 아래 단언이 "스택 있음" 경로로 공짜 통과한다).
    expect(router.canGoBack()).toBe(false);

    // 실행
    tap(row.back);

    // 단언 — 폴백 경로에 닿았고, 그 화면이 보인다.
    expect(app.getPathname()).toBe(row.fallback);
    expect(await screen.findByTestId(row.landed)).toBeOnTheScreen();
  });
});

describe('AC3 · 스택이 있으면 지금처럼 직전 화면으로 한 장 뒤로 (무회귀)', () => {
  it.each(ROWS)('$label', async (row) => {
    // 준비 — 부모 화면에서 이 화면을 push 해 쌓는다.
    openWarm(row.parent, row.cold, row.over as never);
    await screen.findByTestId(row.face);
    const before = rootNames();
    expect(router.canGoBack()).toBe(true);

    // 실행
    tap(row.back);

    // 단언 — 부모로 돌아왔고(폴백이 아니라 직전 화면), 루트 스택이 정확히 한 장 줄었다.
    expect(app.getPathname()).toBe(row.parent);
    expect(rootNames()).toHaveLength(before.length - 1);
  });
});

describe('🔴 ④ 위저드 — 1/4 ‹ (여행을 안 만들었으면 바로 나간다)', () => {
  it('콜드 진입이면 홈(/(tabs))으로 갈아 끼운다', async () => {
    // 준비 — 위저드 1/4 하나만 스택에 올린다(저장된 초안 없음 = 이탈 확인 다이얼로그 없이 바로 나가는 경우).
    openCold('/trips/new/step1');
    await screen.findByTestId('trip-wizard-step1-root');
    expect(router.canGoBack()).toBe(false);

    // 실행
    tap('trip-wizard-step1-back');

    // 단언
    expect(app.getPathname()).toBe(TAB_HOME);
    expect(await screen.findByTestId('home-root')).toBeOnTheScreen();
  });
});

describe('AC7 · D6 위저드 2/4 → 방식 선택(h04): 스택 있음·없음 모두 최종 화면이 방식 선택이다', () => {
  const METHOD = `/trips/${T}/itinerary/method`;
  const BASES_CTA = 'trip-base-generate';

  /** 2/4 를 "여행이 만들어진 뒤" 상태로 연다 — 셸이 마운트된 뒤 스토어에 심는다(셸은 마운트 때 `createdTripId` 를 비운다). */
  async function readyStep2(): Promise<void> {
    await screen.findByTestId('trip-base-step2-root');
    act(() => {
      const store = useTripWizardStore.getState();
      store.setPeriod(undefined, '2026-09-01', '2026-09-03');
      store.addDestination('부산', 2);
      store.setCreatedTripId(T);
    });
    await screen.findByTestId(BASES_CTA);
  }

  it.each([
    ['콜드(스택 없음)', 'cold'],
    ['웜(스택 있음)', 'warm'],
  ] as const)('%s', async (_label, mode) => {
    // 준비
    const over = { 'trips/[tripId]/itinerary/method': stub('method-root') };
    if (mode === 'cold') {
      openCold('/trips/new/step2', over);
    } else {
      app = renderRouter(routes(over), { initialUrl: '/' });
      act(() => {
        router.push('/trips/new/step1');
      });
      await screen.findByTestId('trip-wizard-step1-root');
      act(() => {
        router.push('/trips/new/step2');
      });
    }
    await readyStep2();

    // 실행 — 두 출구 CTA 중 하나(`back` 다음 `push(method)` 순서가 계약이다).
    tap(BASES_CTA);

    // 단언 — 최종 화면이 방식 선택(h04)이고, 직후에도 그대로다(뒤로 간 쪽이 방금 쌓은 h04 를 치우지 않았다).
    expect(await screen.findByTestId('method-root')).toBeOnTheScreen();
    expect(app.getPathname()).toBe(METHOD);
    expect(rootNames().at(-1)).toBe('trips/[tripId]/itinerary/method');
    // 콜드는 [홈, 방식 선택] — 위저드 셸은 걷히고 아래에 홈이 깔린다(옛: [위저드, 방식 선택]).
    if (mode === 'cold') {
      expect(rootNames()).toEqual([
        '(tabs)',
        'trips/[tripId]/itinerary/method',
      ]);
    }
  });
});

describe('🔴 AC5 · 약관 보기 — 누른 시점의 게이트 목적지로 폴백이 정해진다', () => {
  const TERMS = '/terms/SERVICE';

  it.each([
    ['HOME', '/settings', 'settings-stub-root'],
    ['ONBOARDING', '/terms', 'onboarding-terms-root'],
    ['RECONSENT', '/reconsent', 'reconsent-root'],
    ['LOGIN', '/login', 'login-root'],
  ] as const)('콜드 진입 · 게이트 %s → %s', async (dest, path, landed) => {
    // 준비 — 약관 하나만 스택에 올리고, 게이트가 그 목적지에 있다고 알린다.
    publishGateDestination(dest);
    openCold(TERMS, { 'settings/index': stub('settings-stub-root') });
    await screen.findByTestId('terms-viewer-back');
    expect(router.canGoBack()).toBe(false);

    // 실행
    tap('terms-viewer-back');

    // 단언
    expect(app.getPathname()).toBe(path);
    expect(await screen.findByTestId(landed)).toBeOnTheScreen();
  });

  it('렌더한 뒤 목적지가 바뀌면 누른 시점 값으로 간다 (렌더 때 굳히지 않는다)', async () => {
    // 준비 — HOME 에서 열었는데(렌더 시점),
    publishGateDestination('HOME');
    openCold(TERMS, { 'settings/index': stub('settings-stub-root') });
    await screen.findByTestId('terms-viewer-back');

    // 실행 — 누르기 전에 게이트가 LOGIN 으로 바뀐다(세션 만료 등).
    act(() => {
      publishGateDestination('LOGIN');
    });
    tap('terms-viewer-back');

    // 단언 — 렌더 때의 HOME(/settings)이 아니라 누른 때의 LOGIN(/login).
    expect(app.getPathname()).toBe('/login');
    expect(await screen.findByTestId('login-root')).toBeOnTheScreen();
  });

  it('스택이 있으면 게이트와 상관없이 연 자리로 돌아간다', async () => {
    // 준비 — 설정(대역)에서 약관을 push 로 열었다.
    publishGateDestination('HOME');
    openWarm('/settings', TERMS, {
      'settings/index': stub('settings-stub-root'),
    });
    await screen.findByTestId('terms-viewer-back');

    // 실행
    tap('terms-viewer-back');

    // 단언
    expect(app.getPathname()).toBe('/settings');
    expect(rootNames()).toEqual(['settings/index']);
  });
});
