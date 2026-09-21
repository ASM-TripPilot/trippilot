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

describe('🔴 CtaBar · CTA3 — disabled 버튼(TRIP-799 · AC-9)', () => {
  it('disabled:true 면 버튼이 비활성이고 press 해도 onPress 를 안 부른다', () => {
    // ★5 `toBeDisabled()` 단독은 accessibilityState 만으로 통과하는 함정 — press→onPress 0 과 짝지어야
    //    심판이 된다. h14 PARTIAL 잠금(isConfirmLocked)이 이 disabled 를 쓴다.
    const onSave = jest.fn();
    render(
      <CtaBar
        buttons={[
          {
            label: '일정 저장하기',
            variant: 'primary',
            onPress: onSave,
            disabled: true,
          },
        ]}
      />
    );

    const cta = screen.getByTestId('sheet-cta-button-0');
    // 비활성 — **red 성격**: 현행 CtaBar 는 disabled 를 Pressable 에 안 실어 활성이라 이 단언이 red.
    expect(cta).toBeDisabled();

    // 눌러도 콜백이 안 나간다(disabled Pressable 은 onPress 미발화). 활성 짝은 CTA2 가 지킨다.
    fireEvent.press(cta);
    expect(onSave).not.toHaveBeenCalled();
  });
});
