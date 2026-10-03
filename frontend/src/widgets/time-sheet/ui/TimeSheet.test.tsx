import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';

import { TimeSheet } from './TimeSheet';

/**
 * TRIP-1196 · 공용 시각 조정 위젯 `widgets/time-sheet` — **title·placeSummary 를 안 주는 소비처**(h12 직접 짜기
 * `itinerary-manual-time` · h13 장소 추가 `itinerary-edit-time`, 라벨 도착/출발 쌍둥이 포함)도 편집기(h04)와
 * 같은 원통 휠 입력을 쓴다. 편집기 형태(제목 '시간대 조정'+요약 행)는 `TimeSheet.wheel.test.tsx`.
 *
 * 무엇을 보장하나:
 *  - 🔴 W1 오전/오후·시·분 3열 휠 + 시작/종료 세그 + readout + [적용] 이 트리에 있고, 옛 셀 탭 방식
 *    (`start-h-10` 같은 값별 셀·열 ScrollView)과 취소 버튼은 없다.
 *  - 🔴 W2 제목은 '시각 조정'(미지정 기본), 장소 요약 행·'시간대 조정'은 없다.
 *  - 🔴 E1~E4 종료 미설정 동작 통일 — 종료를 안 건드리고 적용해도 endAt 은 **현재 값 문자열**이고 endsNextDay 만
 *    새 시작 기준으로 다시 유도된다(null 은 나가지 않는다). 종료를 건드리면 그 값이 실린다.
 *  - INV-3 소요시간 표기 0건 · `endsNextDay` 는 `end<=start` 기계 유도(INV-2).
 *  - D1 시트 close(딤·스와이프)도 `onCancel` 로 알린다 — 안 알리면 소비처의 "열림" 상태가 남아 다시 못 연다.
 *
 * ★ jest 사각 — 통과형 목이라 시트 실제 열림·`enableContentPanningGesture`·휠 제스처·페이드·딤은 못 본다.
 *   `enableContentPanningGesture={false}` 유지는 아래 D2 가 prop 값으로만 잠그고(실제 효과는 6-b 실기).
 *
 * 3동작 뼈대: 준비=시각으로 렌더 → 실행=휠 셀·적용 press / 휠 스크롤 정지 → 단언=onApply 인자·트리.
 */

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

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

