import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

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
} from '@/widgets/bottom-nav-bar';
import { LiveBottomBar, type LiveBottomBarProps } from './LiveBottomBar';

/**
 * 여행 중 허브 하단 내비 바(props 만 받는 순수 프레젠테이션): 뒤로 + 4칸 캡슐 [일정·수정·챗봇·행사]. 한 칸을 누르면 그 칸의 콜백만 1회,
 * 활성(`active`)·펼침은 부모가 준 값(controlled), 수정 칸은 이동이 아니라 팝업 여닫이 신호. 아래 BM 묶음은 출발 탭이 있을 때 홈 탭 바와 같은
 * 5칸으로 시작해 4단계로 변신하고 뒤로는 역순을 끝낸 **뒤** onBack 을 부르는 모프를 **보이는 결과 상태**로만 본다(값은 barMorph.test).
 */

const BACK = 'execution-live-back';
const SCHEDULE = 'execution-live-bar-schedule';
const EDIT = 'execution-live-bar-edit';
const CHATBOT = 'execution-live-bar-chatbot';
const EVENT = 'execution-live-bar-event';
const DOT = 'execution-live-bar-event-dot';
const CELLS = [SCHEDULE, EDIT, CHATBOT, EVENT];

// OS "동작 줄이기" 답을 true 로 고정 — 모션과 무관한 케이스가 모션 타이머·act 경고 없이 결정적으로 돈다(모프 케이스만 바꾼다).
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

/** 점은 장식이라 기본 쿼리에서 빠진다 — 있는지는 숨은 요소까지 포함해 본다. */
const dot = () => screen.queryByTestId(DOT, { includeHiddenElements: true });

