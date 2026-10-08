import { fireEvent, render, screen } from '@testing-library/react-native';

import { NicknameEditRow } from './NicknameEditRow';

/**
 * TRIP-991 · 닉네임 인라인 편집의 [저장] 버튼 접근성(AC-1).
 *
 * 무엇을 보장하나: 행을 펼치면 나오는 [저장]이 VoiceOver 에 "저장" 버튼으로 읽히고, 누르면 현재 초안을
 * onSubmit 으로 1회 올린다. 저장 검증·서버 오류는 페이지 몫(SettingsPage.test.tsx).
 * 3동작 뼈대: 준비=value 주입 → 실행=편집 트리거 press → [저장] press → 단언=역할·이름·콜백.
 */

describe('🔴 NicknameEditRow · TRIP-991 저장 버튼 역할', () => {
  it('펼친 행의 [저장]은 "저장" 버튼으로 읽히고, 누르면 초안으로 onSubmit 이 1회 불린다', () => {
    const onSubmit = jest.fn();
    render(<NicknameEditRow value="여행자123" onSubmit={onSubmit} />);

    fireEvent.press(screen.getByTestId('settings-nickname-edit'));

    const save = screen.getByRole('button', { name: '저장' });
    expect(save).toHaveProp('testID', 'settings-nickname-save');

    fireEvent.press(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('여행자123');
  });
});

// TRIP-1305
/**
 * 무엇을 보장하나: 페이지가 "저장 중"(saving)을 내려 주면 [저장]은 흐리게(opacity-40) 비활성이 되어 눌러도
 * onSubmit 이 안 불리고, 입력칸은 편집이 막혀(editable=false) 고쳐 써도 값이 그대로다. 저장 중이 아니면
 * 둘 다 평소대로다. 연타 차단의 진짜 그물은 페이지 잠금이다(SettingsPage.hookMock.test.tsx) — 여기는 표시.
 */
describe('NicknameEditRow · 저장 중 표시', () => {
  function tokens(el: { props: { className?: unknown } }): string[] {
    return String(el.props.className ?? '')
      .split(/\s+/)
      .filter(Boolean);
  }

  it('저장 중이면 [저장]은 흐린 비활성이라 눌러도 onSubmit 이 안 불리고, 입력칸은 고쳐지지 않는다', () => {
    const onSubmit = jest.fn();
    const onDraftChange = jest.fn();
    const props = { value: '여행자123', onSubmit, onDraftChange };
    // 행은 저장 전에 펼쳐 둔다 — 저장 중엔 행 머리 토글도 막히므로(03b W1) 펼친 뒤 saving 을 켠다.
    const { rerender } = render(<NicknameEditRow {...props} />);
    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    rerender(<NicknameEditRow {...props} saving />);
    const save = screen.getByTestId('settings-nickname-save');
    const input = screen.getByTestId('settings-nickname-input');

    fireEvent.press(save);
    fireEvent.changeText(input, '새이름');

    expect(save).toBeDisabled();
    expect(tokens(save)).toContain('opacity-40');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input).toHaveProp('editable', false);
    expect(input).toHaveDisplayValue('여행자123');
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it('짝: 저장 중이 아니면 [저장]은 활성이고 흐리지 않으며, 입력칸은 고쳐진다', () => {
    render(<NicknameEditRow value="여행자123" onSubmit={jest.fn()} />);
    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    const save = screen.getByTestId('settings-nickname-save');
    const input = screen.getByTestId('settings-nickname-input');

    fireEvent.changeText(input, '새이름');

    expect(save).not.toBeDisabled();
    expect(tokens(save)).not.toContain('opacity-40');
    expect(input).toHaveDisplayValue('새이름');
  });

  // 03b W1
  it('저장 중이면 행 머리를 눌러도 접히지 않고 입력값이 그대로이며, 저장이 끝나면 다시 접힌다', () => {
    const props = { value: '여행자123', onSubmit: jest.fn() };
    const { rerender } = render(<NicknameEditRow {...props} />);
    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    fireEvent.changeText(
      screen.getByTestId('settings-nickname-input'),
      '새이름'
    );

    rerender(<NicknameEditRow {...props} saving />);
    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    expect(screen.getByTestId('settings-nickname-input')).toHaveDisplayValue(
      '새이름'
    );

    rerender(<NicknameEditRow {...props} />);
    fireEvent.press(screen.getByTestId('settings-nickname-edit'));
    expect(screen.queryByTestId('settings-nickname-input')).toBeNull();
  });
});
