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
