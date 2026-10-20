import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';
import { closestScrollView, stubScrollTo } from '@/test-support/sheetTree';

import {
  startTimeOptions,
  type MustVisitTimeForm,
} from '@/features/add-must-visit';
import { MustVisitTimeScreen } from './MustVisitTimeScreen';

/**
 * h07 방문 시각 지정 화면의 **렌더 계약**. 화면은 완성된 props 만 받는다 — 여행 기간도
 * 시각 목록도 배선이 계산해 내려준다.
 *
 * 무엇을 보장하나:
 *  - 고를 수 있는 날짜가 **여행 기간뿐**이고 자유 입력 통로가 없다(AC-6 · INV-U1-17 을 입력
 *    위젯 자체로 강제).
 *  - 시작 시각 시트가 **열렸을 때만** 존재한다(D2).
 *  - 토글을 끄면 날짜·시각·체류와 저장이 **정말로** 잠긴다 — 회색으로 칠하는 것만으로는
 *    부족하다(D8 · 02a ★7).
 *  - 소요시간 문자열이 한 개도 안 보인다(AC-9 · INV-3). 체류는 `짧게|보통|여유` 라벨뿐이다.
 *
 * *(개념)* **`accessibilityState`** — 요소의 상태(선택됨·꺼짐·켜짐)를 스크린리더에 알리는 표준
 * 속성. 리포 관례상 칩의 선택 여부를 여기에 싣고(`trip-wizard-period-preset-*` 선례), 테스트는
 * `toBeSelected()`·`toBeChecked()` 로 읽는다.
 *
 * 3동작 뼈대: 준비=props 를 만들어 렌더 → 실행=사용자가 누른다 → 단언=보이는 것·불린 콜백.
 */

const DAY_CHIPS = [
  { date: '2026-06-10', label: '6.10 (수)' },
  { date: '2026-06-11', label: '6.11 (목)' },
  { date: '2026-06-12', label: '6.12 (금)' },
];

/** 시·분 두 열 목록(TRIP-1437 결정 1=A). 배선이 순수 함수 결과를 그대로 넘기는 모양 그대로 넘긴다. */
const START_OPTIONS = startTimeOptions();
/** 단언 기준 — 목록 생성 함수와 따로 손으로 적는다(함수가 틀려도 화면 단언이 같이 틀리지 않게). */
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, m) =>
  String(m).padStart(2, '0')
);
/**
 * 시작 시각이 비었을 때 휠을 세울 자리(TRIP-1437 · 배선이 여행 일과 시작에서 계산해 내린다).
 * 분이 0 이 아닌 표본이다 — '10:00' 이면 분 열 위치가 기본값(맨 위)과 같아 "세웠다"를 못 가른다(02a ★5).
 */
const START_ANCHOR = '10:30';

const FORM: MustVisitTimeForm = {
  fixed: true,
  fixedDate: '2026-06-11',
  fixedStart: '13:00',
  dwellKey: 'NORMAL',
};

function renderScreen(
  over: Partial<ComponentProps<typeof MustVisitTimeScreen>> = {}
) {
  return render(
    <MustVisitTimeScreen
      sourcePoiId="poi-a"
      placeName="부산시립미술관"
      region="부산진구"
      imageUrl={null}
      dayChips={DAY_CHIPS}
      startOptions={START_OPTIONS}
      startAnchor={START_ANCHOR}
      form={FORM}
      {...over}
    />
  );
}

/** 렌더된 텍스트 전부 — 부정 스캔(INV-3)의 모집단이다(소스가 아니라 보이는 글자). */
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

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/**
 * 호스트 `TextInput` 노드 개수. 대부분 노드의 `type` 은 **함수**(컴포넌트)라 그냥 비교하면
 * 언제나 거짓이고, 호스트 노드만 `type` 이 문자열이다(02a §5-2 실측).
 *
 * ⚠️ `typeof node.type === 'string'` 으로 좁히지 않는다 — 타입 단계에서 `ElementType` 이
 * **DOM·SVG 내장 태그 이름 유니온**으로 좁혀져 RN 의 `'TextInput'` 과 겹치지 않고, tsc 가
 * TS2367("두 타입에 겹침이 없다")을 낸다(게이트①-2 · 02a §9). `String()` 은 같은 것을 거른다:
 * 함수·클래스·forwardRef 객체는 소스 텍스트나 `[object Object]` 로 문자열화돼 절대
 * `'TextInput'` 과 같아지지 않고, 호스트 노드만 그 이름 그대로 남는다.
 */
function textInputCount(): number {
  return screen.root.findAll((node) => String(node.type) === 'TextInput')
    .length;
}

function dateChipTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-mustvisit-time-date-/)
    .map((node) => String(node.props.testID));
}

function startOptionCount(): number {
  return screen.queryAllByTestId(/^itinerary-mustvisit-time-start-option-/)
    .length;
}

/** 한 열의 셀 testID 를 트리 순서대로 — 요소 배열 대신 문자열로 단언한다(실패 메시지 메모리 폭주 방지, A 블록 주석). */
function startCellIds(unit: 'h' | 'm'): string[] {
  return screen
    .queryAllByTestId(
      new RegExp(`^itinerary-mustvisit-time-start-option-${unit}-`)
    )
    .map((node) => String(node.props.testID));
}

