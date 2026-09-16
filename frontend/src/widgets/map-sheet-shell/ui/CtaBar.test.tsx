import { fireEvent, render, screen } from '@testing-library/react-native';

import { CtaBar } from './CtaBar';

/**
 * TRIP-783 · AC-6 — 하단 고정 CTA 바(widgets). 1버튼/2버튼 변형을 `buttons` prop 으로 받는다
 * (h08=2버튼 `다시 짜기`아웃라인 + `확정하기`primary / h14=1버튼 `일정 저장하기`primary full).
 * 라벨은 소비처 주입(셸은 presentation-only). 변형 스타일(primary/outline)은 className 토큰으로
 * 잠근다(렌더 트리에 평문 prop 으로 남음 — loginVisual 선례).
 *
 * 3동작 뼈대: 준비=buttons 배열로 렌더 → 실행=버튼 press → 단언=버튼 수·라벨·불린 콜백.
 */

describe('🔴 CtaBar · CTA1 — 2버튼 변형(AC-6)', () => {
  it('두 버튼이 라벨·변형대로 그려지고 각자의 콜백만 부른다', () => {
    const onRetry = jest.fn();
    const onConfirm = jest.fn();
    render(
      <CtaBar
        buttons={[
          { label: '다시 짜기', variant: 'outline', onPress: onRetry },
          { label: '확정하기', variant: 'primary', onPress: onConfirm },
        ]}
      />
    );

    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '다시 짜기'
    );
    expect(screen.getByTestId('sheet-cta-button-1')).toHaveTextContent(
      '확정하기'
    );

    // 변형 잠금 — primary 는 bg-primary, outline 은 테두리(className 토큰).
    expect(
      String(screen.getByTestId('sheet-cta-button-1').props.className)
    ).toContain('bg-primary');
    expect(
      String(screen.getByTestId('sheet-cta-button-0').props.className)
    ).toContain('border');

    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    fireEvent.press(screen.getByTestId('sheet-cta-button-1'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 CtaBar · CTA2 — 1버튼 변형(AC-6)', () => {
  it('버튼 하나만 그려지고(둘째 부재 짝) press 가 그 콜백을 부른다', () => {
    const onSave = jest.fn();
    render(
      <CtaBar
        buttons={[
          { label: '일정 저장하기', variant: 'primary', onPress: onSave },
        ]}
      />
    );

    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '일정 저장하기'
    );
    // 짝 — 1버튼 변형이면 둘째 버튼은 없다.
    expect(screen.queryByTestId('sheet-cta-button-1')).toBeNull();

    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
