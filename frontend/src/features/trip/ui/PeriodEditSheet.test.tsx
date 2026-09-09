import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TripDateRange } from '@/features/trip/model/tripDatePicker';

import { PeriodEditSheet } from './PeriodEditSheet';

/**
 * TRIP-667 g01 기간 편집 바텀시트 — **props-only 프레젠테이션**(01b D5).
 *
 * 무엇을 보장하나: 시트가 넘겨받은 `range`·`month`·`today`로 ① 월 네비·요일 헤더·날짜 그리드를 그리고
 * ② 범위 3상태(시작/사이/종료)를 **서로 다른 testID 표식**으로 구분해 그리며 ③ 셀·월 네비·적용 press 를
 * 받은 콜백으로 정확히 올린다. 이 시트는 **상태를 안 가진다** — 보는 달·고른 범위는 배선(TripNewStep1Page)이
 * `applyRangePick`/`shiftMonth`로 소유하고, 시트는 완성형 props 를 받아 그릴 뿐이다(개폐도 배선 소유).
 *
 * 왜 마커를 색 fill 이 아니라 서로 다른 testID 로 잠그나: SVG/배경색 fill 은 jest 렌더 트리에서
 * className/testID 로 관찰되지 않아, 시작·사이·종료를 색으로만 구분하면 셋이 뒤바뀌어도 심판이 못 본다
 * (repo-traps "글리프 fill jest 무심판"). 서로 다른 testID 표식이라야 뒤바뀜이 red 로 잡힌다.
 *
 * 무엇을 **못** 보나(6-b 실기 전용): `__mocks__/@gorhom/bottom-sheet.tsx`가 통과형 목이라(마운트하면
 * children 무조건 렌더) 실제 개폐·딤 전면 커버·범위 하이라이트 실렌더·터치 차단은 jest 원리적 사각이다.
 *
 * 왜 `range`·`month`가 props 인가: 이 시트는 무상태라 "셀 탭 → 표식 변화"(전이)는 배선이 range 를
 * 갱신해 재렌더할 때 일어난다 — 그 전이는 통합 테스트(`TripNewStep1Page.period.integration`)가 잡고,
 * 여기선 "주어진 range 로 어떤 표식을 그리나"(렌더)와 "탭이 어떤 콜백을 부르나"(배선)까지만 잠근다.
 */

function renderSheet(overrides: Partial<PeriodEditSheetPropsForTest> = {}) {
  const spies = {
    onPickDate: jest.fn(),
    onPrevMonth: jest.fn(),
    onNextMonth: jest.fn(),
    onApply: jest.fn(),
    onClose: jest.fn(), // TRIP-683: 딤 바깥 탭 닫힘 콜백(필수 prop 화)
  };
  const props: PeriodEditSheetPropsForTest = {
    today: '2026-06-01',
    month: '2026-06',
    range: {},
    ...spies,
    ...overrides,
  };
  render(<PeriodEditSheet {...props} />);
  return spies;
}

interface PeriodEditSheetPropsForTest {
  today: string;
  month: string;
  range: TripDateRange;
  onPickDate: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onApply: () => void;
  onClose: () => void;
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

describe('AC-1 · 월 네비·요일 헤더·날짜 그리드 렌더', () => {
  it('시트 컨테이너·월 표기·chevron 2개·요일 7칸·날짜 셀을 그린다', () => {
    renderSheet();

    expect(screen.getByTestId('trip-wizard-period-sheet')).toBeOnTheScreen();
    // 월 표기 — 자식 분절(2026/년/6/월)에 안 흔들리게 testID + 완전일치(repo RNTL string=exact).
    expect(screen.getByTestId('trip-wizard-period-month')).toHaveTextContent(
      '2026년 6월'
    );
    expect(screen.getByTestId('trip-wizard-period-prev')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-period-next')).toBeOnTheScreen();

    // 요일 헤더 일~토 7칸(각 셀은 그 한 글자만 담은 Text — 월표기 "2026년 6월"과 안 겹친다).
    for (const label of WEEKDAY_LABELS) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }

    // 그리드 — 6월 첫날·중간·말일 셀이 실재한다.
    expect(
      screen.getByTestId('trip-wizard-period-cell-2026-06-01')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-period-cell-2026-06-15')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-period-cell-2026-06-30')
    ).toBeOnTheScreen();

    // 빈 범위 — 어떤 범위 표식도 없다.
    expect(
      screen.queryByTestId('trip-wizard-period-cell-start-2026-06-01')
    ).toBeNull();
  });
});

