/**
 * @jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { VisitTimeSheet } from './VisitTimeSheet';

/**
 * TRIP-613 · TRIP-1069 · j01 방문 시각 수정 시트의 **폼 계약**.
 *
 * 시트는 서버 순간(`Z`)을 **서울 시계**로 읽어 시·분 셀에 시드하고, [저장]에서 "원본의 서울 날짜 +
 * 고른 서울 HH:mm" 을 다시 UTC 순간(`Z`)으로 되돌려, 분 단위로 **실제로 바뀐 필드만** `onSave` 한다.
 * 클라 선검증(`adjustTimesDraft`) 위반이면 인라인 오류 + onSave 0회(서버 재검증이 최종 — INV-2).
 * 완료 칸은 원본 완료가 있을 때만 고칠 수 있다(01b D1 — PATCH 완료는 BR-U5-06·09 를 우회한다).
 *
 * *(개념)* **순간 vs 벽시계** — `2026-08-31T05:20:00Z` 는 지구상 한 순간이고, 서울 시계로는 14:20 이다.
 *   문자열을 잘라(slice) 쓰면 05:20 이 보이고, 기기 시계(getHours)로 읽으면 기기마다 다르다.
 * *(개념)* 이 파일은 기기 시간대를 **LA 로 바꿔** 돈다 — 로컬 개발기가 KST 라 그냥 돌리면 기기 시계
 *   구현도 통과해 버린다(seoulDate.test 선례).
 * *(개념)* `@gorhom/bottom-sheet` 목은 children 을 무조건 렌더한다 — 딤·개폐는 6-b(AC-11).
 * *(개념)* `fireEvent.press` 는 disabled 를 막지 않는다 → "완료가 실리지 않는다"는 onSave 인자로 판정.
 *
 * 3동작: 준비 = 원본 순간·now 로 렌더 → 실행 = 셀·버튼 press → 단언 = 선택 셀·오류·onSave 인자.
 */

declare const __setDeviceTimeZone: (tz: string | undefined) => void;

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 렌더된 문자열 전부 — INV-3 부정 스캔의 모집단(SlotTimeSheet CS6 헬퍼 이식). */
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

type Patch = { arrivedAt?: string; completedAt?: string };

const onSave = jest.fn<void, [Patch]>();
const onCancel = jest.fn();

const cell = (field: 'arrived' | 'completed', unit: 'h' | 'm', v: string) =>
  `record-trip-visit-time-${field}-${unit}-${v}`;
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));
const save = () => press('record-trip-visit-time-save');

/** onSave 로 나간 모든 patch 에 시각 키가 없다(0회도 통과 — "요청 0회 또는 빈 patch"). */
function expectNoTimeKeysSent() {
  for (const [patch] of onSave.mock.calls) {
    expect(Object.keys(patch)).not.toContain('arrivedAt');
    expect(Object.keys(patch)).not.toContain('completedAt');
  }
}

function renderSheet(
  over: Partial<React.ComponentProps<typeof VisitTimeSheet>> = {}
) {
  return render(
    <VisitTimeSheet
      visitCheckId="v1"
      placeName="부산시립미술관"
      arrivedAt="2026-08-31T05:20:00Z"
      completedAt="2026-08-31T06:00:00Z"
      now="2026-08-31T11:00:00Z"
      onSave={onSave}
      onCancel={onCancel}
      {...over}
    />
  );
}

beforeEach(() => {
  __setDeviceTimeZone('America/Los_Angeles');
  onSave.mockClear();
  onCancel.mockClear();
});
afterEach(() => {
  __setDeviceTimeZone(undefined);
});

describe('S0 · 앵커 — 기기 시간대가 LA 로 바뀌었다', () => {
  it('2026-08-31T05:20Z 가 기기 시계로는 22시(전날)로 읽힌다', () => {
    expect(new Date('2026-08-31T05:20:00Z').getHours()).toBe(22);
  });
});

