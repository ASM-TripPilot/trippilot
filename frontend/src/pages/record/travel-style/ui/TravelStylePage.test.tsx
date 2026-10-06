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

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    dismissTo: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
}));

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
