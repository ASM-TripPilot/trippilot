import type { ReactElement } from 'react';
import { render, screen, within } from '@testing-library/react-native';

import { SplashScreen } from './SplashScreen';

/**
 * c01-splash · loading 프레임(1283:1208) 구조 가드 (Seed 확정 3, TRIP-162).
 *
 * loading 과 default 의 차이는 하단 진행점 첫 점 강조뿐이다. 여기서는 "강조된 점이
 * **구별 가능한 별도 요소**로 존재하는가"(신규 testID)만 본다 — 어느 위치의 점인지·
 * 어떤 스타일로 강조되는지는 [검증] 스크린샷 대조 몫이다. 애니메이션은 비목표(정적 강조만).
 *
 * 기본값 계약: prop 미전달이면 현재 렌더와 동일해야 한다 — 그래야 동결 테스트
 * (SplashScreen.test · SplashScreen.visual.test: 도트 3개)가 무수정 green 으로 남는다.
 */

// loading 은 게이트① 시점에 아직 없는 prop — 확장 타입으로 계약을 선언한다.
// (SplashScreen 은 현재 props 가 없는 컴포넌트라 교집합 없이 새 타입만 선언한다.)
type SplashScreenPropsNext = {
  /** 부트스트랩 진행 중 표시 — true 면 진행점 첫 점을 강조한다. 기본 false. */
  loading?: boolean;
};
const SplashScreenNext: (props: SplashScreenPropsNext) => ReactElement =
  SplashScreen;

describe('SplashScreen — loading 진행점 강조 (c01 · 1283:1208)', () => {
  it('loading 이면 진행 컨테이너 안에 강조 점 1개 + 일반 점 2개(합 3개 유지)를 그린다', () => {
    render(<SplashScreenNext loading />);

    const progress = screen.getByTestId('shell-splash-progress');
    // 강조 점은 일반 점과 testID 로 구별된다 — 스타일 차이는 스크린샷이 검증한다.
    expect(
      within(progress).getAllByTestId('shell-splash-progress-dot-active')
    ).toHaveLength(1);
    expect(
      within(progress).getAllByTestId('shell-splash-progress-dot')
    ).toHaveLength(2);
  });

  it.each([
    ['미전달', undefined],
    ['false', false],
  ])(
    'loading 이 %s 이면 현재 렌더 그대로다 — 강조 점 없이 일반 점 3개',
    (_label, value) => {
      render(<SplashScreenNext loading={value} />);

      const progress = screen.getByTestId('shell-splash-progress');
      expect(
        within(progress).queryByTestId('shell-splash-progress-dot-active')
      ).toBeNull();
      expect(
        within(progress).getAllByTestId('shell-splash-progress-dot')
      ).toHaveLength(3);
    }
  );
});
