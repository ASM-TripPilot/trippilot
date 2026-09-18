import { fireEvent, render, screen } from '@testing-library/react-native';

import { ReplanSolvingScreen } from './ReplanSolvingScreen';

/**
 * TRIP-440 · AC-1·2·3(화면) — i12 재계획 로딩 화면(순수 props+콜백, 라우팅·훅 모름).
 *
 * 무엇을 보장하나:
 *  - 🔴 SOLVING 동안 진행 표시·[백그라운드로]·[취소] 세 컨트롤이 함께 뜬다(AC-1).
 *  - 🔴 [취소] press → onCancel 만, [백그라운드로] press → onBackground 만(취소↔백그라운드 혼선 없음, AC-2·3).
 *
 * ★ 계약 최소화: 이 테스트는 onBackground·onCancel 만 넘긴다 — 다른 props 를 필수로 만들면 안 된다.
 *   진행바·체크리스트·안심노트 세부는 AC 가 없어 안 잰다(6-b 실기 전용, h09 IndeterminateBar 계열).
 *   Figma 라이브 프레임에 두 버튼이 없어(문서-라이브 드리프트) 육안 대조 불가 — 실렌더는 testID 로만.
 *
 * 3동작 뼈대: 준비=props → 실행=렌더/press → 단언=요소 존재·불린 콜백.
 */

function baseProps() {
  return {
    onBackground: jest.fn(),
    onCancel: jest.fn(),
  };
}

describe('🔴 ReplanSolvingScreen — i12 로딩(AC-1·2·3)', () => {
  it('S1 · AC-1 — 진행 표시·[백그라운드로]·[취소]가 함께 뜬다', () => {
    render(<ReplanSolvingScreen {...baseProps()} />);

    expect(screen.getByTestId('planb-solving-progress')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-solving-background')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-solving-cancel')).toBeOnTheScreen();
  });

  it('S2 · AC-2 — [취소] press 는 onCancel 만 부른다', () => {
    const props = baseProps();
    render(<ReplanSolvingScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-solving-cancel'));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onBackground).toHaveBeenCalledTimes(0);
  });

  it('S3 · AC-3 — [백그라운드로] press 는 onBackground 만 부른다(취소와 구별)', () => {
    const props = baseProps();
    render(<ReplanSolvingScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-solving-background'));

    expect(props.onBackground).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(0);
  });
});
