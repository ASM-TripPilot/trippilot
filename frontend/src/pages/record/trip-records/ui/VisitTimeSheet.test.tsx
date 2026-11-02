/**
 * @jest-environment ./src/test-support/deviceTimeZoneEnvironment.cjs
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';

import { VisitTimeSheet } from './VisitTimeSheet';

/**
 * TRIP-613 · TRIP-1069 · j01 방문 시각 수정 시트의 **폼 계약**.
 *
 * 시트는 서버 순간(`Z`)을 **서울 시계**로 읽어 시·분 셀에 시드하고, [저장]에서 "원본의 서울 날짜 +
 * 고른 서울 HH:mm" 을 다시 UTC 순간(`Z`)으로 되돌려, 분 단위로 **실제로 바뀐 필드만** `onSave` 한다.
 * 클라 선검증(`adjustTimesDraft`) 위반이면 인라인 오류 + onSave 0회(서버 재검증이 최종 — INV-2).
 * 완료 칸은 원본 완료가 있을 때만 고칠 수 있다(01b D1 — PATCH 완료는 BR-U5-06·09 를 우회한다). 완료가 없으면
 * 완료 휠 대신 "아직 완료 전" 자리 표시만 둔다(TRIP-1437 Q-116 — 닫힌 휠의 흐린 '00:00' 폐기).
 *
 * *(개념)* **순간 vs 벽시계** — `2026-08-31T05:20:00Z` 는 지구상 한 순간이고, 서울 시계로는 14:20 이다.
 *   문자열을 잘라(slice) 쓰면 05:20 이 보이고, 기기 시계(getHours)로 읽으면 기기마다 다르다.
 * *(개념)* 이 파일은 기기 시간대를 **LA 로 바꿔** 돈다 — 로컬 개발기가 KST 라 그냥 돌리면 기기 시계
 *   구현도 통과해 버린다(seoulDate.test 선례).
 * *(개념)* `@gorhom/bottom-sheet` 목은 children 을 무조건 렌더한다 — 딤·개폐는 6-b(AC-11).
 * *(개념)* "완료가 실리지 않는다"는 막는 방식과 무관하게 onSave 인자로 판정한다(TRIP-1437 부터 완료 전이면
 *   완료 셀 자체가 없다).
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
  // '도착만 한 방문 → 완료 칸 비활성 · 눌러도 patch 에 completedAt 없음'은 W6 의 부분집합이라 지웠다(TRIP-1354 —
  // 완료 휠 disabled 를 풀거나 그룹 비활성 표시를 풀면 W6 가 red).
  it('완료가 있는 방문 → 완료 칸 활성, 바꾼 완료가 07:00Z 순간으로 실린다', () => {
    renderSheet();

    expect(
      screen.getByTestId('record-trip-visit-time-completed')
    ).not.toBeDisabled();
    // TRIP-1437 AC-16 짝 — 완료가 있으면 "완료 전" 자리 표시는 없다.
    expect(
      screen.queryByTestId('record-trip-visit-time-completed-pending')
    ).not.toBeOnTheScreen();

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

/**
 * TRIP-1080 · W — 셀 컬럼을 공용 휠(`shared/ui/WheelPicker`) 4열로 바꾼 뒤의 계약.
 *
 * 무엇을 보장하나:
 *  - W1 시트를 열면 네 휠의 **현재 서울 시각** 셀이 선택돼 있다(00 이 아니라 — 시작 스크롤 위치 자체는 6-b).
 *  - W2·W3 스크롤이 멈춘 값이 곧 선택이고 저장에 실린다(TRIP-990 D21 — 굴린 값이 버려지지 않는다, INV-4).
 *  - W5 딤 탭 등으로 시트가 닫히면 `onCancel` 을 불러 페이지의 편집 상태를 푼다(다시 열 수 있게).
 *  - W6·W7 원본 완료가 없으면 완료 휠 대신 자리 표시만 있다(TRIP-1437 — 옛 "닫힌 휠", TRIP-1069 D1) —
 *    있으면 평소대로 움직인다.
 *  - W8 현재 위치에서 멈춰도 "바뀜"이 아니다(분 단위 diff — 헛 PATCH 없음, TRIP-1069 AC-7).
 *
 * *(개념)* `contentOffset` = 스크롤뷰가 처음에 몇 px 내려간 곳에서 시작하는지. jest 는 실제로 굴리지
 *   못하므로 이 prop 을 읽어 "어디서 시작하나"를 본다. 위 패딩 덕에 `k × 셀 높이` 면 k 번째 값이 가운데다.
 * *(개념)* `fireEvent(휠, 'momentumScrollEnd', …)` = "관성 스크롤이 이 위치에서 멈췄다"는 신호를 직접 쏜다.
 *
 * 커버하지 않는 것(6-b 실기): 실제 스냅·관성, 관성 없이 손을 뗄 때 정지 이벤트가 오는지, 휠을 끌 때
 *   시트가 정말 안 따라오는지(목은 prop 만 받는다), 완료 전 자리 표시의 모양.
 *
 * 3동작 뼈대: 준비=원본 순간으로 렌더 → 실행=휠 정지·닫힘 신호·[저장] → 단언=휠 위치·선택 표식·onSave 인자.
 */
