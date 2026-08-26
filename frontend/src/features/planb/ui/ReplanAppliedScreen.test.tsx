import { fireEvent, render, screen } from '@testing-library/react-native';

import { ReplanAppliedScreen } from './ReplanAppliedScreen';

/**
 * TRIP-441 · AC-2·8 — i19 **반영 완료** 화면(순수, props+콜백만, 라우팅·훅 모름).
 *
 * 무엇을 보장하나:
 *  - 🔴 헤더(뒤로·제목) + 체크 아이콘 + `새 일정이 반영됐어요` + [여행 계속하기]가 함께 뜬다(AC-2).
 *  - 🔴 [여행 계속하기] press → onContinue 만, 뒤로 press → onBack 만(혼선 없음).
 *  - 🔴 되돌리기·지표 chip·전후 배지는 **이번 서브셋에 없다**(AC-8 · draft 부재 · D2 거짓 자리표시 금지).
 *
 * ★ 계약 최소화: 이 테스트는 onBack·onContinue **둘만** 넘긴다 — 구현은 데이터 prop 을 필수로
 *   만들면 안 된다. 지표·전후 항목은 AC 가 없어(계약 공백) 안 잰다 — 부재를 S4 가 잠근다.
 * ★ 체크 아이콘 픽셀·primary bg 는 목이 못 보는 계열(6-b 실기) — 여기선 testID 존재로만.
 *
 * 3동작 뼈대: 준비=props → 실행=렌더/press → 단언=요소 존재·불린 콜백.
 */

function baseProps() {
  return {
    onBack: jest.fn(),
    onContinue: jest.fn(),
  };
}

describe('🔴 ReplanAppliedScreen — i19 반영 완료 서브셋(AC-2·8)', () => {
  it('S1 · AC-2 — 헤더·체크·문구·[여행 계속하기]가 함께 뜬다', () => {
    render(<ReplanAppliedScreen {...baseProps()} />);

    expect(screen.getByText('변경 반영됨')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-applied-back')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-applied-check')).toBeOnTheScreen();
    expect(screen.getByText('새 일정이 반영됐어요')).toBeOnTheScreen();
    expect(screen.getByTestId('planb-applied-continue')).toBeOnTheScreen();
  });

  it('S2 · AC-2 — [여행 계속하기] press 는 onContinue 만 부른다', () => {
    const props = baseProps();
    render(<ReplanAppliedScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-applied-continue'));

    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onBack).toHaveBeenCalledTimes(0);
  });

  it('S3 · 헤더 뒤로 press 는 onBack 만 부른다(계속하기와 구별)', () => {
    const props = baseProps();
    render(<ReplanAppliedScreen {...props} />);

    fireEvent.press(screen.getByTestId('planb-applied-back'));

    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onContinue).toHaveBeenCalledTimes(0);
  });

  it('S4 · AC-8 경계 — 되돌리기·지표·전후 배지는 없다(draft 부재)', () => {
    render(<ReplanAppliedScreen {...baseProps()} />);

    // 긍정 앵커 — 서브셋의 핵심은 있다(부정 짝이 공허 통과하지 않게).
    expect(screen.getByText('새 일정이 반영됐어요')).toBeOnTheScreen();

    // 부정 짝 — draft 계약 공백으로 이번에 안 그리는 표면들을 잠근다(D2).
    expect(screen.queryByText('되돌리기')).toBeNull();
    expect(screen.queryByTestId('planb-applied-metrics')).toBeNull();
    expect(screen.queryByTestId('planb-applied-diff')).toBeNull();
  });
});
