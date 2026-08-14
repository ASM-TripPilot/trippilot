import type { ReactElement } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { capturedTabsProps } from '@/test-support/expoRouterTabsMock';

/**
 * AC-6~AC-8 · SC-1 · SC-4 · SC-5 — `(tabs)` 레이아웃·어댑터·라우트 래퍼.
 *
 * 무엇을 보장하나:
 *  (1) `_layout.tsx`가 여전히 5탭을 index·explore·itinerary·records·my 순서로 등록한다
 *      (교체 작업이 깨뜨리면 안 되는 회귀 가드),
 *  (2) `Tabs`에 `tabBar` 렌더프롭을 넘겨 탭바를 전면 커스텀한다(Q4),
 *  (3) 그 렌더프롭이 네비게이션 상태(state.index)를 `shell-tabbar-*` 활성 탭으로 정확히
 *      매핑하고, press 시 `navigation.navigate(라우트 이름)`을 호출한다,
 *  (4) `(tabs)/index.tsx`가 실물 `HomeScreen`을 그리고, `itinerary`는 TRIP-299로,
 *      `explore`는 TRIP-201로 실화면 승격(그 탭 동작은 각각
 *      `src/__tests__/tabsItineraryRoute.test.tsx`·`tabsExploreRoute.test.tsx`가 잠근다),
 *      나머지 2탭(records·my)은 껍데기를 유지한다.
 *
 * 왜 `src/app/` 밖에 두는가: expo-router의 require.context가 `.test.tsx`를 라우트로
 * 등록해 버리므로(`rootLayout.test` 관례) 라우트 파일 테스트는 항상 `src/__tests__/`에 둔다.
 *
 * expo-router는 파일 상단에서 반드시 목킹한다 — node 버킷은 `--experimental-vm-modules`로
 * 돌아 expo-router 실물 import가 `ERR_REQUIRE_ESM`으로 죽는다(02a §6-2).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-router', () => require('@/test-support/expoRouterTabsMock'));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TabsLayout = require('@/app/(tabs)/_layout').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const IndexRoute = require('@/app/(tabs)/index').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecordsRoute = require('@/app/(tabs)/records').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MyRoute = require('@/app/(tabs)/my').default;

// 라우트 이름 5개 → 조작 네비 상태(state.routes)에 쓸 최소 형태.
const ROUTE_NAMES = ['index', 'explore', 'itinerary', 'records', 'my'];

/**
 * `BottomTabBarProps` 실물 타입을 테스트 픽스처가 다 채울 수는 없다 — 어댑터가 실제로
 * 쓰는 필드(state.index·routes·navigation.navigate·navigation.emit)만 채우고
 * `as unknown as BottomTabBarProps`로 캐스팅한다(02a §6-9). `emit`은 표준 tabPress
 * 프로토콜을 흉내내 `{ defaultPrevented: false }`를 돌려주는 jest.fn으로 둔다 — 어댑터가
 * 그 프로토콜을 쓰든 안 쓰든 통과하도록.
 */
function makeTabBarProps(activeIndex: number) {
  const navigate = jest.fn();
  const emit = jest.fn().mockReturnValue({ defaultPrevented: false });
  const routes = ROUTE_NAMES.map((name) => ({ key: `${name}-key`, name }));
  const props = {
    state: { index: activeIndex, routes },
    navigation: { navigate, emit },
    descriptors: {},
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  } as unknown as BottomTabBarProps;
  return { props, navigate, emit };
}

beforeEach(() => {
  // 이전 테스트의 캡처값이 새 렌더 전에 남아있지 않도록 방어적으로 비운다.
  capturedTabsProps.current = null;
});

describe('(tabs)/_layout — 라우트 등록 순서 (AC-6 · SC-5 · 선제 green)', () => {
  it('5탭이 index·explore·itinerary·records·my 순서로 등록된다', () => {
    render(<TabsLayout />);

    const routeMarkers = screen.getAllByTestId(/^tabs-route-/);
    const names = routeMarkers.map((el) =>
      String(el.props.testID).replace('tabs-route-', '')
    );

    expect(names).toEqual(['index', 'explore', 'itinerary', 'records', 'my']);
  });
});

