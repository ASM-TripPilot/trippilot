import { fireEvent, render, screen } from '@testing-library/react-native';

import { TimeSheet } from './TimeSheet';

/**
 * AC-2 · 공용 시각 조정 위젯 `widgets/time-sheet` — 쌍둥이 시트(h24 SlotTimeSheet ·
 * i15/i22 ManualTimeSheet)를 하나로 접은 뒤에도 두 소비처의 관측 계약이 그대로 남는지 잠근다.
 *
 * 무엇을 보장하나:
 *  - 같은 위젯이 `testIDPrefix` 두 값(`itinerary-edit-time`·`planb-manual-time`)으로 각각
 *    기존 testID 트리·셀 선택·[적용]/[취소]를 낸다(소비처 무회귀).
 *  - `labels` prop 이 실제로 흐른다 — 접두마다 다른 섹션 라벨(시작/종료 vs 도착/출발)이 렌더된다.
 *  - `endsNextDay` 는 `end<=start` 의 **기계 유도**(INV-2 판정 아님) — 시·분 두 축 모두.
 *  - INV-3 — 분 셀은 bare 숫자("30"), 소요시간 표기("30분"·"소요") 0건(02a ★3).
 *
 * *(개념)* **왜 셀 press 인가** — 휠(스크롤-스냅) 시각 피커 라이브러리가 리포에 없고 jest 는 스냅을
 *   구동 못 한다. 시·분을 값별 셀로 두고 누르면 그 값이 선택된다(h07 옵션-셀 선례). "휠" 비주얼은
 *   그 위의 프레젠테이션이다.
 *
 * *(개념)* **통과형 목** — `@gorhom/bottom-sheet` 목은 children 을 무조건 렌더한다. 직접 마운트하면
 *   **항상 열린 상태**라 개폐·2스냅은 여기서 못 잰다 — 6-b 실기 전용(02a ★2). 이 파일은 열림을 가정한
 *   계약·testID·유도만 잠근다.
 *
 * 3동작 뼈대: 준비=현재 시각으로 렌더 → 실행=셀/버튼 press → 단언=선택 셀·불린 콜백 인자.
 */

// 소요시간 표기 탐지기 — HH:mm(09:30)은 숫자 뒤가 `:`라 안 걸리고, bare 분 셀("30")도 안 걸린다.
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 렌더된 문자열 전부 — INV-3 부정 스캔의 모집단(SlotTimeSheet CS6 헬퍼 이식, 02a §5-D). */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

const onApply = jest.fn();
const onCancel = jest.fn();

interface Config {
  prefix: string;
  labels: { start: string; end: string };
}

// 두 소비처가 같은 위젯을 접두·라벨만 다르게 쓴다(h24 편집 · i15/i22 수동 편집).
const CONFIGS: Config[] = [
  { prefix: 'itinerary-edit-time', labels: { start: '시작', end: '종료' } },
  { prefix: 'planb-manual-time', labels: { start: '도착', end: '출발' } },
];

function renderSheet(
  config: Config,
  startAt = '10:15:00',
  endAt = '11:45:00'
): void {
  render(
    <TimeSheet
      startAt={startAt}
      endAt={endAt}
      onApply={onApply}
      onCancel={onCancel}
      testIDPrefix={config.prefix}
      labels={config.labels}
    />
  );
}

beforeEach(() => {
  onApply.mockClear();
  onCancel.mockClear();
});

