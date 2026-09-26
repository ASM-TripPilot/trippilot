import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';

import type { MustVisitTimeForm } from '../model/mustVisitTimeForm';
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

/** 30분 간격 하루치(D2). 화면은 받은 목록을 그대로 그린다 — 만드는 것은 순수 함수 몫이다. */
const START_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, '0');
  const minute = index % 2 === 0 ? '00' : '30';
  return `${hour}:${minute}`;
});

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
  it('열기 전에는 시트도 옵션도 없고, 필드를 누르면 48개가 뜬다', () => {
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
    expect(startOptionCount()).toBe(48);

    // 고르면 그 시각이 넘어간다. 필드를 누르는 것만으로는 아무 값도 정해지지 않는다.
    expect(onPickStart).not.toHaveBeenCalled();
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-time-start-option-13:00')
    );
    expect(onPickStart).toHaveBeenCalledWith('13:00');
    expect(onPickStart).toHaveBeenCalledTimes(1);
  });

  /**
   * TRIP-599(AC-2 통합) — 시작 시각이 휠 primitive 로 교체돼도 **선택 표식**이 살아남는다.
   * 휠 자체의 선택 표식은 `WheelPicker.test.tsx` AC-2 가 잠그고, 여기서는 h07 이 그 primitive 에
   * `selected` 를 실제로 넘겨 배선하는지를 통합 지점에서 잰다 — 안 넘기면 아무 셀도 selected 가
   * 아니어서 red 다. (교체 전 평면 리스트도 같은 계약을 만족하므로 지금은 선제 green 이다.)
   */
  it('D2-b 열린 시트에서 지금 선택된 시각(13:00) 셀만 selected 다', () => {
    renderScreen();
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-field'));

    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-option-13:00')
    ).toBeSelected();
    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-option-09:00')
    ).not.toBeSelected();
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
    // (48개 시각 옵션이 `분` 으로 읽히지 않는 것도 함께 본다).
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
 * "닫기"로만 닫힌다.
 *
 * 왜 닫힘을 떼는가: 휠이 스크롤 정지로도 값을 확정하게 되면, 예전처럼 "값이 넘어오면 시트를 닫는다"를
 * 두면 굴리다 잠깐 멈추는 순간 시트가 닫혀 버린다. 그래서 탭이든 스크롤 정지든 값만 넘기고, 닫기는
 * 사용자가 "닫기"를 눌러서만 한다.
 *
 * 무엇을 보장하나:
 *  - 휠이 12:00 칸(48개 중 24번째)에서 멈추면 `onPickStart('12:00')` 가 1회 불리고 시트는 열린 채다.
 *  - 셀을 탭해도 값만 넘어가고 시트는 열린 채다. "닫기"를 누르면 그때 닫힌다.
 *
 * 3동작 뼈대: 준비=시트를 연다 → 실행=휠 정지 / 셀 탭 / 닫기 → 단언=넘어간 값·시트 존재 여부.
 */
describe('🔴 W3 · 휠 정지 확정 + 닫기로만 닫힘 (D21 · Q6)', () => {
  const SHEET = 'itinerary-mustvisit-time-start-sheet';
  const WHEEL = 'itinerary-mustvisit-time-start-wheel';

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
          y: START_OPTIONS.indexOf('12:00') * WHEEL_CELL_HEIGHT,
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

    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-time-start-option-13:00')
    );

    expect(onPickStart).toHaveBeenCalledWith('13:00');
    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-time-start-close'));

    expect(screen.queryAllByTestId(SHEET)).toEqual([]);
    expect(
      screen.getByTestId('itinerary-mustvisit-time-start-field')
    ).toBeOnTheScreen();
  });
});
