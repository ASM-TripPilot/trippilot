import { fireEvent, render, screen } from '@testing-library/react-native';

import { PreferencesEditView } from './PreferencesEditView';

/**
 * TRIP-991 · 여행 취향 편집 앱바 뒤로의 접근성(AC-2).
 *
 * 무엇을 보장하나: 앱바 뒤로 글리프 버튼이 VoiceOver 에 "뒤로" 버튼으로 읽히고(testID
 * `settings-pref-back` 신설), 누르면 onBack 이 1회 불린다 — 이 화면의 뒤로 배선을 잠그는 첫 테스트다.
 * 뷰만 렌더한다(컨테이너 `SettingsPreferencesPage` 은 네트워크 훅을 끌고 온다).
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

describe('TRIP-1438 Q-122 · 밀도 칩 표시 라벨', () => {
  it('서버 enum "균형있게"는 화면에 "균형 있게"로 보이고, 누르면 enum 그대로 onToggle 에 간다', () => {
    const onToggle = jest.fn();
    render(
      <PreferencesEditView
        selection={{
          styles: null,
          activities: null,
          transportModes: null,
          foodTastes: null,
          pace: '균형있게',
          companionTypes: null,
          petFlag: false,
        }}
        saveError={false}
        onToggle={onToggle}
        onTogglePet={jest.fn()}
        onSave={jest.fn()}
        onBack={jest.fn()}
      />
    );

    const chip = screen.getByTestId('settings-pref-pace-균형있게');
    expect(chip).toHaveTextContent('균형 있게');
    expect(screen.queryByText('균형있게')).toBeNull();

    fireEvent.press(chip);
    expect(onToggle).toHaveBeenCalledWith('pace', '균형있게');
  });
});
