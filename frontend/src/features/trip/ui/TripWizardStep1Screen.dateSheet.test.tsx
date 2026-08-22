import { fireEvent, render, screen } from '@testing-library/react-native';

import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

// TRIP-445 게이트①-2 결정 A — 삭제된 프로덕션 상수 `REGIONS`를 파일 로컬 `{code,name}[]`
// 픽스처로 기계 교체(단언·동작 무변경, 위저드 화면 `regions` 계약과 같은 shape).
const REGIONS: readonly { code: string; name: string }[] = [
  { code: 'busan', name: '부산' },
  { code: 'gyeongju', name: '경주' },
  { code: 'seoul', name: '서울' },
  { code: 'jeju', name: '제주' },
  { code: 'gangneung', name: '강릉' },
  { code: 'yeosu', name: '여수' },
];

/**
 * TRIP-389 g01 날짜 선택 시트 — 달력에서 **출발일만** 고른다(단일 선택). 종료일은 배선이
 * 박수 합으로 파생하므로(`deriveEndDate`) 시트는 시작일 하나만 위로 올려보낸다.
 *
 * 무엇을 보장하나: (1) 두 진입점(날짜 행·'날짜 직접 입력')이 같은 열기 핸들러를 부르고,
 * (2) 배선이 `dateSheetOpen`을 켤 때만 시트가 마운트되며, (3) 셀 하나만 골라도 확정이 즉시
 * 활성이고 그 출발일 하나가 배선으로 올라가며, (4) 2번째 셀 press는 범위가 아니라 출발을 교체한다.
 *
 * ⚠️ TRIP-368의 2단 범위 선택(`onConfirmDates(start, end)`)에서 TRIP-389의 단일 선택
 * (`onConfirmDates(start)`)으로 전이했다 — 종료일이 화면 입력이 아니라 박수 합 파생이 됐기
 * 때문이다. 범위·in-range 하이라이트 케이스는 그래서 걷어냈다.
 *
 * 판정(박수 초과 등)은 이 화면이 아니라 배선의 `validateTripDraft`가 한다.
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

describe('단일 선택 → 확정 (AC-1)', () => {
  it('출발일 셀 하나만 골라도 확정이 즉시 활성이다 (범위 완성 대기가 없다)', () => {
    render(<TripWizardStep1Screen {...props({ dateSheetOpen: true })} />);

    // 부정 앵커 — 아무것도 안 골랐을 때는 잠겨 있다.
    expect(screen.getByTestId('trip-wizard-datesheet-confirm')).toBeDisabled();

    // 셀 하나(출발일)를 고르면 그 즉시 확정이 열린다 — 종료일을 더 고를 필요가 없다.
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    expect(screen.getByTestId('trip-wizard-datesheet-confirm')).toBeEnabled();
  });

  it('출발일을 고르고 확정하면 그 출발일 하나만 배선으로 올라가고 시트가 닫힌다', () => {
    const onConfirmDates = jest.fn();
    const onCloseDateSheet = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ dateSheetOpen: true, onConfirmDates, onCloseDateSheet })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-confirm'));

    // 종료일은 시트가 만들지 않는다 — 출발일 하나(1인자)만 올린다(배선이 박수로 파생).
    expect(onConfirmDates).toHaveBeenCalledWith('2026-06-15');
    expect(onCloseDateSheet).toHaveBeenCalledTimes(1);
  });

  it('이미 고른 뒤 다른 셀을 누르면 범위가 아니라 출발이 교체되고, 과거 셀은 무시된다', () => {
    // 이전 2단 케이스 반증 — 06-15 를 고른 뒤 06-17 을 누르면 [06-15, 06-17] 범위가 아니라
    // 출발이 06-17 로 갈아 끼워진다. 맨 앞 과거 셀(06-05)은 disabled 실차단이라 애초에 안 잡힌다.
    const onConfirmDates = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ dateSheetOpen: true, onConfirmDates })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-05'));
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-15'));
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-17'));
    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-confirm'));

    // 마지막 유효 셀(06-17)이 출발이다. 2단 범위를 만드는 구현이면 2인자로 불려 red.
    expect(onConfirmDates).toHaveBeenCalledWith('2026-06-17');
  });

  it('과거 날짜 칸은 눌러도 시작이 안 잡혀 확정이 안 열린다 (오늘 이전 비활성 · disabled 실차단)', () => {
    // §126 계승 — 단일 선택에서도 유효하고, 여기가 disabled 실차단의 그물이다. 06-05 가 가짜
    // disabled(accessibilityState 만)면 press 가 시작을 잡아 확정이 enabled 로 바뀌어 red.
    render(<TripWizardStep1Screen {...props({ dateSheetOpen: true })} />);

    expect(
      screen.getByTestId('trip-wizard-date-cell-2026-06-05')
    ).toBeDisabled();
    fireEvent.press(screen.getByTestId('trip-wizard-date-cell-2026-06-05'));
    expect(screen.getByTestId('trip-wizard-datesheet-confirm')).toBeDisabled();
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
    expect(screen.queryByTestId('trip-wizard-date-cell-2026-06-15')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-datesheet-prev'));

    // 6월로 되돌아온다(prev 도 no-op·반전이면 여기서 red).
    expect(
      screen.getByTestId('trip-wizard-date-cell-2026-06-15')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-wizard-date-cell-2026-07-15')).toBeNull();
  });
});
