import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import {
  blurViewsIn,
  expectGlassRecipe,
  glassAncestor,
} from '@/test-support/glassAsserts';
import { useAnimatedProbe } from '@/test-support/animatedProbe';
import {
  advance,
  BAR_ROOT,
  deferOsAnswer,
  FINAL_IDS,
  firstGone,
  firstSeen,
  flushOsAnswer,
  frameSample,
  hiddenSpacingClasses,
  holdReduceMotionOn,
  isMounted,
  joinWatches,
  lastSample,
  moved,
  NEW_CELLS,
  readRow,
  rootScale,
  setWindowWidth,
  slotEffect,
  START5_IDS,
  START_CELLS,
  START_EXPLORE,
  START_HOME,
  START_MY,
  START_RECORDS,
  staysOnceGone,
  staysOnceSeen,
  structureSteady,
  useInteractionGate,
  visibleIds,
  watchMotion,
} from '@/test-support/barMotionProbe';
import { renderedText } from '@/test-support/sheetTree';

import type { ShellTabKey } from '@/shared/ui/BottomTabBar';

import {
  BAR_ENTER_DELAY_MS,
  BAR_ENTER_MS,
  BAR_EXIT_MS,
  barMorphFrame,
} from '../model/barMorph';
import { LiveBottomBar, type LiveBottomBarProps } from './LiveBottomBar';

/**
 * TRIP-1522 v2 · i01 여행 중 허브 하단 내비 바(순수 프레젠테이션 — props 만 받는다).
 * 왼쪽 둥근 뒤로 + 4칸 캡슐 [일정·수정·챗봇·행사], 모두 유리 표면(Figma A `5029:3421`). 접힘 상태가 없다 —
 * 시트가 어디 있든 바는 똑같다.
 *
 * 무엇을 보장하나:
 *  - 루트(`execution-live-bottom-bar`) 안에 뒤로 + 4칸이 이 순서로 서고 글자가 정확하다(v1 의 직접 수정·AI 수정 칸은 없다).
 *  - 한 칸을 누르면 그 칸의 콜백만 1회 부른다. 수정 칸은 이동이 아니라 팝업 여닫이 신호일 뿐이다(부모 몫).
 *  - controlled — 활성 칸(`active` = 일정/수정/행사)과 펼침은 부모가 준 값이고 바는 상태를 쥐지 않는다. 낭독 신호는
 *    `selected`(활성)·`expanded`(수정 팝업·행사 카드 열림)다.
 *  - 행사 칸은 기회가 있을 때만 활성+점, 비활성은 낭독 상태와 실제 눌림 차단 둘 다(v1 ★3).
 *  - 칸·뒤로 터치 영역 44 이상(AC-16). 뒤로·캡슐이 유리 표면이다(AC-15). 글자는 라벨뿐이다(AC-22).
 *
 * 3동작: 준비(콜백 jest.fn + props) → 실행(칸 press) → 단언(콜백 횟수·selected/expanded/disabled·트리).
 * 점(`execution-live-bar-event-dot`)은 장식이라 낭독에서 빠진다 → 기본 쿼리가 못 찾으므로 `includeHiddenElements` 로 찾는다.
 * 활성 칸의 분홍/회색 색·아이콘 모양·Figma 치수(58)는 jest 사각 → 6-b.
 */

const BAR = 'execution-live-bottom-bar';
const BACK = 'execution-live-back';
const SCHEDULE = 'execution-live-bar-schedule';
const EDIT = 'execution-live-bar-edit';
const CHATBOT = 'execution-live-bar-chatbot';
const EVENT = 'execution-live-bar-event';
const DOT = 'execution-live-bar-event-dot';
const CELLS = [SCHEDULE, EDIT, CHATBOT, EVENT];

// 사이클 3 — OS "동작 줄이기" 답을 파일 최상위에서 true(켜짐)로 고정한다: 모션과 무관한 기존 케이스(BB1~BB9)가 모션 타이머·act 경고 없이
// 결정적으로 돈다. 모션 케이스(BM)만 describe 안에서 `useAnimatedProbe().setReduceMotion(false)`/`deferOsAnswer()` 로 바꾼다.
beforeEach(holdReduceMotionOn);

function makeHandlers() {
  return {
    onBack: jest.fn(),
    onPressSchedule: jest.fn(),
    onPressEdit: jest.fn(),
    onPressChatbot: jest.fn(),
    onPressEvent: jest.fn(),
  };
}

