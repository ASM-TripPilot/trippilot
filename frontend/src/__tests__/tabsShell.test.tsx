import type { ReactElement } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { getToastBottoms, resetToastBottoms } from '@/shared/ui/toastBottom';
import { TAB_BAR_TOP } from '@/shared/ui/BottomTabBar';
import { capturedTabsProps } from '@/test-support/expoRouterTabsMock';

/**
 * AC-6~AC-8 · SC-5 — `(tabs)` 레이아웃·어댑터.
 *
 * 무엇을 보장하나:
 *  (1) `_layout.tsx`가 여전히 5탭을 index·explore·itinerary·records·my 순서로 등록한다
 *      (교체 작업이 깨뜨리면 안 되는 회귀 가드),
 *  (2) `Tabs`에 넘긴 `tabBar` 렌더프롭(Q4 전면 커스텀)이 네비게이션 상태(state.index)를 `shell-tabbar-*` 활성 탭으로 정확히
 *      매핑하고, press 시 `navigation.navigate(라우트 이름)`을 호출한다.
 *  라우트 래퍼(`(tabs)/index`·explore·records)를 렌더하던 it 은 지웠다(TRIP-1350 · 2026-11-01 축소) —
 *      라우트는 page 를 꽂기만 하고, 그 탭 동작은 `pages/home/ui/HomePage.test.tsx`·`pages/explore/explore-landing/ui/ExploreLandingPage.test.tsx`·
 *      `pages/record/records-calendar/ui/RecordsCalendarPage.test.tsx`·`src/__tests__/tabsItineraryRoute.test.tsx` 가 잠근다.
 *
 * 왜 라우트 폴더(`app/`) 밖에 두는가: expo-router의 require.context가 `.test.tsx`를 라우트로
 * 등록해 버리므로(`AppProviders.test` 관례) 라우트 파일 테스트는 항상 `src/__tests__/`에 둔다.
 *
 * expo-router는 파일 상단에서 반드시 목킹한다 — node 버킷은 `--experimental-vm-modules`로
 * 돌아 expo-router 실물 import가 `ERR_REQUIRE_ESM`으로 죽는다(02a §6-2).
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterTabsMock')
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TabsLayout = require('@routes/(tabs)/_layout').default;

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

// TRIP-1559 — 토스트 바닥 레지스트리는 모듈 싱글턴이다. 파일 최상위(describe 밖)에서 리셋해야 앞 테스트의 신고가 안 샌다.
afterEach(() => resetToastBottoms());

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

describe('(tabs)/_layout — 화면이 탭바를 숨기면 안 그린다 (TRIP-1240)', () => {
  // 커스텀 tabBar 렌더프롭은 `tabBarStyle` 을 react-navigation 이 적용해 주지 않아, 화면이
  // `navigation.setOptions({ tabBarStyle: { display: 'none' } })` 로 숨김을 요청해도 아무 일도 안 일어났다.
  // 어댑터가 **활성 라우트**의 그 옵션만 읽어 숨김이면 null 을 돌려준다(숨김 요청 = 시트가 탭바를 가릴 때).
  // ⚠️ 실제로 탭바가 사라지는지는 jest 사각(6-b 실기).
  function propsWithOptions(options: Record<string, unknown> | undefined) {
    const { props } = makeTabBarProps(2);
    const descriptors =
      options === undefined ? {} : { 'itinerary-key': { options } };
    return { ...props, descriptors } as unknown as BottomTabBarProps;
  }

  /** 활성 탭은 itinerary(2), 숨김 요청은 **다른** 탭 descriptor 에만 둔다. */
  function propsWithOtherTabHidden() {
    const { props } = makeTabBarProps(2);
    const descriptors = {
      'index-key': { options: { tabBarStyle: { display: 'none' } } },
      'itinerary-key': { options: {} },
    };
    return { ...props, descriptors } as unknown as BottomTabBarProps;
  }

  function renderTabBarFor(options: Record<string, unknown> | undefined) {
    render(<TabsLayout />);
    const tabBar = capturedTabsProps.current?.tabBar as (
      props: BottomTabBarProps
    ) => ReactElement | null;
    return tabBar(propsWithOptions(options));
  }

  it('TB-L1 활성 화면의 tabBarStyle.display 가 none 이면 탭바를 그리지 않는다', () => {
    expect(renderTabBarFor({ tabBarStyle: { display: 'none' } })).toBeNull();
  });

  it('TB-L2 스타일이 배열로 와도(펼친 뒤 display none) 그리지 않는다', () => {
    expect(
      renderTabBarFor({
        tabBarStyle: [{ position: 'absolute' }, { display: 'none' }],
      })
    ).toBeNull();
  });

  it('TB-L4 숨김을 요청한 건 다른 탭이고 지금 보는 탭은 아니면 탭바를 그린다 (탭 화면은 다른 탭으로 가도 남는다)', () => {
    // 준비 — 정렬 시트를 연 채 다른 탭으로 가면 일정 화면의 숨김 요청이 남는다. 지금 보는 탭만 읽어야
    // 홈 같은 곳에서 탭바가 사라져 못 빠져나가는 일이 없다.
    render(<TabsLayout />);
    const tabBar = capturedTabsProps.current?.tabBar as (
      props: BottomTabBarProps
    ) => ReactElement | null;

    // 실행·단언
    expect(tabBar(propsWithOtherTabHidden())).not.toBeNull();
  });

  it('TB-L3 숨김 요청이 없거나 display 가 none 이 아니면 탭바를 그린다', () => {
    expect(renderTabBarFor(undefined)).not.toBeNull();
    expect(renderTabBarFor({ tabBarStyle: undefined })).not.toBeNull();
    expect(
      renderTabBarFor({ tabBarStyle: { display: 'flex' } })
    ).not.toBeNull();
  });
});

describe('(tabs)/_layout — 숨김 요청과 토스트 바닥 신고 (TRIP-1559 T5)', () => {
  // 어댑터가 null 을 돌려 탭바가 unmount 되면 탭바가 신고해 둔 토스트 바닥도 같이 풀려야 한다 — 안 풀리면 시트가 탭바를
  // 가린 화면(TRIP-1240)에서 토스트가 없는 탭바 높이만큼 떠 있다.
  function adapterProps(options: Record<string, unknown>) {
    const { props } = makeTabBarProps(2);
    return {
      ...props,
      descriptors: { 'itinerary-key': { options } },
    } as unknown as BottomTabBarProps;
  }

  it('탭바를 그리는 동안 알약 윗변을 신고하고, 숨김 요청으로 null 이 되면 해제한다', () => {
    render(<TabsLayout />);
    const tabBar = capturedTabsProps.current?.tabBar as (
      props: BottomTabBarProps
    ) => ReactElement | null;
    expect(getToastBottoms()).toEqual([]);

    const view = render(<>{tabBar(adapterProps({}))}</>);
    expect(getToastBottoms()).toEqual([TAB_BAR_TOP]);

    view.rerender(
      <>{tabBar(adapterProps({ tabBarStyle: { display: 'none' } }))}</>
    );
    expect(getToastBottoms()).toEqual([]);
  });
});
