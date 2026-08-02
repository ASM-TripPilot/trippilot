import { render, screen } from '@testing-library/react-native';

import { SplashScreen } from './SplashScreen';

describe('c01-splash — 부트스트랩 스플래시 (AC-SHELL-01-10 · AC-ONB-01-11)', () => {
  it('로고·워드마크·슬로건·진행 인디케이터를 몰입형으로 렌더한다', () => {
    render(<SplashScreen />);
    expect(screen.getByTestId('shell-splash-root')).toBeOnTheScreen();
    expect(screen.getByTestId('shell-splash-logo')).toBeOnTheScreen();
    expect(screen.getByTestId('shell-splash-wordmark')).toHaveTextContent(
      'TripPilot'
    );
    expect(
      screen.getByText('여행의 처음부터 끝까지, 한 곳에서')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('shell-splash-progress')).toBeOnTheScreen();
  });

  it('스플래시에는 탭바가 없다 — 5개 탭 라벨이 렌더되지 않는다 (AC-SHELL-01-10)', () => {
    render(<SplashScreen />);
    ['홈', '탐색', '일정', '기록', '마이'].forEach((label) => {
      expect(screen.queryByText(label)).toBeNull();
    });
  });

  it('소요시간(duration) 을 표시하지 않는다 (INV-3, AC-ONB-01-11)', () => {
    render(<SplashScreen />);
    expect(screen.queryByText(/소요\s*시간|duration/i)).toBeNull();
  });
});