describe.each(CONFIGS)(
  '🔴 widgets/time-sheet · 접두=$prefix — 쌍둥이 통일 무회귀',
  (config) => {
    const { labels } = config;
    // testID 규약 = `${prefix}-{suffix}`(기존 SlotTimeSheet·ManualTimeSheet 와 바이트 동일).
    const id = (suffix: string): string => `${config.prefix}-${suffix}`;

    it('CS1 · 현재 시각을 시작·종료 각각으로 시드하고 라벨을 접두별로 그린다', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      expect(screen.getByTestId(id('sheet'))).toBeOnTheScreen();

      // 시작·종료가 독립 값으로 시드된다(분 granularity 15·45 유지 — 30분 반올림이 아니다).
      expect(screen.getByTestId(id('start-h-10'))).toBeSelected();
      expect(screen.getByTestId(id('start-m-15'))).toBeSelected();
      expect(screen.getByTestId(id('end-h-11'))).toBeSelected();
      expect(screen.getByTestId(id('end-m-45'))).toBeSelected();

      // 짝(부정) — 시드 안 된 값은 선택되지 않는다.
      expect(screen.getByTestId(id('start-h-11'))).not.toBeSelected();

      // labels prop 이 실제로 흐른다 — 접두마다 다른 라벨(getByText 완전일치, 02a §5-A).
      expect(screen.getByText(labels.start)).toBeOnTheScreen();
      expect(screen.getByText(labels.end)).toBeOnTheScreen();

      expect(screen.getByTestId(id('apply'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('cancel'))).toBeOnTheScreen();
    });

    it('CS2 · 무변경 적용은 시드값을 초 보존해 싣고 endsNextDay=false', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      fireEvent.press(screen.getByTestId(id('apply')));

      // 표시는 HH:mm, 저장은 "HH:mm:00" — 11:45 > 10:15 라 익일 아님.
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith({
        startAt: '10:15:00',
        endAt: '11:45:00',
        endsNextDay: false,
      });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('CS3 · 시작 시만 23 으로 바꾸면 종료·분은 유지되고 endsNextDay=true', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      // 시작의 '시'만 23 으로 — 시작 '분'(15)·종료(11:45)는 안 건드린다.
      fireEvent.press(screen.getByTestId(id('start-h-23')));
      fireEvent.press(screen.getByTestId(id('apply')));

      // 종료 11:45 불변 = start·end 독립. 11:45 ≤ 23:15 라 익일.
      expect(onApply).toHaveBeenCalledWith({
        startAt: '23:15:00',
        endAt: '11:45:00',
        endsNextDay: true,
      });
    });

    it('CS4 · start==end 면 endsNextDay=true (경계 ≤)', () => {
      renderSheet(config, '11:00:00', '11:00:00');

      fireEvent.press(screen.getByTestId(id('apply')));

      expect(onApply).toHaveBeenCalledWith({
        startAt: '11:00:00',
        endAt: '11:00:00',
        endsNextDay: true,
      });
    });

    it('CS5 · 취소는 onCancel 만, onApply 는 안 부른다', () => {
      renderSheet(config);

      fireEvent.press(screen.getByTestId(id('cancel')));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onApply).not.toHaveBeenCalled();
    });

    it('CS6 · INV-3 — 시각 숫자는 보이나 소요시간 표기는 0건(분 셀 bare 숫자)', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      const texts = renderedTexts();
      // 긍정 앵커 — 시트가 실제로 시각을 그리고 있다.
      expect(texts.some((t) => t.includes('10'))).toBe(true);
      expect(texts.some((t) => t.includes('45'))).toBe(true);

      // 부정 — 소요시간 표기 0건. 분 셀을 "30분"으로 그리면 여기서 걸린다(02a ★3, source 가드 밖).
      expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
    });

    it('CS7 · 같은 시·늦은 분은 익일이 아니다(분 축)', () => {
      renderSheet(config, '10:15:00', '10:45:00');

      // 아무 셀도 안 바꾸고 시드값 그대로 적용한다.
      fireEvent.press(screen.getByTestId(id('apply')));

      // 시가 같아도(10==10) 종료 분(45)이 시작 분(15)보다 뒤 → 익일 아님. 시만 보는 유도식이면 red.
      expect(onApply).toHaveBeenCalledWith({
        startAt: '10:15:00',
        endAt: '10:45:00',
        endsNextDay: false,
      });
    });

    it('CS8 · 분 셀 press 는 그 필드의 분만 바꾼다', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      // 시작 '분' 셀 40 만 누른다(시·종료는 안 건드린다).
      fireEvent.press(screen.getByTestId(id('start-m-40')));
      fireEvent.press(screen.getByTestId(id('apply')));

      // 시작 분만 40 으로 흐르고 시작 시(10)·종료(11:45)는 그대로여야 한다.
      expect(onApply).toHaveBeenCalledWith({
        startAt: '10:40:00',
        endAt: '11:45:00',
        endsNextDay: false,
      });
    });
  }
);
