import { fireEvent, render, screen } from '@testing-library/react-native';

import { REGIONS } from '@/features/explore/model/regions';

import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-368 g01 날짜 선택 시트 — 프리셋 밖 임의 기간을 달력에서 범위로 고른다.
 *
 * 무엇을 보장하나: (1) 두 진입점(날짜 행·'날짜 직접 입력')이 같은 열기 핸들러를 부르고,
 * (2) 배선이 `dateSheetOpen`을 켤 때만 시트가 마운트되며, (3) 달력에서 임의 범위를 고르고
 * 확정하면 그 시작·종료가 배선으로 올라가고, (4) 범위가 완성되기 전엔 확정이 잠긴다.
 *
 * 판정(박수 초과 등)은 이 화면이 아니라 배선의 `validateTripDraft`가 한다 — 이 시트는 시작·종료만
 * 만든다. `applyDatePick`이 역전 범위를 구조적으로 못 만드는 성질은 `tripDatePicker.test.ts`가 본다.
 *
 * 3동작: 준비(props) → 실행(렌더·press) → 단언(보이는 것 / 불린 콜백).
 */

const BASE = '2026-06-10';

function props(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return {
    destinations: [],
    startDate: undefined,
    endDate: undefined,
    presetCode: undefined,
    party: 1,
    companionType: undefined,
    preferenceChips: [],
    regions: REGIONS,
    canProceed: false,
    baseDate: BASE,
    onBack: jest.fn(),
    onAddDestination: jest.fn(),
    onRemoveDestination: jest.fn(),
    onSelectPreset: jest.fn(),
    onPressPeriod: jest.fn(),
    onCloseDateSheet: jest.fn(),
    onConfirmDates: jest.fn(),
    onChangeParty: jest.fn(),
    onSelectCompanion: jest.fn(),
    onChangePreference: jest.fn(),
    onNext: jest.fn(),
    ...over,
  };
}

describe('두 진입점이 같은 열기 핸들러를 부른다 (AC — 진입 2곳)', () => {
  it('날짜 행을 누르면 onPressPeriod 가 불린다', () => {
    const onPressPeriod = jest.fn();
    render(<TripWizardStep1Screen {...props({ onPressPeriod })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-date-field'));

    expect(onPressPeriod).toHaveBeenCalledTimes(1);
  });

  it("'날짜 직접 입력'을 누르면 같은 onPressPeriod 가 불린다", () => {
    const onPressPeriod = jest.fn();
    // '날짜 직접 입력' 버튼은 등록 숙소가 없는 얼굴(empty)에서 뜬다.
    render(
      <TripWizardStep1Screen
        {...props({ onPressPeriod, stayImport: { kind: 'empty' } })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-manual-dates'));

    expect(onPressPeriod).toHaveBeenCalledTimes(1);
  });
});

describe('시트는 dateSheetOpen 일 때만 마운트된다', () => {
  it('닫혀 있으면 달력이 없다', () => {
    render(<TripWizardStep1Screen {...props({ dateSheetOpen: false })} />);

    expect(screen.queryByTestId('trip-wizard-datesheet')).toBeNull();
  });

  it('열리면 달력과 날짜 칸이 그려진다', () => {
    render(<TripWizardStep1Screen {...props({ dateSheetOpen: true })} />);

    expect(screen.getByTestId('trip-wizard-datesheet')).toBeOnTheScreen();
    // 기준 달(2026-06)의 칸들이 보인다.
    expect(
      screen.getByTestId('trip-wizard-date-cell-2026-06-15')
    ).toBeOnTheScreen();
  });
});

describe('임의 범위 선택 → 확정 (AC — 선택)', () => {
  it('범위가 완성되기 전에는 확정이 잠긴다', () => {
    render(<TripWizardStep1Screen {...props({ dateSheetOpen: true })} />);

    // 아무것도 안 골랐을 때
    expect(screen.getByTestId('trip-wizard-datesheet-confirm')).toBeDisabled();

    // 시작만 골랐을 때도 잠겨 있어야 한다(종료 미정).
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    expect(screen.getByTestId('trip-wizard-datesheet-confirm')).toBeDisabled();
  });

  it('시작·종료를 고른 뒤 확정하면 그 범위가 배선으로 올라가고 시트가 닫힌다 (2박 3일)', () => {
    const onConfirmDates = jest.fn();
    const onCloseDateSheet = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ dateSheetOpen: true, onConfirmDates, onCloseDateSheet })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-17'));

    expect(screen.getByTestId('trip-wizard-datesheet-confirm')).toBeEnabled();
    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-confirm'));

    expect(onConfirmDates).toHaveBeenCalledWith('2026-06-15', '2026-06-17');
    expect(onCloseDateSheet).toHaveBeenCalledTimes(1);
  });

  it('과거 날짜 칸은 눌러도 범위에 안 들어간다 (오늘 이전 비활성)', () => {
    const onConfirmDates = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ dateSheetOpen: true, onConfirmDates })}
      />
    );

    // BASE=2026-06-10 이전 칸은 disabled 라 눌러도 시작이 안 잡힌다.
    expect(
      screen.getByTestId('trip-wizard-date-cell-2026-06-05')
    ).toBeDisabled();
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-05'));
    expect(screen.getByTestId('trip-wizard-datesheet-confirm')).toBeDisabled();
  });

  it('🔴 과거 셀을 눌러도 시작으로 안 잡히고, 이어 미래 셀을 누르면 그 미래 셀이 시작이 된다 (disabled prop 실차단)', () => {
    // 앞 케이스는 "확정이 잠긴다"만 봐서, `disabled` 를 `accessibilityState` 만으로 바꿔도(회색인데
    // 눌리는 함정) 통과했다. 이 케이스는 **과거 press 가 실제로 무시되는가**를 확정으로 본다(TRIP-375).
    const onConfirmDates = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ dateSheetOpen: true, onConfirmDates })}
      />
    );

    // 과거(06-05) → 미래(06-15) → 미래(06-17) 순으로 누른다.
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-05'));
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-17'));

    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-confirm'));

    // disabled 가 실차단이면 과거 press 는 버려지고 시작은 06-15 다. 실차단이 아니면 시작이
    // 06-05 로 잡혀 뒤 순서가 어긋나고, 이 정확 일치 단언이 red 를 낸다.
    expect(onConfirmDates).toHaveBeenCalledWith('2026-06-15', '2026-06-17');
  });
});

