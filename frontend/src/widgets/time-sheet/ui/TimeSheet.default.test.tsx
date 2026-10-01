import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TimeSheet } from './TimeSheet';

/**
 * TRIP-981 · 기본 변형(24시 두 컬럼 + 취소/적용) 시각 시트 — h12 직접 짜기·h13 장소 추가가 쓴다.
 *
 * 무엇을 보장하나:
 *  - 🔴 D1 (A) 딤 탭·제스처로 시트가 닫혀도 소비처에 `onCancel` 로 알린다. 안 알리면 소비처의 "열림"
 *    상태가 남아 시트가 마운트된 채 닫혀 있고, 다음 '+ 추가'·시각 칩이 다시 열지 못한다(#057).
 *    아래로 끌어 닫기는 켜지 않는다(시·분 열을 굴리다 시트가 닫히지 않게 — 01b Q1).
 *  - 🔴 C1·C2 (C) 시트를 열면 시·분 네 열 모두 **선택 셀이 열의 보이는 창 안**에서 시작한다(#042 —
 *    10시가 창 밖이라 시 열에 강조가 안 보였다). 첫 칸이면 맨 위, 마지막 칸이면 끝 너머로 비지 않는다.
 *
 * *(개념)* **딤 닫힘 대리** — 테스트용 바텀시트 목은 시트를 항상 열린 채로 그려 "닫힌 상태"를 못
 *   만든다. 목이 `onClose` 를 상자에 그대로 남기므로 `fireEvent(시트, 'close')` 로 그 콜백을 불러
 *   "딤으로 닫혔다"를 흉내 낸다(h04 H7 선례).
 *
 * *(개념)* **초기 위치 = contentOffset** — ScrollView 가 처음 몇 px 내려간 곳에서 시작할지 정하는 값.
 *   jest 는 실제 스크롤을 못 하므로 이 prop 값과 셀·창 높이(`style`)로 "보이는가"를 계산한다.
 *   실제 화면 위치·안드로이드는 6-b.
 *
 * 3동작 뼈대: 준비=시각으로 렌더 → 실행=close 발화(D1) / 없음(C) → 단언=콜백 횟수 / 열 기하.
 */

const PREFIX = 'itinerary-edit-time';
const id = (suffix: string): string => `${PREFIX}-${suffix}`;

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0')
);

const onApply = jest.fn();
const onCancel = jest.fn();

function renderSheet(startAt: string, endAt: string): void {
  render(
    <TimeSheet
      startAt={startAt}
      endAt={endAt}
      onApply={onApply}
      onCancel={onCancel}
      testIDPrefix={PREFIX}
      labels={{ start: '시작', end: '종료' }}
    />
  );
}

beforeEach(() => {
  onApply.mockClear();
  onCancel.mockClear();
});

describe('🔴 D1 · 기본 변형도 딤·제스처로 닫히면 onCancel 이 불린다 (#057)', () => {
  it('시트 close 발화 → onCancel 1회·onApply 0회, 닫힘을 쥔 엘리먼트는 아래로 끌어 닫기를 켜지 않는다', () => {
    renderSheet('10:00:00', '11:00:00');
    const sheet = screen.getByTestId(id('sheet'));

    fireEvent(sheet, 'close');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    // onClose 를 가진 가장 가까운 조상 = 닫힘을 쥔 시트. 시·분 열이 평범한 ScrollView 라 끌어 닫기는 끈다.
    let owner: ReactTestInstance | null = sheet;
    while (owner !== null && typeof owner.props.onClose !== 'function') {
      owner = owner.parent;
    }
    expect(owner).not.toBeNull();
    expect(owner?.props.enablePanDownToClose).not.toBe(true);
  });
});