describe('AC-2 · 범위 3상태 표식 (시작/사이/종료 서로 다른 testID)', () => {
  it('시작만 있으면 시작 표식만 뜨고, 사이·종료 표식은 없다', () => {
    renderSheet({ range: { start: '2026-06-10' } });

    expect(
      screen.getByTestId('trip-wizard-period-cell-start-2026-06-10')
    ).toBeOnTheScreen();
    // 미완성 — 종료·사이 표식 부재.
    expect(
      screen.queryByTestId('trip-wizard-period-cell-end-2026-06-10')
    ).toBeNull();
    expect(
      screen.queryByTestId('trip-wizard-period-cell-between-2026-06-11')
    ).toBeNull();
  });

  it('완성 범위는 시작·사이·종료를 각각 다른 표식으로 그린다 (뒤바뀜이 red)', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-13' } });

    // 시작 = 10, 종료 = 13 (양 끝 각자 표식)
    expect(
      screen.getByTestId('trip-wizard-period-cell-start-2026-06-10')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-period-cell-end-2026-06-13')
    ).toBeOnTheScreen();
    // 사이 = 11·12 (양 끝 사이만)
    expect(
      screen.getByTestId('trip-wizard-period-cell-between-2026-06-11')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-period-cell-between-2026-06-12')
    ).toBeOnTheScreen();

    // 뒤바뀜 방지 — 시작 표식이 종료 자리(13)에, 종료 표식이 시작 자리(10)에 있으면 안 된다.
    expect(
      screen.queryByTestId('trip-wizard-period-cell-start-2026-06-13')
    ).toBeNull();
    expect(
      screen.queryByTestId('trip-wizard-period-cell-end-2026-06-10')
    ).toBeNull();
    // 양 끝은 사이 표식이 아니다(사이가 끝까지 번지면 red).
    expect(
      screen.queryByTestId('trip-wizard-period-cell-between-2026-06-10')
    ).toBeNull();
    expect(
      screen.queryByTestId('trip-wizard-period-cell-between-2026-06-13')
    ).toBeNull();
  });

  it('날짜 셀 탭 → onPickDate(그 날짜) 를 부른다 (배선 신호)', () => {
    const spies = renderSheet();

    fireEvent.press(screen.getByTestId('trip-wizard-period-cell-2026-06-10'));

    expect(spies.onPickDate).toHaveBeenCalledWith('2026-06-10');
  });
});

describe('AC-3 · 선택 요약 (실제 달력 요일)', () => {
  it('완성 범위면 "M월 D일(요일) – D일(요일) · N박 N일" 을 실제 달력 요일로 그린다', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-13' } });

    // 실측 오라클(02a §5-2): 2026-06-10 = 수, 2026-06-13 = 토. 브리프 예시(화/금)는 손베낌 오기.
    // en dash(U+2013) · 미들닷(U+00B7) 포함. summaryPeriod 동형이라 요일 계산이 틀리면 red.
    expect(
      screen.getByText('6월 10일(수) – 13일(토) · 3박 4일')
    ).toBeOnTheScreen();
  });

  it('미완성(시작만)이면 완성 요약을 그리지 않는다', () => {
    renderSheet({ range: { start: '2026-06-10' } });

    // en dash 는 완성 요약에만 등장한다 — 없으면 완성 요약이 안 떴다는 뜻.
    expect(screen.queryByText(/–/)).toBeNull();
  });
});