/** 시작 시트 안에서 selected 인 셀 testID 전부. */
function selectedStartCells(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-mustvisit-time-start-option-/)
    .filter((node) => node.props.accessibilityState?.selected === true)
    .map((node) => String(node.props.testID));
}

const H_WHEEL = 'itinerary-mustvisit-time-start-wheel-h';
const M_WHEEL = 'itinerary-mustvisit-time-start-wheel-m';
const hourCell = (hh: string): string =>
  `itinerary-mustvisit-time-start-option-h-${hh}`;
const minuteCell = (mm: string): string =>
  `itinerary-mustvisit-time-start-option-m-${mm}`;

describe('C25 · AC-6 · AC-V4 — 날짜 칩은 여행 기간에서만 나오고 선택 상태를 노출한다', () => {
  it('칩 3개가 기간 날짜 그대로이고 고른 칩만 selected 다', () => {
    renderScreen();

    expect(dateChipTestIds()).toEqual([
      'itinerary-mustvisit-time-date-2026-06-10',
      'itinerary-mustvisit-time-date-2026-06-11',
      'itinerary-mustvisit-time-date-2026-06-12',
    ]);
    expect(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-11')
    ).toBeSelected();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-10')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-12')
    ).not.toBeSelected();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-11')
    ).toHaveTextContent('6.11 (목)');
  });

  it('C25-b 기간 밖 날짜를 칠 통로가 없다 — 화면에 텍스트 입력이 0개다', () => {
    renderScreen();

    // INV-U1-17("`fixedDate` 는 여행 기간 안")을 사후 검증이 아니라 **입력 위젯 자체로** 강제한다.
    // 자유 입력 칸이 하나라도 있으면 기간 밖 날짜가 만들어질 수 있다.
    expect(textInputCount()).toBe(0);
  });

  it('C25-c 칩을 누르면 그 날짜가 넘어간다', () => {
    const onPickDate = jest.fn();
    renderScreen({ onPickDate });

    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-12')
    );
    expect(onPickDate).toHaveBeenCalledWith('2026-06-12');
  });
});

describe('C26 · D2 — 시작 시각은 바텀시트 목록에서 고른다', () => {
  /**
   * ⚠️ `@gorhom/bottom-sheet` 수동 목은 children 을 **무조건** 렌더한다(02a §5-2 실측). 따라서
   * 시트를 상시 마운트하면 닫힌 상태에서도 48개 옵션이 트리에 남는다. 아래 "열기 전 0건" 이
   * **조건부 마운트를 강제하는 심판**이다(`TripWizardStep2Screen` 의 `fixSheet === undefined ?
   * null : …` 선례와 같은 형태).
   */
  // TRIP-1437 — 옛 단언은 "48개 한 열 · `start-option-13:00`" 이었다. 시·분 두 열로 바뀌었다(AC-1).
  it('열기 전에는 시트도 옵션도 없고, 필드를 누르면 시 24칸·분 60칸 두 열이 뜬다 (AC-1)', () => {
    const onPickStart = jest.fn();
    renderScreen({ onPickStart });

    expect(
      screen.queryAllByTestId('itinerary-mustvisit-time-start-sheet')
    ).toEqual([]);
    expect(startOptionCount()).toBe(0);

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));

    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-sheet')
    ).toBeOnTheScreen();
    expect(screen.getByTestId(H_WHEEL)).toBeOnTheScreen();
    expect(screen.getByTestId(M_WHEEL)).toBeOnTheScreen();
    // 완전 일치 — 개수·순서·zero-pad. 옛 한 열 셀(`-start-option-13:00`)은 0개다.
    expect(startCellIds('h')).toEqual(HOURS.map(hourCell));
    expect(startCellIds('m')).toEqual(MINUTES.map(minuteCell));
    expect(
      screen.queryAllByTestId(
        /^itinerary-mustvisit-time-start-option-\d{2}:\d{2}$/
      ).length
    ).toBe(0);

    // 고르면 그 시각이 넘어간다 — 시 15 를 누르면 분은 지금 값(13:00 의 00)을 그대로 쓴다.
    // 필드를 누르는 것만으로는 아무 값도 정해지지 않는다.
    expect(onPickStart).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(hourCell('15')));
    expect(onPickStart).toHaveBeenCalledWith('15:00');
    expect(onPickStart).toHaveBeenCalledTimes(1);
  });

  /**
   * TRIP-599(AC-2 통합) — 시작 시각이 휠 primitive 로 교체돼도 **선택 표식**이 살아남는다.
   * 휠 자체의 선택 표식은 `WheelPicker.test.tsx` AC-2 가 잠그고, 여기서는 h07 이 그 primitive 에
   * `selected` 를 실제로 넘겨 배선하는지를 통합 지점에서 잰다 — 안 넘기면 아무 셀도 selected 가
   * 아니어서 red 다. (교체 전 평면 리스트도 같은 계약을 만족하므로 지금은 선제 green 이다.)
   */
  it('D2-b 열린 시트에서 지금 선택된 시각(13:00)의 시 13·분 00 셀만 selected 다', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));

    // TRIP-1437 — 두 열이라 선택 셀도 둘이다. 일과 시작 자리(10·30)는 선택이 아니다.
    expect(selectedStartCells()).toEqual([hourCell('13'), minuteCell('00')]);
    expect(screen.getByTestId(hourCell('09'))).not.toBeSelected();
    expect(screen.getByTestId(hourCell('10'))).not.toBeSelected();
  });
});

