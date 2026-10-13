import { fireEvent, render, screen } from '@testing-library/react-native';

import { MemoInline } from './MemoInline';

/**
 * TRIP-566 · AC-5(메모 UX) · BR-U5-13 — 방문 메모 인라인 입력(1개, PUT upsert 는 배선 훅 소관).
 *
 * 무엇을 보장하나:
 *  - 본문 없으면 placeholder "메모를 남겨보세요"(정본).
 *  - VM 으로 받은 메모 텍스트(PUT 후 낙관값)를 표시한다(신규 진입 = placeholder).
 *  - blur 시 공백만이면 **저장 콜백 0회**(무의미 PUT 방지) · 유효하면 trim 후 onSubmit 1회(TRIP-1078).
 *
 * ★ 2000 상한은 **클라 UX 카피**(과입력 방지)일 뿐 — 룰 판정 권위는 서버(PutMemoRequest.text 1~2000).
 *   jest fireEvent.changeText 는 maxLength 를 우회하므로 **prop 값**으로만 잠근다.
 *
 * (개념) `getByPlaceholderText`·`getByText`=RNTL 완전일치. `fireEvent(input,'blur')`=포커스 빠짐 이벤트
 *   발화 · `'submitEditing'`=키보드 완료 이벤트 발화. `not.toHaveBeenCalled()`=콜백 미발화.
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
 * 🔴 TRIP-1078 · AC-1·AC-2·AC-3 — 저장 경로는 blur 하나(return 은 제출→blur).
 *
 * ★ jest 의 submitEditing 은 multiline 이어도 핸들러를 부르지만 실기 iOS multiline 은 그 이벤트를 안 낸다 —
 *   옛 제출 케이스가 #064 를 통과시킨 그물. 저장 증명은 전부 'blur' 로 한다.
 * ★ jest 는 blurAndSubmit 의 "제출 뒤 blur" 연쇄를 흉내 내지 않는다 → 실기 return 은 두 이벤트를 순서대로
 *   직접 쏜다. submitEditing 만 → 0회, submitEditing+blur → 1회 가 짝이라야 "blur 하나" 가 잠긴다.
 */
describe('🔴 TRIP-1078 AC-1·AC-3 · blur 저장 — 공백만이면 저장 콜백 0', () => {
  it('유효 본문 입력 후 blur → trim 후 onSubmit 1회', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '  노을이 근사했다  ');
    fireEvent(input, 'blur');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('노을이 근사했다');
  });

  it('공백만 입력 후 blur → onSubmit 0회', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '   ');
    fireEvent(input, 'blur');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('입력 없이 blur → onSubmit 0회', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    fireEvent(screen.getByTestId('record-trip-memo-input'), 'blur');

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1078 AC-2 · return = 제출→blur, 한 번에 저장 1회', () => {
  it('입력칸의 submitBehavior 가 blurAndSubmit 이다', () => {
    render(<MemoInline />);

    expect(
      screen.getByTestId('record-trip-memo-input').props.submitBehavior
    ).toBe('blurAndSubmit');
  });

  it('submitEditing 만으로는 저장하지 않는다(저장 경로는 blur 하나)', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '파도 소리가 좋았다');
    fireEvent(input, 'submitEditing');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('실기 return 순서(submitEditing → blur)에서 onSubmit 은 1회다', () => {
    const onSubmit = jest.fn();
    render(<MemoInline onSubmit={onSubmit} />);

    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '파도 소리가 좋았다');
    fireEvent(input, 'submitEditing');
    fireEvent(input, 'blur');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('파도 소리가 좋았다');
  });
});
