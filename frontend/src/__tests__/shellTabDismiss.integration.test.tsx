import type { ReactElement } from 'react';
import { router, Stack, Tabs } from 'expo-router';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
} from 'expo-router/testing-library';

import { TAB_BAR_TOP } from '@/shared/ui/BottomTabBar';
import { getToastBottoms, resetToastBottoms } from '@/shared/ui/toastBottom';
import { useToastBottom } from '@/shared/ui/useToastBottom';
import { TravelStylePage } from '@/pages/record/travel-style';
import { useStyleAnalysis } from '@/pages/record/travel-style/model/useStyleAnalysis';

/**
 * TRIP-1262 · 자체 탭바 화면의 탭 이동이 **실제 스택**을 걷어내는가(QA F3·F4).
 *
 * 페이지 테스트들은 expo-router 를 목으로 바꿔 "dismissTo 를 이 경로로 불렀다"까지만 본다. 여기서는
 * `renderRouter`(expo-router 가 테스트용으로 주는 가짜 앱 — 목 없이 진짜 라우터를 돌린다)에 앱과 같은
 * 모양(루트 Stack 위에 (tabs) · 위저드 · 탭바 가진 스택 화면)을 쌓고, 실물 `TravelStylePage` 의 탭바를
 * 눌러 루트 스택이 어떻게 남는지를 본다. 5칸 탭바를 복제해 그리는 세 화면(숙소 검색·장소 탐색·여행 스타일)은 같은 한 줄
 * (`router.dismissTo(shellTabHref(key))`)을 쓰므로 대표로 하나를 태운다 — 화면별 배선은 각 페이지 테스트가 잠근다.
 * (회고·요약은 TRIP-1584 에서 3칸 바로 바뀌어 빠졌다 — 그쪽 스택은 `recordBarStack.integration.test.tsx`.)
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

/**
 * TRIP-1559 T3 — 같은 실물 라우터(`renderRouter`)로 **토스트 바닥 신고가 포커스를 따라가는가**를 잰다.
 * 위 describe 들은 쓰는 가짜 앱이 `<Tabs>` 기본 탭바라 이 일에는 못 쓴다 — 여기선 앱의 실제 `(tabs)/_layout`(탭 바 어댑터 + BottomTabBar)을 꽂는다.
 *
 * *(개념)* 포커스 = "지금 맨 위에 보이는 화면". 홈 탭은 위에 스택 화면이 올라와도 마운트된 채 남는다 — 그 홈(탭 바)의 신고가 위 화면의
 * 토스트 바닥에 새면 안 된다(옛 ✦ 올림이 "마운트 기준"이라 샜다). 탭 바 렌더프롭이 `(tabs)` 스택 라우트 컨텍스트 안에서 그려져 push 되면 blur 된다는
 * 것을 코드로 확인(2026-10-22 스파이크)하고 이 테스트가 상시 심판이 된다.
 *
 * 무엇을 보장하나: 탭 화면에선 탭 바 값만 · 스택 화면을 올리면 그 화면 값만(탭 바 값 없음) · 돌아오면 다시 탭 바 값만 · 탭을 옮겨도 탭 바 신고는 하나.
 * 3동작 뼈대: 준비=실제 레이아웃으로 앱 모양 렌더 → 실행=push/back/탭 이동 → 단언=레지스트리.
 */

// 모듈 싱글턴 — 파일 최상위(describe 밖)에서 리셋한다.
afterEach(() => resetToastBottoms());

describe('TRIP-1559 T3 · 탭 바 위에 스택 화면이 올라오면 탭 바 신고가 빠진다 (진짜 라우터)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TabsLayout = require('@routes/(tabs)/_layout')
    .default as () => ReactElement;

  // 바(CTA 바 등)를 가진 스택 화면 흉내 — 실물 CtaBar 의 신고는 CtaBar.test 가 잰다.
  const STACK_BAR_HEIGHT = 120;
  function StackScreenWithBar() {
    useToastBottom(STACK_BAR_HEIGHT);
    return null;
  }
  const TOAST_ROUTES = {
    _layout: () => <Stack screenOptions={{ headerShown: false }} />,
    '(tabs)/_layout': TabsLayout,
    '(tabs)/index': Empty,
    '(tabs)/explore': Empty,
    h16: StackScreenWithBar,
  };

  it('탭 화면에선 탭 바 값만 · 스택 화면을 올리면 그 화면 값만 · 돌아오면 다시 탭 바 값만 보인다', () => {
    // 준비 — 앱과 같은 모양: 루트 스택 아래에 (tabs) 가 마운트돼 있다. 그리기 전엔 신고가 없다(앵커).
    expect(getToastBottoms()).toEqual([]);
    renderRouter(TOAST_ROUTES, { initialUrl: '/' });
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);

    // 실행 — 스택 화면을 위에 올린다.
    act(() => router.push('/h16' as never));

    // 단언 — 아래 (tabs) 는 마운트돼 있어도 포커스가 아니라 탭 바 값이 새지 않는다.
    expect(getToastBottoms()).toEqual([STACK_BAR_HEIGHT]);

    // 실행·단언 — 돌아오면 탭 바 값이 돌아오고 스택 화면 값은 사라진다.
    act(() => router.back());
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);
  });

  it('탭을 옮겨도 탭 바 신고는 하나다', () => {
    renderRouter(TOAST_ROUTES, { initialUrl: '/' });

    act(() => router.navigate('/explore' as never));

    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);
  });
});