describe('C27 · AC-V4 · D4 · INV-3 — 체류는 3단계 라벨뿐이다', () => {
  it('칩 3개에 보통만 selected 이고, 분 숫자가 화면에 없다', () => {
    const onPickDwell = jest.fn();
    renderScreen({ onPickDwell });

    expect(
      screen.getByTestId('itinerary-mustvisit-time-dwell-SHORT')
    ).toHaveTextContent('짧게');
    expect(
      screen.getByTestId('itinerary-mustvisit-time-dwell-NORMAL')
    ).toHaveTextContent('보통');
    expect(
      screen.getByTestId('itinerary-mustvisit-time-dwell-LONG')
    ).toHaveTextContent('여유');
    expect(
      screen.getByTestId('itinerary-mustvisit-time-dwell-NORMAL')
    ).toBeSelected();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-dwell-SHORT')
    ).not.toBeSelected();

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-dwell-LONG'));
    expect(onPickDwell).toHaveBeenCalledWith('LONG');
  });
});

describe('C28 · AC-5 — 값이 비면 사유가 보이고 저장이 잠긴다', () => {
  it('사유가 화면에 있고 CTA 를 눌러도 저장이 시도되지 않는다', () => {
    const onSubmit = jest.fn();
    renderScreen({
      form: { ...FORM, fixedStart: null },
      blockReason: 'START_MISSING',
      onSubmit,
    });

    const error = screen.getByTestId('itinerary-mustvisit-time-error');
    expect(error).toBeOnTheScreen();
    // 빈 안내는 안내가 아니다(INV-4 침묵 실패 금지).
    expect(error).not.toHaveTextContent('');

    const cta = screen.getByTestId('itinerary-mustvisit-time-submit');
    expect(cta).toBeDisabled();
    // ⚠️ `toBeDisabled()` 만으로는 부족하다 — 접근성 상태만 칠하고 실제로는 눌리는 구현이
    //    그 매처를 통과한다(02a ★7 실측). 실제로 안 불리는지 함께 본다.
    fireEvent.press(cta);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('C28-b 값이 다 차면 사유가 사라지고 저장이 열린다 (긍정 짝)', () => {
    const onSubmit = jest.fn();
    renderScreen({ blockReason: null, onSubmit });

    expect(screen.queryAllByTestId('itinerary-mustvisit-time-error')).toEqual(
      []
    );
    const cta = screen.getByTestId('itinerary-mustvisit-time-submit');
    expect(cta).toBeEnabled();
    fireEvent.press(cta);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 C29 · AC-a3 · BR-U1-48 — 토글 OFF 는 입력 3섹션만 잠그고 저장은 연다 (ANYTIME 제출)', () => {
  it('날짜·시각·체류는 잠기지만 저장은 열리고 라벨이 아무 때나로 두기다', () => {
    // ★ 저장 축 반전(TRIP-786) — 구 C29 는 "OFF 면 저장도 정말로 잠긴다"를 뮤테이션으로 못박았다.
    //    이번 요구는 OFF=ANYTIME 제출 허용이라 **입력 3섹션 잠금은 유지**하되 **저장만 연다**.
    const onPickDate = jest.fn();
    const onPickDwell = jest.fn();
    const onPickStart = jest.fn();
    const onSubmit = jest.fn();
    renderScreen({
      form: { ...FORM, fixed: false },
      onPickDate,
      onPickDwell,
      onPickStart,
      onSubmit,
    });

    // ① 변하지 않는 축 — 토글이 꺼져 있고 입력 3섹션(날짜·시각·체류)은 계속 잠긴다. 회색으로
    //    칠하는 것만으로는 부족하므로 접근성 상태 + 실제 press 무발화를 함께 본다(구 C29 계승).
    expect(
      screen.getByTestId('itinerary-mustvisit-time-toggle')
    ).not.toBeChecked();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-11')
    ).toBeDisabled();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-dwell-NORMAL')
    ).toBeDisabled();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-field')
    ).toBeDisabled();

    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-11')
    );
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-dwell-LONG'));
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));

    expect(onPickDate).not.toHaveBeenCalled();
    expect(onPickDwell).not.toHaveBeenCalled();
    // 시트도 열리지 않는다 — 열렸다면 옵션이 트리에 나타난다.
    expect(startOptionCount()).toBe(0);
    expect(onPickStart).not.toHaveBeenCalled();

    // ② 반전 축 — 저장은 열린다. 라벨은 `아무 때나로 두기`(ANYTIME)이고, 눌리면 onSubmit 1회.
    //    회색 잠금이 걷혀야 한다 — `toBeEnabled` + 실제 press 발화 두 겹으로 확인.
    const cta = screen.getByTestId('itinerary-mustvisit-time-submit');
    expect(cta).toBeEnabled();
    expect(cta).toHaveTextContent('아무 때나로 두기');
    fireEvent.press(cta);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // ③ 안내 박스는 꺼진 상태의 설명을 계속 한다(무엇이 일어날지 말해 준다).
    expect(
      screen.getByTestId('itinerary-mustvisit-time-notice')
    ).toBeOnTheScreen();
  });

  it('C29-b 꺼져 있어도 토글 자신은 눌린다 (안 그러면 다시 켤 수 없다)', () => {
    const onToggleFixed = jest.fn();
    renderScreen({ form: { ...FORM, fixed: false }, onToggleFixed });

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-toggle'));
    expect(onToggleFixed).toHaveBeenCalledWith(true);
  });
});

