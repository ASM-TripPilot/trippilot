import { fireEvent, render, screen } from '@testing-library/react-native';

import { PreferencesEditView } from './PreferencesEditView';

/**
 * TRIP-991 · 여행 취향 편집 앱바 뒤로의 접근성(AC-2).
 *
 * 무엇을 보장하나: 앱바 뒤로 글리프 버튼이 VoiceOver 에 "뒤로" 버튼으로 읽히고(testID
 * `settings-pref-back` 신설), 누르면 onBack 이 1회 불린다 — 이 화면의 뒤로 배선을 잠그는 첫 테스트다.
 * 뷰만 렌더한다(컨테이너 `PreferencesEditScreen` 은 네트워크 훅을 끌고 온다).
 * 3동작 뼈대: 준비=selection null(축 미렌더) → 실행=render → "뒤로" press → 단언=역할·이름·testID·콜백.
 */

describe('🔴 PreferencesEditView · TRIP-991 앱바 뒤로', () => {
  it('앱바 뒤로는 "뒤로" 버튼으로 읽히고, 누르면 onBack 이 1회 불린다', () => {
    const onBack = jest.fn();
    render(
      <PreferencesEditView
        selection={null}
        saveError={false}
        onToggle={jest.fn()}
        onTogglePet={jest.fn()}
        onSave={jest.fn()}
        onBack={onBack}
      />
    );

    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back).toHaveProp('testID', 'settings-pref-back');

    fireEvent.press(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
