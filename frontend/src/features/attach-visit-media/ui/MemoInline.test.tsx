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
 *   jest fireEvent.changeText 는 maxLength 를 우회해 jest 로 못 본다 — 실화면 QA(기능 지도 trip-record) 몫.
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
    expect(onSubmit).toHaveBeenCalledWith('노을이 근사했다', '');
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

// TRIP-1415 AC-5 · D8 — 첫 서버 메모 조회가 끝나기 전엔 입력을 잠근다(빈칸에 써서 서버 메모를 덮는 upsert 차단).
// RNTL 은 editable=false 입력의 changeText·blur 를 버린다 — 실제 TextInput 과 같은 동작을 본다(02a ★2).
describe('잠금 — editable={false} 면 글자도 저장도 받지 않는다', () => {
  it('L1 잠긴 입력에 글을 넣고 포커스를 빼도 값은 시드 그대로이고 onSubmit 0회', () => {
    // 준비
    const onSubmit = jest.fn();
    render(<MemoInline text="서버 글" editable={false} onSubmit={onSubmit} />);

    // 실행
    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '바꾼 글');
    fireEvent(input, 'blur');

    // 단언
    expect(screen.getByTestId('record-trip-memo-input').props.value).toBe(
      '서버 글'
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('🔴 TRIP-1078 AC-2 · return = 제출→blur, 한 번에 저장 1회', () => {
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
    expect(onSubmit).toHaveBeenCalledWith('파도 소리가 좋았다', '');
  });
});

// TRIP-1426 AC-8 · UX-05 — 스크린리더가 읽을 이름. j01·허브 메모 시트가 같은 입력을 쓴다. 접근성 트리에 실제로 잡히는지는
// 통과형 시트 목 아래라 jest 가 못 본다(6-b 실기 — agent-device 수정 전/후 대조).
// (개념) `toHaveAccessibleName` = 접근성 이름(라벨 → 없으면 글자) 완전 일치 — placeholder 는 이름이 되지 않는다.
describe('🔴 TRIP-1426 AC-8 · 메모 입력칸의 접근성 이름은 "메모 입력"이다', () => {
  it('A1 입력칸을 "메모 입력" 이름으로 찾을 수 있다', () => {
    // 준비·실행
    render(<MemoInline />);

    // 단언
    const input = screen.getByTestId('record-trip-memo-input');
    expect(input).toHaveAccessibleName('메모 입력');
    expect(screen.getByLabelText('메모 입력')).toBe(input);
  });
});

describe('🔴 TRIP-1492 · onSubmit 두 번째 인자는 마운트 때 심은 글이다', () => {
  it('시드 "서버 글" 로 마운트 → 글을 고쳐 blur 하면 (고친 글, "서버 글"), text prop 이 나중에 바뀌어도 seed 는 그대로', () => {
    const onSubmit = jest.fn();
    const { rerender } = render(
      <MemoInline text="서버 글" onSubmit={onSubmit} />
    );
    rerender(<MemoInline text="다른 기기 글" onSubmit={onSubmit} />);

    const input = screen.getByTestId('record-trip-memo-input');
    fireEvent.changeText(input, '고친 글');
    fireEvent(input, 'blur');

    expect(onSubmit).toHaveBeenCalledWith('고친 글', '서버 글');
  });
});
