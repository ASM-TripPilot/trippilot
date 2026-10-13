import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';

import { TimeSheet, type TimeSheetPlaceSummary } from './TimeSheet';

/**
 * TRIP-1196 · 공용 시각 조정 위젯 `widgets/time-sheet` — **title·placeSummary 를 안 주는 소비처**(h12 직접 짜기
 * `itinerary-manual-time` · h13 장소 추가 `itinerary-edit-time`, 라벨 도착/출발 쌍둥이 포함)도 편집기(h04)와
 * 같은 원통 휠 입력을 쓴다. 편집기 형태(제목 '시간대 조정'+요약 행)는 아래 두 번째 블록(옛 wheel/apply 합본).
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
 * TRIP-1356 · 옛 `TimeSheet.wheel.test.tsx`(편집기 형태 CH*)·`TimeSheet.apply.test.tsx`(종료 선택 사항·W4·T*)를 아래 두 번째 블록으로
 * 합쳤다. 위 describe.each 와 같은 행동을 보던 it 5개는 지웠다: E1=H1a · E2=H1b · INV-3=H4 · D1=H7 (D1 이 H7 의 상위 집합),
 * W3 는 W4(시작 탭 분 열 포함 4행)가 덮는다. 소비처 prefix 2종 이상은 describe.each(CONFIGS) 에 그대로 남는다.
 *
 * 3동작 뼈대: 준비=시각으로 렌더 → 실행=휠 셀·적용 press / 휠 스크롤 정지 → 단언=onApply 인자·트리.
 */

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;
/** TRIP-1215 오류 문구(01b Q5) — 완전 일치. */
const RANGE_ERROR = '종료 시각은 시작보다 늦어야 해요';

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
    // TRIP-1215 — 막힘 = 문구 + disabled + 눌러도 onApply 0회. RNTL 은 disabled 를 안 누르므로 셋 다 본다.
    const expectBlocked = (): void => {
      expect(screen.getByTestId(id('error'))).toHaveTextContent(RANGE_ERROR);
      expect(screen.getByTestId(id('apply'))).toBeDisabled();
      press('apply');
      expect(onApply).not.toHaveBeenCalled();
    };

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

    // TRIP-1215 계약 변경 — 옛 E2 는 23:15/숨은 11:45 를 익일로 적용했다. 이제 막히고, 재유도 의도는 E2b 로 옮겼다.
    it('E2 · 시작만 오후 11시로 → 숨은 종료 11:45 가 새벽이 아니라 막힌다 (readout 은 "설정 안 됨" 그대로)', () => {
      renderSheet(config, '10:15:00', '11:45:00');

      // 시작 탭 활성 — 오후로 바꾼 뒤 시 11 → 23시.
      press('wheel-ap-오후', 'wheel-h-11');

      expect(screen.getByTestId(id('readout'))).toHaveTextContent(/설정 안 됨/);
      expectBlocked();
    });

    it('E2b · 07:00–08:30 에서 시작만 오후 11시로 → 숨은 종료 08:30 유지 + endsNextDay true 로 재유도', () => {
      renderSheet(config, '07:00:00', '08:30:00');

      press('wheel-ap-오후', 'wheel-h-11', 'apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '23:00:00',
        endAt: '08:30:00',
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

    // TRIP-1215 계약 변경 — 옛 E4 는 같은 시각을 "24시간 방문(익일)"으로 적용했다. 이제 열자마자 막힌다(01b Q3).
    it('E4 · start==end 면 아무것도 안 눌러도 열자마자 막혀 있다', () => {
      renderSheet(config, '11:00:00', '11:00:00');

      expectBlocked();
    });

    // TRIP-1215 — props 로 바로 심은 (시작, 숨은 종료) 경계 표. 마운트 시점 판정과 숨은 종료 경로를 함께 본다.
    it.each<[string, string, boolean | null, string]>([
      ['13:00:00', '14:30:00', false, '같은 날 허용'],
      ['18:00:00', '08:59:00', true, '밤 시작 18:00 · 새벽 종료 08:59 허용'],
      ['17:59:00', '08:59:00', null, '시작 17:59 는 밤이 아니라 막힘'],
      ['18:00:00', '09:00:00', null, '종료 09:00 은 새벽이 아니라 막힘'],
      ['23:30:00', '00:30:00', true, '기본 제안 자정 넘김 허용'],
      ['11:00:00', '08:00:00', null, 'Q-29 막힘'],
      ['15:00:00', '14:30:00', null, '숨은 종료보다 늦은 시작 막힘'],
      ['13:00:00', '13:00:00', null, '같은 시각 막힘'],
    ])(
      'E6 · 시작 %s · 종료 %s → endsNextDay %s (%s)',
      (startAt, endAt, endsNextDay) => {
        renderSheet(config, startAt, endAt);

        if (endsNextDay === null) {
          expectBlocked();
          return;
        }
        expect(screen.queryByTestId(id('error'))).toBeNull();
        expect(screen.getByTestId(id('apply'))).not.toBeDisabled();
        press('apply');
        expect(appliedPatch()).toStrictEqual({ startAt, endAt, endsNextDay });
      }
    );

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

/**
 * TRIP-787 · 공용 시각 시트 `widgets/time-sheet`를 **편집기(h04) 소비처 형태**(title='시간대 조정' + placeSummary)로 쓸 때의 계약.
 * TRIP-1196 — 입력(휠·세그·readout·적용)은 모든 소비처가 공유한다. 공통 입력은 `TimeSheet.test.tsx` 가 두 접두로 잠근다.
 *
 * 무엇을 보장하나:
 *  - title·placeSummary 를 주면 헤더 '시간대 조정'+부제·장소 요약 행·시작/종료 2탭 세그·readout·3열 휠·
 *    단일 '적용' CTA(취소 부재)를 낸다(AC-1~AC-6).
 *  - 종료는 **내부 optional 상태**로만 표현 — 미설정이면 readout '설정 안 됨'(seed Q1, onApply 계약 불변).
 *  - INV-3 — h04 분 열/readout 이 bare 숫자, 소요시간 표기 0건(AC-INV3).
 *
 * *(개념)* **통과형 목** — `@gorhom/bottom-sheet` 는 `__mocks__`가 children 을 무조건 렌더한다(node_modules
 *   수동 목 자동적용, frozen 파일이 `jest.mock` 0회로 green 인 실측). 직접 마운트하면 **항상 열린 상태**라
 *   시트 내용을 조회할 수 있다 — 실개폐·2스냅·딤은 못 잰다(6-b 실기 전용, 02a ★3).
 *
 * *(개념)* **휠 실회전·중앙강조·활성탭이 편집하는 필드**는 jest 원리적 사각(WheelPicker 주석 자인) —
 *   여기선 '3열이 트리에 존재·탭 selected 전환·readout 문자열'까지만(02a ★3). 아침 육안이 유일 그물.
 *
 * 3동작 뼈대: 준비=편집기 형태로 렌더 → 실행=탭/셀 press → 단언=텍스트·selected·testID 존재/부재.
 */

/** 편집기(h04) 형태 — 아래 두 묶음이 공유한다. */
const H04_PREFIX = 'itinerary-edit-time';
const hid = (suffix: string): string => `${H04_PREFIX}-${suffix}`;

// Q2 region·Q3 badgeLabel 프리뷰 픽스처(Figma context-card 값).
const FIXTURE: TimeSheetPlaceSummary = {
  imageUrl: 'https://example.com/gwangalli.jpg',
  name: '광안리 해변',
  badgeLabel: '필수',
  region: '부산 부산진구',
};

function renderH04(placeSummary?: TimeSheetPlaceSummary): void {
  render(
    <TimeSheet
      title="시간대 조정"
      testIDPrefix={H04_PREFIX}
      labels={{ start: '시작', end: '종료' }}
      startAt="13:00:00"
      endAt="14:30:00"
      placeSummary={placeSummary}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

function hpress(...suffixes: string[]): void {
  suffixes.forEach((suffix) =>
    fireEvent.press(screen.getByTestId(hid(suffix)))
  );
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

/**
 * 막힌 상태 3종 — 문구가 보이고, [적용]이 disabled 이고, 눌러도 onApply 가 안 나간다.
 * RNTL 은 disabled Pressable 을 누르지 않으므로 onApply 0회만으론 disabled 를 증명 못 한다(02a ★4).
 */
function hExpectBlocked(): void {
  expect(screen.getByTestId(hid('error'))).toHaveTextContent(RANGE_ERROR);
  expect(screen.getByTestId(hid('apply'))).toBeDisabled();
  hpress('apply');
  expect(onApply).not.toHaveBeenCalled();
}

function hExpectOpen(): void {
  expect(screen.queryByTestId(hid('error'))).toBeNull();
  expect(screen.getByTestId(hid('apply'))).not.toBeDisabled();
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

describe('🔴 widgets/time-sheet · 편집기 형태(title+placeSummary) — 시간대 조정', () => {
  it('CH1 · 헤더 "시간대 조정" + 부제를 그린다 (AC-1)', () => {
    renderH04(FIXTURE);

    // 완전일치 — default 제목은 '시각 조정'('시간대'≠'시각')이라 h04 분기 전엔 red(02a §5-A).
    expect(screen.getByText('시간대 조정')).toBeOnTheScreen();
    expect(screen.getByText('시작·종료를 돌려서 맞춰요')).toBeOnTheScreen();
  });

  it('CH2 · 장소 요약 행 — 썸네일·이름·배지·"{region} · 꼭 갈 곳" (AC-2)', () => {
    renderH04(FIXTURE);

    expect(screen.getByTestId(hid('place-summary'))).toBeOnTheScreen();
    // 이미지 있음 → 썸네일 이미지 렌더.
    expect(screen.getByTestId(hid('place-thumb-image'))).toBeOnTheScreen();
    // 이름·배지 라벨(파생 아님, 문자열 그대로)·지역 합성 줄.
    expect(screen.getByText('광안리 해변')).toBeOnTheScreen();
    expect(screen.getByText('필수')).toBeOnTheScreen();
    expect(screen.getByText('부산 부산진구 · 꼭 갈 곳')).toBeOnTheScreen();
  });

  it('CH2b · imageUrl null 이면 이름·지역은 남고 썸네일 이미지만 빠진다 (AC-2)', () => {
    renderH04({ ...FIXTURE, imageUrl: null });

    // 행 자체와 텍스트는 그대로.
    expect(screen.getByTestId(hid('place-summary'))).toBeOnTheScreen();
    expect(screen.getByText('광안리 해변')).toBeOnTheScreen();
    expect(screen.getByText('부산 부산진구 · 꼭 갈 곳')).toBeOnTheScreen();
    // 이미지만 미렌더(자리 컨테이너만) — 부재는 queryBy* 로.
    expect(screen.queryByTestId(hid('place-thumb-image'))).toBeNull();
  });

  it('CH3 · 시작/종료 2탭 세그 — 하나만 selected, 종료 press 로 전환 (AC-3)', () => {
    renderH04(FIXTURE);

    // 초기 = 시작 탭 활성(하나만 selected).
    expect(screen.getByTestId(hid('seg-start'))).toBeSelected();
    expect(screen.getByTestId(hid('seg-end'))).not.toBeSelected();

    // 종료 탭 press → 활성 전환.
    fireEvent.press(screen.getByTestId(hid('seg-end')));

    expect(screen.getByTestId(hid('seg-end'))).toBeSelected();
    expect(screen.getByTestId(hid('seg-start'))).not.toBeSelected();
  });

  it('CH3r · readout 이 "시작 …"과 종료 "설정 안 됨"을 반영한다 (AC-3·AC-6)', () => {
    renderH04(FIXTURE);

    // 다중 Text 이어붙임 → 부분 포함은 정규식(02a §5-A). 종료는 내부 optional 미설정(seed Q1).
    const readout = screen.getByTestId(hid('readout'));
    expect(readout).toHaveTextContent(/시작/);
    expect(readout).toHaveTextContent(/설정 안 됨/);
    // ▸ 값 심판(5-b 경고-1 봉합) — seed startAt "13:00" 이 12시간제로 "오후 1:00" 으로 변환돼
    //   보이는가. 이 줄이 decompose12→timeLabel12(오전/오후·시 접기) 출력을 잠근다. 없으면
    //   오전/오후 스왑·시 오프셋 뮤턴트가 readout 라벨만 보는 위 두 줄을 통과한다.
    expect(readout).toHaveTextContent(/오후 1:00/);
  });

  it('CH4 · 3열 휠 — 오전/오후·1~12·00~59 세 열이 트리에 실재한다 (AC-4)', () => {
    renderH04(FIXTURE);

    // WheelPicker 3벌 — 각 열의 대표 셀이 존재하면 세 열이 렌더된 것(02a ★3).
    expect(screen.getByTestId(hid('wheel-ap-오전'))).toBeOnTheScreen();
    expect(screen.getByTestId(hid('wheel-h-12'))).toBeOnTheScreen();
    expect(screen.getByTestId(hid('wheel-m-00'))).toBeOnTheScreen();
  });

  it('CH4b · 12↔24시간 변환 왕복 — seed 는 오후로 선택돼 있고, 오전을 누르면 readout 이 바뀐다 (AC-4·5-b 경고-1)', () => {
    renderH04(FIXTURE);

    // 준비/단언 — seed "13:00" 은 오후 1시. decompose12 가 오후 셀을 selected 로 표시한다.
    expect(screen.getByTestId(hid('wheel-ap-오후'))).toBeSelected();
    expect(screen.getByTestId(hid('wheel-ap-오전'))).not.toBeSelected();

    // 실행 — 오전 셀 press → onSelect('오전') → compose24('오전','1')="01" → 상태 되씀.
    fireEvent.press(screen.getByTestId(hid('wheel-ap-오전')));

    // 단언 — readout 시작이 "오전 1:00" 으로 바뀐다. compose24 왕복까지 잠근다(+12/-12 뮤턴트 검출).
    expect(screen.getByTestId(hid('readout'))).toHaveTextContent(/오전 1:00/);
  });

  it('CH5 · 단일 "적용" CTA — h04 는 취소 버튼이 없다 (AC-5)', () => {
    renderH04(FIXTURE);

    expect(screen.getByTestId(hid('apply'))).toBeOnTheScreen();
    // default 는 취소를 렌더한다 → h04 분기 전엔 present 라 red.
    expect(screen.queryByTestId(hid('cancel'))).toBeNull();
  });

  it('CH6 · INV-3 — 분 열은 bare 숫자, 소요시간 표기 0건 (AC-INV3)', () => {
    renderH04(FIXTURE);

    // 양성 앵커 — h04 분 휠 셀이 실재(h04 분기 전엔 부재라 이 줄이 red 를 만든다, 02a ★5).
    expect(screen.getByTestId(hid('wheel-m-00'))).toBeOnTheScreen();

    // 음성 — 렌더 텍스트 어디에도 소요시간 표기 0건(분 셀을 "0분"으로 그리면 여기서 걸린다).
    const texts = renderedTexts();
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
  });
});

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

// TRIP-1215 계약 변경 — H1d 는 옛 "숨은 종료로 익일 적용"을 잠갔다. 이제 숨은 종료에도 같은 판정이 걸려 막힌다.
describe('🔴 AC-1 · 종료를 손대지 않고 적용하면 종료는 현재 값 유지 — endAt 은 문자열 (TRIP-1196)', () => {
  it('H1c · 종료 탭만 열어 보고 휠을 안 누르면 여전히 미설정이고 종료 값은 유지된다', () => {
    renderH04();

    hpress('seg-end');
    expect(screen.getByTestId(hid('readout'))).toHaveTextContent(/설정 안 됨/);
    hpress('apply');

    expect(appliedPatch()).toStrictEqual({
      startAt: '13:00:00',
      endAt: '14:30:00',
      endsNextDay: false,
    });
  });

  it('H1d · 종료를 안 건드린 채 시작을 14:30 이후(15:45)로 옮기면 숨은 종료 기준으로 막힌다', () => {
    renderH04();

    hpress('wheel-h-3', 'wheel-m-45');

    hExpectBlocked();
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

      hpress('seg-end', ...wheelPresses, 'apply');

      expect(appliedPatch()).toStrictEqual({
        startAt: '13:00:00',
        endAt,
        endsNextDay,
      });
    }
  );
});

describe('🔴 AC-6 · 배지·지역을 안 주면 요약 행은 썸네일+이름뿐이다', () => {
  it('H6 · 배지 알약·"꼭 갈 곳" 줄이 없다 (짝: 둘 다 주면 둘 다 있다)', () => {
    renderH04({ imageUrl: 'https://example.com/a.jpg', name: '광안리 해변' });

    const summary = screen.getByTestId(hid('place-summary'));
    expect(screen.getByTestId(hid('place-thumb-image'))).toBeOnTheScreen();
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
    const full = screen.getByTestId(hid('place-summary'));
    expect(pinkPills(full).length).toBeGreaterThan(0);
    expect(full).toHaveTextContent('광안리 해변필수부산 부산진구 · 꼭 갈 곳');
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
    fireEvent(screen.getByTestId(hid(`wheel-${column}`)), 'momentumScrollEnd', {
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
      hpress('apply');

      expect(appliedPatch()).toStrictEqual({
        startAt,
        endAt: '14:30:00',
        endsNextDay,
      });
    }
  );

  it('종료 탭에서 시 열이 3에 멈추면 종료가 설정되어 15:30 으로 실린다', () => {
    renderH04();

    hpress('seg-end');
    settle('h', 2);

    expect(screen.getByTestId(hid('readout'))).toHaveTextContent(/오후 3:30/);
    hpress('apply');
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
    hExpectOpen();

    hpress('seg-end', 'wheel-ap-오전'); // 종료 14:30 → 02:30
    hExpectBlocked();

    hpress('wheel-ap-오후'); // 02:30 → 14:30
    hExpectOpen();
    hpress('wheel-h-3', 'apply'); // 15:30

    expect(appliedPatch()).toStrictEqual({
      startAt: '13:00:00',
      endAt: '15:30:00',
      endsNextDay: false,
    });
  });

  it('T2 · 종료를 안 건드린 채 시작을 15:00 으로 옮기면 막히고, 14:00 으로 되돌리면 숨은 종료로 적용된다', () => {
    renderH04();

    hpress('wheel-h-3'); // 시작 15:00 · 숨은 종료 14:30
    hExpectBlocked();

    hpress('wheel-h-2'); // 시작 14:00
    hExpectOpen();
    hpress('apply');

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

    hpress(...start, 'seg-end', ...end);

    if (applied === null) {
      hExpectBlocked();
      return;
    }
    hExpectOpen();
    hpress('apply');
    expect(appliedPatch()).toStrictEqual(applied);
  });

  it('T4 · 막히면 [적용] 채움이 회색 토큰으로 바뀌고, 문구는 오류 색 토큰 · raw hex 0 · 소요시간 표기 0', () => {
    renderH04();
    // 허용 상태 — [적용]은 primary 채움(className 은 Pressable 자신에 있다, 02a ★2).
    expect(classTokens(screen.getByTestId(hid('apply')))).toContain(
      'bg-primary'
    );
    expect(classTokens(screen.getByTestId(hid('apply')))).not.toContain(
      'bg-hairline-strong'
    );

    hpress('seg-end', 'wheel-ap-오전');

    const apply = screen.getByTestId(hid('apply'));
    expect(classTokens(apply)).toContain('bg-hairline-strong');
    expect(classTokens(apply)).not.toContain('bg-primary');
    expect(classTokens(screen.getByTestId(hid('error')))).toContain(
      'text-primary-text'
    );

    // raw hex — testID 몇 개가 아니라 시트 서브트리 전 노드(버튼 안쪽 Text 포함)의 className 을 본다.
    const classNames = screen
      .getByTestId(hid('sheet'))
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