describe('in-range 하이라이트가 시작·종료 사이 칸에 켜진다 (AC — 렌더 단언)', () => {
  it('🔴 시작·종료 사이 셀은 endpoint 가 아니어도 in-range 배경이 켜진다', () => {
    // isDateInRange 하한/상한이 옳아도, 화면이 그 결과를 배경 토큰으로 그리지 않으면 사용자는
    // 범위를 못 본다 — 그 렌더 연결이 지금까지 무판정이었다(TRIP-375).
    render(<TripWizardStep1Screen {...props({ dateSheetOpen: true })} />);

    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-18'));

    // 사이 셀(06-16)은 endpoint 가 아니라 in-range 배경(primary-pale)이라야 한다.
    const mid = screen.getByTestId('trip-wizard-date-cell-2026-06-16');
    expect(String(mid.props.className)).toContain('bg-primary-pale');

    // 짝(부정) — 범위 밖 셀(06-20)은 그 배경이 없다. 없으면 "전부 켜는" 구현도 통과한다.
    const outside = screen.getByTestId('trip-wizard-date-cell-2026-06-20');
    expect(String(outside.props.className)).not.toContain('bg-primary-pale');
  });
});

describe('월 이동 (prev/next)', () => {
  it('🔴 다음 달을 누르면 그 달 칸이 그려지고, 이전 달로 되돌아온다', () => {
    render(<TripWizardStep1Screen {...props({ dateSheetOpen: true })} />);

    // 기준 달 2026-06 의 칸이 보인다.
    expect(
      screen.getByTestId('trip-wizard-date-cell-2026-06-15')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-next'));

    // 7월로 넘어가면 7월 칸이 생기고 6월 칸은 사라진다. next 가 no-op 이거나 방향이 반전되면
    // 07-15 칸이 안 생겨 red.
    expect(
      screen.getByTestId('trip-wizard-date-cell-2026-07-15')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-date-cell-2026-06-15')
    ).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-prev'));

    // 6월로 되돌아온다(prev 도 no-op·반전이면 여기서 red).
    expect(
      screen.getByTestId('trip-wizard-date-cell-2026-06-15')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-date-cell-2026-07-15')
    ).toBeNull();
  });
});
