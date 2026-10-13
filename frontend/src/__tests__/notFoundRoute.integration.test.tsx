import { router, Stack, Tabs } from 'expo-router';
import { Text } from 'react-native';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  within,
} from 'expo-router/testing-library';

import { SPLASH_MIN_VISIBLE_MS, SplashGate } from '@/app/routing/SplashGate';
import { useBootstrapGate, type BootstrapDestination } from '@/features/auth';
import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import NotFoundRoute from '@routes/+not-found';

/**
 * TRIP-935 · 없는 경로 화면의 [홈으로]가 **실제 라우터에서** 게이트가 연 화면에 닿는다(Maestro M-08).
 *
 * 왜 실물 라우터인가: 버그는 "어떤 문자열로 replace 하나"가 아니라 "그 문자열을 라우터가 어디로 푸나"에 있었다.
 * `'/'` 는 `(onboarding)/index` 와 `(tabs)/index` 둘에 걸리고 라우터는 가드를 모른 채 `(onboarding)` 으로
 * 풀어서, 그 그룹이 닫힌 HOME 상태에선 replace 가 조용히 버려졌다. 라우터 목(`notFoundRoute.test`)으로는
 * 이것이 안 보인다.
 *
 * *(개념)* `renderRouter` — expo-router 가 주는 테스트용 앱. 경로 → 화면 표를 넘기면 실제 라우터가 돈다.
 *   루트 `_layout` 에 실제 `SplashGate` 를 꽂아 가드 표(Stack.Protected)는 앱과 같은 것을 쓴다.
 *   그룹 화면들은 testID 만 가진 가짜다.
 *
 * 3동작: 준비 = 게이트 목적지 + 없는 경로로 앱 열기 → 실행 = [홈으로] → 단언 = 그 목적지의 화면이 보인다.
 *
 * TRIP-1350 — 옛 `notFoundRoute.test`(라우터 목) 를 합쳤다. 목은 `router` 싱글턴을 스파이로 바꿔 대신한다:
 * 문구·영문 기본 문구 부재·"목적지는 누를 때 읽는다"는 라우터를 실제로 움직일 필요가 없어 `dismissTo` 를 막아 둔 채 인자만 본다.
 * 옛 단위 it 의 "HOME → /(tabs) 1회" 는 실물 라우터 it(HOME 도착 · 탭 두 벌 안 쌓임)이 더 강하게 잠가 둘 다 남긴다.
 *
 * 통합 버킷 이유: 실물 expo-router 는 node 버킷(`--experimental-vm-modules`)에서 로드가 실패한다.
 */

jest.mock('@/features/auth/model/useBootstrapGate', () => ({
  __esModule: true,
  BOOTSTRAP_TIMEOUT_MS: 3000,
  useBootstrapGate: jest.fn(),
}));
// 계정 경계 정리·푸시 재등록은 SplashGate 의 다른 테스트가 본다 — 여기선 끈다.
jest.mock('@/app/model/useAccountBoundaryReset', () => ({
  useAccountBoundaryReset: jest.fn(),
}));
jest.mock('@/shared/push', () => ({ registerPushIfGranted: jest.fn() }));

const mockUseBootstrapGate = useBootstrapGate as jest.MockedFunction<
  typeof useBootstrapGate
>;

function stub(testID: string) {
  return function Stub() {
    return <Text testID={testID}>{testID}</Text>;
  };
}

// 키 순서 = 앱 파일 순서(require.context, 사전순). 지금 화면과 그룹이 안 겹치면 '/' 처럼 여러 라우트에
// 똑같이 맞는 경로는 앞 키가 이긴다 — (tabs) 를 앞에 두면 옛 버그의 HOME 증상은 숨지만 ONBOARDING 쪽이 대신
// 막혀 스위트 전체로는 여전히 red 다. 고친 코드는 그룹을 명시해 동점이 없으므로 순서와 무관하다.
const ROUTES = {
  _layout: SplashGate,
  '(auth)/_layout': () => <Stack />,
  '(auth)/login': stub('login-root'),
  '(onboarding)/_layout': () => <Stack />,
  '(onboarding)/index': stub('onboarding-root'),
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/index': stub('home-root'),
  '(tabs)/explore': stub('explore-root'),
  '+not-found': NotFoundRoute,
  'force-update': stub('force-update-root'),
  reconsent: stub('reconsent-root'),
  'trips/[tripId]/planb/index': stub('planb-root'),
};

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  mockUseBootstrapGate.mockReset();
  resetGateDestination();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** 게이트가 `destination` 을 연 상태로 없는 경로 앱을 열고 스플래시 floor 까지 넘긴다. */
function openNotFound(destination: BootstrapDestination): void {
  mockUseBootstrapGate.mockReturnValue({
    phase: 'resolved',
    destination,
    isProvisional: false,
  });
  publishGateDestination(destination);
  renderRouter(ROUTES, { initialUrl: '/zz-none' });
  act(() => {
    jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
  });
}