describe('S1 · AC-4 — 서울 시각으로 시드되고 장소명이 부제로 뜬다', () => {
  it('05:20Z·06:00Z → 도착 14:20·완료 15:00 셀이 선택되고, 부제는 부산시립미술관', () => {
    renderSheet();

    expect(
      screen.getByTestId('record-trip-visit-time-sheet')
    ).toBeOnTheScreen();
    expect(screen.getByTestId(cell('arrived', 'h', '14'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '20'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'h', '15'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'm', '00'))).toBeSelected();
    // 짝 — 문자열을 자른 시(05)도, LA 기기 시계(22)도 선택되지 않는다.
    expect(screen.getByTestId(cell('arrived', 'h', '05'))).not.toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'h', '22'))).not.toBeSelected();

    expect(
      screen.getByTestId('record-trip-visit-time-place')
    ).toHaveTextContent('부산시립미술관');
  });
});

describe('S6 · AC-6 — 도착만 바꿔 저장하면 도착만 UTC 순간으로 실린다', () => {
  it('도착 시 13 → onSave 1회, 키는 arrivedAt 뿐, 값은 Z 로 끝나는 04:20Z 순간', () => {
    renderSheet();

    press(cell('arrived', 'h', '13'));
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    expect(Object.keys(patch)).toEqual(['arrivedAt']);
    expect(patch.arrivedAt).toMatch(/Z$/);
    expect(Date.parse(patch.arrivedAt!)).toBe(
      Date.parse('2026-08-31T04:20:00Z')
    );
    expect(screen.queryByTestId('record-trip-visit-time-error')).toBeNull();
  });

  it('서울 01:30(UTC 전날 16:30) 방문 — 분만 45 로 바꾸면 날짜가 하루 어긋나지 않는다', () => {
    renderSheet({
      arrivedAt: '2026-08-31T16:30:00Z',
      completedAt: null,
      now: '2026-09-01T03:00:00Z',
    });

    expect(screen.getByTestId(cell('arrived', 'h', '01'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '30'))).toBeSelected();

    press(cell('arrived', 'm', '45'));
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    expect(patch.arrivedAt).toMatch(/Z$/);
    expect(Date.parse(patch.arrivedAt!)).toBe(
      Date.parse('2026-08-31T16:45:00Z')
    );
  });
});

describe('S7 · AC-7 — 분이 안 바뀌면 시각을 보내지 않는다(초·소수 자리 무시)', () => {
  const FRACTIONAL = {
    arrivedAt: '2026-08-31T05:20:07.123456Z',
    completedAt: '2026-08-31T06:00:59.999Z',
    // now 을 멀리 둔다 — 미래 오류로 onSave 가 막혀 "0회"로 공허하게 통과하지 않게(아래 오류 부재 단언과 짝).
    now: '2026-09-30T00:00:00Z',
  };

  it('아무것도 안 누르고 저장 → 요청 0회 또는 시각 키 없는 patch', () => {
    renderSheet(FRACTIONAL);

    save();

    expectNoTimeKeysSent();
    expect(screen.queryByTestId('record-trip-visit-time-error')).toBeNull();
  });

  it('도착 시를 13 으로 바꿨다가 14 로 되돌리고 저장 → 위와 같다', () => {
    renderSheet(FRACTIONAL);

    press(cell('arrived', 'h', '13'));
    press(cell('arrived', 'h', '14'));
    save();

    expectNoTimeKeysSent();
    expect(screen.queryByTestId('record-trip-visit-time-error')).toBeNull();
  });
});

describe('S8 · AC-8 · D1 — 완료 칸은 원본 완료가 있을 때만 고친다', () => {
  it('도착만 한 방문 → 완료 칸 비활성, 완료 셀을 눌러도 patch 에 completedAt 이 없다', () => {
    renderSheet({ completedAt: null });

    expect(
      screen.getByTestId('record-trip-visit-time-completed')
    ).toBeDisabled();

    press(cell('completed', 'h', '15'));
    press(cell('arrived', 'h', '13'));
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    // 짝 — 도착은 실린다(공허 통과 방지), 완료는 안 실린다.
    expect(Object.keys(patch)).toEqual(['arrivedAt']);
  });

  it('완료가 있는 방문 → 완료 칸 활성, 바꾼 완료가 07:00Z 순간으로 실린다', () => {
    renderSheet();

    expect(
      screen.getByTestId('record-trip-visit-time-completed')
    ).not.toBeDisabled();

    press(cell('completed', 'h', '16'));
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    expect(Object.keys(patch)).toEqual(['completedAt']);
    expect(patch.completedAt).toMatch(/Z$/);
    expect(Date.parse(patch.completedAt!)).toBe(
      Date.parse('2026-08-31T07:00:00Z')
    );
  });
});