describe('LiveBottomBar · 구성과 배선', () => {
  it.each([
    ['뒤로', 'onBack', BACK],
    ['일정', 'onPressSchedule', SCHEDULE],
    ['수정', 'onPressEdit', EDIT],
    ['챗봇', 'onPressChatbot', CHATBOT],
    ['행사', 'onPressEvent', EVENT],
  ] as const)(
    '%s 는 버튼으로 읽히고 누르면 %s 만 1회 부르고 나머지 콜백은 0회다',
    (label, own, testID) => {
      const handlers = renderBar();

      expect(screen.getByRole('button', { name: label })).toHaveProp(
        'testID',
        testID
      );
      fireEvent.press(screen.getByTestId(testID));

      expect(handlers[own]).toHaveBeenCalledTimes(1);
      Object.entries(handlers)
        .filter(([name]) => name !== own)
        .forEach(([, fn]) => expect(fn).not.toHaveBeenCalled());
    }
  );

  it('기회가 있으면 활성 + 점(낭독 제외) + "추천 있음", 없으면 비활성 + 점 없음 + 눌러도 콜백 0회다', () => {
    const withEvent = renderBar({ eventAvailable: true });
    const cell = screen.getByTestId(EVENT);
    expect(cell).toBeEnabled();
    expect(dot()).not.toBeNull();
    expect(screen.queryByTestId(DOT)).toBeNull(); // 장식 — 낭독 대상에서 빠진다
    expect(cell).toHaveAccessibilityValue({ text: '추천 있음' });
    fireEvent.press(cell);
    expect(withEvent.onPressEvent).toHaveBeenCalledTimes(1);
    screen.unmount();

    // 짝 앵커: 바는 그려졌고 행사 칸만 비활성이다. 상태(disabled)만으로는 눌림이 안 막히므로 효과 0도 본다.
    const noEvent = renderBar({ eventAvailable: false });
    const idle = screen.getByTestId(EVENT);
    expect(screen.getByTestId(CHATBOT)).toBeEnabled();
    expect(idle).toBeDisabled();
    expect(dot()).toBeNull();
    fireEvent.press(idle);
    expect(noEvent.onPressEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['schedule', SCHEDULE],
    ['edit', EDIT],
    ['event', EVENT],
  ] as const)(
    'active=%s 이면 그 칸만 selected 이고 수정·행사의 expanded 는 팝업·카드가 열렸을 때만 true 다',
    (active, activeId) => {
      renderBar({ active });

      for (const id of CELLS) {
        if (id === activeId) expect(screen.getByTestId(id)).toBeSelected();
        else expect(screen.getByTestId(id)).not.toBeSelected();
      }
      expect(screen.getByTestId(EDIT).props.accessibilityState.expanded).toBe(
        active === 'edit'
      );
      expect(screen.getByTestId(EVENT).props.accessibilityState.expanded).toBe(
        active === 'event'
      );
    }
  );

  it('칸을 눌러도 부모가 active 를 안 바꾸면 바 혼자 바꾸지 않는다 — 콜백만 부른다', () => {
    const handlers = renderBar({ active: 'schedule' });

    fireEvent.press(screen.getByTestId(EDIT));

    expect(handlers.onPressEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(SCHEDULE)).toBeSelected();
    expect(screen.getByTestId(EDIT)).not.toBeSelected();
  });

  it('렌더된 글자는 정확히 일정·수정·챗봇·행사(이 순서)이고 시각·소요시간 글자가 없다 (INV-3)', () => {
    renderBar();

    const lines = renderedText(screen.root).split('\n');
    expect(lines).toEqual(['일정', '수정', '챗봇', '행사']);
    expect(lines.join(' ')).not.toMatch(/분|시간|소요|:/);
  });
});

// 손가락으로 누르는 최소 크기 44pt — 칸 style 의 height/minHeight(+ 뒤로는 width/minWidth)에 hitSlop 을 더한 값. 칸 폭은 flex-1 이라 jest 가
// 못 읽으므로 칸은 높이만, 뒤로(고정 지름)는 둘 다. 읽을 수 없으면(undefined) 통과시키지 않는다.
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
  if (own === 0) return undefined;
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

describe('LiveBottomBar · 터치 영역 44 이상', () => {
  it.each([
    ['뒤로', BACK, ['height', 'width']],
    ['일정', SCHEDULE, ['height']],
    ['수정', EDIT, ['height']],
    ['챗봇', CHATBOT, ['height']],
    ['행사', EVENT, ['height']],
  ] as const)(
    '%s 의 터치 크기는 읽을 수 있는 축에서 44 이상이다',
    (_l, testID, axes) => {
      renderBar();

      for (const axis of axes) {
        const size = extent(screen.getByTestId(testID), axis);
        expect(size).toBeDefined();
        expect(size as number).toBeGreaterThanOrEqual(MIN_TOUCH);
      }
    }
  );
});

// ── 영상 4단계 모프 (BM) ─────────────────────────────────────────────────────────────────────────────────────────────
// 허브 바가 홈 탭 바와 같은 5칸(홈·탐색·일정·기록·마이)으로 시작해 ① 확대 → ② 일정만 남기고 컷 → ③ 폭이 줄며 일정이 맨 앞으로 → ④ 뒤로 원 +
// 수정·챗봇·행사 등장을 재생하고, 뒤로는 역순(ⓐ 즉시 사라짐 → ⓑ 펼침 → ⓒ 나머지 칸 등장)을 끝낸 **뒤** `onBack` 을 부른다. 출발 탭이 없으면 모션 없음.
// 입장은 OS 답 false + interactions 완료 + 마운트 후 `BAR_ENTER_DELAY_MS` 중 가장 늦은 때 시작하고, 그 전까지 시작 5칸이 그대로다.
const START5_TEXT = ['홈', '탐색', '일정', '기록', '마이'];
const FINAL_TEXT = ['일정', '수정', '챗봇', '행사'];
const TAB_ID: Record<ShellTabKey, string> = {
  home: START_HOME,
  explore: START_EXPLORE,
  itinerary: SCHEDULE,
  records: START_RECORDS,
  my: START_MY,
};
const TABS = ['home', 'itinerary', 'records'] as const; // 경계 대표: 기본·일정(출발 탭=일정)·그 밖
/** 프레임(16ms) 격자 위에서 "아직 안 불려야 하는 시각"(총 길이 − 40ms 이전)과 "이미 불렸어야 하는 시각"(총 길이 + 한 프레임 — 연타가 타이머를 늦추는 것도 잡는다). */
const BEFORE_DUE_MS = Math.floor((BAR_EXIT_MS - 40) / 16) * 16;
const AFTER_DUE_MS = Math.ceil(BAR_EXIT_MS / 16) * 16 + 16;

const selectedStartIds = () =>
  START5_IDS.filter(
    (id) => screen.getByTestId(id).props.accessibilityState?.selected === true
  );

/** 뒤로 가지가 (숨김이든) 마운트돼 있으면 누른다 — 연타·늦은 재누름용. */
const pressBackIfMounted = () => {
  const back = screen.queryByTestId(BACK, { includeHiddenElements: true });
  if (back) fireEvent.press(back);
};

const allShapes = (watch: { shapes: string[][] }, ids: string[]) =>
  watch.shapes.every((shape) => shape.join() === ids.join());

describe('LiveBottomBar · 모프 (BM)', () => {
  const probe = useAnimatedProbe();
  const gate = useInteractionGate();

  /** 모션 없는 최종 모양의 지문 — 출발 탭 없이 그린 바. */
  function staticFinalSample(): string {
    renderBar();
    const sample = frameSample();
    screen.unmount();
    return sample;
  }

  it('입장 신호 + 출발 탭이면 첫 프레임이 시작 5칸(홈 활성)이고 OS 답을 기다리는 동안 안 움직이며, 답이 true 로 오면 최종 구조로 즉시 바뀐다', async () => {
    const finalSample = staticFinalSample();
    const os = deferOsAnswer();
    const handlers = renderBar({ departureTab: 'home', entrance: true });

    expect(screen.getAllByTestId(BAR_ROOT)).toHaveLength(1);
    expect(visibleIds()).toEqual(START5_IDS);
    expect(renderedText(screen.root).split('\n')).toEqual(START5_TEXT);
    expect(selectedStartIds()).toEqual([START_HOME]);
    NEW_CELLS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
    const waiting = watchMotion(20);
    expect(moved(waiting)).toBe(false);
    expect(allShapes(waiting, START5_IDS)).toBe(true);
    // 시작 칸은 복제본일 뿐이라 눌러도 허브 콜백이 없고, 일정 칸만 진짜 버튼이다.
    START_CELLS.forEach((id) => fireEvent.press(screen.getByTestId(id)));
    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    fireEvent.press(screen.getByTestId(SCHEDULE));
    expect(handlers.onPressSchedule).toHaveBeenCalledTimes(1);

    await act(async () => {
      os.resolve(true);
    });
    expect(visibleIds()).toEqual(FINAL_IDS);
    expect(renderedText(screen.root).split('\n')).toEqual(FINAL_TEXT);
    expect(screen.getByTestId(SCHEDULE)).toBeSelected();
    advance(32); // 값이 최종으로 자리 잡는 스냅 프레임은 움직임으로 치지 않는다
    const after = watchMotion(30);
    expect(structureSteady(after)).toBe(true);
    expect(moved(after)).toBe(false);
    expect(lastSample(after)).toBe(finalSample);
  });

  it.each(TABS)(
    '[출발 탭 %s] 답이 false 여도 지연 동안은 시작 5칸 그대로이고, 지연 뒤 4단계를 재생한다 — 컷 이후 시작 칸 제거(재등장 없음) → 새 칸 등장 → 최종 구조, 일정 칸은 같은 노드, 분홍은 시작에선 출발 탭·컷 뒤엔 일정',
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

      // 지연 동안(≤ D−16)은 아무것도 안 움직이고 확대(①)도 시작하지 않으며, 시작 5칸은 ① 구간(D+64)까지 유지된다.
      watch.shapes.forEach((shape, i) => {
        if (watch.at[i] <= D + 64) expect(shape).toEqual(START5_IDS);
        if (watch.at[i] <= D - 16) expect(scales[i]).toBeCloseTo(1, 6);
      });
      const quiet = watch.samples.filter((_, i) => watch.at[i] <= D - 16);
      expect(new Set(quiet).size).toBe(1);
      // ② 컷: 지연 전엔 없고 D+200ms 안에 시작 칸 4개가 렌더에서 사라져 다시 안 나타난다.
      START_CELLS.forEach((id) => {
        const gone = firstGone(watch, id) as number;
        expect(gone).toBeGreaterThanOrEqual(D);
        expect(gone).toBeLessThanOrEqual(D + 200);
        expect(staysOnceGone(watch, id)).toBe(true);
      });
      const cutAt = firstGone(watch, START_HOME) as number;
      // 분홍: 컷 전 시작 5칸은 출발 탭 칸 하나(일정이면 일정), 컷 뒤엔 일정 — 시작부터 일정이 분홍이면 홈 탭 바와 색이 튄다.
      startSelected.forEach((ids, i) => {
        if (ids !== null) expect(ids).toEqual([TAB_ID[tab]]);
        expect(watch.scheduleSelected[i]).toBe(
          watch.at[i] < cutAt ? tab === 'itinerary' : true
        );
      });
      // 시작 칸 레이어와 새 칸 레이어는 동시에 안 보이고, 새 칸은 컷 뒤에 처음 보여 안 사라진다.
      watch.shapes.forEach((shape) =>
        expect(
          START_CELLS.some((id) => shape.includes(id)) &&
            NEW_CELLS.some((id) => shape.includes(id))
        ).toBe(false)
      );
      NEW_CELLS.forEach((id) => {
        expect(firstSeen(watch, id) as number).toBeGreaterThanOrEqual(cutAt);
        expect(staysOnceSeen(watch, id)).toBe(true);
      });
      expect(structureSteady(watch)).toBe(true);
      expect(moved(watch)).toBe(true);
      // 끝: 정적 최종과 같고, 시작 칸이 렌더에 남지 않으며(숨기기만 한 게 아니다), 이후 안 변한다.
      expect(lastSample(watch)).toBe(finalSample);
      expect(visibleIds()).toEqual(FINAL_IDS);
      expect(renderedText(screen.root).split('\n')).toEqual(FINAL_TEXT);
      expect(moved(watchMotion(20))).toBe(false);
    }
  );

  it('입장 신호가 없거나(허브가 이미 한 번 재생함) 출발 탭이 없으면(푸시 딥링크·planb) OS 답이 false 여도 첫 프레임부터 최종 구조이고 움직이지 않는다', async () => {
    const finalSample = staticFinalSample();
    probe.setReduceMotion(false);
    for (const props of [
      { departureTab: 'home', entrance: false },
      { entrance: true },
    ] as const) {
      renderBar(props);
      expect(visibleIds()).toEqual(FINAL_IDS);
      await flushOsAnswer();

      const watch = watchMotion(60);

      expect(allShapes(watch, FINAL_IDS)).toBe(true);
      expect(moved(watch)).toBe(false);
      expect(lastSample(watch)).toBe(finalSample);
      screen.unmount();
    }
  });

  it.each(TABS)(
    '[출발 탭 %s] 뒤로를 누르면 onBack 은 모션이 끝난 뒤 정확히 1회다 — 연타해도 1회(타이머를 늦추지도 않는다), 뒤로·새 칸이 즉시 사라진 뒤 시작 칸이 나타나 그 탭이 분홍인 시작 5칸에서 끝난다',
    async (tab) => {
      probe.setReduceMotion(false);
      const handlers = renderBar({ departureTab: tab });
      await flushOsAnswer();
      expect(visibleIds()).toEqual(FINAL_IDS);

      fireEvent.press(screen.getByTestId(BACK));
      expect(handlers.onBack).not.toHaveBeenCalled(); // 같은 틱에는 부르지 않는다
      let before = -1;
      let afterDue = -1;
      const watch = watchMotion(40, 16, (ms) => {
        if (ms === 16 || ms === 32 || ms === 112 || ms === 304)
          pressBackIfMounted(); // 연타 — 숨겨진 뒤로가 남아 있어도 무시돼야 한다
        if (ms === BEFORE_DUE_MS) before = handlers.onBack.mock.calls.length;
        // 시작 5칸이 서 있는 내내 분홍은 출발 탭 하나다(일정이 분홍인 채 끝났다가 홈 탭 바로 바뀌면 색이 튄다).
        if (visibleIds().includes(START_HOME))
          expect(selectedStartIds()).toEqual([TAB_ID[tab]]);
        if (ms === AFTER_DUE_MS) afterDue = handlers.onBack.mock.calls.length;
      });

      expect(before).toBe(0);
      expect(afterDue).toBe(1);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
      NEW_CELLS.forEach((id) => {
        expect(firstGone(watch, id) as number).toBeLessThanOrEqual(100);
        expect(staysOnceGone(watch, id)).toBe(true);
      });
      const backGone = firstGone(watch, BACK) as number;
      START_CELLS.forEach((id) => {
        expect(firstSeen(watch, id) as number).toBeGreaterThanOrEqual(backGone);
        expect(staysOnceSeen(watch, id)).toBe(true);
      });
      expect(structureSteady(watch)).toBe(true);
      expect(visibleIds()).toEqual(START5_IDS);
      expect(renderedText(screen.root).split('\n')).toEqual(START5_TEXT);
      expect(selectedStartIds()).toEqual([TAB_ID[tab]]);
      expect(allShapes(watchMotion(38), START5_IDS)).toBe(true); // 끝난 뒤 최종으로 되돌아가지 않는다
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    }
  );

  it('뒤로: 동작 줄이기 true 면 모션 없이 즉시 1회, 답이 아직 안 왔으면 모션을 시작하고 타이머로 1회, 출발 탭이 없으면 답이 false 여도 즉시 1회 (INV-4)', async () => {
    probe.setReduceMotion(true);
    const reduced = renderBar({ departureTab: 'home' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    expect(reduced.onBack).toHaveBeenCalledTimes(1);
    expect(moved(watchMotion(40))).toBe(false);
    expect(visibleIds()).toEqual(FINAL_IDS);
    screen.unmount();

    deferOsAnswer();
    const waiting = renderBar({ departureTab: 'home' });
    fireEvent.press(screen.getByTestId(BACK));
    expect(waiting.onBack).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(BACK));
    expect(moved(watchMotion(30))).toBe(true);
    expect(waiting.onBack).toHaveBeenCalledTimes(1); // OS 답이 끝내 안 와도 이동한다
    screen.unmount();

    probe.setReduceMotion(false);
    const noTab = renderBar({});
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    expect(noTab.onBack).toHaveBeenCalledTimes(1);
    expect(moved(watchMotion(40))).toBe(false);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it.each([false, true])(
    '퇴장이 시작된 뒤 OS 답(%s)이 늦게 와도 퇴장은 그대로 이어진다 — 입장을 다시 시작하지 않고 즉시 이동하지도 않으며 onBack 은 모션 뒤 1회다',
    async (lateAnswer) => {
      const os = deferOsAnswer();
      const handlers = renderBar({ departureTab: 'home' });
      expect(visibleIds()).toEqual(FINAL_IDS);

      fireEvent.press(screen.getByTestId(BACK));
      expect(handlers.onBack).not.toHaveBeenCalled();
      const early = watchMotion(4);
      await act(async () => {
        os.resolve(lateAnswer);
      });
      expect(handlers.onBack).not.toHaveBeenCalled();
      const watch = joinWatches(early, watchMotion(40));

      NEW_CELLS.forEach((id) => expect(staysOnceGone(watch, id)).toBe(true));
      START_CELLS.forEach((id) => expect(staysOnceSeen(watch, id)).toBe(true));
      expect(visibleIds()).toEqual(START5_IDS);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    }
  );

  it('입장 도중(④ 진행 중)에 뒤로를 눌러도 onBack 은 누른 뒤 모션이 끝나면 1회이고, 끝 모양은 시작 5칸이며 입장의 끝 표식이 퇴장을 망치지 않는다', async () => {
    probe.setReduceMotion(false);
    const handlers = renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    const entering = watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + 304) / 16));
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
    NEW_CELLS.forEach((id) => expect(staysOnceGone(leaving, id)).toBe(true));
    START_CELLS.forEach((id) => expect(staysOnceSeen(leaving, id)).toBe(true));
    const tail = leaving.shapes.filter((_, i) => leaving.at[i] >= BAR_EXIT_MS);
    expect(tail.length).toBeGreaterThan(10);
    expect(allShapes({ shapes: tail }, START5_IDS)).toBe(true);
    expect(
      joinWatches(entering, leaving).rootCounts.every((n) => n === 1)
    ).toBe(true);
  });

  it('퇴장 도중 바가 사라지면(스와이프·하드웨어 뒤로로 허브가 먼저 떠남) onBack 을 부르지 않는다 — router.back 을 한 번 더 부르지 않는다 (대조군: 남아 있으면 1회)', async () => {
    probe.setReduceMotion(false);
    const gone = renderBar({ departureTab: 'home' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    watchMotion(7);
    screen.unmount();
    advance(1000);
    expect(gone.onBack).not.toHaveBeenCalled();

    const kept = renderBar({ departureTab: 'home' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    advance(BAR_EXIT_MS + 60);
    expect(kept.onBack).toHaveBeenCalledTimes(1);
  });

  // ── 입장 시작 지연 ──
  // 실기에서 허브가 열린 직후 프레임이 끊겼다(시트·지도·목록 첫 렌더와 모프가 겹침). 지연 중에는 뒤로가 시작 5칸에 없어 누를 수 없다(도달 불가 —
  // 뒤로는 컷 뒤에 처음 마운트된다). `BAR_ENTER_DELAY_MS` 가 없으면 아래 시계가 NaN 이 되어 공허하게 통과하므로 먼저 확인한다.
  it('지연(BAR_ENTER_DELAY_MS) 동안은 OS 답이 false 여도 시작 5칸 그대로 아무것도 안 움직이고(확대·컷 없음), 지연이 끝난 뒤에야 컷이 일어난다', async () => {
    expect(Number.isFinite(BAR_ENTER_DELAY_MS)).toBe(true);
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    const scales: number[] = [];

    const quiet = watchMotion(
      Math.floor((BAR_ENTER_DELAY_MS - 32) / 16),
      16,
      () => scales.push(rootScale())
    );

    expect(moved(quiet)).toBe(false);
    expect(allShapes(quiet, START5_IDS)).toBe(true);
    scales.forEach((scale) => expect(scale).toBeCloseTo(1, 6));
    const after = watchMotion(Math.ceil((BAR_ENTER_MS + 192) / 16));
    expect(firstGone(after, START_HOME) as number).toBeLessThanOrEqual(232);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it('지연이 지난 뒤에 OS 답(false)이 오면 답이 온 시점부터 시작한다 — 도착 직후에도 바로 컷이 나지 않는다 ("늦은 쪽")', async () => {
    expect(Number.isFinite(BAR_ENTER_DELAY_MS)).toBe(true);
    const os = deferOsAnswer();
    renderBar({ departureTab: 'home', entrance: true });
    advance(BAR_ENTER_DELAY_MS + 200);
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

  it('runAfterInteractions 가 끝나지 않으면 지연이 한참 지나도 시작하지 않고, 끝나는 순간 곧 시작한다', async () => {
    probe.setReduceMotion(false);
    gate.hold();
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    expect(gate.pending()).toBe(1); // 바가 시작을 InteractionManager.runAfterInteractions 에 맡겼다(계약)

    const stuck = watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + 1000) / 16));

    expect(moved(stuck)).toBe(false);
    expect(allShapes(stuck, START5_IDS)).toBe(true);
    gate.finish();
    const after = watchMotion(Math.ceil((BAR_ENTER_MS + 160) / 16));
    expect(moved(after)).toBe(true);
    expect(firstGone(after, START_HOME) as number).toBeLessThanOrEqual(200);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it('지연 도중 바가 사라지면(허브가 먼저 떠남) 지연 타이머와 interactions 대기를 모두 취소한다 — 이후 아무 일도 안 일어난다 (누수 0)', async () => {
    probe.setReduceMotion(false);
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    // 정확히 BAR_ENTER_DELAY_MS 짜리 setTimeout 이 있었다면 그 id 가 언마운트 때 clearTimeout 으로 지워졌는지 호출 기록으로 본다
    // (가짜 타이머 수는 배경 타이머와 분리해 읽을 수 없고, 실행돼도 `alive` 가드가 막아 눈에 안 보인다).
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
      advance(100);
      expect(gate.pending()).toBe(1);

      screen.unmount();

      expect(gate.pending()).toBe(0);
      const cleared = clearSpy.mock.calls.map(([id]) => id);
      delayIds.forEach((id) => expect(cleared).toContain(id));
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

// ── 간격·폭 합 (BS) ──────────────────────────────────────────────────────────────────────────────────────────────────
// 사이클 3 은 루트 className `gap-sm`(8)과 캡슐 `marginLeft`(8)를 둘 다 둬 간격이 16 이 됐다(jest 는 className 을 style 로 안 바꿔 안 읽혔다).
// 설계: 뒤로 58 + 간격 8 + 캡슐 264 = 330. 시작 5칸·퇴장 끝은 뒤로 0 + 간격 0 + 캡슐 풀폭. 가로 간격은 style 숫자 한 곳에서만 내고(유리 바깥
// 노드 className 에 gap/space-x/m·p 클래스 금지), 어디서 내든 읽은 합이 설계값이다 — className 으로 모양을 못 박지 않는 부정형 가드.
describe('LiveBottomBar · 간격·폭 합 (BS)', () => {
  const probe = useAnimatedProbe();
  useInteractionGate();

  it('최종 모양: 뒤로 58 + 간격 8 이고 캡슐이 나머지를 채우며 숨은 가로 오프셋 style·간격 className 이 없다', () => {
    renderBar();

    const row = readRow();

    expect(row.backWidth).toBe(58);
    expect(row.spacing).toBe(8); // 16 이면 간격이 두 번 — 캡슐 256·칸 59·팝업 5pt 어긋남
    expect(row.capsuleFills).toBe(true);
    expect(row.strayKeys).toEqual([]);
    expect(hiddenSpacingClasses()).toEqual([]);
  });

  it('퇴장이 끝난 모양은 시작 5칸이다 — 뒤로 0 + 간격 0(탭 바 pill 자리)에 활성은 출발 탭이고, 시작 칸 레이어에도 간격 className 이 없다', async () => {
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'records' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    watchMotion(40);

    const row = readRow();
    expect(row.backWidth).toBe(0);
    expect(row.spacing).toBe(0);
    expect(row.capsuleFills).toBe(true);
    expect(row.strayKeys).toEqual([]);
    expect(hiddenSpacingClasses()).toEqual([]);
    expect(visibleIds()).toEqual(START5_IDS);
    expect(selectedStartIds()).toEqual([START_RECORDS]);
  });
});

// ── 단계 함수 값 ↔ 칸 스타일 고리 (BL) ────────────────────────────────────────────────────────────────────────────────
// "어느 칸이 마운트돼 있나"만 보면 칸이 단계 함수가 낸 값으로 실제 연결됐는지(새 칸이 시작 칸 값을 읽는지·슬롯 불투명도/확대·바 확대·뒤로 폭)를
// 못 잡는다 — 칸의 조상 효과(`slotEffect`)·루트 확대·뒤로 폭을 `barMorphFrame` 오라클과 비교한다.
// ⚠️ 한계: 중간 값은 시각 정렬 오차(±8ms)를 흡수하는 범위로만 보고 평평한 구간(plateau)·끝값을 우선한다. ① 확대는 0.1s 안에서만 보이는 값이라
//   끝값·plateau 가 없어 중간 구간(0~96ms)을 범위로 본다(상수 1 로 고정한 구현을 거르는 유일한 길).
describe('LiveBottomBar · 단계 함수 값 ↔ 칸 스타일 (BL)', () => {
  useAnimatedProbe();
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
    expect({ label, ok: actual >= lo - 0.02 && actual <= hi + 0.02 }).toEqual({
      label,
      ok: true,
    });
  }

  it('입장: 시작 칸은 시작 칸 값(1·1)으로 서고, ① 동안 바 전체가 커지며, 컷 뒤 평평한 구간에 새 칸은 투명·작고 뒤로 폭 0, 끝나면 새 칸 1·1·뒤로 58·바 확대 1', async () => {
    const os = deferOsAnswer();
    renderBar({ departureTab: 'home', entrance: true });
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
    const D = BAR_ENTER_DELAY_MS; // 모프 시계는 지연이 끝나는 순간부터 돈다
    watchMotion(Math.ceil((D + BAR_ENTER_MS + 80) / 16), 16, (ms) => {
      const t = ms - D;
      if (t <= 96)
        expectIn(
          rootScale(),
          range('enter', Math.max(0, t), (f) => f.barScale),
          `rootScale@${ms}`
        );
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

    const last = barMorphFrame('enter', BAR_ENTER_MS);
    NEW_IDS.forEach((id, i) => {
      const effect = slotEffect(id);
      expect(effect.opacity).toBeCloseTo(last.newCells[i].opacity, 6);
      expect(effect.scale).toBeCloseTo(last.newCells[i].scale, 6);
    });
    expect(readRow().backWidth).toBe(last.backSize);
    expect(rootScale()).toBeCloseTo(last.barScale, 6);
  });
});