function renderBar(overrides: Partial<LiveBottomBarProps> = {}) {
  const handlers = makeHandlers();
  render(
    <LiveBottomBar
      active="schedule"
      eventAvailable
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

/** 점은 기본 쿼리에서 빠진다(장식) — 있는지 없는지는 숨은 요소까지 포함해 본다. */
const dot = () => screen.queryByTestId(DOT, { includeHiddenElements: true });

describe('LiveBottomBar · BB1 구성 (AC-1)', () => {
  it('루트 안에 뒤로 + 4칸이 일정·수정·챗봇·행사 순서로 서고 글자가 정확하며, v1 칸(직접 수정·AI 수정)은 없다', () => {
    renderBar();

    const bar = screen.getByTestId(BAR);
    expect(within(bar).getByTestId(BACK)).toBeOnTheScreen();
    // 완전 일치 — 글자가 더 붙으면(예: 아이콘 글자) 실패한다.
    expect(screen.getByTestId(SCHEDULE)).toHaveTextContent('일정');
    expect(screen.getByTestId(EDIT)).toHaveTextContent('수정');
    expect(screen.getByTestId(CHATBOT)).toHaveTextContent('챗봇');
    expect(screen.getByTestId(EVENT)).toHaveTextContent('행사');
    // 칸 순서 — 트리 순서(AC-1 이 [T] 로 정한 항목).
    const order = bar
      .findAll(
        (node) =>
          typeof node.type === 'string' && CELLS.includes(node.props.testID)
      )
      .map((node) => node.props.testID as string);
    expect(order).toEqual(CELLS);
    // v1 의 칸은 팝업 항목이 됐다 — 짝 앵커(새 칸은 있다)와 함께 부재를 본다.
    expect(screen.queryByTestId('execution-live-bar-manual')).toBeNull();
    expect(screen.queryByTestId('execution-live-bar-ai')).toBeNull();
  });
});

describe('LiveBottomBar · BB2 뒤로 (AC-2)', () => {
  it('"뒤로" 버튼으로 읽히고 누르면 onBack 만 1회 부른다', () => {
    const handlers = renderBar();

    const back = screen.getByRole('button', { name: '뒤로' });
    expect(back).toHaveProp('testID', BACK);
    fireEvent.press(back);

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    Object.entries(handlers)
      .filter(([name]) => name !== 'onBack')
      .forEach(([, fn]) => expect(fn).not.toHaveBeenCalled());
  });
});

describe('LiveBottomBar · BB3 칸 배선 (AC-3)', () => {
  it.each([
    ['일정', 'onPressSchedule', SCHEDULE],
    ['수정', 'onPressEdit', EDIT],
    ['챗봇', 'onPressChatbot', CHATBOT],
    ['행사', 'onPressEvent', EVENT],
  ] as const)(
    '%s 칸을 누르면 %s 만 1회 부르고 나머지 콜백은 0회다',
    (_label, own, testID) => {
      const handlers = renderBar();

      fireEvent.press(screen.getByTestId(testID));

      expect(handlers[own]).toHaveBeenCalledTimes(1);
      Object.entries(handlers)
        .filter(([name]) => name !== own)
        .forEach(([, fn]) => expect(fn).not.toHaveBeenCalled());
    }
  );
});

describe('LiveBottomBar · BB4 행사 칸 활성 · 점 (AC-11)', () => {
  it('기회가 있으면 활성 + 점 + "추천 있음" 낭독값, 없으면 비활성 + 점 없음 + 눌러도 콜백 0회', () => {
    // 있음
    const withEvent = renderBar({ eventAvailable: true });
    const cell = screen.getByTestId(EVENT);
    expect(cell).toBeEnabled();
    expect(dot()).not.toBeNull();
    expect(cell).toHaveAccessibilityValue({ text: '추천 있음' });
    fireEvent.press(cell);
    expect(withEvent.onPressEvent).toHaveBeenCalledTimes(1);
    screen.unmount();

    // 없음 — 짝 앵커: 바는 그려졌고(다른 칸이 산다) 행사 칸만 비활성이다.
    const noEvent = renderBar({ eventAvailable: false });
    const idle = screen.getByTestId(EVENT);
    expect(screen.getByTestId(BAR)).toBeOnTheScreen();
    expect(screen.getByTestId(CHATBOT)).toBeEnabled();
    expect(idle).toBeDisabled();
    expect(dot()).toBeNull();
    expect(idle).not.toHaveAccessibilityValue({ text: '추천 있음' });
    // 상태(disabled)만으로는 눌림이 안 막힌다 — 효과 0도 함께 본다.
    fireEvent.press(idle);
    expect(noEvent.onPressEvent).not.toHaveBeenCalled();
  });
});

describe('LiveBottomBar · BB5 활성 칸 표현은 부모가 쥔다 (AC-13·16 · controlled)', () => {
  it.each([
    ['schedule', SCHEDULE],
    ['edit', EDIT],
    ['event', EVENT],
  ] as const)(
    'active=%s 이면 그 칸만 selected 이고 챗봇은 늘 selected 가 아니다',
    (active, activeId) => {
      renderBar({ active });

      for (const id of CELLS) {
        const cell = screen.getByTestId(id);
        if (id === activeId) expect(cell).toBeSelected();
        else expect(cell).not.toBeSelected();
      }
    }
  );

  it('수정·행사 칸의 expanded 는 팝업·카드가 열렸을 때만 true — 닫혀 있으면 명시적 false(접힘)다', () => {
    renderBar({ active: 'schedule' });
    expect(screen.getByTestId(EDIT)).toBeCollapsed();
    expect(screen.getByTestId(EVENT)).toBeCollapsed();
    screen.unmount();

    renderBar({ active: 'edit' });
    expect(screen.getByTestId(EDIT)).toBeExpanded();
    expect(screen.getByTestId(EVENT)).toBeCollapsed();
    screen.unmount();

    renderBar({ active: 'event' });
    expect(screen.getByTestId(EVENT)).toBeExpanded();
    expect(screen.getByTestId(EDIT)).toBeCollapsed();
  });

  it('칸을 눌러도 부모가 active 를 안 바꾸면 바 혼자 바꾸지 않는다 — 콜백만 부른다', () => {
    const handlers = renderBar({ active: 'schedule' });

    fireEvent.press(screen.getByTestId(EDIT));

    expect(handlers.onPressEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(SCHEDULE)).toBeSelected();
    expect(screen.getByTestId(EDIT)).not.toBeSelected();
    expect(screen.getByTestId(EDIT)).toBeCollapsed();
  });
});

describe('LiveBottomBar · BB6 접근성 (AC-16)', () => {
  it('4칸이 모두 버튼 역할 + 이름으로 잡히고, 점은 장식이라 낭독 대상 쿼리에서 빠진다', () => {
    renderBar();

    for (const [name, testID] of [
      ['일정', SCHEDULE],
      ['수정', EDIT],
      ['챗봇', CHATBOT],
      ['행사', EVENT],
    ] as const) {
      expect(screen.getByRole('button', { name })).toHaveProp('testID', testID);
    }

    // 장식 — 기본 쿼리는 못 찾고(낭독에서 빠짐) 숨은 요소까지 포함하면 있다.
    expect(screen.queryByTestId(DOT)).toBeNull();
    expect(dot()).not.toBeNull();
  });
});

// 5-b 후 보강(v1 BB8 이식) — 손가락으로 누르는 최소 크기는 44pt 다(모바일 접근성 기준).
// 렌더 트리에서 읽히는 값만 본다: 칸 style 의 height/minHeight(+ 뒤로는 width/minWidth)에 hitSlop(눈에 안 보이게 누름
// 범위를 넓히는 여유, 숫자 하나 또는 {top,bottom,left,right})을 더한 값. 바 위치·바 높이 58 같은 모양 수치는 일부러 안 본다(6-b 몫).
// 칸 폭은 `flex-1`(남는 폭 나눠 갖기)이라 jest 가 못 읽는다 → 칸은 높이만, 뒤로(고정 지름)는 높이·폭 둘 다.
const MIN_TOUCH = 44;

function extent(
  node: ReactTestInstance,
  axis: 'height' | 'width'
): number | undefined {
  const style = StyleSheet.flatten(node.props.style) ?? {};
  const min = axis === 'height' ? style.minHeight : style.minWidth;
  const own = Math.max(
    typeof style[axis] === 'number' ? (style[axis] as number) : 0,
    typeof min === 'number' ? min : 0
  );
  if (own === 0) return undefined; // 이 축은 jest 가 못 읽는다(flex 등)
  const slop = node.props.hitSlop as
    | number
    | { top?: number; bottom?: number; left?: number; right?: number }
    | undefined;
  const extra =
    typeof slop === 'number'
      ? slop * 2
      : axis === 'height'
        ? (slop?.top ?? 0) + (slop?.bottom ?? 0)
        : (slop?.left ?? 0) + (slop?.right ?? 0);
  return own + extra;
}

describe('LiveBottomBar · BB7 터치 영역 44 이상 (AC-16)', () => {
  it.each([
    ['뒤로', BACK, ['height', 'width']],
    ['일정', SCHEDULE, ['height']],
    ['수정', EDIT, ['height']],
    ['챗봇', CHATBOT, ['height']],
    ['행사', EVENT, ['height']],
  ] as const)(
    '%s 의 터치 크기는 읽을 수 있는 축에서 44 이상이다',
    (_label, testID, axes) => {
      renderBar();

      const node = screen.getByTestId(testID);
      for (const axis of axes) {
        const size = extent(node, axis);
        // 읽을 수 없으면(undefined) 통과시키지 않는다 — 크기 값이 style 에 없으면 계약 미이행이다.
        expect(size).toBeDefined();
        expect(size as number).toBeGreaterThanOrEqual(MIN_TOUCH);
      }
    }
  );
});

describe('LiveBottomBar · BB8 유리 (AC-15)', () => {
  it('뒤로·캡슐이 각각 유리 표면(BlurView 2개)이고 값이 레시피와 같으며, 4칸 라벨은 캡슐 유리 위에 있다', () => {
    renderBar();

    const blurs = blurViewsIn(screen.getByTestId(BAR));
    expect(blurs).toHaveLength(2);
    blurs.forEach((blur) => expectGlassRecipe(blur));

    const back = screen.getByTestId(BACK);
    // 뒤로: 유리가 뒤로 버튼을 품거나(조상) 뒤로 버튼이 유리를 품는다(자손) — 둘 중 하나는 유리다.
    const backGlass = glassAncestor(back) ?? blurViewsIn(back)[0] ?? null;
    expect(backGlass).not.toBeNull();

    const capsules = ['일정', '수정', '챗봇', '행사'].map((label) =>
      glassAncestor(screen.getByText(label))
    );
    capsules.forEach((glass) => expect(glass).not.toBeNull());
    // 네 라벨은 같은 캡슐 하나 위에 있고, 그것은 뒤로의 유리와 다른 것이다.
    expect(new Set(capsules).size).toBe(1);
    expect(capsules[0]).not.toBe(backGlass);
  });
});

describe('LiveBottomBar · BB9 글자는 라벨뿐 (AC-22 · INV-2·3)', () => {
  it('렌더된 글자는 정확히 일정·수정·챗봇·행사이고 시각·소요시간 글자가 없다', () => {
    renderBar();

    const lines = renderedText(screen.root).split('\n');
    expect(lines).toEqual(['일정', '수정', '챗봇', '행사']);
    expect(lines.join(' ')).not.toMatch(/분|시간|소요|:/);
  });
});

// ── TRIP-1522 사이클 4 · 변신 모션 = 영상 4단계 모프 (BM) ──────────────────────────────────────────────────────
// 허브 바가 홈 탭 바와 같은 5칸(홈·탐색·일정·기록·마이)으로 시작해 ① 확대 → ② 일정만 남기고 컷 → ③ 폭이 줄며 일정이 맨 앞으로 →
// ④ 뒤로 원 + 수정·챗봇·행사 등장을 스스로 재생하고, 뒤로 버튼은 그 역순(ⓐ 즉시 사라짐 → ⓑ 펼침 → ⓒ 나머지 칸 등장)을 재생한 **뒤**
// `onBack` 을 부른다(사이클 3 의 "동시 시작" 을 이 한 곳만 뒤집음). jest 는 모션 값을 안 읽고 **보이는 결과 상태**만 본다(02a ★1·★2):
// 시작 5칸 · 컷 이후 시작 칸 제거(재등장 금지) · 시작 칸과 새 칸이 동시에 안 보임 · 일정 칸은 같은 노드 · 끝 구조 · onBack 시점.
// 값 자체(스케일·폭·곡선)는 barMorph.test(순수 함수), 실제 모양·길이는 6-b. 출발 탭 정보가 없으면(`departureTab` 없음) 모션이 없다.
const TAB_LABEL: Record<ShellTabKey, string> = {
  home: '홈',
  explore: '탐색',
  itinerary: '일정',
  records: '기록',
  my: '마이',
};
const START5_TEXT = ['홈', '탐색', '일정', '기록', '마이'];
const FINAL_TEXT = ['일정', '수정', '챗봇', '행사'];
const TAB_ID: Record<ShellTabKey, string> = {
  home: START_HOME,
  explore: START_EXPLORE,
  itinerary: SCHEDULE,
  records: START_RECORDS,
  my: START_MY,
};
/** 퇴장이 끝났다고 볼 시각 — 총 길이 + 여유(타이머 오차·프레임 간격). */
const EXIT_DONE_MS = BAR_EXIT_MS + 60;
/** 프레임(16ms) 격자 위에서 "아직 안 불려야 하는 시각"(총 길이 − 40ms 이전)과 "이미 불렸어야 하는 시각"(총 길이 + 한 프레임) — 연타가 타이머를 다시 시작해 늦추는 것도 잡는다. */
const BEFORE_DUE_MS = Math.floor((BAR_EXIT_MS - 40) / 16) * 16;
const AFTER_DUE_MS = Math.ceil(BAR_EXIT_MS / 16) * 16 + 16;

/** 시작 5칸 중 selected 인 칸 id 목록. */
const selectedStartIds = () =>
  START5_IDS.filter(
    (id) => screen.getByTestId(id).props.accessibilityState?.selected === true
  );

/** 뒤로 가지가 (숨김이든) 아직 마운트돼 있으면 누른다 — 연타·늦은 재누름 시나리오용. */
const pressBackIfMounted = () => {
  const back = screen.queryByTestId(BACK, { includeHiddenElements: true });
  if (back) fireEvent.press(back);
};

describe('LiveBottomBar · BM 영상 4단계 모프 (사이클 4 AC-2~12)', () => {
  const probe = useAnimatedProbe();

  /** 모션 없는 최종 모양의 샘플 — 출발 탭 없이 그린 바(같은 래퍼·같은 시점). */
  function staticFinalSample(): string {
    renderBar();
    const sample = frameSample();
    screen.unmount();
    return sample;
  }

  it('BM1 입장 신호 + 출발 탭이 있으면 첫 프레임이 시작 5칸(홈 활성)이고 OS 답을 기다리는 동안 움직이지 않는다 — 답이 true 로 오면 최종 구조로 즉시 바뀐다', async () => {
    const finalSample = staticFinalSample();
    const os = deferOsAnswer();
    renderBar({ departureTab: 'home', entrance: true });

    // 첫 프레임: 홈 탭 바와 같은 5칸 — 루트 1개, 순서 홈·탐색·일정·기록·마이, 글자 정확히 5개, 활성은 홈 하나.
    expect(screen.getAllByTestId(BAR_ROOT)).toHaveLength(1);
    expect(visibleIds()).toEqual(START5_IDS);
    expect(renderedText(screen.root).split('\n')).toEqual(START5_TEXT);
    expect(selectedStartIds()).toEqual([START_HOME]);
    // 뒤로·수정·챗봇·행사는 아직 접근성 트리에 없다(5칸도 완전한 바 — 새 칸은 ④ 까지 안 보인다).
    NEW_CELLS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
    const waiting = watchMotion(20);
    expect(moved(waiting)).toBe(false);
    expect(
      waiting.shapes.every((shape) => shape.join() === START5_IDS.join())
    ).toBe(true);

    // 답이 true(동작 줄이기 켜짐) → 모션 없이 곧장 최종 구조.
    await act(async () => {
      os.resolve(true);
    });
    expect(visibleIds()).toEqual(FINAL_IDS);
    expect(renderedText(screen.root).split('\n')).toEqual(FINAL_TEXT);
    expect(screen.getByTestId(SCHEDULE)).toBeSelected();
    advance(32); // 값이 최종으로 자리 잡는 한두 프레임(보간이 아니라 스냅)은 움직임으로 치지 않는다
    const after = watchMotion(30);
    expect(structureSteady(after)).toBe(true);
    expect(moved(after)).toBe(false);
    expect(lastSample(after)).toBe(finalSample);
  });

  it.each(['home', 'explore', 'itinerary', 'records', 'my'] as const)(
    'BM2 [출발 탭 %s] 답이 false 로 와도 지연(BAR_ENTER_DELAY_MS) 동안은 시작 5칸이 그대로이고, 지연 뒤 4단계를 재생한다 — 컷 이후 시작 칸 제거(재등장 없음) → 새 칸 등장 → 최종 구조, 일정 칸은 같은 노드이고 분홍(활성)은 시작에선 출발 탭·컷 뒤엔 일정이다',
    async (tab) => {
      const finalSample = staticFinalSample();
      const os = deferOsAnswer();
      renderBar({ departureTab: tab, entrance: true });
      await act(async () => {
        os.resolve(false);
      });
      const D = BAR_ENTER_DELAY_MS;
      const startSelected: (string[] | null)[] = [];
      const scales: number[] = [];
      const watch = watchMotion(
        Math.ceil((D + BAR_ENTER_MS + 320) / 16),
        16,
        () => {
          startSelected.push(
            visibleIds().includes(START_HOME) ? selectedStartIds() : null
          );
          scales.push(rootScale());
        }
      );

      // 지연 구간(0~D)과 ① 확대 구간(D~D+64): 5칸 구조가 그대로이고, 지연 동안은 확대(①)도 시작하지 않는다.
      watch.shapes.forEach((shape, i) => {
        if (watch.at[i] <= D + 64) expect(shape).toEqual(START5_IDS);
        if (watch.at[i] <= D - 16) expect(scales[i]).toBeCloseTo(1, 6);
      });
      const quiet = watch.samples.filter((_, i) => watch.at[i] <= D - 16);
      expect(new Set(quiet).size).toBe(1); // 지연 동안 아무것도 안 움직인다
      // ② 컷: 지연이 끝나기 전에는 일어나지 않고, 지연 + 200ms 안에 시작 칸 4개가 렌더에서 사라져 다시 안 나타난다.
      START_CELLS.forEach((id) => {
        const gone = firstGone(watch, id);
        expect(gone).not.toBeNull();
        expect(gone as number).toBeGreaterThanOrEqual(D);
        expect(gone as number).toBeLessThanOrEqual(D + 200);
        expect(staysOnceGone(watch, id)).toBe(true);
      });
      const cutAt = firstGone(watch, START_HOME) as number;
      // 활성(분홍) 칸: 컷 전 시작 5칸에서는 출발 탭 칸 하나(출발 탭이 일정이면 일정), 컷 뒤에는 일정 — 시작부터 일정이 분홍이면 홈 탭 바와 색이 튄다.
      startSelected.forEach((ids, i) => {
        if (ids !== null) expect(ids).toEqual([TAB_ID[tab]]);
        if (watch.at[i] < cutAt)
          expect(watch.scheduleSelected[i]).toBe(tab === 'itinerary');
        else expect(watch.scheduleSelected[i]).toBe(true);
      });
      // 시작 칸 레이어와 새 칸 레이어는 동시에 보이지 않는다 — 컷이 등장보다 먼저 끝난다.
      watch.shapes.forEach((shape) => {
        const hasStart = START_CELLS.some((id) => shape.includes(id));
        const hasNew = NEW_CELLS.some((id) => shape.includes(id));
        expect(hasStart && hasNew).toBe(false);
      });
      // ④ 새 칸은 시작 칸이 사라진 뒤에 처음 보이고, 한 번 보이면 안 사라진다.
      NEW_CELLS.forEach((id) => {
        const seen = firstSeen(watch, id);
        expect(seen).not.toBeNull();
        expect(seen as number).toBeGreaterThanOrEqual(cutAt);
        expect(staysOnceSeen(watch, id)).toBe(true);
      });
      // 구조: 루트는 늘 하나, 일정 칸은 같은 노드(리마운트 없음). 움직였다.
      expect(structureSteady(watch)).toBe(true);
      expect(moved(watch)).toBe(true);
      // 끝: 최종 구조 · 정적 최종과 같은 샘플 · 시작 칸이 렌더에 남지 않는다(숨기기만 한 게 아니다) · 이후 안 변한다.
      expect(lastSample(watch)).toBe(finalSample);
      expect(visibleIds()).toEqual(FINAL_IDS);
      expect(renderedText(screen.root).split('\n')).toEqual(FINAL_TEXT);
      expect(moved(watchMotion(20))).toBe(false);
    }
  );

  it('BM3 입장 신호 + 출발 탭 + OS 답 true(동작 줄이기) → 모션 없이 곧장 최종 구조', async () => {
    const finalSample = staticFinalSample();
    probe.setReduceMotion(true);
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    advance(32); // 스냅 프레임은 움직임으로 치지 않는다(BM1 과 같다)

    const watch = watchMotion(40);

    expect(visibleIds()).toEqual(FINAL_IDS);
    expect(structureSteady(watch)).toBe(true);
    expect(moved(watch)).toBe(false);
    expect(lastSample(watch)).toBe(finalSample);
  });

  it('BM4 입장 신호가 없으면(허브가 이미 한 번 재생함) 출발 탭이 있고 OS 답이 false 여도 첫 프레임부터 최종 구조이고 움직이지 않는다 — 짝: BM2 는 입장 신호가 있을 때 움직였다', async () => {
    const finalSample = staticFinalSample();
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'home', entrance: false });
    expect(visibleIds()).toEqual(FINAL_IDS); // 답이 오기 전 첫 프레임도 최종
    await flushOsAnswer();

    const watch = watchMotion(60);

    expect(moved(watch)).toBe(false);
    expect(lastSample(watch)).toBe(finalSample);
    expect(screen.getByTestId(SCHEDULE)).toBeSelected();
  });

  it('BM4b 출발 탭이 없으면(탭 바 위가 아닌 진입 — 푸시 딥링크·planb 등) 입장 신호가 있고 OS 답이 false 여도 모션 없이 최종 구조다 — 시작 칸이 한 번도 안 보인다', async () => {
    const finalSample = staticFinalSample();
    probe.setReduceMotion(false);
    renderBar({ entrance: true });
    expect(visibleIds()).toEqual(FINAL_IDS);
    await flushOsAnswer();

    const watch = watchMotion(60);

    expect(
      watch.shapes.every((shape) => shape.join() === FINAL_IDS.join())
    ).toBe(true);
    expect(moved(watch)).toBe(false);
    expect(lastSample(watch)).toBe(finalSample);
  });

  it.each(['home', 'explore', 'itinerary', 'records', 'my'] as const)(
    'BM5 [출발 탭 %s] 뒤로를 누르면 onBack 은 모션이 끝난 뒤 정확히 1회다 — 연타해도 1회, 역순(뒤로·새 칸 즉시 사라짐 → 시작 칸 왼→오 등장) 끝 모양은 그 탭이 활성인 시작 5칸',
    async (tab) => {
      probe.setReduceMotion(false);
      const handlers = renderBar({ departureTab: tab });
      await flushOsAnswer();
      expect(visibleIds()).toEqual(FINAL_IDS);

      fireEvent.press(screen.getByTestId(BACK));
      // 모션이 끝나길 기다린다 — 같은 틱에는 부르지 않는다(사이클 3 의 동시 시작을 뒤집음).
      expect(handlers.onBack).not.toHaveBeenCalled();
      let before = -1;
      let afterDue = -1;
      const watch = watchMotion(40, 16, (ms) => {
        // 연타: 모션 도중 계속 누른다(숨겨진 뒤로가 남아 있어도 무시돼야 한다).
        if (ms === 16 || ms === 32 || ms === 112 || ms === 304)
          pressBackIfMounted();
        if (ms === BEFORE_DUE_MS) before = handlers.onBack.mock.calls.length;
        // 구조 교체(≈50ms) 뒤 시작 5칸이 서 있는 내내 분홍은 출발 탭 하나다 — 일정이 분홍인 채 끝났다가 홈 탭 바(홈 분홍)로 바뀌면 색이 튄다.
        if (visibleIds().includes(START_HOME))
          expect(selectedStartIds()).toEqual([TAB_ID[tab]]);
        if (ms === AFTER_DUE_MS) afterDue = handlers.onBack.mock.calls.length;
      });

      expect(before).toBe(0); // BAR_EXIT_MS − 40 까지는 아직 0회
      // 첫 press 로부터 총 길이 + 한 프레임 안에 1회 — 연타가 타이머를 다시 시작해 늦추면 안 된다.
      expect(afterDue).toBe(1);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
      // ⓐ 뒤로·새 칸은 ~100ms 안에 사라지고 다시 안 나타난다.
      NEW_CELLS.forEach((id) => {
        const gone = firstGone(watch, id);
        expect(gone).not.toBeNull();
        expect(gone as number).toBeLessThanOrEqual(100);
        expect(staysOnceGone(watch, id)).toBe(true);
      });
      // ⓒ 시작 칸은 뒤로가 사라진 뒤에 왼→오 순서로 나타나고 안 사라진다.
      const backGone = firstGone(watch, BACK) as number;
      const seen = START_CELLS.map((id) => firstSeen(watch, id));
      seen.forEach((at) => {
        expect(at).not.toBeNull();
        expect(at as number).toBeGreaterThanOrEqual(backGone);
      });
      const times = seen as number[];
      expect(times[0]).toBeLessThanOrEqual(times[1]);
      expect(times[1]).toBeLessThanOrEqual(times[2]);
      expect(times[2]).toBeLessThanOrEqual(times[3]);
      START_CELLS.forEach((id) => expect(staysOnceSeen(watch, id)).toBe(true));
      // 루트는 늘 하나, 일정 칸은 같은 노드.
      expect(structureSteady(watch)).toBe(true);
      // 끝 모양 = 시작 5칸, 활성은 출발 탭 하나.
      expect(visibleIds()).toEqual(START5_IDS);
      expect(renderedText(screen.root).split('\n')).toEqual(START5_TEXT);
      expect(selectedStartIds()).toEqual([TAB_ID[tab]]);
      expect(screen.getByTestId(TAB_ID[tab])).toHaveTextContent(TAB_LABEL[tab]);
      // 끝난 뒤 최종으로 되돌아가지 않는다.
      const tail = watchMotion(38);
      expect(
        tail.shapes.every((shape) => shape.join() === START5_IDS.join())
      ).toBe(true);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    }
  );

  it('BM6 [동작 줄이기·대기·출발 탭 없음] OS 답이 true 면 모션 없이 즉시 1회, 답이 아직 안 왔으면 모션을 시작하고 타이머로 1회, 출발 탭이 없으면 즉시 1회 (INV-4)', async () => {
    // ⓐ 답 true → 타이머를 안 흘려도 onBack 1회, 모션 없음(최종 모양 그대로).
    probe.setReduceMotion(true);
    const reduced = renderBar({ departureTab: 'home' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    expect(reduced.onBack).toHaveBeenCalledTimes(1);
    const reducedWatch = watchMotion(40);
    expect(moved(reducedWatch)).toBe(false);
    expect(visibleIds()).toEqual(FINAL_IDS);
    screen.unmount();

    // ⓑ 답 대기 → 즉시 0회 · 모션 시작 · 타이머로 정확히 1회(OS 답이 끝내 안 와도 이동한다).
    deferOsAnswer();
    const waiting = renderBar({ departureTab: 'home' });
    fireEvent.press(screen.getByTestId(BACK));
    expect(waiting.onBack).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(BACK));
    const waitingWatch = watchMotion(30);
    expect(moved(waitingWatch)).toBe(true);
    expect(waiting.onBack).toHaveBeenCalledTimes(1);
    screen.unmount();

    // ⓒ 출발 탭 없음 → 답이 false 여도 즉시 1회, 모션 없음(끝 모양을 알 수 없다).
    probe.setReduceMotion(false);
    const noTab = renderBar({});
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    expect(noTab.onBack).toHaveBeenCalledTimes(1);
    expect(moved(watchMotion(40))).toBe(false);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it.each([false, true])(
    'BM7 [늦은 OS 답 %s] 퇴장이 시작된 뒤 OS 답이 늦게 와도 퇴장은 그대로 이어진다 — 입장을 다시 시작하지 않고(뒤로·새 칸은 안 돌아옴) 즉시 이동하지도 않으며, onBack 은 모션 뒤 1회다',
    async (lateAnswer) => {
      const os = deferOsAnswer();
      const handlers = renderBar({ departureTab: 'home' });
      expect(visibleIds()).toEqual(FINAL_IDS); // 입장 신호가 없으면 대기 중에도 최종

      fireEvent.press(screen.getByTestId(BACK));
      expect(handlers.onBack).not.toHaveBeenCalled(); // 퇴장 시작 (OS 답 대기 중이라 true 가 아니다)
      const early = watchMotion(4);
      await act(async () => {
        os.resolve(lateAnswer);
      });
      // 늦은 답이 true 여도 이미 시작한 퇴장을 "즉시 이동"으로 바꾸지 않는다.
      expect(handlers.onBack).not.toHaveBeenCalled();
      const late = watchMotion(40);
      const watch = joinWatches(early, late);

      NEW_CELLS.forEach((id) => expect(staysOnceGone(watch, id)).toBe(true));
      START_CELLS.forEach((id) => expect(staysOnceSeen(watch, id)).toBe(true));
      expect(visibleIds()).toEqual(START5_IDS);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    }
  );

  it('BM8 입장 모션 도중(④ 진행 중)에 뒤로를 눌러도 onBack 은 누른 뒤 모션이 끝나면 1회이고, 끝 모양은 시작 5칸이며 최종으로 되돌아가지 않는다', async () => {
    probe.setReduceMotion(false);
    const handlers = renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    const entering = watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + 304) / 16)); // 지연 + ≈304ms — ④ 가 한창이다
    expect(screen.queryByTestId(BACK)).not.toBeNull();

    fireEvent.press(screen.getByTestId(BACK));
    expect(handlers.onBack).not.toHaveBeenCalled();
    let before = -1;
    const leaving = watchMotion(40, 16, (ms) => {
      if (ms === BEFORE_DUE_MS) before = handlers.onBack.mock.calls.length;
    });

    expect(before).toBe(0);
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(visibleIds()).toEqual(START5_IDS);
    expect(selectedStartIds()).toEqual([START_HOME]);
    // 입장의 "끝났다" 표식(타이머·콜백)이 퇴장 도중 새 칸을 다시 띄우거나 시작 칸을 걷지 않는다 — 한 번 사라진 건 안 돌아오고, 한 번 나타난 건 안 사라진다.
    NEW_CELLS.forEach((id) => expect(staysOnceGone(leaving, id)).toBe(true));
    START_CELLS.forEach((id) => expect(staysOnceSeen(leaving, id)).toBe(true));
    // 입장 쪽 타이머(컷·④)가 퇴장을 망치지 않는다 — 퇴장이 끝난 시각 이후의 모든 프레임은 시작 5칸 그대로다.
    const tail = leaving.shapes.filter((_, i) => leaving.at[i] >= BAR_EXIT_MS);
    expect(tail.length).toBeGreaterThan(10);
    expect(tail.every((shape) => shape.join() === START5_IDS.join())).toBe(
      true
    );
    expect(
      joinWatches(entering, leaving).rootCounts.every((n) => n === 1)
    ).toBe(true);
  });

  it('BM9 퇴장 도중 바가 사라지면(스와이프·하드웨어 뒤로로 허브가 먼저 떠남) onBack 은 부르지 않는다 — router.back 을 한 번 더 부르지 않는다 (대조군: 남아 있으면 1회)', async () => {
    probe.setReduceMotion(false);
    const gone = renderBar({ departureTab: 'home' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    watchMotion(7); // ≈112ms
    screen.unmount();
    advance(1000);
    expect(gone.onBack).not.toHaveBeenCalled();

    // 대조군 — 같은 입력에서 언마운트하지 않으면 불린다(타이머가 아예 안 도는 구현이 위 단언을 공허하게 통과하지 못하게).
    const kept = renderBar({ departureTab: 'home' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    advance(EXIT_DONE_MS);
    expect(kept.onBack).toHaveBeenCalledTimes(1);
  });

  it('BM10 시작 5칸의 홈·탐색·기록·마이는 눌러도 허브 콜백을 부르지 않고, 일정 칸은 진짜 버튼이다 (복제본일 뿐 — 탭 이동 없음)', () => {
    deferOsAnswer();
    const handlers = renderBar({ departureTab: 'home', entrance: true });
    expect(visibleIds()).toEqual(START5_IDS);

    START_CELLS.forEach((id) => fireEvent.press(screen.getByTestId(id)));
    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());

    fireEvent.press(screen.getByTestId(SCHEDULE));
    expect(handlers.onPressSchedule).toHaveBeenCalledTimes(1);
  });

  // ── 6-b 후 보강 3 — 입장 모프 시작 지연 (허브 첫 렌더가 끝난 뒤로) ─────────────────────────────────────────────────────
  // 실기 녹화에서 허브가 열린 직후 프레임이 끊겼다(93·42·158ms) — 시트가 올라오고 지도·목록이 처음 그려지는 구간과 4단계 모프(0.46s)가
  // 겹쳤다. 계약: 모프는 OS 답이 false 로 확인되고 + `InteractionManager.runAfterInteractions` 가 끝났고 + 마운트 후 `BAR_ENTER_DELAY_MS` 가
  // 지난 뒤 중 **가장 늦은 시점**에 시작한다. 그 전까지 시작 5칸이 그대로 서 있다(숨기지 않는다 · ① 확대도 시작하지 않는다).
  // 동작 줄이기 true·출발 탭 없음은 지연 없이 최종 구조(BM3·BM4b), 퇴장은 지연 없음(BM5). 지연 중에는 뒤로가 시작 5칸에 없어 누를 수 없다
  // (뒤로는 컷 뒤 최종 구조에서 처음 마운트된다 — 지연 중 뒤로 = 도달 불가, 02a §11). 지연 중 시작 5칸에서 누를 수 있는 건 일정 칸뿐이다.
  const gate = useInteractionGate();

  it('BM11 지연 동안(BAR_ENTER_DELAY_MS 전)은 OS 답이 false 여도 시작 5칸이 그대로이고 아무것도 안 움직이며(확대·컷 없음), 지연이 끝난 뒤에야 컷이 일어난다', async () => {
    expect(Number.isFinite(BAR_ENTER_DELAY_MS)).toBe(true); // 상수가 없으면 아래 시계 계산이 NaN 이 되어 공허하게 통과한다
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    const scales: number[] = [];

    const quiet = watchMotion(
      Math.floor((BAR_ENTER_DELAY_MS - 16) / 16),
      16,
      () => scales.push(rootScale())
    );

    expect(moved(quiet)).toBe(false);
    expect(
      quiet.shapes.every((shape) => shape.join() === START5_IDS.join())
    ).toBe(true);
    scales.forEach((scale) => expect(scale).toBeCloseTo(1, 6));
    // 지연이 끝난 뒤 컷(+100ms)까지 시작 5칸이 이어지고, 컷 뒤에는 시작 칸이 사라진다.
    const after = watchMotion(Math.ceil((BAR_ENTER_MS + 160) / 16));
    expect(firstGone(after, START_HOME)).not.toBeNull();
    expect(firstGone(after, START_HOME) as number).toBeLessThanOrEqual(
      200 + 32
    );
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it('BM11b 지연이 지난 뒤에 OS 답(false)이 오면 답이 온 시점부터 시작한다 — 그전엔 시작 5칸 그대로, 도착 직후에도 바로 컷이 나지 않는다 ("늦은 쪽")', async () => {
    expect(Number.isFinite(BAR_ENTER_DELAY_MS)).toBe(true); // 상수가 없으면 아래 시계 계산이 NaN 이 되어 공허하게 통과한다
    const os = deferOsAnswer();
    renderBar({ departureTab: 'home', entrance: true });
    advance(BAR_ENTER_DELAY_MS + 200); // 지연도 interactions 도 이미 끝났다
    expect(visibleIds()).toEqual(START5_IDS);

    await act(async () => {
      os.resolve(false);
    });
    const watch = watchMotion(Math.ceil((BAR_ENTER_MS + 160) / 16));

    watch.shapes.forEach((shape, i) => {
      if (watch.at[i] <= 64) expect(shape).toEqual(START5_IDS);
    });
    expect(firstGone(watch, START_HOME) as number).toBeLessThanOrEqual(200);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it('BM12 runAfterInteractions 가 끝나지 않으면 지연이 한참 지나도 시작하지 않고, 끝나는 순간 (지연은 이미 지났으니) 곧 시작한다', async () => {
    probe.setReduceMotion(false);
    gate.hold();
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    // 바는 InteractionManager.runAfterInteractions 에 시작을 맡겼다(계약) — 아직 끝나지 않은 건이 하나 있다.
    expect(gate.pending()).toBe(1);

    const stuck = watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + 1000) / 16));

    expect(moved(stuck)).toBe(false);
    expect(
      stuck.shapes.every((shape) => shape.join() === START5_IDS.join())
    ).toBe(true);

    gate.finish();
    const after = watchMotion(Math.ceil((BAR_ENTER_MS + 160) / 16));
    expect(moved(after)).toBe(true);
    expect(firstGone(after, START_HOME) as number).toBeLessThanOrEqual(200);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it('BM12b 지연이 끝나기 전에 interactions 가 먼저 끝나도 지연이 끝나야 시작한다 (둘 중 늦은 쪽)', async () => {
    expect(Number.isFinite(BAR_ENTER_DELAY_MS)).toBe(true); // 상수가 없으면 아래 시계 계산이 NaN 이 되어 공허하게 통과한다
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer(); // 기본 게이트: 마이크로태스크 뒤 즉시 끝남

    const early = watchMotion(Math.floor((BAR_ENTER_DELAY_MS - 32) / 16));

    expect(
      early.shapes.every((shape) => shape.join() === START5_IDS.join())
    ).toBe(true);
    expect(moved(early)).toBe(false);
  });

  it('BM13 지연 도중 바가 사라지면(허브가 먼저 떠남) 지연 타이머와 interactions 대기를 모두 취소한다 — 이후 아무 일도 안 일어난다 (누수 0)', async () => {
    probe.setReduceMotion(false);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    // 지연 타이머(= 정확히 BAR_ENTER_DELAY_MS 짜리 setTimeout)가 있다면 그 id 가 언마운트 때 clearTimeout 으로 지워졌는지 본다.
    // (jest 는 가짜 타이머 수를 배경 타이머와 분리해 읽을 수 없고, 실행돼도 `alive` 가드가 막아 눈에 안 보이므로 호출 기록으로 본다.)
    const delayIds: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const setSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      const id = (realSetTimeout as unknown as (...a: unknown[]) => unknown)(
        fn,
        ms,
        ...rest
      );
      if (ms === BAR_ENTER_DELAY_MS) delayIds.push(id);
      return id;
    }) as unknown as typeof setTimeout);
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    try {
      gate.hold();
      renderBar({ departureTab: 'home', entrance: true });
      await flushOsAnswer();
      advance(100); // 지연 도중
      expect(gate.pending()).toBe(1);

      screen.unmount();

      expect(gate.pending()).toBe(0); // 대기 중이던 interactions 취소
      const cleared = clearSpy.mock.calls.map(([id]) => id);
      delayIds.forEach((id) => expect(cleared).toContain(id)); // 지연 타이머도 취소(지연 타이머를 쓰는 구현이라면)
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
    advance(2000);
    gate.finish();
    expect(errors).not.toHaveBeenCalled(); // 언마운트 뒤 상태 갱신·act 경고 없음
    errors.mockRestore();
  });
});

// ── 간격·폭 합 (BS) — 사이클 3 5-b 후 보강 유지 + 시작 5칸 ─────────────────────────────────────────────────────
// 사이클 3 은 루트 className `gap-sm`(8)과 캡슐 `marginLeft`(8)를 둘 다 둬 간격이 16 이 됐다(jest 는 className 을 style 로 안 바꿔 안 읽혔다).
// 설계: 뒤로 58 + 간격 8 + 캡슐 264 = 330(좌우 30). 시작 5칸·퇴장 끝은 뒤로 0 + 간격 0 + 캡슐 330(x30, 탭 바 pill 자리).
// 계약(02a): ① 가로 간격은 style 숫자로만(루트·모션 래퍼·유리 바깥 래퍼·시작 칸 레이어 className 에 gap/space-x/m·p 클래스 금지)
// ② 어디서 내든 읽은 합이 설계값. "읽히지 않는 간격 클래스가 없다"는 부정형 가드이고 className 으로 모양을 못 박지 않는다.
describe('LiveBottomBar · BS 간격·폭 합 (사이클 3 5-b 후 보강 · 사이클 4 시작 5칸)', () => {
  const probe = useAnimatedProbe();
  useInteractionGate();

  it('BS1 최종 모양: 뒤로 58 + 간격 8 이고 캡슐이 나머지를 채운다 → 캡슐 264(= 330 − 58 − 8) — 숨은 가로 오프셋 style 이 없다', () => {
    renderBar();

    const row = readRow();

    expect(row.backWidth).toBe(58);
    // 행 gap·뒤로 marginRight·캡슐 marginLeft 중 어디서 내든 합이 8 — 16 이면(간격이 두 번) 캡슐이 256 이 돼 칸 59·팝업 5pt 어긋남.
    expect(row.spacing).toBe(8);
    expect(row.capsuleFills).toBe(true);
    expect(row.strayKeys).toEqual([]);
  });

  it('BS2 가로 간격은 style 숫자로만 낸다 — 유리 바깥 어느 노드의 className 에도 gap·space-x·margin·padding 클래스가 없다 (읽히지 않는 두 번째 간격 금지)', () => {
    renderBar();
    // 짝 앵커 — 바는 그려졌고 읽을 수 있다(빈 트리라 공허하게 통과하지 않게).
    expect(screen.getByTestId(BAR_ROOT)).toBeOnTheScreen();
    expect(readRow().backWidth).toBe(58);

    // jest 는 className 을 style 로 바꾸지 않아 이런 클래스가 있으면 BS1 의 합이 실제와 달라진다(루트 `gap-sm` 이 정확히 그 결함).
    expect(hiddenSpacingClasses()).toEqual([]);
  });

  it('BS3 퇴장이 끝난 모양은 시작 5칸이다 — 뒤로 0 + 간격 0 → 알약이 풀폭 330 으로 x30 에서 시작하고(탭 바 pill 자리), 활성은 출발 탭이다', async () => {
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'records' });
    await flushOsAnswer();

    fireEvent.press(screen.getByTestId(BACK));
    watchMotion(40); // 퇴장 모션이 끝날 때까지

    const row = readRow();
    expect(row.backWidth).toBe(0);
    expect(row.spacing).toBe(0);
    expect(row.capsuleFills).toBe(true);
    expect(row.strayKeys).toEqual([]);
    expect(visibleIds()).toEqual(START5_IDS);
    expect(selectedStartIds()).toEqual([START_RECORDS]);
  });

  it('BS4 입장 모션이 끝나면 최종 모양(뒤로 58 · 간격 8)으로 돌아와 멈춘다 — 모션이 다른 숫자에 머물지 않는다', async () => {
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();

    watchMotion(60);

    const row = readRow();
    expect(row.backWidth).toBe(58);
    expect(row.spacing).toBe(8);
    expect(row.strayKeys).toEqual([]);
  });

  it('BS5 시작 5칸에서도 알약은 풀폭이다(뒤로 0 · 간격 0 · 캡슐 fill) — 시작 칸 레이어에 읽히지 않는 가로 간격 className 이 없다', () => {
    deferOsAnswer();
    renderBar({ departureTab: 'home', entrance: true });
    // 짝 앵커 — 시작 5칸이 실제로 그려져 있다(최종 구조를 읽고 공허하게 통과하지 않게).
    expect(visibleIds()).toEqual(START5_IDS);

    const row = readRow();
    expect(row.backWidth).toBe(0);
    expect(row.spacing).toBe(0);
    expect(row.capsuleFills).toBe(true);
    expect(row.strayKeys).toEqual([]);
    expect(hiddenSpacingClasses()).toEqual([]);
  });
});

// ── 5-b 후 보강(사이클 4) — 단계 함수 값 ↔ 칸 스타일 고리 (경고-2) ───────────────────────────────────────────────────
// 사이클 4 심판은 "어느 칸이 마운트돼 있나"와 캡슐 래퍼 지문만 봐서, 칸이 단계 함수가 낸 값으로 실제 연결됐는지(수정·챗봇·행사가 새 칸 값을
// 읽는지 · 슬롯 불투명도/확대 · 바 전체 확대 · 뒤로 래퍼 폭)는 비어 있었다 — 새 칸이 시작 칸 값을 읽어도 154개가 초록이었다.
// 읽는 것: 칸에서 캡슐 래퍼 앞까지의 조상 효과(`slotEffect`)와 루트 확대(`rootScale`), 뒤로 가지 폭(`readRow`). 오라클은 `barMorphFrame` 호출 결과.
// ⚠️ 한계(02a 5-b 후 보강): 모션의 **중간 값**은 프레임 시각 정렬 오차(±8ms)를 흡수하는 범위로만 보고, 값이 평평한 구간(plateau)과 끝값을 우선한다.
//   ① 확대는 0.1s 안에서만 보이는 값이라 끝값·plateau 가 없어 중간 한 구간(0~96ms)을 범위로 본다(상수 1 로 고정한 구현을 거르는 유일한 길).
describe('LiveBottomBar · BL 단계 함수 값 ↔ 칸 스타일 (사이클 4 5-b 후 보강 · 경고-2)', () => {
  const probe = useAnimatedProbe();
  useInteractionGate();
  let windowSpy: jest.SpyInstance | null = null;
  beforeEach(() => {
    windowSpy = setWindowWidth(390);
  });
  afterEach(() => {
    windowSpy?.mockRestore();
    windowSpy = null;
  });
  const NEW_IDS = [EDIT, CHATBOT, EVENT];
  const NEAR = 0.02;

  /** 프레임 시각 ±8ms 안에서 단계 함수가 낼 수 있는 값의 [최소, 최대]. */
  function range(
    direction: 'enter' | 'exit',
    ms: number,
    pick: (frame: ReturnType<typeof barMorphFrame>) => number
  ): [number, number] {
    const values = [-8, 0, 8].map((d) =>
      pick(barMorphFrame(direction, Math.max(0, ms + d)))
    );
    return [Math.min(...values), Math.max(...values)];
  }
  function expectIn(actual: number, [lo, hi]: [number, number], label: string) {
    expect({
      label,
      ok: actual >= lo - NEAR && actual <= hi + NEAR,
      actual,
      lo,
      hi,
    }).toEqual(expect.objectContaining({ ok: true }));
  }

  it('BL1 입장: 시작 5칸의 홈·탐색·기록·마이는 불투명도 1·확대 1 로 서고(시작 칸 값), ① 동안 바 전체가 커지며, 컷 뒤 평평한 구간에 새 칸은 투명·작고 뒤로 폭은 0 이고, 끝나면 새 칸 불투명도 1·확대 1·뒤로 58·바 확대 1 이다', async () => {
    const os = deferOsAnswer();
    renderBar({ departureTab: 'home', entrance: true });
    // 시작 5칸 첫 프레임 — 시작 칸은 시작 칸 값(1·1)을 읽는다(새 칸 값을 읽으면 0 이다).
    const first = barMorphFrame('enter', 0);
    START_CELLS.forEach((id, k) => {
      const effect = slotEffect(id);
      expect(effect.opacity).toBeCloseTo(first.startCells[k].opacity, 6);
      expect(effect.scale).toBeCloseTo(first.startCells[k].scale, 6);
    });
    expect(rootScale()).toBeCloseTo(first.barScale, 6);

    await act(async () => {
      os.resolve(false);
    });
    // 모프 시계는 지연(BAR_ENTER_DELAY_MS)이 끝나는 순간부터 돈다 — 프레임 시각에서 지연을 뺀 값이 단계 함수의 입력이다.
    const D = BAR_ENTER_DELAY_MS;
    watchMotion(Math.ceil((D + BAR_ENTER_MS + 80) / 16), 16, (ms) => {
      const t = ms - D;
      // 지연 동안은 시작 모양 그대로(확대 1) · ① 확대(0~96ms): 바 전체가 커진다 — 상수 1 로 고정한 구현은 여기서 걸린다.
      if (t <= 96)
        expectIn(
          rootScale(),
          range('enter', Math.max(0, t), (f) => f.barScale),
          `rootScale@${ms}`
        );
      // 컷 뒤 ~ ④ 시작 전 평평한 구간(128~208ms): 새 칸은 투명·작고, 뒤로 폭은 0 (마운트돼 있다면).
      if (t >= 128 && t <= 208) {
        NEW_IDS.forEach((id, i) => {
          if (!isMounted(id)) return;
          const effect = slotEffect(id);
          expectIn(
            effect.opacity,
            range('enter', t, (f) => f.newCells[i].opacity),
            `${id}.opacity@${ms}`
          );
          expectIn(
            effect.scale,
            range('enter', t, (f) => f.newCells[i].scale),
            `${id}.scale@${ms}`
          );
        });
        expectIn(
          readRow().backWidth ?? 0,
          range('enter', t, (f) => f.backSize),
          `backWidth@${ms}`
        );
      }
    });

    // 끝(≥ 입장 총 길이): 새 칸 3개 불투명도·확대 = 단계 함수의 끝값(1·1), 뒤로 폭 58, 바 확대 1 — 새 칸이 시작 칸 값을 읽으면 0 이다.
    const last = barMorphFrame('enter', BAR_ENTER_MS);
    NEW_IDS.forEach((id, i) => {
      const effect = slotEffect(id);
      expect(effect.opacity).toBeCloseTo(last.newCells[i].opacity, 6);
      expect(effect.scale).toBeCloseTo(last.newCells[i].scale, 6);
    });
    expect(readRow().backWidth).toBe(last.backSize);
    expect(rootScale()).toBeCloseTo(last.barScale, 6);
  });

  it.each(['home', 'records'] as const)(
    'BL2 퇴장 [출발 탭 %s]: 구조 교체 뒤 시작 칸이 서 있는 평평한 구간(80~200ms)에 불투명도 0, 끝나면 시작 칸 4개 불투명도 1·확대 1·바 확대 1 이다',
    async (tab) => {
      probe.setReduceMotion(false);
      renderBar({ departureTab: tab });
      await flushOsAnswer();
      fireEvent.press(screen.getByTestId(BACK));

      watchMotion(36, 16, (ms) => {
        // 시작 칸이 마운트돼 있다면(⌀ 구조 교체 ≈50ms 이후) 아직 안 나타난 평평한 구간이다.
        if (ms >= 80 && ms <= 200) {
          START_CELLS.forEach((id, k) => {
            if (!isMounted(id)) return;
            expectIn(
              slotEffect(id).opacity,
              range('exit', ms, (f) => f.startCells[k].opacity),
              `${id}.opacity@${ms}`
            );
          });
        }
        // 퇴장에는 바 전체 확대가 없다.
        expect(rootScale()).toBeCloseTo(1, 6);
      });

      const last = barMorphFrame('exit', BAR_EXIT_MS);
      START_CELLS.forEach((id, k) => {
        const effect = slotEffect(id);
        expect(effect.opacity).toBeCloseTo(last.startCells[k].opacity, 6);
        expect(effect.scale).toBeCloseTo(last.startCells[k].scale, 6);
      });
    }
  );
});
