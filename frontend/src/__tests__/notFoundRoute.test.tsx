import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import NotFoundRoute from '@/app/+not-found';

/**
 * TRIP-935 AC-2(R3) · 없는 경로 화면 `+not-found`.
 *
 * 무엇을 보장하나: expo-router 기본 화면(영문 "Unmatched Route" + `/_sitemap` 링크)을 대체해
 * 한국어 안내와 [홈으로]를 그리고, [홈으로]는 홈('/')으로 replace 한다(뒤로가기로 이 화면에
 * 돌아오지 않게). 실제 라우트 매칭·`_sitemap` 차단은 재빌드 실기(6-b) 몫이다.
 *
 * 목: `useRouter()` 반환값과 `router` 싱글턴을 같은 함수로 묶는다 — 어느 방식으로 구현해도
 * 목적지와 replace 여부만 잠근다(02a ★11).
 */

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const router = {
    replace: (...args: unknown[]) => mockReplace(...args),
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
  };
  return { router, useRouter: () => router };
});

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
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

  it('[홈으로] press → router.replace("/") 정확히 1회, push·back 은 0회', () => {
    render(<NotFoundRoute />);

    fireEvent.press(screen.getByTestId('not-found-home'));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