// 소비처 형태: 직접 짜기·장소 추가(시작/종료) · 도착/출발 라벨 쌍둥이.
const CONFIGS: Config[] = [
  { prefix: 'itinerary-manual-time', labels: { start: '시작', end: '종료' } },
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

/** 첫 onApply 인자 — 키 부재·null 까지 보려면 toStrictEqual 로 잰다. */
function appliedPatch(): unknown {
  expect(onApply).toHaveBeenCalledTimes(1);
  return onApply.mock.calls[0][0];
}

beforeEach(() => {
  onApply.mockClear();
  onCancel.mockClear();
});

describe.each(CONFIGS)(
  '🔴 widgets/time-sheet · 접두=$prefix — 기본 소비처도 휠',
  (config) => {
    const { labels } = config;
    const id = (suffix: string): string => `${config.prefix}-${suffix}`;
    const press = (...suffixes: string[]): void =>
      suffixes.forEach((suffix) =>
        fireEvent.press(screen.getByTestId(id(suffix)))
      );

    it('W1 · 휠 3열·세그·readout·적용이 있고, 셀 탭 열·취소 버튼은 없다', () => {
      renderSheet(config);

      expect(screen.getByTestId(id('sheet'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('wheel-ap'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('wheel-h'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('wheel-m'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('seg-start'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('seg-end'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('readout'))).toBeOnTheScreen();
      expect(screen.getByTestId(id('apply'))).toBeOnTheScreen();

      // 옛 셀 탭 방식의 흔적 0 — 값별 셀·열 ScrollView·취소 버튼.
      expect(screen.queryByTestId(id('start-h-10'))).toBeNull();
      expect(screen.queryByTestId(id('start-h-column'))).toBeNull();
      expect(screen.queryByTestId(id('cancel'))).toBeNull();

      // labels 가 세그·readout 에 흐른다.
      expect(screen.getByTestId(id('seg-start'))).toHaveTextContent(
        labels.start
      );
      expect(screen.getByTestId(id('seg-end'))).toHaveTextContent(labels.end);
      expect(screen.getByTestId(id('readout'))).toHaveTextContent(
        new RegExp(`${labels.start} 오전 10:15`)
      );
    });

    it('W2 · 제목은 기본 "시각 조정" — "시간대 조정"·장소 요약 행은 없다', () => {
      renderSheet(config);

      expect(screen.getByText('시각 조정')).toBeOnTheScreen();
      expect(screen.queryByText('시간대 조정')).toBeNull();
      expect(screen.queryByTestId(id('place-summary'))).toBeNull();
    });

    it('E1 · 종료를 안 건드리고 적용 → 종료는 현재 값 문자열 그대로, endsNextDay=false', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      press('apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '10:15:00',
        endAt: '11:45:00',
        endsNextDay: false,
      });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('E2 · 시작만 오후 11시로 → 종료 11:45 유지 + endsNextDay 만 true 로 재유도', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      // 시작 탭 활성 — 오후로 바꾼 뒤 시 11 → 23시.
      press('wheel-ap-오후', 'wheel-h-11', 'apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '23:15:00',
        endAt: '11:45:00',
        endsNextDay: true,
      });
    });

    it('E3 · 종료 탭 휠을 건드리면 그 값이 실린다 (오전 11:45 → 오후 3:45)', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      press('seg-end', 'wheel-ap-오후', 'wheel-h-3', 'apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '10:15:00',
        endAt: '15:45:00',
        endsNextDay: false,
      });
    });

    it('E4 · start==end 면 endsNextDay=true (경계 ≤), 종료 미설정이어도 같다', () => {
      renderSheet(config, '11:00:00', '11:00:00');

      press('apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '11:00:00',
        endAt: '11:00:00',
        endsNextDay: true,
      });
    });

    it('E5 · 종료 탭을 열기만 하면 미설정 표기("설정 안 됨")가 남고 종료 값은 유지된다', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      press('seg-end');
      expect(screen.getByTestId(id('readout'))).toHaveTextContent(/설정 안 됨/);
      press('apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '10:15:00',
        endAt: '11:45:00',
        endsNextDay: false,
      });
    });

    it('W3 · 분 휠 스크롤 정지 = 셀 탭과 같다 (시작 분 40)', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      fireEvent(screen.getByTestId(id('wheel-m')), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 0, y: 40 * WHEEL_CELL_HEIGHT } },
      });
      press('apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '10:40:00',
        endAt: '11:45:00',
        endsNextDay: false,
      });
    });

    it('INV-3 · 시각 숫자는 보이나 소요시간 표기는 0건(종료 설정 전·후 모두)', () => {
      renderSheet(config, '10:15:00', '11:45:00');
      expect(screen.getByTestId(id('wheel-m-45'))).toBeOnTheScreen();
      expect(renderedTexts().filter((t) => DURATION_TEXT.test(t))).toEqual([]);

      press('seg-end', 'wheel-m-30');
      expect(screen.getByTestId(id('readout'))).toHaveTextContent(/11:30/);
      expect(renderedTexts().filter((t) => DURATION_TEXT.test(t))).toEqual([]);
    });

    it('D1 · 시트 close(딤·스와이프) → onCancel 1회·onApply 0회, 끌어 닫기·본문 pan 꺼짐이 유지된다 (D2)', () => {
      renderSheet(config);
      const sheet = screen.getByTestId(id('sheet'));

      fireEvent(sheet, 'close');

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onApply).not.toHaveBeenCalled();

      // onClose 를 가진 가장 가까운 조상 = 닫힘을 쥔 BottomSheet.
      let owner: ReactTestInstance | null = sheet;
      while (owner !== null && typeof owner.props.onClose !== 'function') {
        owner = owner.parent;
      }
      expect(owner?.props.enablePanDownToClose).toBe(true);
      // 휠 드래그가 시트 끌기로 새지 않게 — jest 는 효과를 못 보고 prop 값만 본다(실효 확인은 6-b).
      expect(owner?.props.enableContentPanningGesture).toBe(false);
    });
  }
);