describe('C30 · D8 긍정 앵커 — 토글이 켜져 있으면 전부 눌린다', () => {
  it('날짜·체류·저장이 열려 있고 각각 콜백을 부른다', () => {
    // 앵커가 없으면 "전부 항상 비활성" 인 화면이 C29 를 통과한다.
    const onPickDate = jest.fn();
    const onPickDwell = jest.fn();
    const onSubmit = jest.fn();
    renderScreen({ onPickDate, onPickDwell, onSubmit, blockReason: null });

    expect(screen.getByTestId('itinerary-mustvisit-time-toggle')).toBeChecked();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-10')
    ).toBeEnabled();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-dwell-LONG')
    ).toBeEnabled();
    expect(screen.getByTestId('itinerary-mustvisit-time-submit')).toBeEnabled();
    // AC-a3 짝 — 켜진 상태의 CTA 라벨은 `이 시각으로 고정`이다(OFF 의 `아무 때나로 두기`와 갈린다).
    //    이 앵커가 없으면 두 라벨을 모두 한 문자열로 바꾼 나이브 구현이 C29 를 통과한다.
    expect(
      screen.getByTestId('itinerary-mustvisit-time-submit')
    ).toHaveTextContent('이 시각으로 고정');

    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-time-date-2026-06-10')
    );
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-dwell-LONG'));
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-submit'));

    expect(onPickDate).toHaveBeenCalledTimes(1);
    expect(onPickDwell).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('C31 · AC-9 · INV-3 — h07 에도 소요시간 문자열이 없다', () => {
  it('장소명·날짜·시각은 보이는데 분·시간·소요 표기는 0건이다', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));

    const texts = renderedTexts();
    // 긍정 앵커 — 화면이 실제로 무언가를 그리고 있다.
    expect(texts).toContain('부산시립미술관');
    expect(texts).toContain('6.11 (목)');
    expect(texts.some((text) => text.includes('13:00'))).toBe(true);

    // 부정 — 체류 3단계가 라벨뿐이라 분값이 새어 나올 자리가 없다. 시트를 연 상태까지 훑는다
    // (시·분 두 열 셀이 `시`·`분` 으로 읽히지 않는 것도 함께 본다 — 셀은 bare 숫자, TRIP-1437).
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);
  });
});

describe('C32 · D10 — 장소 카드 보조행은 region 이 있을 때만 지역을 말한다', () => {
  it('region 이 있으면 `{region} · 꼭 갈 곳` 이다', () => {
    renderScreen({ region: '부산진구' });

    // 완전 일치 — `Place` 에 주소 문자열이 없어 `region`(선택·nullable) 이 유일한 출처다.
    expect(
      screen.getByTestId('itinerary-mustvisit-time-subtitle')
    ).toHaveTextContent('부산진구 · 꼭 갈 곳');
  });

  it('C32-b region 이 없으면 앞의 구분자가 남지 않는다', () => {
    renderScreen({ region: null });

    // 흔한 버그 — `${region ?? ''} · 꼭 갈 곳` 으로 짜면 ` · 꼭 갈 곳` 이 된다. 완전 일치가 잡는다.
    expect(
      screen.getByTestId('itinerary-mustvisit-time-subtitle')
    ).toHaveTextContent('꼭 갈 곳');
  });
});

