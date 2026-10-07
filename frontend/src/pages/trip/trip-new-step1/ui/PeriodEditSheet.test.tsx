import { fireEvent, render, screen } from '@testing-library/react-native';

import type { TripDateRange } from '@/pages/trip/trip-new-step1/model/tripDatePicker';

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
 * 갱신해 재렌더할 때 일어난다 — 그 전이는 통합 테스트(`TripNewStep1Page.integration` 「기간 편집 시트」)가 잡고,
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

  // TRIP-1027 AC-2 — 여행지 0곳이면 배선이 {시작: D, 끝: D}(당일)를 넘긴다. 시작 표식이 먼저 걸려
  // 끝 원·사이 표식 없이 시작 원 하나만 뜨고, 범위는 완성이라 적용은 열린다(02a ★16).
  it('당일 범위(시작 = 끝)면 시작 표식 하나만 뜨고, 끝·사이 표식은 없으며 적용은 열린다', () => {
    const spies = renderSheet({
      range: { start: '2026-06-10', end: '2026-06-10' },
    });

    expect(
      screen.getByTestId('trip-wizard-period-cell-start-2026-06-10')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-period-cell-end-2026-06-10')
    ).toBeNull();
    expect(
      screen.queryAllByTestId(/^trip-wizard-period-cell-between-/)
    ).toHaveLength(0);

    const apply = screen.getByTestId('trip-wizard-period-apply');
    expect(apply).toBeEnabled();
    fireEvent.press(apply);
    expect(spies.onApply).toHaveBeenCalledTimes(1);
  });
});

describe('AC-3 · 선택 요약 (범위만, 실제 달력 요일)', () => {
  it('완성 범위면 "M월 D일(요일) – D일(요일)" 을 접미 없이(범위만) 실제 달력 요일로 그린다', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-13' } });

    // 실측 오라클(02a §5-2): 2026-06-10 = 수, 2026-06-13 = 토. 브리프 예시(화/금)는 손베낌 오기.
    // TRIP-737: 시트 요약은 범위만(summaryPeriod.main) — "· 3박 4일" 접미(sub)는 버린다(Figma 3627:2068).
    // en dash(U+2013) 포함. getByText 는 완전일치라 접미가 다시 붙으면 red(문자열이 안 맞음).
    expect(screen.getByText('6월 10일(수) – 13일(토)')).toBeOnTheScreen();
  });

  it('요약에 박수 접미("3박 4일"·미들닷)가 다시 붙지 않는다', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-13' } });

    // 접미가 회귀하면 이 부재 단언이 red. `·`(U+00B7)·"3박 4일" 둘 다 없어야 한다.
    expect(screen.queryByText(/3박 4일/)).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
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

/**
 * TRIP-1045 AC-B1(QA #018) — 범위 띠와 원을 px 고정 크기로 맞춘다. Tailwind 기본 눈금(`h-9`·`top-1`)은
 * rem 이라 NativeWind 네이티브에서 1rem=14px 로 계산돼 원(31.5)과 띠(top 3.5)의 세로 중심이 어긋났다.
 * Figma `3627:2068`: 셀 44 안에 띠 `h-[36px] top-[4px]`, 원 `36×36`(4+36+4=44).
 * 실제 세로 중심이 맞는지는 픽셀이라 jest 사각 — 여기선 rem 유틸이 빠지고 px 값이 들어갔는지까지만 본다.
 * 시작·끝 반쪽 띠는 testID 가 없어 jest 사각이다(맡던 소스 스캔 `periodEditSheetStructure` g5 는 TRIP-1145 로 지웠다).
 */
describe('AC-B1 · 띠·원은 rem 유틸 없이 36/4 px 고정 (TRIP-1045)', () => {
  /** className 을 공백으로 쪼갠 토큰 — 부분 문자열 비교면 `h-9` 가 `h-90` 에도 걸린다. */
  function tokens(testID: string): string[] {
    return String(screen.getByTestId(testID).props.className ?? '').split(
      /\s+/
    );
  }

  it('원(날짜 버튼)은 h-[36px]·w-[36px] 이고 h-9·w-9 가 없다', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-13' } });

    const circle = tokens('trip-wizard-period-cell-2026-06-10');
    expect(circle).toEqual(expect.arrayContaining(['h-[36px]', 'w-[36px]']));
    expect(circle).not.toContain('h-9');
    expect(circle).not.toContain('w-9');
  });

  it('사이 띠는 h-[36px] + top 4px(top-[4px] 또는 top-xs) 이고 top-1·h-9 가 없다', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-13' } });

    const band = tokens('trip-wizard-period-cell-between-2026-06-11');
    expect(band).toContain('h-[36px]');
    // `xs` 토큰은 tailwind.config 에서 '4px' 로 정의돼 있어(rem 아님) 둘 다 맞는 표기다.
    expect(band.includes('top-[4px]') || band.includes('top-xs')).toBe(true);
    expect(band).not.toContain('top-1');
    expect(band).not.toContain('h-9');
  });
});

