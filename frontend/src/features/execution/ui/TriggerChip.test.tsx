import { fireEvent, render, screen } from '@testing-library/react-native';

import { TriggerChip } from './TriggerChip';

/**
 * TRIP-561 · i08 인앱 트리거 칩 — 순수 프레젠테이션(props 만, 재판정 0).
 *
 * 무엇을 보장하나:
 *  - 칩이 제목·부제를 그리고 `[대안 보기](chevron)`·`[끄기](×)` 두 어포던스를 가진다.
 *  - chevron/× press 가 각각 콜백으로 나간다(실제 라우팅·억제는 페이지·6-b 실기 소관 — ★3).
 *  - 색은 raw hex 가 아니라 토큰 클래스(`bg-primary-pale`·`text-primary-text`)를 쓴다.
 *
 * 3동작 뼈대: 준비=props → 실행=render/press → 단언=testID·문구·콜백·토큰.
 * 개념: **fireEvent.press(node)** = 그 노드를 눌렀다고 흉내내 onPress 를 부른다.
 */

// className 은 NativeWind 가 렌더 트리에 평문 prop 으로 남긴다(LiveItineraryScreen.test 선례).
// 공백으로 쪼갠 토큰 배열로 만들어 원소 일치(toContain)로 스타일을 잰다.
function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

const baseProps = {
  title: '다음 방문지 비 예보 70%',
  subtitle: '탭하여 실내 대안 보기',
  onPressAlternative: jest.fn(),
  onDismiss: jest.fn(),
};

describe('TriggerChip (i08)', () => {
  it('C1 칩·제목·부제·chevron·× 를 그린다', () => {
    render(<TriggerChip {...baseProps} />);
    expect(screen.getByTestId('execution-live-trigger-chip')).toBeTruthy();
    expect(screen.getByText('다음 방문지 비 예보 70%')).toBeTruthy();
    expect(screen.getByText('탭하여 실내 대안 보기')).toBeTruthy();
    expect(
      screen.getByTestId('execution-live-trigger-alternative')
    ).toBeTruthy();
    expect(screen.getByTestId('execution-live-trigger-dismiss')).toBeTruthy();
  });

  it('C2 chevron(대안 보기)을 누르면 onPressAlternative 가 불린다', () => {
    const onPressAlternative = jest.fn();
    render(
      <TriggerChip {...baseProps} onPressAlternative={onPressAlternative} />
    );
    fireEvent.press(screen.getByTestId('execution-live-trigger-alternative'));
    expect(onPressAlternative).toHaveBeenCalledTimes(1);
  });

  it('C3 ×(끄기)를 누르면 onDismiss 가 불린다', () => {
    const onDismiss = jest.fn();
    render(<TriggerChip {...baseProps} onDismiss={onDismiss} />);
    fireEvent.press(screen.getByTestId('execution-live-trigger-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('C4 배경·글자색이 raw hex 가 아니라 primary 토큰 클래스다', () => {
    render(<TriggerChip {...baseProps} />);
    // 칩 루트 배경 = primary-pale 토큰.
    const chip = screen.getByTestId('execution-live-trigger-chip');
    expect(classTokens(chip)).toContain('bg-primary-pale');
    // 제목 글자색 = primary-text 토큰(글자색은 그 Text 가 진다).
    const title = screen.getByText('다음 방문지 비 예보 70%');
    expect(classTokens(title)).toContain('text-primary-text');
  });
});
