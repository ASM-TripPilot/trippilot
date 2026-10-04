import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';

import { TimeSheet } from './TimeSheet';

/**
 * TRIP-927 · 편집기 형태(title+placeSummary) 시각 시트의 **종료 선택 사항**·요약 행 생략·닫힘 배선.
 *
 * 무엇을 보장하나:
 *  - 종료를 손대지 않고 적용하면 종료는 현재 값(`endAt` prop) 유지 + `endsNextDay` 재유도 — null 은 안 나간다
 *    (TRIP-1196 AC-1). 종료 탭을 여는 것만으로는 "설정"이 아니다 — 휠 값을 눌러야 설정된다.
 *  - 종료를 설정하고 적용하면 `{ startAt, endAt, endsNextDay }`, 유도는 `end <= start`(AC-2).
 *  - 설정 상태에서도 소요시간 표기 0건(AC-4, INV-3).
 *  - 배지·지역을 안 주면 요약 행은 썸네일+이름뿐(AC-6, Q1).
 *  - 스와이프·딤 탭으로 닫혀도 `onCancel` 이 불린다(AC-7) — 목이 prop 을 호스트 View 에 펼쳐서
 *    `onClose` 가 트리에 남는다. 실제 제스처 닫힘은 6-b 실기 전용.
 *
 * ⚠️ `toHaveBeenCalledWith` 는 undefined 키에 관대하다 — 키 부재는 `toStrictEqual` 로만 잰다(02a ★1).
 * ⚠️ 휠은 12시간제·활성 탭 한 벌이다 — 누름 순서가 결과를 바꾼다(02a ★4).
 *
 * 3동작: 준비=h04 렌더(13:00–14:30) → 실행=탭·휠 셀·적용 press 또는 close 발화 → 단언=onApply 인자·트리.
 */

const PREFIX = 'itinerary-edit-time';
const id = (suffix: string): string => `${PREFIX}-${suffix}`;

// 소요시간 표기 탐지기(CH6·CS6 와 같은 식) — HH:mm·bare 분 셀은 안 걸린다.
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

const onApply = jest.fn();
const onCancel = jest.fn();

type Summary = {
  imageUrl: string | null;
  name: string;
  badgeLabel?: string;
  region?: string;
};

