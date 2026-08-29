import { fireEvent, render, screen } from '@testing-library/react-native';

import { NoAlternativeScreen } from './NoAlternativeScreen';

/**
 * TRIP-563 · AC-1(컴포넌트, i16) — 대안 없음 화면(순수 props+콜백, 라우팅·훅 모름).
 *
 * 무엇을 보장하나:
 *  - 🔴 3버튼(건너뛰기·휴식 모드·수동 수정)이 모두 **enabled** 로 뜨고, 지도·경고 문구가 렌더된다(AC-1).
 *  - 🔴 각 버튼 탭이 **대응 onPress 만 정확히 1회** 발화한다(혼선 없음, press 버블링 방지).
 *  - 🔴 skipCount 가 "남은 방문지 N개 건너뛰기" 라벨에 반영된다.
 *
 * ★ 지도(KakaoMapView)는 WebView 라 렌더 트리에 안 남는다 → `@/shared/map` 을 무해 스텁으로 목하고
 *   화면이 세운 map 영역(planb-noalt-map)의 존재만 잰다. 실 지도(center·타일)는 6-b 실기.
 * ★ RNTL toHaveTextContent: STRING=완전일치 / 정규식=부분일치(node_modules 실측). skip 라벨은 글리프·
 *   숫자 조립이라 정규식 부분으로 잰다.
 *
 * 3동작 뼈대: 준비=props → 실행=렌더/press → 단언=요소 존재·enabled·불린 콜백.
 */

// 지도는 이 화면의 심판 대상이 아니다 — WebView 를 통과 스텁으로 치환(center 무관).
jest.mock('@/shared/map', () => ({ KakaoMapView: () => null }));

function baseProps() {
  return {
    skipCount: 3,
    onSkip: jest.fn(),
    onRestMode: jest.fn(),
    onManualEdit: jest.fn(),
  };
}

describe('🔴 NoAlternativeScreen — i16 대안 없음(AC-1)', () => {
  it('N1 · AC-1 — 3버튼 enabled + 지도·경고 문구·skipCount 라벨 렌더', () => {
    render(<NoAlternativeScreen {...baseProps()} />);

    // 3버튼 존재 + 모두 enabled(disabled prop 미지정 → not.toBeDisabled 통과).
    for (const id of [
      'planb-noalt-skip',
      'planb-noalt-rest',
      'planb-noalt-manual',
    ]) {
      expect(screen.getByTestId(id)).toBeOnTheScreen();
      expect(screen.getByTestId(id)).not.toBeDisabled();
    }

    // 지도 영역(스텁 안쪽은 null 이지만 화면이 세운 래퍼 View 는 남는다).
    expect(screen.getByTestId('planb-noalt-map')).toBeOnTheScreen();

    // 경고 문구(제목 완전일치 노드 + 부제 부분포함).
    expect(screen.getByText('조건에 맞는 대안이 없어요')).toBeOnTheScreen();
    expect(screen.queryByText(/남은 시간이 부족/)).not.toBeNull();

    // skipCount 반영 — 숫자 3 이 라벨에 조립된다(정규식 부분).
    expect(screen.getByTestId('planb-noalt-skip')).toHaveTextContent(
      /남은 방문지\s*3\s*개 건너뛰기/
    );
  });

  it('N2 · AC-1 — [건너뛰기] 탭은 onSkip 만 1회', () => {
    const props = baseProps();
    render(<NoAlternativeScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-noalt-skip'));

    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onRestMode).toHaveBeenCalledTimes(0);
    expect(props.onManualEdit).toHaveBeenCalledTimes(0);
  });

  it('N2 · AC-1 — [휴식 모드] 탭은 onRestMode 만 1회', () => {
    const props = baseProps();
    render(<NoAlternativeScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-noalt-rest'));

    expect(props.onRestMode).toHaveBeenCalledTimes(1);
    expect(props.onSkip).toHaveBeenCalledTimes(0);
    expect(props.onManualEdit).toHaveBeenCalledTimes(0);
  });

  it('N2 · AC-1 — [수동 수정] 탭은 onManualEdit 만 1회', () => {
    const props = baseProps();
    render(<NoAlternativeScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-noalt-manual'));

    expect(props.onManualEdit).toHaveBeenCalledTimes(1);
    expect(props.onSkip).toHaveBeenCalledTimes(0);
    expect(props.onRestMode).toHaveBeenCalledTimes(0);
  });
});
