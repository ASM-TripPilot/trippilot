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