describe('C33 · AC-b3 — errorText 는 에러 행에 뜨고 onRetry 는 다시 시도를 세운다', () => {
  it('errorText 문구가 그대로 보이고, onRetry 를 주면 다시 시도가 뜨며 눌리면 불린다', () => {
    // 화면은 순수 — 배선이 넘긴 `errorText` 를 그대로 그린다(현행 통로 유지, 회귀 앵커).
    const onRetry = jest.fn();
    renderScreen({ errorText: '저장하지 못했어요', onRetry });

    expect(
      screen.getByTestId('itinerary-mustvisit-time-error')
    ).toHaveTextContent('저장하지 못했어요');

    const retry = screen.getByTestId('itinerary-mustvisit-time-retry');
    expect(retry).toBeOnTheScreen();
    fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('C33-b onRetry 가 없으면 다시 시도 버튼이 없다 (복구 불가할 때는 안 세운다)', () => {
    renderScreen({ errorText: '저장하지 못했어요' });

    expect(
      screen.getByTestId('itinerary-mustvisit-time-error')
    ).toHaveTextContent('저장하지 못했어요');
    expect(screen.queryAllByTestId('itinerary-mustvisit-time-retry')).toEqual(
      []
    );
  });
});

describe('🔴 C34 · AC-b1 · AC-b2 — 저장 실패 행이 안내 배너 아래로 가고 흰 배경이 된다', () => {
  it('안내 배너 다음에 에러 행이 온다 (형제 순서 · 현재는 위라 red)', () => {
    renderScreen({ errorText: '저장하지 못했어요' });

    // ★ `getAllByTestId(/regex/)` 는 렌더 트리 pre-order 로 돌아온다(node_modules
    //    `find-all.js` 실측 — 부모→자식, 형제는 순서 보존). `$` 앵커라 `-error-row`·`-retry`·
    //    `-duplicate` 는 안 걸리고 `-notice`·`-error` 두 Text 만 뽑힌다.
    const order = screen
      .getAllByTestId(/^itinerary-mustvisit-time-(notice|error)$/)
      .map((node) => String(node.props.testID));

    // 현재 에러 행이 안내 배너 **위**라 배열이 [error, notice] → red. Figma 는 안내 아래다.
    expect(order).toEqual([
      'itinerary-mustvisit-time-notice',
      'itinerary-mustvisit-time-error',
    ]);
  });

  it('C34-b 에러 행 배경이 흰색(bg-canvas)이고 회색이 아니다', () => {
    renderScreen({ errorText: '저장하지 못했어요' });

    // 배경은 에러 행 **컨테이너 View** 에 얹힌다(메시지 `-error` Text 는 `text-*` 뿐이라 못 본다).
    // 구현자가 그 컨테이너에 신규 testID `-error-row` 를 부여해야 이 축이 unambiguous 하게 잠긴다.
    // className 은 렌더 트리에 평문 prop 으로 남는다(HomeScreen.test.tsx:186 선례).
    const row = screen.getByTestId('itinerary-mustvisit-time-error-row');
    const className = String(row.props.className);

    // 변경 축 — 흰 배경(현재 bg-surface-soft 회색 → red).
    expect(className).toContain('bg-canvas');
    expect(className).not.toContain('bg-surface-soft');
    // 앵커 — hairline 테두리 + r12(rounded-button=12px 실측). 실제 흰 렌더·픽셀은 6-b 대조.
    expect(className).toContain('border-hairline');
    expect(className).toContain('rounded-button');
  });
});

/**
 * TRIP-990 · W3 (D21 · 01b Q6) — h07 시작 시각 시트: 휠을 굴리다 멈추면 그 값이 확정되고, 시트는
 * 휠 정지·셀 탭으로는 닫히지 않는다(딤·끌기 닫힘은 아래 A 가 잠근다 — TRIP-1014).
 *
 * 왜 닫힘을 떼는가: 휠이 스크롤 정지로도 값을 확정하게 되면, 예전처럼 "값이 넘어오면 시트를 닫는다"를
 * 두면 굴리다 잠깐 멈추는 순간 시트가 닫혀 버린다. 그래서 탭이든 스크롤 정지든 값만 넘기고, 닫기는
 * 사용자가 "닫기"를 눌러서만 한다.
 *
 * 무엇을 보장하나:
 *  - 시 휠이 12 칸에서 멈추면 `onPickStart('12:00')` 가 1회 불리고 시트는 열린 채다(TRIP-1437 — 두 열이라
 *    분은 지금 값 13:00 의 00 을 쓴다).
 *  - 셀을 탭해도 값만 넘어가고 시트는 열린 채다. "닫기"를 누르면 그때 닫힌다.
 *
 * 3동작 뼈대: 준비=시트를 연다 → 실행=휠 정지 / 셀 탭 / 닫기 → 단언=넘어간 값·시트 존재 여부.
 */
describe('🔴 W3 · 휠 정지 확정 + 휠 정지·셀 탭으로는 닫히지 않음 (D21 · Q6)', () => {
  const SHEET = 'itinerary-mustvisit-time-start-sheet';
  const WHEEL = H_WHEEL;

  function openSheet(onPickStart: jest.Mock): void {
    renderScreen({ onPickStart });
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));
  }

  it('휠이 12:00 에서 멈추면 그 값이 넘어가고 시트는 열린 채다', () => {
    const onPickStart = jest.fn();
    openSheet(onPickStart);

    fireEvent(screen.getByTestId(WHEEL), 'momentumScrollEnd', {
      nativeEvent: {
        contentOffset: {
          x: 0,
          y: HOURS.indexOf('12') * WHEEL_CELL_HEIGHT,
        },
      },
    });

    expect(onPickStart).toHaveBeenCalledWith('12:00');
    expect(onPickStart).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
  });

  it('셀을 탭해도 값만 넘어가고 시트는 열린 채이며, "닫기"를 눌러야 닫힌다', () => {
    const onPickStart = jest.fn();
    openSheet(onPickStart);

    fireEvent.press(screen.getByTestId(hourCell('14')));

    expect(onPickStart).toHaveBeenCalledWith('14:00');
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-close'));

    expect(screen.queryAllByTestId(SHEET)).toEqual([]);
    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-field')
    ).toBeOnTheScreen();
  });
});