describe('(tabs)/_layout — tabBar 렌더프롭 배선 (SC-4)', () => {
  it('Tabs에 tabBar 함수 prop을 넘긴다', () => {
    render(<TabsLayout />);

    // 렌더프롭 = "이 자리를 무엇으로 그릴지" 함수를 통째로 넘기는 패턴.
    // 이것이 함수여야 Q4가 요구하는 "전면 커스텀"이 성립한다.
    expect(typeof capturedTabsProps.current?.tabBar).toBe('function');
  });
});

describe('(tabs)/_layout — 어댑터 활성 매핑 (AC-7)', () => {
  it('현재 라우트 index=0(index) → 탭 key home이 selected로 매핑된다', () => {
    render(<TabsLayout />);
    const tabBar = capturedTabsProps.current?.tabBar as (
      props: BottomTabBarProps
    ) => ReactElement;

    const { props } = makeTabBarProps(0);
    // tabBar가 돌려주는 엘리먼트를 다시 렌더한다 — 이전 render(<TabsLayout />)의 결과는
    // 더는 보지 않는다(screen은 가장 최근 render 트리를 가리킨다).
    render(tabBar(props));

    ['home', 'explore', 'itinerary', 'records', 'my'].forEach((key) => {
      expect(screen.getByTestId(`shell-tabbar-tab-${key}`)).toBeOnTheScreen();
    });
    expect(screen.getByTestId('shell-tabbar-tab-home')).toBeSelected();
    expect(screen.getByTestId('shell-tabbar-tab-explore')).not.toBeSelected();
  });
});

describe('(tabs)/_layout — 어댑터 press→navigate (AC-8)', () => {
  it('탭을 누르면 navigate(라우트 이름)이 호출되고, state.index가 바뀌면 selected도 옮겨간다', () => {
    render(<TabsLayout />);
    const tabBar = capturedTabsProps.current?.tabBar as (
      props: BottomTabBarProps
    ) => ReactElement;

    const { props, navigate } = makeTabBarProps(0);
    render(tabBar(props));

    fireEvent.press(screen.getByTestId('shell-tabbar-tab-itinerary'));

    // 탭 이동은 네비게이터 위임 — 우리는 호출만 증명한다(상태 보존은 프레임워크 기본).
    expect(navigate).toHaveBeenCalledWith('itinerary');

    // 추가 준비 — state.index=2(itinerary)로 다시 호출·렌더.
    const { props: propsAtItinerary } = makeTabBarProps(2);
    render(tabBar(propsAtItinerary));

    expect(screen.getByTestId('shell-tabbar-tab-itinerary')).toBeSelected();
    expect(screen.getByTestId('shell-tabbar-tab-home')).not.toBeSelected();
  });
});

describe('(tabs)/index.tsx — 홈 라우트 래퍼 (SC-1 · SC-5)', () => {
  it('기본 export가 홈 화면 루트를 그린다', () => {
    // 홈은 라우터 무의존이라 준비할 목이 없다 — 어느 상태 픽스처인지는 단언하지 않는다
    // (그건 4-b 대상이 아니라 [구현]의 재량, 02a §7 G-1).
    render(<IndexRoute />);

    expect(screen.getByTestId('home-dashboard-root')).toBeOnTheScreen();
  });
});

describe('(tabs)/{records,my} — 껍데기 유지 (SC-5 · 선제 green)', () => {
  // itinerary 는 TRIP-299 로, explore 는 TRIP-201 로 실화면 승격 — 그 탭들의 동작은
  // `tabsItineraryRoute.test.tsx`·`tabsExploreRoute.test.tsx`(게이트① 동결)가 각각 잠근다.
  // 여기서는 아직 껍데기인 2탭(records·my)만 지킨다.
  it('홈·일정·탐색 외 2탭은 각각 기존 텍스트 껍데기를 그대로 그린다', () => {
    const { unmount: unmountRecords } = render(<RecordsRoute />);
    expect(screen.getByText('기록')).toBeOnTheScreen();
    unmountRecords();

    render(<MyRoute />);
    expect(screen.getByText('마이')).toBeOnTheScreen();
  });
});