describe('AC-4 · "적용" 은 범위 완성 시에만 활성 (진짜 disabled prop, 01b D1)', () => {
  it('빈 범위 — disabled 매처 + press 무반응 + onApply 0회 (3단)', () => {
    const spies = renderSheet({ range: {} });

    const apply = screen.getByTestId('trip-wizard-period-apply');
    expect(apply).toBeDisabled();

    // 진짜 disabled prop 이면 press 가 안 먹는다(accessibilityState 만 세운 가짜는 여기서 red).
    fireEvent.press(apply);
    expect(spies.onApply).not.toHaveBeenCalled();
  });

  it('시작만 있어도(미완성) 여전히 disabled + press 무반응', () => {
    const spies = renderSheet({ range: { start: '2026-06-10' } });

    const apply = screen.getByTestId('trip-wizard-period-apply');
    expect(apply).toBeDisabled();
    fireEvent.press(apply);
    expect(spies.onApply).not.toHaveBeenCalled();
  });

  it('완성 범위면 활성 + press → onApply 1회', () => {
    const spies = renderSheet({
      range: { start: '2026-06-10', end: '2026-06-13' },
    });

    const apply = screen.getByTestId('trip-wizard-period-apply');
    expect(apply).not.toBeDisabled();

    fireEvent.press(apply);
    expect(spies.onApply).toHaveBeenCalledTimes(1);
  });
});

describe('AC-5 · 과거 셀은 진짜 disabled (today 주입, 01b D3)', () => {
  it('과거 셀 — disabled 매처 + press 무반응 + onPickDate 0회 (3단)', () => {
    // today = 6/12 → 6/11 은 과거(비활성), 6/12(오늘)는 활성.
    const spies = renderSheet({ today: '2026-06-12', range: {} });

    const past = screen.getByTestId('trip-wizard-period-cell-2026-06-11');
    expect(past).toBeDisabled();
    fireEvent.press(past);
    expect(spies.onPickDate).not.toHaveBeenCalled();
  });

  it('오늘(=today) 셀은 활성 — press → onPickDate 를 부른다 (짝)', () => {
    const spies = renderSheet({ today: '2026-06-12', range: {} });

    const today = screen.getByTestId('trip-wizard-period-cell-2026-06-12');
    expect(today).not.toBeDisabled();
    fireEvent.press(today);
    expect(spies.onPickDate).toHaveBeenCalledWith('2026-06-12');
  });
});

describe('월 네비 chevron — prev/next 가 뒤바뀌지 않는다', () => {
  it('today 의 달을 보면 prev 는 disabled, next press → onNextMonth (뒤로 안 감)', () => {
    // month = today 의 달(6월) → 그 앞은 전부 과거라 prev 비활성.
    const spies = renderSheet({ today: '2026-06-01', month: '2026-06' });

    const prev = screen.getByTestId('trip-wizard-period-prev');
    expect(prev).toBeDisabled();
    fireEvent.press(prev);
    expect(spies.onPrevMonth).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('trip-wizard-period-next'));
    expect(spies.onNextMonth).toHaveBeenCalledTimes(1);
    // next 가 실수로 prev 에 배선되면 여기서 red.
    expect(spies.onPrevMonth).not.toHaveBeenCalled();
  });

  it('미래 달을 보면 prev 활성 — press → onPrevMonth', () => {
    const spies = renderSheet({ today: '2026-06-01', month: '2026-07' });

    const prev = screen.getByTestId('trip-wizard-period-prev');
    expect(prev).not.toBeDisabled();
    fireEvent.press(prev);
    expect(spies.onPrevMonth).toHaveBeenCalledTimes(1);
    expect(spies.onNextMonth).not.toHaveBeenCalled();
  });
});
