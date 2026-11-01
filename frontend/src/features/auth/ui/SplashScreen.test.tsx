import { render, screen } from '@testing-library/react-native';

import { AccessibilityInfo } from 'react-native';

import { answerReduceMotionSynchronously } from '@/test-support/animatedProbe';

import { SplashScreen } from './SplashScreen';

const reduceSpy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled');

// TRIP-1624 — 답을 effect 안에서 동기로 받아 render 의 act 가 감싼다(비동기 답은 act 밖 상태 변경 경고를 낸다).
beforeEach(() => answerReduceMotionSynchronously(false));

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

  it('기존 testID 와 새 모션 요소(비행기·도착 파동)·점 3개가 렌더된다 (TRIP-1383)', async () => {
    render(<SplashScreen />);
    expect(screen.getByTestId('shell-splash-illustration')).toBeOnTheScreen();
    expect(await screen.findByTestId('shell-splash-plane')).toBeOnTheScreen();
    expect(screen.getByTestId('shell-splash-arrival-ripple')).toBeOnTheScreen();
    expect(screen.getAllByTestId('shell-splash-progress-dot')).toHaveLength(3);
  });

  it('동작 줄이기면 파동은 없고 비행기·핀·점은 정지 그림 그대로 있다 (TRIP-1383)', async () => {
    reduceSpy.mockResolvedValue(true);
    render(<SplashScreen />);
    expect(screen.getByTestId('shell-splash-illustration')).toBeOnTheScreen();
    expect(await screen.findByTestId('shell-splash-plane')).toBeOnTheScreen();
    expect(screen.queryByTestId('shell-splash-arrival-ripple')).toBeNull();
    expect(screen.getAllByTestId('shell-splash-progress-dot')).toHaveLength(3);
  });
});