/**
 * TRIP-1014 · A (#041 · 01b Q2) — h07 시작 시각 시트가 딤 탭·아래로 끌기로 닫혀도 다시 열린다.
 *
 * 왜: 라이브러리가 딤 탭으로 시트를 닫아도 화면의 "열림" 상태(`startSheetOpen`)가 그대로면, 칸을 다시
 * 눌러도 이미 열린 상태라 아무 일도 안 일어난다. 시트의 `onClose` 가 그 상태를 풀어야 한다.
 *
 * 무엇을 보장하나:
 *  - A1 닫힘 신호(`close`)를 받으면 시트가 트리에서 빠지고, 시작 시각 칸은 남는다.
 *  - A2 그 뒤 칸을 다시 누르면 시트가 새로 뜬다. "닫힌 뒤 0개"를 먼저 본다 — 닫힘이 고장 나 시트가 계속
 *    떠 있어도 "재탭 후 1개"는 참이라서(02a ★A5).
 *  - A3 `onClose` 를 쥔 엘리먼트가 아래로 끌어 닫기를 켜고(`true`), 본문 끌기는 끈다(`false` — TRIP-599
 *    휠 스크롤 보호). 같은 엘리먼트여야 한다 — 안쪽 `BottomSheetView` 에 `onClose` 를 달면 실기에선 딤이
 *    안 먹는다(02a ★A2).
 *
 * ⚠️ `fireEvent(요소, 'close')` 는 딤 탭의 대역이다 — 부모를 타고 올라가 `onClose` 를 찾아 부르고, 못 찾으면
 *   조용히 끝난다(02a ★A1). 실제 딤·핸들 끌기가 닫는지, 휠을 굴려도 안 끌리는지는 6-b 실기
 *   (`h03-mustvisit-time-default`).
 *
 * 실패 메시지 주의: 요소 배열을 `toEqual([])`·`toHaveLength` 로 단언하면 **실패할 때** jest 가 요소 객체 전체를
 *   문자열로 풀다가 메모리가 넘쳐 스위트가 통째로 죽는다(02a ★A6 실측). 그래서 부재는 `not.toBeOnTheScreen()`,
 *   개수는 `.length` 숫자로 본다.
 *
 * 3동작 뼈대: 준비=시트를 연다 → 실행=닫힘 신호 / 다시 탭 → 단언=시트 개수·닫힘 엘리먼트의 prop.
 */
describe('🔴 A · S1 시트가 딤·끌기로 닫혀도 다시 열린다 (TRIP-1014 #041)', () => {
  const SHEET = 'itinerary-mustvisit-time-start-sheet';
  const FIELD = 'itinerary-mustvisit-time-start-field';

  function openSheet(): void {
    renderScreen();
    fireEvent.press(screen.getByTestId(FIELD));
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
  }

  it('A1 · 닫힘 신호를 받으면 시트가 트리에서 빠지고 시작 시각 칸은 남는다', () => {
    openSheet();

    fireEvent(screen.getByTestId(SHEET), 'close');

    expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen();
    expect(screen.getByTestId(FIELD)).toBeOnTheScreen();
  });

  it('A2 · 닫힌 뒤 시작 시각 칸을 다시 누르면 시트가 새로 뜬다', () => {
    openSheet();
    fireEvent(screen.getByTestId(SHEET), 'close');
    // 앵커 — 먼저 닫혔어야 "다시 열림"이 뜻을 가진다(02a ★A5).
    expect(screen.queryByTestId(SHEET)).not.toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(FIELD));

    expect(screen.getAllByTestId(SHEET).length).toBe(1);
    expect(screen.getByTestId(hourCell('13'))).toBeOnTheScreen();
  });

  it('A3 · 닫힘을 쥔 엘리먼트가 아래로 끌어 닫기를 켜고 본문 끌기는 끈다', () => {
    openSheet();

    // onClose 를 가진 가장 가까운 조상 = 닫힘을 쥔 BottomSheet(TimeSheet H7 선례).
    let owner: ReactTestInstance | null = screen.getByTestId(SHEET);
    while (owner !== null && typeof owner.props.onClose !== 'function') {
      owner = owner.parent;
    }

    expect(owner).not.toBeNull();
    expect(owner?.props.enablePanDownToClose).toBe(true);
    // not.toBe(true) 가 아니라 toBe(false) — prop 을 지우면(undefined) 라이브러리 기본값 true 로 돌아간다.
    expect(owner?.props.enableContentPanningGesture).toBe(false);
  });
});

/**
 * TRIP-1437 (QA Q-066·Q-116) — 방문 시각 지정의 시각 표기·휠 위치·배지·토글 행.
 *
 * 무엇을 보장하나:
 *  - AC-5 시작 시각 칸은 `HH:mm` 한 가지로만 보인다("오후 1:00 (13:00)" 이중 표기 폐기).
 *  - AC-7 값이 비어 있으면 휠은 배선이 내린 자리(`startAnchor`, 그 여행 일과 시작)에 서고 선택 표시는 없다.
 *  - AC-8 시트를 열고 레이아웃만 받고 닫으면 값이 정해지지 않는다(BR-U1-49 — 보기만으로 값 설정 금지).
 *  - AC-9 값이 있으면 그 값이 선택·위치이고 일과 시작 자리는 무시된다.
 *  - AC-10 한 열만 고르면 다른 열은 화면에 서 있던 값이다(01b Q3 — 값이 비었으면 세운 자리의 값).
 *  - AC-11 '고정' 배지는 토글이 켜졌을 때만 있다(BR-U1-48 — 꺼짐 = ANYTIME).
 *  - AC-12 토글은 행 전체가 누름 대상이고 role switch·checked 는 그 행 하나(testID 그대로)에 있다.
 *
 * *(개념)* **위치(anchor) vs 선택(selected)** — 선택은 저장될 값, 위치는 눈이 머무는 칸이다. 이번 칸은
 *   값은 비운 채 위치만 일과 시작으로 옮긴다.
 * *(개념)* `stubScrollTo` — RN jest 목의 `scrollTo` 는 모든 스크롤뷰가 함께 쓰는 가짜라, 이 열 인스턴스에
 *   새 가짜를 꽂아 이 열 호출만 센다(1417 02a ★1).
 *
 * 커버하지 않는 것(6-b): 휠이 실기에서 정말 그 칸에 서는지, 프로그램 스크롤이 정지 이벤트를 쏴서 값이
 *   정해지는 길이 있는지(jest 의 scrollTo 는 그 이벤트를 안 낸다), 배지·토글 행의 모양.
 *
 * 3동작 뼈대: 준비=폼·자리로 렌더(·시트 열기) → 실행=레이아웃·셀·행 누르기 → 단언=칸 글자·위치·콜백.
 */
