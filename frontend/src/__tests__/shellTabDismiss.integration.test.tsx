import { router, Stack, Tabs } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { TravelStylePage } from '@/pages/record/travel-style';
import { useStyleAnalysis } from '@/pages/record/travel-style/model/useStyleAnalysis';

/**
 * TRIP-1262 · 자체 탭바 화면의 탭 이동이 **실제 스택**을 걷어내는가(QA F3·F4).
 *
 * 페이지 테스트들은 expo-router 를 목으로 바꿔 "dismissTo 를 이 경로로 불렀다"까지만 본다. 여기서는
 * `renderRouter`(expo-router 가 테스트용으로 주는 가짜 앱 — 목 없이 진짜 라우터를 돌린다)에 앱과 같은
 * 모양(루트 Stack 위에 (tabs) · 위저드 · 탭바 가진 스택 화면)을 쌓고, 실물 `TravelStylePage` 의 탭바를
 * 눌러 루트 스택이 어떻게 남는지를 본다. 다섯 화면은 같은 한 줄(`router.dismissTo(shellTabHref(key))`)을
 * 쓰므로 대표로 하나를 태운다 — 화면별 배선은 각 페이지 테스트가 잠근다.
 *
 * (개념) 루트 스택의 라우트 이름 목록 = 엣지 스와이프 뒤로가 되짚을 화면들. `(tabs)` 하나만 남아야
 * 탭 루트에서 스와이프가 무반응이다. 옛 `replace` 는 [(tabs), 위저드, (tabs)] 를 남겼다(뮤테이션 red 실측).
 */

jest.mock('@/pages/record/travel-style/model/useStyleAnalysis', () => ({
  useStyleAnalysis: jest.fn(),
}));

function Empty() {
  return null;
}

const ROUTES = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/_layout': () => <Tabs screenOptions={{ headerShown: false }} />,
  '(tabs)/index': Empty,
  '(tabs)/explore': Empty,
  '(tabs)/itinerary': Empty,
  '(tabs)/records': Empty,
  '(tabs)/my': Empty,
  'trips/new/step1': Empty,
  'my-style': TravelStylePage,
};

/** 루트 스택에 남은 라우트 이름들(스와이프 뒤로가 되짚을 순서). 최상위는 expo-router 의 `__root`
 * 래퍼라 그 안의 상태(= `_layout` 의 Stack)를 읽는다. */
function rootStackNames(
  state: ReturnType<ReturnType<typeof renderRouter>['getRouterState']>
): string[] {
  const stack = state?.routes[0]?.state;
  return (stack?.routes ?? []).map((route) => route.name);
}

beforeEach(() => {
  (useStyleAnalysis as jest.Mock).mockReturnValue({
    data: { official: false },
    isError: false,
  });
});

describe('🔴 TRIP-1262 · 탭바 이동은 아래 스택을 걷어낸다 (진짜 라우터)', () => {
  it('위저드 위 스택 화면에서 탭을 누르면 루트 스택이 (tabs) 하나만 남는다 (F4)', () => {
    // 준비 — 홈 탭 → 위저드 → 탭바 가진 스택 화면 순으로 쌓는다.
    const app = renderRouter(ROUTES, { initialUrl: '/' });
    act(() => router.push('/trips/new/step1'));
    // 'my-style' 는 이 테스트의 메모리 라우터에만 있는 가짜 경로라 typedRoutes 가 모른다 — 타입만 눌러 둔다.
    act(() => router.push('/my-style' as never));
    expect(rootStackNames(app.getRouterState())).toEqual([
      '(tabs)',
      'trips/new/step1',
      'my-style',
    ]);

    // 실행 — 화면의 탭바로 기록 탭.
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-records'));

    // 단언 — 위저드까지 걷히고 기록 탭에 있다.
    expect(rootStackNames(app.getRouterState())).toEqual(['(tabs)']);
    expect(app.getPathname()).toBe('/records');
  });

  it('바로 열린(아래 스택 없는) 화면에서 탭을 누르면 지금 화면이 그 탭으로 바뀐다 (콜드 오픈)', () => {
    // 준비 — 딥링크 콜드 오픈처럼 스택 화면 하나만 있다.
    const app = renderRouter(ROUTES, { initialUrl: '/my-style' });

    // 실행
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-records'));

    // 단언 — 탭으로 교체(무반응·겹쌓임 없음).
    expect(rootStackNames(app.getRouterState())).toEqual(['(tabs)']);
    expect(app.getPathname()).toBe('/records');
  });
});