describe('당일치기(시작=종료) · 원만 있고 범위 띠는 없다', () => {
  it('시작=종료면 선택 원 하나뿐이고 어떤 띠도 그리지 않는다', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-10' } });

    expect(
      screen.getByTestId('trip-wizard-period-cell-start-2026-06-10')
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^trip-wizard-period-band-/)).toHaveLength(
      0
    );
    expect(
      screen.queryAllByTestId(/^trip-wizard-period-cell-between-/)
    ).toHaveLength(0);
    expect(
      screen.queryByTestId('trip-wizard-period-cell-end-2026-06-10')
    ).toBeNull();
  });

  it('시작≠종료면 시작 칸은 오른쪽 반 띠, 끝 칸은 왼쪽 반 띠를 종전대로 그린다(무회귀)', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-11' } });

    const startBand = screen.getByTestId(
      'trip-wizard-period-band-start-2026-06-10'
    );
    expect(String(startBand.props.className).split(/\s+/)).toEqual(
      expect.arrayContaining(['right-0', 'w-1/2'])
    );
    const endBand = screen.getByTestId(
      'trip-wizard-period-band-end-2026-06-11'
    );
    expect(String(endBand.props.className).split(/\s+/)).toEqual(
      expect.arrayContaining(['left-0', 'w-1/2'])
    );
  });

  it('범위가 시작만 있고 끝이 없을 때도 띠는 없다', () => {
    renderSheet({ range: { start: '2026-06-10' } });

    expect(screen.queryAllByTestId(/^trip-wizard-period-band-/)).toHaveLength(
      0
    );
  });
});

/**
 * TRIP-1267(QA F10) — 셀을 누르면 늘 새 시작일이 되고 끝은 시작 + 여행지 박수 합으로 파생된다(TRIP-1027).
 * 사용자는 끝날짜를 직접 못 고르므로, 처음 셀을 누르기 **전에** 그 규칙을 읽게 안내 한 줄을 항상 띄운다.
 * 기대 문구는 리터럴로 적는다 — 구현 상수를 import 해 비교하면 자기 자신과 비교하는 동어반복이다.
 * 실제 크기·색·간격과 시트 높이 증가로 적용 버튼이 밀리는지는 픽셀이라 6-b 프리뷰 몫이다.
 */