describe('🔴 TRIP-1437 · 방문 시각 지정 — 24시간 표기·휠 위치·배지·토글 행', () => {
  function openSheet(): void {
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));
  }

  /** 두 열에 가짜 scrollTo 를 꽂고(아직 0회 앵커), 레이아웃을 쏜 뒤 열별 가짜를 돌려준다. */
  function layoutBothColumns(): { h: jest.Mock; m: jest.Mock } {
    const stub = (cell: string): jest.Mock => {
      const scroll = closestScrollView(screen.getByTestId(cell));
      expect(scroll).not.toBeNull();
      const scrollTo = stubScrollTo(scroll!);
      expect(scrollTo).not.toHaveBeenCalled();
      return scrollTo;
    };
    const h = stub(hourCell('00'));
    const m = stub(minuteCell('00'));
    [H_WHEEL, M_WHEEL].forEach((wheel) =>
      fireEvent(screen.getByTestId(wheel), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 220 } },
      })
    );
    return { h, m };
  }

  const offsetY = (wheel: string): unknown =>
    screen.getByTestId(wheel).props.contentOffset?.y;

  it('AC-5 · 시작 시각 13:00 은 칸에 정확히 "13:00" 으로만 보인다 — 오전·오후·괄호 없음', () => {
    renderScreen();

    // 완전 일치 — 칸 안 글자 전부가 이 다섯 글자다(아이콘은 글자가 없다, 02a §5).
    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-field')
    ).toHaveTextContent('13:00');

    // 시트를 연 상태까지 — 어디에도 12시간 표기가 없다.
    openSheet();
    expect(renderedTexts().filter((t) => /오전|오후/.test(t))).toEqual([]);
  });

  it('AC-7 · 값이 비면 시 열은 10칸(440)·분 열은 30칸(1320)에 서고, 어떤 셀도 선택돼 있지 않다', () => {
    const onPickStart = jest.fn();
    renderScreen({ form: { ...FORM, fixedStart: null }, onPickStart });
    openSheet();

    // 첫 프레임 위치(contentOffset) — 자정(0)이 아니라 일과 시작 10:30.
    expect(offsetY(H_WHEEL)).toBe(10 * WHEEL_CELL_HEIGHT);
    expect(offsetY(M_WHEEL)).toBe(30 * WHEEL_CELL_HEIGHT);

    // 레이아웃 뒤 다시 맞추기(1417 L 패턴)도 같은 자리로.
    const { h, m } = layoutBothColumns();
    expect(h).toHaveBeenCalledWith(
      expect.objectContaining({ y: 10 * WHEEL_CELL_HEIGHT, animated: false })
    );
    expect(m).toHaveBeenCalledWith(
      expect.objectContaining({ y: 30 * WHEEL_CELL_HEIGHT, animated: false })
    );

    // 위치일 뿐 선택이 아니다.
    expect(selectedStartCells()).toEqual([]);
    expect(onPickStart).not.toHaveBeenCalled();
  });

  it('AC-8 · 열고 레이아웃만 받고 닫으면 onPickStart 0회이고 칸은 여전히 "시각 선택"이다', () => {
    const onPickStart = jest.fn();
    renderScreen({ form: { ...FORM, fixedStart: null }, onPickStart });
    // 앵커 — 열기 전 칸은 빈 자리 문구다.
    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-field')
    ).toHaveTextContent('시각 선택');

    openSheet();
    layoutBothColumns();
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-close'));

    expect(onPickStart).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('itinerary-mustvisit-time-start-sheet')
    ).not.toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-field')
    ).toHaveTextContent('시각 선택');
  });

  it('AC-9 · 값 13:07 이 있으면 시 13·분 07 이 선택이고 그 자리(572 / 308)에 선다 — 일과 시작은 무시', () => {
    renderScreen({ form: { ...FORM, fixedStart: '13:07' } });
    openSheet();

    expect(selectedStartCells()).toEqual([hourCell('13'), minuteCell('07')]);
    expect(offsetY(H_WHEEL)).toBe(13 * WHEEL_CELL_HEIGHT);
    expect(offsetY(M_WHEEL)).toBe(7 * WHEEL_CELL_HEIGHT);

    const { h, m } = layoutBothColumns();
    expect(h).toHaveBeenCalledWith(
      expect.objectContaining({ y: 13 * WHEEL_CELL_HEIGHT, animated: false })
    );
    expect(m).toHaveBeenCalledWith(
      expect.objectContaining({ y: 7 * WHEEL_CELL_HEIGHT, animated: false })
    );
  });

  it.each<[string | null, 'h' | 'm', string, string, string]>([
    [null, 'h', '19', '19:30', '값이 비면 분은 세운 자리 30'],
    [null, 'm', '45', '10:45', '값이 비면 시는 세운 자리 10'],
    ['13:07', 'h', '19', '19:07', '값이 있으면 분은 그 값 07'],
  ])(
    'AC-10 · 값 %s 에서 %s 열 %s 를 누르면 onPickStart(%s) 1회 (%s)',
    (fixedStart, unit, cellValue, expected) => {
      const onPickStart = jest.fn();
      renderScreen({ form: { ...FORM, fixedStart }, onPickStart });
      openSheet();

      fireEvent.press(
        screen.getByTestId(
          unit === 'h' ? hourCell(cellValue) : minuteCell(cellValue)
        )
      );

      expect(onPickStart).toHaveBeenCalledWith(expected);
      expect(onPickStart).toHaveBeenCalledTimes(1);
    }
  );

  it('AC-11 · 토글이 꺼져 있으면 장소 카드에 "고정" 배지가 없다 — 짝: 켜면 있다', () => {
    renderScreen({ form: { ...FORM, fixed: false } });

    expect(
      screen.queryByTestId('itinerary-mustvisit-time-fixed-badge')
    ).not.toBeOnTheScreen();
    // 글자로도 없다 — testID 만 떼고 글자를 남기는 구현을 막는다('시각 고정' 제목·CTA 는 완전 일치에 안 걸린다).
    expect(screen.queryAllByText('고정').length).toBe(0);

    screen.unmount();
    renderScreen({ form: { ...FORM, fixed: true } });

    expect(
      screen.getByTestId('itinerary-mustvisit-time-fixed-badge')
    ).toHaveTextContent('고정');
    expect(screen.queryAllByText('고정').length).toBe(1);
  });

  it.each<[boolean, string]>([
    [false, '시각 고정'],
    [true, '시각 고정'],
    [false, '예약·공연처럼 시간이 정해진 곳에 켜세요'],
  ])(
    'AC-12 · 켜짐=%s 에서 스위치가 아니라 행 글자 "%s" 를 눌러도 onToggleFixed(반대 값) 1회',
    (fixed, label) => {
      const onToggleFixed = jest.fn();
      renderScreen({ form: { ...FORM, fixed }, onToggleFixed });

      // 행 글자를 누른다 — 누름 손잡이가 위에 없으면 RNTL 은 조용히 아무것도 안 한다(02a §5).
      fireEvent.press(screen.getByText(label));

      expect(onToggleFixed).toHaveBeenCalledWith(!fixed);
      expect(onToggleFixed).toHaveBeenCalledTimes(1);
    }
  );

  it('AC-12 · switch 는 화면에 정확히 하나이고, 그것이 testID 토글 요소이며 checked 가 토글 상태를 따른다', () => {
    renderScreen({ form: { ...FORM, fixed: true } });

    const switches = screen.getAllByRole('switch');
    expect(switches.length).toBe(1);
    const toggle = screen.getByTestId('itinerary-mustvisit-time-toggle');
    expect(switches[0]).toBe(toggle);
    expect(toggle).toBeChecked();
    // 페이지 배선·연타 가드 테스트가 이 요소의 accessibilityState 를 직접 읽는다(02a ★9).
    expect(toggle.props.accessibilityState?.checked).toBe(true);
    // 행 안에 스위치 글자가 함께 있다 — 스위치만 따로 떼 둔 구현이면 이 요소에 제목이 없다.
    expect(toggle).toHaveTextContent(/시각 고정/);

    screen.unmount();
    renderScreen({ form: { ...FORM, fixed: false } });
    expect(
      screen.getByTestId('itinerary-mustvisit-time-toggle')
    ).not.toBeChecked();
  });
});

