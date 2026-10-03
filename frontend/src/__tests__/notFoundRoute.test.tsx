import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  publishGateDestination,
  resetGateDestination,
} from '@/features/auth/model/gateDestination';
import NotFoundRoute from '@routes/+not-found';

/**
 * TRIP-935 AC-2(R3) · 없는 경로 화면 `+not-found`.
 *
 * 무엇을 보장하나: expo-router 기본 화면(영문 "Unmatched Route" + `/_sitemap` 링크)을 대체해
 * 한국어 안내와 [홈으로]를 그리고, [홈으로]는 **누른 순간** 게이트가 연 그룹으로 dismissTo 한다(뒤로가기로
 * 이 화면에 돌아오지 않고, 그 그룹을 두 벌 쌓지 않게). 그 경로가 실제 라우터에서 화면에 닿는지·스택이 한
 * 벌인지는 `notFoundRoute.integration.test`, `_sitemap` 차단은 재빌드 실기(6-b) 몫이다.
 *
 * 목: `useRouter()` 반환값과 `router` 싱글턴을 같은 함수로 묶는다 — 어느 방식으로 구현해도
 * 목적지와 이동 방식만 잠근다(02a ★11).
 */

const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const router = {
    dismissTo: (...args: unknown[]) => mockDismissTo(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
  };
  return { router, useRouter: () => router };
});

beforeEach(() => {
  mockDismissTo.mockClear();
  mockReplace.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  resetGateDestination();
});

describe('🔴 TRIP-935 AC-2 · 없는 경로 화면은 한국어 안내 + [홈으로]', () => {
  it('제목 "페이지를 찾을 수 없어요"와 [홈으로] 버튼을 그린다', () => {
    render(<NotFoundRoute />);

    expect(screen.getByText('페이지를 찾을 수 없어요')).toBeOnTheScreen();
    const home = screen.getByTestId('not-found-home');
    expect(within(home).getByText('홈으로')).toBeOnTheScreen();
    expect(home.props.accessibilityRole).toBe('button');
  });

  it('영문 기본 화면 문구(Unmatched·Sitemap·Go back)가 하나도 없다', () => {
    render(<NotFoundRoute />);

    // 앵커 — 화면이 실제로 그려졌다(빈 렌더의 공허 통과 차단).
    expect(screen.getByTestId('not-found-home')).toBeOnTheScreen();
    expect(
      screen.queryAllByText(/Unmatched|Sitemap|not found|Go back/i)
    ).toHaveLength(0);
  });

  it('[홈으로] press(목적지 HOME) → router.dismissTo("/(tabs)") 정확히 1회, replace·push·back 은 0회', () => {
    // '/' 가 아니다 — '/' 는 라우터가 닫힌 (onboarding) 으로 풀어 버려졌다(M-08).
    // replace 가 아니다 — 앱 안에서 열린 404 면 (tabs) 를 한 벌 더 쌓는다(5-b 경고-1).
    publishGateDestination('HOME');
    render(<NotFoundRoute />);

    fireEvent.press(screen.getByTestId('not-found-home'));

    expect(mockDismissTo).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('목적지는 그릴 때가 아니라 누를 때 읽는다 — 404 가 떠 있는 동안 HOME→LOGIN 이면 /login', () => {
    // 준비 — HOME 으로 그린 뒤 세션이 만료돼 게이트가 LOGIN 을 열었다(화면은 다시 안 그려진다).
    publishGateDestination('HOME');
    render(<NotFoundRoute />);
    publishGateDestination('LOGIN');

    fireEvent.press(screen.getByTestId('not-found-home'));

    expect(mockDismissTo).toHaveBeenCalledWith('/login');
  });
});
