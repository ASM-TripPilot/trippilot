import { fireEvent, render, screen } from '@testing-library/react-native';

import { MemoInline } from './MemoInline';

/**
 * TRIP-566 · AC-5(메모 UX) · BR-U5-13 — 방문 메모 인라인 입력(1개, PUT upsert 는 배선 훅 소관).
 *
 * 무엇을 보장하나:
 *  - 본문 없으면 placeholder "메모를 남겨보세요"(정본).
 *  - VM 으로 받은 메모 텍스트(PUT 후 낙관값)를 표시한다(신규 진입 = placeholder).
 *  - 제출 시 공백만이면 **저장 콜백 0회**(무의미 PUT 방지) · 유효하면 trim 후 onSubmit 1회.
 *
 * ★ 2000 상한은 **클라 UX 카피**(과입력 방지)일 뿐 — 룰 판정 권위는 서버(PutMemoRequest.text 1~2000).
 *   jest fireEvent.changeText 는 maxLength 를 우회하므로 **prop 값**으로만 잠근다.
 *
 * (개념) `getByPlaceholderText`·`getByText`=RNTL 완전일치. `fireEvent(input,'submitEditing')`=키보드
 *   완료 이벤트 발화. `not.toHaveBeenCalled()`=콜백 미발화.
 */

describe('🔴 AC-5 · placeholder / 초기 표시', () => {
  it('본문 없으면 placeholder "메모를 남겨보세요"', () => {
    render(<MemoInline />);
    expect(screen.getByPlaceholderText('메모를 남겨보세요')).toBeTruthy();
  });

  it('VM 메모 텍스트(낙관값)를 초기 표시한다', () => {
    render(<MemoInline text="바람이 좋았고 노을이 근사했다" />);
    expect(screen.getByTestId('record-trip-memo-input').props.value).toBe(
      '바람이 좋았고 노을이 근사했다'
    );
  });
});

describe('🔴 AC-5 · 2000 상한(UX 카피)', () => {
  it('입력 maxLength 가 2000', () => {
    render(<MemoInline />);
    expect(screen.getByTestId('record-trip-memo-input').props.maxLength).toBe(
      2000
    );
  });
});

/**
 * 🔴 TRIP-759 · AC-3 — 메모 표면 = 박스 없는 플레인 텍스트(Figma 1557:1738).
 *
 * 무엇을 보장하나: 입력 크롬에서 박스 fill 토큰 `bg-surface-soft` 가 사라진다(박스 제거).
 *
 * ★green-lie 방지: 위 AC-5 블록들은 placeholder/value/maxLength/submit **행동**만 보고 className 은
 *   안 본다 → 박스를 남겨도 전수 green(크롬 파리티가 jest 사각). 이 단언이 크롬을 새로 잠근다.
 * ★className 은 jest 에 보인다: 이 리포는 NativeWind 가 className 을 host prop 문자열로 **보존**한다
 *   (`node.props.className`, HomeScreen.test:186·MagazineScreen.test 선례, 02a §5-C). 그래서 브리프가
 *   "6-b 사각"이라 본 크롬 제거를 jest 로 잠근다(더 강한 그물). 이 단언이 **red 로 떠야** 정상 —
 *   현 className 에 `bg-surface-soft` 가 실재함을 증명(green 이면 className 미보존 신호).
 * ★한 토큰만: seed #4 가 판정 기준으로 `bg-surface-soft 부재` 를 명시. border/rounded 까지 잠그면
 *   플레인 텍스트 스타일을 과잉 구속하므로 박스 fill 부재만 못박는다.
 *
 * (개념) `String(node.props.className).split(/\s+/)` = 클래스 문자열을 토큰 배열로 쪼갬 → `not.toContain`
 *   은 그 배열에 토큰이 없음(부분문자열 오탐 회피, repo 관례).
 */
describe('🔴 AC-3 · 박스 크롬 제거(bg-surface-soft 부재)', () => {
  it('메모 입력 className 에 bg-surface-soft 박스 fill 토큰이 없다', () => {
    render(<MemoInline />);

    const input = screen.getByTestId('record-trip-memo-input');
    expect(String(input.props.className).split(/\s+/)).not.toContain(
      'bg-surface-soft'
    );
  });
});

describe('🔴 AC-5 · 제출 — 공백만이면 저장 콜백 0', () => {
  it('유효 본문 → trim 후 onSubmit 1회', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '  노을이 근사했다  ');
    fireEvent(input, 'submitEditing');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('노을이 근사했다');
  });

  it('공백만 입력 → onSubmit 0회', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '   ');
    fireEvent(input, 'submitEditing');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('입력 없이 제출 → onSubmit 0회', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    fireEvent(screen.getByTestId('record-trip-memo-input'), 'submitEditing');

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