// TRIP-1507 — 시트를 안전 영역 밖(루트 형제)으로 옮겼으니 홈 인디케이터 여백을 시트가 직접 가진다(16 + 하단 안전 영역).
describe('TRIP-1507 · 시각 시트 하단 여백 = 16 + 하단 안전 영역', () => {
  function paddingBottomWith(bottom: number | null): number {
    const screenEl = (
      <MustVisitTimeScreen
        sourcePoiId="poi-a"
        placeName="부산시립미술관"
        region="부산진구"
        imageUrl={null}
        dayChips={DAY_CHIPS}
        startOptions={START_OPTIONS}
        startAnchor={START_ANCHOR}
        form={FORM}
      />
    );
    render(
      bottom === null ? (
        screenEl
      ) : (
        <SafeAreaInsetsContext.Provider
          value={{ top: 47, bottom, left: 0, right: 0 }}
        >
          {screenEl}
        </SafeAreaInsetsContext.Provider>
      )
    );
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));
    const style = screen.getByTestId('itinerary-mustvisit-time-start-sheet')
      .props.style;
    return StyleSheet.flatten(style).paddingBottom as number;
  }

  it('하단 안전 영역 34 → 50', () => {
    expect(paddingBottomWith(34)).toBe(50);
  });
  it('Provider 없음(jest 기본) → 16 그대로', () => {
    expect(paddingBottomWith(null)).toBe(16);
  });
});