describe('🔴 TRIP-935 M-08 · [홈으로]는 게이트가 연 화면에 닿는다', () => {
  it.each<[BootstrapDestination, string]>([
    ['HOME', 'home-root'],
    ['ONBOARDING', 'onboarding-root'],
    ['LOGIN', 'login-root'],
    ['RECONSENT', 'reconsent-root'],
    ['FORCE_UPDATE', 'force-update-root'],
  ])('목적지 %s → [홈으로] → %s', (destination, landing) => {
    // 준비 — 게이트가 destination 을 열었고, 없는 경로로 앱이 열렸다.
    mockUseBootstrapGate.mockReturnValue({
      phase: 'resolved',
      destination,
      isProvisional: false,
    });
    publishGateDestination(destination);
    renderRouter(ROUTES, { initialUrl: '/zz-none' });
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    expect(screen.getByTestId('not-found-home')).toBeOnTheScreen();

    // 실행
    fireEvent.press(screen.getByTestId('not-found-home'));

    // 단언 — 목적지 화면이 보이고 없는 경로 화면은 사라졌다.
    expect(screen.getByTestId(landing)).toBeOnTheScreen();
    expect(screen.queryByTestId('not-found-home')).toBeNull();
  });

  it('앱 안(탐색 탭)에서 404 로 들어와도 [홈으로]는 기존 탭으로 돌아간다 — (tabs) 를 두 벌 쌓지 않는다', () => {
    // 준비 — HOME 으로 탐색 탭에 있다가 없는 주소가 push 됐다(알림·공유 딥링크, 낡은 push 대상).
    mockUseBootstrapGate.mockReturnValue({
      phase: 'resolved',
      destination: 'HOME',
      isProvisional: false,
    });
    publishGateDestination('HOME');
    renderRouter(ROUTES, { initialUrl: '/explore' });
    act(() => {
      jest.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    });
    act(() => {
      router.push('/zz-none' as never);
    });
    expect(screen.getByTestId('not-found-home')).toBeOnTheScreen();

    // 실행
    fireEvent.press(screen.getByTestId('not-found-home'));

    // 단언 — 홈이 보이고, 루트 스택에 되돌아갈 화면이 없다. replace 였다면 [옛 (tabs), 새 (tabs)] 라
    // 뒤로가기가 옛 탭의 탐색 화면을 꺼냈다(canGoBack true). navigate·push 였다면 404 가 뒤에 남는다.
    expect(screen.getByTestId('home-root')).toBeOnTheScreen();
    expect(router.canGoBack()).toBe(false);
  });
});

describe('🔴 TRIP-935 AC-2 · 없는 경로 화면은 한국어 안내 + [홈으로]', () => {
  it('제목 "페이지를 찾을 수 없어요"와 [홈으로] 버튼을 그린다', () => {
    openNotFound('HOME');

    expect(screen.getByText('페이지를 찾을 수 없어요')).toBeOnTheScreen();
    const home = screen.getByTestId('not-found-home');
    expect(within(home).getByText('홈으로')).toBeOnTheScreen();
    expect(home.props.accessibilityRole).toBe('button');
  });

  it('영문 기본 화면 문구(Unmatched·Sitemap·Go back)가 하나도 없다', () => {
    openNotFound('HOME');

    // 앵커 — 화면이 실제로 그려졌다(빈 렌더의 공허 통과 차단).
    expect(screen.getByTestId('not-found-home')).toBeOnTheScreen();
    expect(
      screen.queryAllByText(/Unmatched|Sitemap|not found|Go back/i)
    ).toHaveLength(0);
  });

  it('[홈으로] press(목적지 HOME) → router.dismissTo("/(tabs)") 정확히 1회, replace·push·back 은 0회', () => {
    // '/' 가 아니다 — '/' 는 라우터가 닫힌 (onboarding) 으로 풀어 버려졌다(M-08).
    // replace 가 아니다 — 앱 안에서 열린 404 면 (tabs) 를 한 벌 더 쌓는다(5-b 경고-1).
    openNotFound('HOME');
    const dismissTo = jest.spyOn(router, 'dismissTo').mockImplementation();
    const replace = jest.spyOn(router, 'replace').mockImplementation();
    const push = jest.spyOn(router, 'push').mockImplementation();
    const back = jest.spyOn(router, 'back').mockImplementation();

    fireEvent.press(screen.getByTestId('not-found-home'));

    expect(dismissTo).toHaveBeenCalledTimes(1);
    expect(dismissTo).toHaveBeenCalledWith('/(tabs)');
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it('목적지는 그릴 때가 아니라 누를 때 읽는다 — 404 가 떠 있는 동안 HOME→LOGIN 이면 /login', () => {
    // 준비 — HOME 으로 그린 뒤 세션이 만료돼 게이트가 LOGIN 을 열었다(화면은 다시 안 그려진다).
    openNotFound('HOME');
    const dismissTo = jest.spyOn(router, 'dismissTo').mockImplementation();
    act(() => {
      publishGateDestination('LOGIN');
    });

    fireEvent.press(screen.getByTestId('not-found-home'));

    expect(dismissTo).toHaveBeenCalledWith('/login');
  });
});