/**
 * 5-b 보강(03b B1) — "비활성"이 모양만이면 안 된다. 셀이 눌려 선택이 옮겨 가고 저장 때 버려지면
 * 사용자는 고른 값이 사라진 이유를 모른다(INV-4 버려지는 입력). S8 의 onSave 인자로는 "안 눌린다"와
 * "눌리지만 버린다"가 같아 보이므로, **선택 표시가 움직였는가**로 판정한다.
 * `toBeDisabled()` 는 조상의 비활성 표시도 비활성으로 쳐서(03b probe) 셀에 걸어도 현 구현이 통과한다 —
 * 그래서 쓰지 않는다. 시드 값(00 등)을 박제하지 않으려고 "누르기 전 선택 집합 = 누른 뒤 선택 집합"으로 본다.
 */
describe('S8b · 5-b 보강 B1 — 닫힌 완료 칸은 눌러도 선택이 움직이지 않는다', () => {
  /** 완료 칸 셀 중 지금 선택 표시가 켜진 것들의 testID. */
  const selectedCompletedCells = () =>
    screen
      .queryAllByTestId(/^record-trip-visit-time-completed-[hm]-\d{2}$/)
      .filter((node) => node.props.accessibilityState?.selected === true)
      .map((node) => node.props.testID as string);

  it('도착만 한 방문 → 완료 15시·45분을 눌러도 선택 집합이 그대로다', () => {
    renderSheet({ completedAt: null });
    const before = selectedCompletedCells();

    press(cell('completed', 'h', '15'));
    press(cell('completed', 'm', '45'));

    expect(selectedCompletedCells()).toEqual(before);
    expect(
      screen.getByTestId(cell('completed', 'h', '15')).props.accessibilityState
        ?.selected
    ).not.toBe(true);
  });

  it('짝 — 완료가 있는 방문은 완료 16시를 누르면 선택이 15시에서 16시로 옮겨 간다', () => {
    renderSheet();

    press(cell('completed', 'h', '16'));

    expect(screen.getByTestId(cell('completed', 'h', '16'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'h', '15'))).not.toBeSelected();
  });
});

describe('S2 · AC-10 · BR-U5-05 — 완료가 도착보다 앞이면 인라인 오류 + onSave 0회', () => {
  it('도착 14:00·완료 15:00(서울) 에서 완료 시를 13 으로 → 오류, 요청 안 나감', () => {
    renderSheet({
      arrivedAt: '2026-08-31T05:00:00Z',
      completedAt: '2026-08-31T06:00:00Z',
    });

    press(cell('completed', 'h', '13'));
    save();

    expect(
      screen.getByTestId('record-trip-visit-time-error')
    ).toBeOnTheScreen();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('S4 · AC-10 — now 보다 미래면 인라인 오류 + onSave 0회', () => {
  it('도착 10:00·now 12:00(서울) 에서 도착 시를 23 으로 → 오류, 요청 안 나감', () => {
    renderSheet({
      arrivedAt: '2026-08-31T01:00:00Z',
      completedAt: null,
      now: '2026-08-31T03:00:00Z',
    });

    press(cell('arrived', 'h', '23'));
    save();

    expect(
      screen.getByTestId('record-trip-visit-time-error')
    ).toBeOnTheScreen();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('S5 · AC-25 · INV-3 — 시트 렌더 어디에도 소요시간 문자열이 없다', () => {
  it('시각 숫자는 보이는데 분·시간·소요 표기는 0건이다(분 셀은 "30" 이지 "30분" 아님)', () => {
    renderSheet();

    const texts = renderedTexts();
    // 긍정 앵커 — 시트가 실제로 시각을 그리고 있다.
    expect(texts.some((t) => t.includes('14'))).toBe(true);
    expect(texts.some((t) => t.includes('20'))).toBe(true);
    expect(screen.getByTestId(cell('arrived', 'm', '30'))).toHaveTextContent(
      '30'
    );

    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
  });
});

describe('S9 · 취소 — onCancel 만, onSave 는 안 부른다', () => {
  it('취소 press → onCancel 1회, onSave 0회', () => {
    renderSheet();

    press('record-trip-visit-time-cancel');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