interface ColumnGeometry {
  /** 열이 처음 내려가 있는 거리(px). */
  y: number;
  /** 보이는 창 높이. */
  viewport: number;
  /** 셀 하나 높이(열 안에서 전부 같다). */
  cellHeight: number;
  padTop: number;
  padBottom: number;
  count: number;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

/** 열 하나의 기하를 렌더 트리에서 읽는다 — 전제(숫자·같은 높이·양수)를 먼저 단언한다. */
function columnGeometry(
  field: 'start' | 'end',
  unit: 'h' | 'm',
  values: string[]
): ColumnGeometry {
  const column = screen.getByTestId(id(`${field}-${unit}-column`));
  const viewport = StyleSheet.flatten(column.props.style)?.height;
  const y = column.props.contentOffset?.y;
  const content = StyleSheet.flatten(column.props.contentContainerStyle) ?? {};
  const cellHeights = values.map(
    (value) =>
      StyleSheet.flatten(
        screen.getByTestId(id(`${field}-${unit}-${value}`)).props.style
      )?.height
  );

  // 전제 — 창·오프셋·셀 높이가 숫자이고, 셀 높이는 열 안에서 전부 같다(고정 높이 계약).
  expect(typeof viewport).toBe('number');
  expect(typeof y).toBe('number');
  expect(typeof cellHeights[0]).toBe('number');
  expect(cellHeights[0]).toBeGreaterThan(0);
  expect(cellHeights.filter((h) => h !== cellHeights[0])).toEqual([]);
  // 전제 — 열이 창보다 길어 실제로 스크롤된다(창을 키워 전부 보이게 하는 우회를 막는다).
  expect(values.length * (cellHeights[0] as number)).toBeGreaterThan(
    viewport as number
  );

  const padding = numberOr(content.padding, 0);
  const padVertical = numberOr(content.paddingVertical, padding);
  return {
    y: y as number,
    viewport: viewport as number,
    cellHeight: cellHeights[0] as number,
    padTop: numberOr(content.paddingTop, padVertical),
    padBottom: numberOr(content.paddingBottom, padVertical),
    count: values.length,
  };
}

/** index 번째 셀이 창 안에 통째로 보이고, 오프셋이 스크롤 범위(0 ~ 끝) 안에 있다. */
function expectCellVisible(geometry: ColumnGeometry, index: number): void {
  const { y, viewport, cellHeight, padTop, padBottom, count } = geometry;
  const top = padTop + index * cellHeight;
  const maxY = Math.max(0, padTop + count * cellHeight + padBottom - viewport);

  expect(y).toBeGreaterThanOrEqual(0);
  expect(y).toBeLessThanOrEqual(maxY);
  expect(y).toBeLessThanOrEqual(top);
  expect(top + cellHeight).toBeLessThanOrEqual(y + viewport);
}

describe('🔴 C · 시각 열은 선택 셀이 보이는 위치에서 시작한다 (#042 · INV-2)', () => {
  it('C1 · 10:00–11:00 이면 시작 시 10·종료 시 11 이 창 안에 있고, 분 00 열은 맨 위다', () => {
    renderSheet('10:00:00', '11:00:00');

    expectCellVisible(columnGeometry('start', 'h', HOURS), 10);
    expectCellVisible(columnGeometry('end', 'h', HOURS), 11);

    const startMinute = columnGeometry('start', 'm', MINUTES);
    const endMinute = columnGeometry('end', 'm', MINUTES);
    expectCellVisible(startMinute, 0);
    expectCellVisible(endMinute, 0);
    expect(startMinute.y).toBe(0);
    expect(endMinute.y).toBe(0);
  });

  it('C1b · 14:30–15:45 이면 분 열도 30·45 가 창 안에서 시작한다', () => {
    renderSheet('14:30:00', '15:45:00');

    expectCellVisible(columnGeometry('start', 'h', HOURS), 14);
    expectCellVisible(columnGeometry('start', 'm', MINUTES), 30);
    expectCellVisible(columnGeometry('end', 'h', HOURS), 15);
    expectCellVisible(columnGeometry('end', 'm', MINUTES), 45);
  });

  it('C2a · 경계 — 첫 칸(00:00)이면 네 열 모두 맨 위(0)에서 시작한다', () => {
    renderSheet('00:00:00', '00:00:00');

    expect(columnGeometry('start', 'h', HOURS).y).toBe(0);
    expect(columnGeometry('start', 'm', MINUTES).y).toBe(0);
    expect(columnGeometry('end', 'h', HOURS).y).toBe(0);
    expect(columnGeometry('end', 'm', MINUTES).y).toBe(0);
  });

  it('C2b · 경계 — 마지막 칸(23:59)이면 23·59 가 보이고 끝 너머로 비지 않는다', () => {
    renderSheet('23:59:00', '23:59:00');

    expectCellVisible(columnGeometry('start', 'h', HOURS), 23);
    expectCellVisible(columnGeometry('start', 'm', MINUTES), 59);
    expectCellVisible(columnGeometry('end', 'h', HOURS), 23);
    expectCellVisible(columnGeometry('end', 'm', MINUTES), 59);
  });
});
