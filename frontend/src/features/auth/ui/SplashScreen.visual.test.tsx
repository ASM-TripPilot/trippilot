import { render, screen, within } from '@testing-library/react-native';

import { SplashScreen } from './SplashScreen';

// 이 파일은 '비주얼 구조 가드'다. 픽셀(색·간격·폰트·일러스트 위치)은 jest 로 검증할 수
// 없으므로 다루지 않고 — 그건 [검증] 단계의 Figma 스크린샷 대조 몫이다 — 재구현 후
// 브랜드 시각요소가 '존재'하는지만 새 testID 로 확인한다.
//
// 주의: expo-linear-gradient·react-native-svg 는 아직 미설치라 이 파일에서 직접 import
// 하지 않는다. 화면을 렌더(RNTL)해 implementer 가 붙일 새 testID 를 조회하는 방식으로만
// 단언하므로, 패키지 없이 렌더되는 현재 wireframe 에서도 깨끗한 red 가 난다.
//
// within(container) = 특정 요소의 하위 트리 안에서만 쿼리하는 RNTL 헬퍼(요소의 '중첩'을 단언).
describe('c01-splash 비주얼 구조 가드 (AC-VS-1~4 · 신규 실패 테스트)', () => {
  it('AC-VS-1 배경이 그라디언트 요소로 렌더된다 — 단색 View 가 아니다', () => {
    // 준비: 스플래시 화면을 렌더한다.
    render(<SplashScreen />);
    // 실행+단언: LinearGradient 에 붙는 shell-splash-gradient 가 존재해야 한다.
    // (현재는 bg-white 단색 View 뿐 → 이 testID 없음 → red)
    expect(screen.getByTestId('shell-splash-gradient')).toBeOnTheScreen();
  });

  it('AC-VS-2 로고가 박스 안 종이비행기 SVG 글리프로 렌더된다 — bg-black 사각형이 아니다', () => {
    // 준비: 화면을 렌더하고 기존 계약 testID 의 로고 박스를 잡는다.
    render(<SplashScreen />);
    const logo = screen.getByTestId('shell-splash-logo');
    // 실행+단언: 로고 박스 안에 글리프 SVG(신규 testID)가 중첩돼야 한다.
    // (현재는 빈 bg-black View → 자식 글리프 없음 → red)
    expect(
      within(logo).getByTestId('shell-splash-logo-glyph')
    ).toBeOnTheScreen();
  });

  it('AC-VS-3 상단에 비행경로 일러스트 SVG 가 렌더된다', () => {
    // 준비: 화면을 렌더한다.
    render(<SplashScreen />);
    // 실행+단언: 상단 일러스트(신규 testID)가 존재해야 한다.
    // (현재는 일러스트 존 자체가 없음 → red)
    expect(screen.getByTestId('shell-splash-illustration')).toBeOnTheScreen();
  });

  it('AC-VS-4 진행 인디케이터가 도트 3개로 렌더된다 — 빈 컨테이너가 아니다', () => {
    // 준비: 화면을 렌더하고 기존 계약 testID 의 진행 컨테이너를 잡는다.
    render(<SplashScreen />);
    const progress = screen.getByTestId('shell-splash-progress');
    // 실행+단언: 컨테이너 안 도트(신규 testID)가 정확히 3개여야 한다.
    // (현재는 자식 없는 빈 View → 0개 → red)
    expect(
      within(progress).getAllByTestId('shell-splash-progress-dot')
    ).toHaveLength(3);
  });
});