function renderH04(placeSummary?: Summary): void {
  render(
    <TimeSheet
      title="시간대 조정"
      testIDPrefix={PREFIX}
      labels={{ start: '시작', end: '종료' }}
      startAt="13:00:00"
      endAt="14:30:00"
      placeSummary={placeSummary}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

function press(...suffixes: string[]): void {
  suffixes.forEach((suffix) => fireEvent.press(screen.getByTestId(id(suffix))));
}

/** 첫 onApply 인자 — 키 부재까지 보려면 호출 인자를 직접 꺼내 toStrictEqual 로 잰다. */
function appliedPatch(): unknown {
  expect(onApply).toHaveBeenCalledTimes(1);
  return onApply.mock.calls[0][0];
}

/** 서브트리의 문자열 자식 전부(composite·host 중복 포함 — 개수 아닌 존재만 본다). */
function textsIn(node: ReactTestInstance): string[] {
  const out: string[] = [];
  node
    .findAll(() => true)
    .forEach((n) => {
      const children = n.props?.children as unknown;
      (Array.isArray(children) ? children : [children]).forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

/** 오류 문구(01b Q5 확정) — 완전 일치로 잰다. */
const RANGE_ERROR = '종료 시각은 시작보다 늦어야 해요';

/**
 * 막힌 상태 3종 — 문구가 보이고, [적용]이 disabled 이고, 눌러도 onApply 가 안 나간다.
 * RNTL 은 disabled Pressable 을 누르지 않으므로 onApply 0회만으론 disabled 를 증명 못 한다(02a ★4).
 */
function expectBlocked(): void {
  expect(screen.getByTestId(id('error'))).toHaveTextContent(RANGE_ERROR);
  expect(screen.getByTestId(id('apply'))).toBeDisabled();
  press('apply');
  expect(onApply).not.toHaveBeenCalled();
}

function expectOpen(): void {
  expect(screen.queryByTestId(id('error'))).toBeNull();
  expect(screen.getByTestId(id('apply'))).not.toBeDisabled();
}

function classTokens(node: ReactTestInstance): string[] {
  const className: unknown = node.props?.className;
  return typeof className === 'string' ? className.trim().split(/\s+/) : [];
}

function pinkPills(node: ReactTestInstance): ReactTestInstance[] {
  return node.findAll(
    (n) =>
      typeof n.props?.className === 'string' &&
      n.props.className.includes('bg-primary-pale')
  );
}

beforeEach(() => {
  onApply.mockClear();
  onCancel.mockClear();
});

// TRIP-1215 계약 변경 — H1b·H1d 는 옛 "숨은 종료로 익일 적용"을 잠갔다. 이제 숨은 종료에도 같은 판정이 걸려 막힌다.
describe('🔴 AC-1 · 종료를 손대지 않고 적용하면 종료는 현재 값 유지 — endAt 은 문자열 (TRIP-1196)', () => {
  it('H1a · 아무것도 안 건드리고 적용 → { 13:00:00, endAt: 14:30:00(현재 값), endsNextDay: false }', () => {
    renderH04();

    press('apply');

    const patch = appliedPatch();
    expect(patch).toStrictEqual({
      startAt: '13:00:00',
      endAt: '14:30:00',
      endsNextDay: false,
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('H1b · 시작만 23시로 바꾸면 숨은 종료 14:30 이 시작보다 일러 막힌다 — readout 은 여전히 "설정 안 됨"', () => {
    renderH04();

    // 시작 탭 활성 · 오후 1시에서 11 셀 → 오후 11시(23). 14:30 은 새벽(09:00 전)이 아니다.
    press('wheel-h-11');

    expect(screen.getByTestId(id('readout'))).toHaveTextContent(/설정 안 됨/);
    expectBlocked();
  });

  it('H1c · 종료 탭만 열어 보고 휠을 안 누르면 여전히 미설정이고 종료 값은 유지된다', () => {
    renderH04();

    press('seg-end');
    expect(screen.getByTestId(id('readout'))).toHaveTextContent(/설정 안 됨/);
    press('apply');

    expect(appliedPatch()).toStrictEqual({
      startAt: '13:00:00',
      endAt: '14:30:00',
      endsNextDay: false,
    });
  });

  it('H1d · 종료를 안 건드린 채 시작을 14:30 이후(15:45)로 옮기면 숨은 종료 기준으로 막힌다', () => {
    renderH04();

    press('wheel-h-3', 'wheel-m-45');

    expectBlocked();
  });
});

// TRIP-1215 계약 변경 — 옛 '같은 시각이면 익일'(13:00=13:00)·'자정 넘김'(13:00→02:30) 행은 이제 막힌다(T3 로 옮김).
describe('AC-2 · 종료를 설정하고 적용하면 endAt·endsNextDay(end <= start)를 싣는다', () => {
  it.each([
    [['wheel-h-3'], '15:30:00', false, '같은 날'],
    [['wheel-h-1'], '13:30:00', false, '같은 시·늦은 분'],
    [['wheel-m-45'], '14:45:00', false, '분만 바꿈'],
  ])(
    'H2 · 종료 탭 → %j → endAt %s · endsNextDay %s (%s)',
    (wheelPresses, endAt, endsNextDay) => {
      renderH04();

      press('seg-end', ...wheelPresses, 'apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '13:00:00',
        endAt,
        endsNextDay,
      });
    }
  );
});

describe('AC-4 · INV-3 — 종료를 설정한 상태에서도 소요시간 표기 0건', () => {
  it('H4 · readout 에 설정한 종료가 보이고, 렌더 텍스트에 분·시간·소요 0건', () => {
    renderH04();

    press('seg-end', 'wheel-h-3');

    // 양성 앵커 — 설정된 종료가 12시간제로 보인다.
    expect(screen.getByTestId(id('readout'))).toHaveTextContent(/오후 3:30/);
    expect(textsIn(screen.root).filter((t) => DURATION_TEXT.test(t))).toEqual(
      []
    );
  });
});

describe('🔴 AC-6 · 배지·지역을 안 주면 요약 행은 썸네일+이름뿐이다', () => {
  it('H6 · 배지 알약·"꼭 갈 곳" 줄이 없다 (짝: 둘 다 주면 둘 다 있다)', () => {
    renderH04({ imageUrl: 'https://example.com/a.jpg', name: '광안리 해변' });

    const summary = screen.getByTestId(id('place-summary'));
    expect(screen.getByTestId(id('place-thumb-image'))).toBeOnTheScreen();
    // 완전일치 — 이름 말고 아무 텍스트도 없다(배지 라벨·둘째 줄 부재).
    expect(summary).toHaveTextContent('광안리 해변');
    expect(pinkPills(summary)).toHaveLength(0);
    expect(textsIn(summary).filter((t) => t.includes('꼭 갈 곳'))).toEqual([]);
    expect(textsIn(summary).filter((t) => t.includes('undefined'))).toEqual([]);

    // 탐지기 짝 — 배지·지역을 주면 같은 탐지기가 알약과 둘째 줄을 잡는다.
    screen.unmount();
    renderH04({
      imageUrl: 'https://example.com/a.jpg',
      name: '광안리 해변',
      badgeLabel: '필수',
      region: '부산 부산진구',
    });
    const full = screen.getByTestId(id('place-summary'));
    expect(pinkPills(full).length).toBeGreaterThan(0);
    expect(full).toHaveTextContent('광안리 해변필수부산 부산진구 · 꼭 갈 곳');
  });
});

describe('🔴 AC-7 · 스와이프·딤으로 닫혀도 onCancel 이 불린다', () => {
  it('H7 · 시트 close 발화 → onCancel 1회·onApply 0회, 같은 엘리먼트가 아래로 끌어 닫기를 켠다', () => {
    renderH04();
    const sheet = screen.getByTestId(id('sheet'));

    fireEvent(sheet, 'close');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    // onClose 를 가진 가장 가까운 조상 = 닫힘을 쥔 BottomSheet. 그 엘리먼트가 pan-down 도 켠다.
    let owner: ReactTestInstance | null = sheet;
    while (owner !== null && typeof owner.props.onClose !== 'function') {
      owner = owner.parent;
    }
    expect(owner?.props.enablePanDownToClose).toBe(true);
  });
});

/**
 * TRIP-990 · W4 (D21 파급) — h04 휠 3열도 스크롤이 멈추면 **활성 탭**의 값을 바꾼다.
 *
 * 공용 휠이 스크롤 정지로 값을 확정하게 되면서 h12 편집·i07 여행 중 편집(`ItineraryEditPage`)의 시각
 * 시트도 같은 동작을 물려받는다. 셀을 탭했을 때와 결과가 같아야 한다 — 시작 탭이면 시작 시각, 종료 탭이면
 * 종료 시각이 바뀌고, 종료가 바뀌면 "설정됨"이 켜져 적용 결과에 종료가 실린다.
 *
 * 열 순서는 [오전/오후, 시(1~12), 분(00~59)]. 시작 13:00 은 오후 1시라, 시 열의 '11' 은 23시다.
 *
 * 3동작 뼈대: 준비=h04(13:00–14:30) → 실행=(종료 탭) → 열 하나를 k칸에서 멈춤 → 적용 → 단언=onApply 인자.
 */
describe('🔴 W4 · h04 휠 스크롤 정지 = 셀 탭과 같은 결과 (D21)', () => {
  function settle(column: 'ap' | 'h' | 'm', cells: number): void {
    fireEvent(screen.getByTestId(id(`wheel-${column}`)), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 0, y: cells * WHEEL_CELL_HEIGHT } },
    });
  }

  // TRIP-1215 계약 변경 — 옛 행 ['h', 10] 은 23:00 시작이 숨은 종료 14:30 보다 늦어 이제 막힌다.
  it.each([
    ['h', 1, '14:00:00', false, '시 열 2(오후) → 14시'],
    ['ap', 0, '01:00:00', false, '오전/오후 열 오전 → 1시'],
    ['m', 15, '13:15:00', false, '분 열 15'],
  ] as const)(
    '시작 탭에서 %s 열이 %i칸에 멈추면 startAt %s · endsNextDay %s (%s)',
    (column, cells, startAt, endsNextDay, _label) => {
      renderH04();

      settle(column, cells);
      press('apply');

      expect(appliedPatch()).toStrictEqual({
        startAt,
        endAt: '14:30:00',
        endsNextDay,
      });
    }
  );

  it('종료 탭에서 시 열이 3에 멈추면 종료가 설정되어 15:30 으로 실린다', () => {
    renderH04();

    press('seg-end');
    settle('h', 2);

    expect(screen.getByTestId(id('readout'))).toHaveTextContent(/오후 3:30/);
    press('apply');
    expect(appliedPatch()).toStrictEqual({
      startAt: '13:00:00',
      endAt: '15:30:00',
      endsNextDay: false,
    });
  });
});

/**
 * TRIP-1215 · 시트가 "실수로 넣은" 종료<시작을 막는다 (QA Q-29: 11:00–08:00 이 그대로 들어가던 것).
 *
 * 허용 = 종료 > 시작(같은 날), 또는 시작 18:00 이상 + 종료 09:00 전(정상 자정 넘김 → endsNextDay true).
 * 그 밖(같은 시각 포함)은 `-error` 문구 + [적용] disabled. 판정 대상 종료는 휠을 건드렸으면 휠 값,
 * 아니면 숨은 `endAt` 이다. 휠을 굴릴 때마다 다시 판정한다 — 처음 그릴 때만 재면 T1·T2 가 red(02a ★1).
 *
 * jest 사각: 실제 회색·문구 위치·시트 높이는 6-b 실기(02a §8).
 */
describe('🔴 시트 안 종료<시작 막기 — 문구·disabled 가 휠을 따라간다', () => {
  it('T1 · 허용으로 열려 종료를 오전 2:30 으로 굴리면 막히고, 다시 늦추면 풀려 그 값으로 적용된다', () => {
    renderH04();
    // 앵커 — 열렸을 땐(13:00–14:30) 문구가 없고 [적용]이 열려 있다.
    expectOpen();

    press('seg-end', 'wheel-ap-오전'); // 종료 14:30 → 02:30
    expectBlocked();

    press('wheel-ap-오후'); // 02:30 → 14:30
    expectOpen();
    press('wheel-h-3', 'apply'); // 15:30

    expect(appliedPatch()).toStrictEqual({
      startAt: '13:00:00',
      endAt: '15:30:00',
      endsNextDay: false,
    });
  });

  it('T2 · 종료를 안 건드린 채 시작을 15:00 으로 옮기면 막히고, 14:00 으로 되돌리면 숨은 종료로 적용된다', () => {
    renderH04();

    press('wheel-h-3'); // 시작 15:00 · 숨은 종료 14:30
    expectBlocked();

    press('wheel-h-2'); // 시작 14:00
    expectOpen();
    press('apply');

    expect(appliedPatch()).toStrictEqual({
      startAt: '14:00:00',
      endAt: '14:30:00',
      endsNextDay: false,
    });
  });

  // 12시간제 누름 순서(02a ★10): 시작 13:00 = 오후 1 · 종료 14:30 = 오후 2:30. 오전 12 → 00시.
  it.each([
    {
      label: '18:00 시작 · 08:59 종료 → 자정 넘김 허용',
      start: ['wheel-h-6'],
      end: ['wheel-ap-오전', 'wheel-h-8', 'wheel-m-59'],
      applied: { startAt: '18:00:00', endAt: '08:59:00', endsNextDay: true },
    },
    {
      label: '17:59 시작 · 08:59 종료 → 막힘',
      start: ['wheel-h-5', 'wheel-m-59'],
      end: ['wheel-ap-오전', 'wheel-h-8', 'wheel-m-59'],
      applied: null,
    },
    {
      label: '18:00 시작 · 09:00 종료 → 막힘',
      start: ['wheel-h-6'],
      end: ['wheel-ap-오전', 'wheel-h-9', 'wheel-m-00'],
      applied: null,
    },
    {
      label: '23:30 시작 · 00:30 종료 → 자정 넘김 허용',
      start: ['wheel-h-11', 'wheel-m-30'],
      end: ['wheel-ap-오전', 'wheel-h-12'],
      applied: { startAt: '23:30:00', endAt: '00:30:00', endsNextDay: true },
    },
    {
      label: '11:00 시작 · 08:00 종료(Q-29) → 막힘',
      start: ['wheel-ap-오전', 'wheel-h-11'],
      end: ['wheel-ap-오전', 'wheel-h-8', 'wheel-m-00'],
      applied: null,
    },
    {
      label: '13:00 시작 · 13:00 종료(같은 시각) → 막힘',
      start: [],
      end: ['wheel-h-1', 'wheel-m-00'],
      applied: null,
    },
    {
      label: '13:00 시작 · 02:30 종료(시작이 밤이 아님) → 막힘',
      start: [],
      end: ['wheel-ap-오전'],
      applied: null,
    },
  ])('T3 · 휠로 맞춘 경계 — $label', ({ start, end, applied }) => {
    renderH04();

    press(...start, 'seg-end', ...end);

    if (applied === null) {
      expectBlocked();
      return;
    }
    expectOpen();
    press('apply');
    expect(appliedPatch()).toStrictEqual(applied);
  });

  it('T4 · 막히면 [적용] 채움이 회색 토큰으로 바뀌고, 문구는 오류 색 토큰 · raw hex 0 · 소요시간 표기 0', () => {
    renderH04();
    // 허용 상태 — [적용]은 primary 채움(className 은 Pressable 자신에 있다, 02a ★2).
    expect(classTokens(screen.getByTestId(id('apply')))).toContain(
      'bg-primary'
    );
    expect(classTokens(screen.getByTestId(id('apply')))).not.toContain(
      'bg-hairline-strong'
    );

    press('seg-end', 'wheel-ap-오전');

    const apply = screen.getByTestId(id('apply'));
    expect(classTokens(apply)).toContain('bg-hairline-strong');
    expect(classTokens(apply)).not.toContain('bg-primary');
    expect(classTokens(screen.getByTestId(id('error')))).toContain(
      'text-primary-text'
    );

    // raw hex — testID 몇 개가 아니라 시트 서브트리 전 노드(버튼 안쪽 Text 포함)의 className 을 본다.
    const classNames = screen
      .getByTestId(id('sheet'))
      .findAll(() => true)
      .map((node) => node.props?.className as unknown)
      .filter((value): value is string => typeof value === 'string');
    // 모집단 앵커 — 수집이 문구 Text 까지 닿았다.
    expect(classNames.some((c) => c.includes('text-primary-text'))).toBe(true);
    expect(classNames.filter((c) => c.includes('#'))).toEqual([]);

    const texts = textsIn(screen.root);
    expect(texts).toContain(RANGE_ERROR);
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
  });
});