describe('기간 규칙 안내 한 줄 (종료일은 박수로 정해진다)', () => {
  const NOTE = 'trip-wizard-period-note';
  const NOTE_TEXT = '종료일은 여행지에서 정한 박수로 정해져요';

  type JsonNode = {
    props?: { testID?: unknown };
    children?: (JsonNode | string)[] | null;
  };

  /** 렌더 트리의 testID 를 화면 위→아래(문서 순서)로 모은다. */
  function testIdOrder(): string[] {
    const acc: string[] = [];
    const walk = (n: JsonNode | string | null | undefined): void => {
      if (!n || typeof n === 'string') return;
      const tid = n.props?.testID;
      if (typeof tid === 'string') acc.push(tid);
      (n.children ?? []).forEach(walk);
    };
    const root = screen.toJSON() as unknown as JsonNode | JsonNode[] | null;
    if (Array.isArray(root)) root.forEach(walk);
    else walk(root);
    return acc;
  }

  it.each<[string, TripDateRange]>([
    ['빈 범위', {}],
    ['시작만', { start: '2026-06-10' }],
    ['완성 범위', { start: '2026-06-10', end: '2026-06-13' }],
    ['당일(시작=끝)', { start: '2026-06-10', end: '2026-06-10' }],
  ])('%s 에서도 안내 문구가 정확히 그 글자로 보인다', (_label, range) => {
    renderSheet({ range });

    // toHaveTextContent(문자열) = 완전 일치(앞뒤 공백만 정리) — 글자가 하나라도 다르면 red.
    expect(screen.getByTestId(NOTE)).toHaveTextContent(NOTE_TEXT);
  });

  it('안내는 달력 다음, 적용 버튼 바로 위에 놓인다', () => {
    renderSheet({ range: { start: '2026-06-10', end: '2026-06-13' } });

    const order = testIdOrder();
    // 달력의 마지막 칸(6/30) < 안내 < 적용 — 안내가 적용 버튼 안이나 달력 위로 가면 red.
    const lastCell = order.indexOf('trip-wizard-period-cell-2026-06-30');
    const note = order.indexOf(NOTE);
    const apply = order.indexOf('trip-wizard-period-apply');
    expect(lastCell).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(lastCell);
    expect(apply).toBeGreaterThan(note);
  });

  it('안내는 정적 안내문 토큰(font-noto · text-caption · text-muted)을 쓰고 raw 값이 없다', () => {
    renderSheet();

    const tokens = String(screen.getByTestId(NOTE).props.className ?? '').split(
      /\s+/
    );
    expect(tokens).toEqual(
      expect.arrayContaining(['font-noto', 'text-caption', 'text-muted'])
    );
    // 임의값(`text-[12px]`·`text-[#6a6a6a]`)이 섞이면 토큰 대신 하드코딩이 들어간 것이다.
    expect(tokens.filter((t) => t.includes('[') || t.includes('#'))).toEqual(
      []
    );
  });
});

/**
 * TRIP-1285(QA B-03 · 결정 1) — 다음 달 chevron 상한. 마지막으로 볼 수 있는 달 = 오늘의 달 + 24(01b Q1).
 * 그 달에서 next 는 prev 하한과 같은 얼굴로 죽는다: 진짜 `disabled` + `opacity-40`.
 *
 * 왜 상한 달과 그 직전 달을 짝으로 보나: 상한 달 비활성만 보면 한 달 일찍(+23) 막는 구현도 통과한다
 * (+24 도 비활성이니까). 직전 달 활성까지 봐야 경계가 정확히 한 칸으로 고정된다(02a ★9).
 * 오늘이 12월·1월인 행은 해를 넘기는 월 산술을 시험한다(02a ★10).
 *
 * 실제 흐림 픽셀·시트 개폐는 통과형 목이라 6-b 몫이다 — 여기선 disabled 상태·토큰·콜백까지만 본다.
 */