describe('🔴 W · TRIP-1080 — 공용 휠 4열 시트', () => {
  /** 서울 21:42 도착 · 22:30 완료 — 문자열 slice 면 12:42, LA 기기 시계면 05:42 라 셋이 다 갈린다. */
  const LATE = {
    arrivedAt: '2026-09-28T12:42:00Z',
    completedAt: '2026-09-28T13:30:00Z',
    now: '2026-09-28T15:00:00Z',
  };
  const SHEET = 'record-trip-visit-time-sheet';

  const wheel = (field: 'arrived' | 'completed', unit: 'h' | 'm') =>
    `record-trip-visit-time-${field}-${unit}-wheel`;

  /** 휠이 index 번째 값이 가운데 오는 위치에서 멈췄다고 알린다. */
  function settle(
    field: 'arrived' | 'completed',
    unit: 'h' | 'm',
    index: number
  ) {
    fireEvent(screen.getByTestId(wheel(field, unit)), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: 0, y: index * WHEEL_CELL_HEIGHT } },
    });
  }

  it('W1 · AC-1 — 열면 네 휠의 21·42·22·30 셀이 선택돼 있다', () => {
    renderSheet(LATE);

    // 휠의 시작 스크롤 위치(contentOffset)는 jest 사각 — 실화면 QA(지도 trip-record tr-time-edit). 선택 셀만 본다.
    expect(screen.getByTestId(cell('arrived', 'h', '21'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'm', '42'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'h', '22'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'm', '30'))).toBeSelected();
  });

  it('W2 · AC-2 — 도착 시 휠이 20 에서 멈추면 20 이 선택되고, 저장하면 도착만 11:42Z 로 실린다', () => {
    renderSheet(LATE);

    settle('arrived', 'h', 20);

    expect(screen.getByTestId(cell('arrived', 'h', '20'))).toBeSelected();
    expect(screen.getByTestId(cell('arrived', 'h', '21'))).not.toBeSelected();

    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    expect(Object.keys(patch)).toEqual(['arrivedAt']);
    expect(patch.arrivedAt).toMatch(/Z$/);
    expect(Date.parse(patch.arrivedAt!)).toBe(
      Date.parse('2026-09-28T11:42:00Z')
    );
  });

  it('W3 · AC-2 짝 — 도착 분 휠이 05 에서 멈추면 저장에 12:05Z 로 실린다', () => {
    renderSheet(LATE);

    settle('arrived', 'm', 5);

    expect(screen.getByTestId(cell('arrived', 'm', '05'))).toBeSelected();

    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    expect(Object.keys(patch)).toEqual(['arrivedAt']);
    expect(Date.parse(patch.arrivedAt!)).toBe(
      Date.parse('2026-09-28T12:05:00Z')
    );
  });

  it('W5 · AC-5 — 시트가 닫히면(딤 탭 대역) onCancel 1회, onSave 0회', () => {
    renderSheet(LATE);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent(screen.getByTestId(SHEET), 'close');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  // TRIP-1437 (Q-116) — 옛 W6 는 "완료 셀 84개가 있되 닫혀 있다(scrollEnabled false·선택 없음)"를 잠갔다.
  // 닫힌 휠도 가운데 띠 안에 흐린 '00' 이 서 있었다 → 완료 전이면 셀을 아예 그리지 않고 자리 표시만 둔다(01b Q1).
  it('W6 · AC-15 · BR-U5-05 — 완료 없는 방문: 완료 셀 0개·완료 칸에 숫자 없음·"아직 완료 전이에요" 자리 표시, 도착은 고쳐 저장에 도착만 실린다', () => {
    renderSheet({ ...LATE, completedAt: null });
    const COMPLETED_CELL = /^record-trip-visit-time-completed-[hm]-\d{2}$/;
    const completedGroup = screen.getByTestId(
      'record-trip-visit-time-completed'
    );

    // 완료 휠·셀이 없다 — 그래서 띠 안 '00:00' 이 설 자리도 없다.
    expect(screen.queryAllByTestId(COMPLETED_CELL).length).toBe(0);
    expect(screen.queryByTestId(wheel('completed', 'h'))).not.toBeOnTheScreen();
    expect(screen.queryByTestId(wheel('completed', 'm'))).not.toBeOnTheScreen();
    // 완료 칸 안 글자에 숫자가 하나도 없다(라벨 '완료' + 자리 표시 문구뿐).
    expect(completedGroup).not.toHaveTextContent(/\d/);
    // 자리 표시 — 완료 칸 안에 있고 문구는 완전 일치(01b Q1). 칸은 여전히 비활성으로 알린다.
    const pending = screen.getByTestId(
      'record-trip-visit-time-completed-pending'
    );
    expect(pending).toHaveTextContent('아직 완료 전이에요');
    expect(completedGroup.findAll((node) => node === pending).length).toBe(1);
    expect(completedGroup).toBeDisabled();

    // 짝 — 도착 휠은 살아 있다: 굴려 멈춘 값이 저장에 실린다(공허 통과 방지).
    expect(
      screen.getByTestId(wheel('arrived', 'h')).props.scrollEnabled
    ).not.toBe(false);
    settle('arrived', 'h', 20);
    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    expect(Object.keys(patch)).toEqual(['arrivedAt']);
    expect(Date.parse(patch.arrivedAt!)).toBe(
      Date.parse('2026-09-28T11:42:00Z')
    );
  });

  it('W7 · AC-8 짝 — 완료가 있는 방문은 완료 시 휠이 23 에서 멈추면 선택이 옮겨 가고 14:30Z 로 실린다', () => {
    renderSheet(LATE);

    settle('completed', 'h', 23);

    expect(screen.getByTestId(cell('completed', 'h', '23'))).toBeSelected();
    expect(screen.getByTestId(cell('completed', 'h', '22'))).not.toBeSelected();

    save();

    expect(onSave).toHaveBeenCalledTimes(1);
    const [patch] = onSave.mock.calls[0]!;
    expect(Object.keys(patch)).toEqual(['completedAt']);
    expect(patch.completedAt).toMatch(/Z$/);
    expect(Date.parse(patch.completedAt!)).toBe(
      Date.parse('2026-09-28T14:30:00Z')
    );
  });

  it('W8 · AC-9 — 네 휠이 모두 현재 위치에서 멈추고 저장하면 onSave 1회, 시각 키 0개', () => {
    renderSheet(LATE);

    settle('arrived', 'h', 21);
    settle('arrived', 'm', 42);
    settle('completed', 'h', 22);
    settle('completed', 'm', 30);
    save();

    // 1회 + 빈 patch — 0회면 "시각 키 없음"이 공허하게 참이 된다(02a ★8).
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(Object.keys(onSave.mock.calls[0]![0])).toEqual([]);
    expect(screen.queryByTestId('record-trip-visit-time-error')).toBeNull();
  });
});
