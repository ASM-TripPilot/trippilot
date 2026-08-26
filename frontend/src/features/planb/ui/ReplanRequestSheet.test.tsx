import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  REPLAN_DIRECTIVES,
  REPLAN_REASONS,
} from '@/features/planb/model/replanScope';

import { ReplanRequestSheet } from './ReplanRequestSheet';

/**
 * TRIP-439 · AC-1·AC-2·BR-U4-12·D5 — i10 재계획 요청 시트(순수 props+콜백).
 *
 * 무엇을 보장하나:
 *  - 🔴 범위 2칩·사유 6칩·방향 7칩·자유텍스트·2 CTA 가 규약 testID 로 실재하고, 라벨이 카탈로그와 일치.
 *  - 🔴 칩 press → 대응 콜백(onSelectScope/onToggleReason/onToggleDirective) 이 그 key 로 불린다.
 *  - 🔴 `[AI가 다시 짜기]`↔`[직접 고르기]` 두 CTA 는 **서로 다른 콜백**을 부른다(페이지 분기의 seam).
 *  - 🔴 감지 배너+[끄기]는 `trigger` prop **있을 때만** 뜬다(D5 — 수동 진입 주 동선엔 없음).
 *
 * ★1 바텀시트 목이 children 을 통과 렌더하므로 시트 안 요소를 조회할 수 있다(시트 거동 자체는 무심판).
 * ★2 자유텍스트는 RN TextInput 계약(BottomSheetTextInput 은 목이 미제공).
 * ★3 칩=단일 leaf 라 라벨은 문자열 완전일치로 잠근다(배너는 다중 텍스트라 정규식 부분포함).
 *
 * 3동작: 준비 = 기본 props → 실행 = 렌더/press/changeText → 단언 = 요소 존재·불린 콜백.
 */

/** 기본 props — 값은 비어 있고 콜백은 스파이. 케이스마다 override. */
function baseProps() {
  return {
    scope: 'PARTIAL_SLOTS' as const,
    selectedReasons: [] as string[],
    selectedDirectives: [] as string[],
    freeText: '',
    onSelectScope: jest.fn(),
    onToggleReason: jest.fn(),
    onToggleDirective: jest.fn(),
    onChangeFreeText: jest.fn(),
    onSubmit: jest.fn(),
    onManual: jest.fn(),
  };
}

describe('🔴 R1 · 범위 2칩 · 라벨 · 단일선택 표시', () => {
  it('두 칩이 라벨과 함께 뜨고 기본 범위가 선택 표시되며 press 가 값을 올린다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    // 라벨 완전일치(칩=단일 leaf, ★3).
    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS')
    ).toHaveTextContent('지금 이후');
    expect(
      screen.getByTestId('planb-request-scope-FULL_DAY')
    ).toHaveTextContent('오늘 전체');

    // 기본값(지금 이후)이 selected.
    expect(
      screen.getByTestId('planb-request-scope-PARTIAL_SLOTS').props
        .accessibilityState?.selected
    ).toBe(true);

    // 오늘 전체 press → onSelectScope('FULL_DAY').
    fireEvent.press(screen.getByTestId('planb-request-scope-FULL_DAY'));
    expect(props.onSelectScope).toHaveBeenCalledTimes(1);
    expect(props.onSelectScope).toHaveBeenCalledWith('FULL_DAY');
  });
});

describe('🔴 R2 · 사유 6칩 전량 · 토글 콜백 (BR-U4-12)', () => {
  it('카탈로그의 사유 6종이 모두 뜨고, 하나를 누르면 그 key 로 토글된다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    // 카탈로그(모델)와 render 를 동기로 잠근다 — 6종 전부 존재 + 라벨 일치.
    REPLAN_REASONS.forEach((reason) => {
      const chip = screen.getByTestId(`planb-request-reason-${reason.key}`);
      expect(chip).toHaveTextContent(reason.label);
    });

    fireEvent.press(screen.getByTestId('planb-request-reason-WEATHER'));
    expect(props.onToggleReason).toHaveBeenCalledTimes(1);
    expect(props.onToggleReason).toHaveBeenCalledWith('WEATHER');
  });
});

describe('🔴 R3 · 방향 7칩 전량 · 토글 콜백', () => {
  it('카탈로그의 방향 7종이 모두 뜨고, 하나를 누르면 그 key 로 토글된다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    REPLAN_DIRECTIVES.forEach((directive) => {
      const chip = screen.getByTestId(
        `planb-request-directive-${directive.key}`
      );
      expect(chip).toHaveTextContent(directive.label);
    });

    fireEvent.press(screen.getByTestId('planb-request-directive-RELAX'));
    expect(props.onToggleDirective).toHaveBeenCalledTimes(1);
    expect(props.onToggleDirective).toHaveBeenCalledWith('RELAX');
  });
});

describe('🔴 R4 · 자유텍스트 (★2 RN TextInput)', () => {
  it('입력하면 onChangeFreeText 로 그 값이 올라간다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    fireEvent.changeText(
      screen.getByTestId('planb-request-freetext'),
      '저녁은 야경'
    );
    expect(props.onChangeFreeText).toHaveBeenCalledTimes(1);
    expect(props.onChangeFreeText).toHaveBeenCalledWith('저녁은 야경');
  });
});

describe('🔴 R5 · 2 CTA 분기 seam (AC-1 · AC-2)', () => {
  it('[AI가 다시 짜기]는 onSubmit 만, [직접 고르기]는 onManual 만 부른다', () => {
    const props = baseProps();
    render(<ReplanRequestSheet {...props} />);

    fireEvent.press(screen.getByTestId('planb-request-submit'));
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    expect(props.onManual).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('planb-request-manual'));
    expect(props.onManual).toHaveBeenCalledTimes(1);
    // submit 은 여전히 1회(직접 고르기가 제출을 안 부름).
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 R6 · 감지 배너 조건부 (D5)', () => {
  it('trigger 가 없으면 [끄기]가 없고, 있으면 배너+[끄기]가 뜬다', () => {
    const props = baseProps();
    const { rerender } = render(<ReplanRequestSheet {...props} />);

    // 수동 진입 주 동선 — 배너/끄기 없음.
    expect(screen.queryByTestId('planb-request-suppress')).toBeNull();

    // 트리거가 주어지면(자동 진입 변형) 배너+끄기 렌더.
    const onSuppress = jest.fn();
    rerender(
      <ReplanRequestSheet
        {...props}
        trigger={{ title: '비 예보 감지' }}
        onSuppress={onSuppress}
      />
    );

    expect(screen.getByTestId('planb-request-suppress')).toBeOnTheScreen();
    // 배너는 제목+부제를 담을 수 있어 정규식 부분포함으로 잠근다(★3).
    expect(screen.getByTestId('planb-request-detected')).toHaveTextContent(
      /비 예보 감지/
    );

    fireEvent.press(screen.getByTestId('planb-request-suppress'));
    expect(onSuppress).toHaveBeenCalledTimes(1);
  });
});
