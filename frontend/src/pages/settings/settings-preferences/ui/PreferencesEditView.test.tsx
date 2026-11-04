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

/**
 * TRIP-1755 · 취향 조회가 실패하면 빈 화면 대신 오류 + 다시 시도(INV-4).
 *
 * 무엇을 보장하나(순수 뷰 — props 로 상태를 먹인다):
 *  - PV1 `selection=null` + `loadFailed` → 오류 얼굴(`settings-pref-load-error`)과 다시 시도, 저장 버튼·안내 한 줄은 없다.
 *    저장 실패 전용 `settings-pref-error` 와 섞이지 않는다. 뒤로 가는 길은 열려 있다.
 *  - PV2 `retrying` 이면 다시 시도가 비활성이다(연타로 요청이 늘지 않게). 아니면 활성이다.
 *  - PV3 `loadFailed` 를 안 주면(= 로딩 중 · 프리뷰) 오류 얼굴은 없다 — 응답을 기다리는 동안 오류로 번쩍이지 않는다.
 * 조회·재시도·시드의 실제 배선은 `SettingsPreferencesPage.integration.test.tsx` 가 잰다.
 *
 * 3동작 뼈대: 준비=props → 실행=render(+press) → 단언=testID 있음/없음·콜백·비활성.
 */
describe('TRIP-1755 · 취향 조회 실패 얼굴 (순수 뷰)', () => {
  const LOAD_ERROR = 'settings-pref-load-error';
  const LOAD_RETRY = 'settings-pref-load-retry';

  function renderView(
    overrides: Partial<React.ComponentProps<typeof PreferencesEditView>> = {}
  ) {
    const props = {
      selection: null,
      saveError: false,
      onToggle: jest.fn(),
      onTogglePet: jest.fn(),
      onSave: jest.fn(),
      onBack: jest.fn(),
      ...overrides,
    };
    render(<PreferencesEditView {...props} />);
    return props;
  }

  it('PV1 loadFailed 면 오류 얼굴·다시 시도가 있고 저장·안내·저장 실패 줄은 없으며, 다시 시도·뒤로가 콜백으로 나간다', () => {
    const onRetry = jest.fn();
    const props = renderView({ loadFailed: true, onRetry });

    expect(screen.getByTestId(LOAD_ERROR)).toBeOnTheScreen();
    expect(screen.getByTestId(LOAD_RETRY)).toBeOnTheScreen();
    expect(screen.queryByTestId('settings-pref-save')).toBeNull();
    expect(screen.queryByTestId('settings-pref-priority-note')).toBeNull();
    expect(screen.queryByTestId('settings-pref-error')).toBeNull();

    fireEvent.press(screen.getByTestId(LOAD_RETRY));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('settings-pref-back'));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('PV2 retrying 이면 다시 시도가 비활성이고, 아니면 활성이다(짝)', () => {
    const { unmount } = render(
      <PreferencesEditView
        selection={null}
        saveError={false}
        loadFailed
        retrying
        onRetry={jest.fn()}
        onToggle={jest.fn()}
        onTogglePet={jest.fn()}
        onSave={jest.fn()}
        onBack={jest.fn()}
      />
    );
    expect(screen.getByTestId(LOAD_RETRY)).toBeDisabled();
    unmount();

    renderView({ loadFailed: true, retrying: false, onRetry: jest.fn() });
    expect(screen.getByTestId(LOAD_RETRY)).toBeEnabled();
  });

  it('PV3 loadFailed 를 안 주면(로딩 중) 오류 얼굴이 없다 — 뷰는 그려져 있다', () => {
    renderView({ selection: null });

    // 긍정 앵커: 뷰는 떠 있고 헤더 뒤로가 있다.
    expect(screen.getByTestId('settings-pref-back')).toBeOnTheScreen();
    expect(screen.queryByTestId(LOAD_ERROR)).toBeNull();
    expect(screen.queryByTestId(LOAD_RETRY)).toBeNull();
  });
});
