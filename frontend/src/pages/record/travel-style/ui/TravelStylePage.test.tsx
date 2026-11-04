import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useStyleAnalysis } from '../model/useStyleAnalysis';
import { TravelStylePage } from './TravelStylePage';

/**
 * TRIP-1262 · j05 여행 스타일 페이지 — 복제 탭바 항법만 본다(조회 훅·expo-router 목, 화면은 실물).
 *
 * 무엇을 보장하나: 스타일 화면(스택 화면)의 탭바로 탭을 누르면 `router.dismissTo(탭 경로)` 1회 —
 * replace 면 이 화면만 (tabs) 로 바뀌고 아래 스택(마이 → 스타일)이 남아 탭 루트에서 스와이프가
 * 지나간 화면을 되살린다(QA F3).
 */

jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock({
    router: ['push', 'replace', 'back', 'dismissTo', 'canGoBack'],
  })
);

jest.mock('../model/useStyleAnalysis', () => ({
  useStyleAnalysis: jest.fn(),
}));

describe('🔴 TRIP-1262 · 복제 탭바는 dismissTo 로 탭에 간다 (QA F3)', () => {
  it('홈·마이 탭 press → dismissTo(/(tabs)) · dismissTo(/my), replace 0회', () => {
    // 준비 — 분석 미달(insufficient) 봉투: 정식 본문 없이도 화면과 탭바는 그려진다.
    (useStyleAnalysis as jest.Mock).mockReturnValue({
      data: { official: false },
      isError: false,
    });

    render(<TravelStylePage />);

    // 실행
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
    fireEvent.press(screen.getByTestId('shell-tabbar-tab-my'));

    // 단언
    expect((router.dismissTo as jest.Mock).mock.calls).toEqual([
      ['/(tabs)'],
      ['/my'],
    ]);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});

// TRIP-1765 — AppBar 는 accessibilityRole 속성을 늘 달고 값만 선택이라 role 게이트(ESLint)가 이 자리를 못 본다.
describe('앱바 뒤로는 낭독기에 "뒤로" 버튼이다', () => {
  it('봉투가 있는 얼굴에서 "뒤로" 버튼은 앱바 뒤로 하나다', () => {
    (useStyleAnalysis as jest.Mock).mockReturnValue({
      data: { official: false },
      isError: false,
    });

    render(<TravelStylePage />);

    expect(screen.getByRole('button', { name: '뒤로' })).toHaveProp(
      'testID',
      'reflection-style-back'
    );
  });
});

describe('🔴 TRIP-1752 · 스타일을 못 받으면 막다른 화면이 아니다 (INV-4)', () => {
  // 딥링크·도우미 이동으로 오면 탭바가 없는 이 화면에 갇힌다 — 실패 얼굴엔 [다시 시도]·[뒤로], 로딩 얼굴엔 [뒤로](결정 1).
  beforeEach(() => {
    (router.back as jest.Mock).mockClear();
    (router.replace as jest.Mock).mockClear();
    (router.canGoBack as jest.Mock).mockReturnValue(false);
  });

  it('실패 → 오류 얼굴 · [다시 시도]는 다시 받고 · [뒤로]는 히스토리 없으면 마이 탭으로 replace', () => {
    // 준비 — 조회 실패(재시도 끝), 봉투 없음.
    const refetch = jest.fn();
    (useStyleAnalysis as jest.Mock).mockReturnValue({
      data: undefined,
      isError: true,
      refetch,
    });

    render(<TravelStylePage />);

    // 단언 — 글자 한 줄만 있으면 위반이다.
    expect(screen.getByTestId('reflection-style-error')).toBeOnTheScreen();

    // 실행·단언 — 다시 시도 = 재조회 1회.
    fireEvent.press(screen.getByTestId('reflection-style-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);

    // 실행·단언 — 뒤로 = handleBack 그대로(히스토리 없음 → 마이 탭).
    fireEvent.press(screen.getByTestId('reflection-style-error-back'));
    expect(router.replace).toHaveBeenCalledWith('/my');
  });

  it('로딩 중에도 [뒤로]가 있다 — 히스토리가 있으면 back', () => {
    (useStyleAnalysis as jest.Mock).mockReturnValue({
      data: undefined,
      isError: false,
      refetch: jest.fn(),
    });
    (router.canGoBack as jest.Mock).mockReturnValue(true);

    render(<TravelStylePage />);

    expect(screen.queryByTestId('reflection-style-error')).toBeNull();
    fireEvent.press(screen.getByTestId('reflection-style-loading-back'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
