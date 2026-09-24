import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { TimeSheet } from './TimeSheet';

/**
 * TRIP-927 · h04(시간대 조정) 변형의 **종료 선택 사항**·요약 행 생략·닫힘 배선.
 *
 * 무엇을 보장하나:
 *  - 종료를 손대지 않고 적용하면 `{ startAt, endAt: null }` — `endsNextDay` 키 자체가 없다(AC-1, Q2).
 *    종료 탭을 여는 것만으로는 "설정"이 아니다 — 휠 값을 눌러야 설정된다(AC-2 경계).
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
      mode="h04"
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

describe('🔴 AC-1 · 종료를 손대지 않고 적용하면 endAt:null — endsNextDay 키 없음', () => {
  it('H1a · 아무것도 안 건드리고 적용 → { startAt: 13:00:00, endAt: null }', () => {
    renderH04();

    press('apply');

    const patch = appliedPatch();
    expect(patch).toStrictEqual({ startAt: '13:00:00', endAt: null });
    expect(patch).not.toHaveProperty('endsNextDay');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('H1b · 시작만 23시로 바꿔 적용 → { startAt: 23:00:00, endAt: null }', () => {
    renderH04();

    // 시작 탭 활성 · 오후 1시에서 11 셀 → 오후 11시(23).
    press('wheel-h-11', 'apply');

    expect(appliedPatch()).toStrictEqual({ startAt: '23:00:00', endAt: null });
  });

  it('H1c · 종료 탭만 열어 보고 휠을 안 누르면 여전히 미설정이다', () => {
    renderH04();

    press('seg-end');
    expect(screen.getByTestId(id('readout'))).toHaveTextContent(/설정 안 됨/);
    press('apply');

    expect(appliedPatch()).toStrictEqual({ startAt: '13:00:00', endAt: null });
  });
});

describe('AC-2 · 종료를 설정하고 적용하면 endAt·endsNextDay(end <= start)를 싣는다', () => {
  it.each([
    [['wheel-h-3'], '15:30:00', false, '같은 날'],
    [['wheel-h-1', 'wheel-m-00'], '13:00:00', true, '같은 시각이면 익일'],
    [['wheel-h-1'], '13:30:00', false, '같은 시·늦은 분'],
    [['wheel-ap-오전'], '02:30:00', true, '자정 넘김'],
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