describe('다음 달 상한 = 오늘의 달 + 24 (TRIP-1285 결정 1)', () => {
  /** [오늘, 상한 달(next 비활성), 직전 달(next 활성)]. */
  const LIMITS: readonly [string, string, string][] = [
    ['2026-10-08', '2028-10', '2028-09'],
    ['2026-12-31', '2028-12', '2028-11'],
    ['2027-01-01', '2029-01', '2028-12'],
    ['2026-01-15', '2028-01', '2027-12'],
  ];

  /** className 을 공백으로 쪼갠 토큰 — 부분 문자열 비교면 다른 토큰에 걸린다. */
  function nextTokens(): string[] {
    return String(
      screen.getByTestId('trip-wizard-period-next').props.className ?? ''
    ).split(/\s+/);
  }

  it.each(LIMITS)(
    '오늘 %s · 상한 달 %s 을 보면 next 는 disabled · opacity-40 이고 눌러도 onNextMonth 0회',
    (today, limitMonth) => {
      // 준비
      const spies = renderSheet({ today, month: limitMonth });
      const next = screen.getByTestId('trip-wizard-period-next');

      // 단언 ① — 보이는 얼굴과 접근성 상태
      expect(next).toBeDisabled();
      expect(nextTokens()).toContain('opacity-40');

      // 실행 — 진짜 disabled 면 press 가 안 먹는다
      fireEvent.press(next);

      // 단언 ② — 콜백이 안 올라간다
      expect(spies.onNextMonth).not.toHaveBeenCalled();
    }
  );

  it.each(LIMITS)(
    '오늘 %s · 상한 %s 의 직전 달 %s 을 보면 next 는 활성이고(opacity-40 없음) 눌러서 onNextMonth 1회 (짝)',
    (today, _limitMonth, beforeLimit) => {
      const spies = renderSheet({ today, month: beforeLimit });
      const next = screen.getByTestId('trip-wizard-period-next');

      expect(next).toBeEnabled();
      expect(nextTokens()).not.toContain('opacity-40');

      fireEvent.press(next);

      expect(spies.onNextMonth).toHaveBeenCalledTimes(1);
    }
  );
});

/**
 * TRIP-1285(결정 2 · 01b Q4) — 시트 상단 요약줄도 행과 같은 규칙으로 연도를 붙인다(같은 셀렉터 출력).
 *
 * 왜 오늘을 두 개로 짝짓나: 시트가 `today` prop 대신 실시계를 읽어도, 실시계 해와 같은 해의 오늘만 쓰면
 * 결과가 같아 통과한다. 해가 다른 오늘(2026 / 2029)을 같이 보면 실시계 배선은 언제 돌려도 하나가 red(02a ★4).
 * `toHaveTextContent(문자열)` 은 완전 일치다(앞뒤 공백 정리·공백 접기 — 바이트는 셀렉터 테스트가 잠근다).
 */
describe('요약줄 — 올해가 아니면 연도를 붙인다 (TRIP-1285 결정 2)', () => {
  it('오늘 2026-10-08 · 2027-05-15~17 → "2027년 5월 15일(토) – 17일(월)"', () => {
    renderSheet({
      today: '2026-10-08',
      month: '2027-05',
      range: { start: '2027-05-15', end: '2027-05-17' },
    });

    expect(screen.getByTestId('trip-wizard-period-summary')).toHaveTextContent(
      '2027년 5월 15일(토) – 17일(월)'
    );
  });

  it('오늘 2026-10-08 · 2029-05-15~17(QA 재현) → "2029년 5월 15일(화) – 17일(목)"', () => {
    renderSheet({
      today: '2026-10-08',
      month: '2029-05',
      range: { start: '2029-05-15', end: '2029-05-17' },
    });

    expect(screen.getByTestId('trip-wizard-period-summary')).toHaveTextContent(
      '2029년 5월 15일(화) – 17일(목)'
    );
  });

  it('짝 — 오늘이 같은 해(2029-01-10)면 같은 범위에 연도가 없다', () => {
    renderSheet({
      today: '2029-01-10',
      month: '2029-05',
      range: { start: '2029-05-15', end: '2029-05-17' },
    });

    expect(screen.getByTestId('trip-wizard-period-summary')).toHaveTextContent(
      '5월 15일(화) – 17일(목)'
    );
  });

  it('INV-3 · 연도가 붙은 요약에도 소요시간 문자열(시간·분·duration)이 없다', () => {
    renderSheet({
      today: '2026-10-08',
      month: '2029-05',
      range: { start: '2029-05-15', end: '2029-05-17' },
    });

    expect(
      screen.getByTestId('trip-wizard-period-summary')
    ).not.toHaveTextContent(/시간|분|duration/i);
  });
});
