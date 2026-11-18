import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { useAnimatedProbe } from '@/test-support/animatedProbe';
import {
  advance,
  deferOsAnswer,
  FINAL_IDS,
  firstGone,
  flushOsAnswer,
  holdReduceMotionOn,
  joinWatches,
  moved,
  NEW_CELLS,
  rootScale,
  slotEffect,
  START5_IDS,
  START_CELLS,
  START_EXPLORE,
  START_HOME,
  START_MY,
  START_RECORDS,
  staysOnceGone,
  staysOnceSeen,
  useInteractionGate,
  visibleIds,
  watchMotion,
  withHiddenBars,
  structureSteady,
} from '@/test-support/barMotionProbe';
import {
  ExitProbe,
  exitProbeText,
  LeavingScreen,
} from '@/test-support/barExitHarness';

import { resetReduceMotionForTests } from '@/shared/lib/reduceMotion';
import type { ShellTabKey } from '@/shared/ui/BottomTabBar';

import {
  BAR_ENTER_DELAY_MS,
  BAR_ENTER_MS,
  BAR_EXIT_MS,
  barMorphFrame,
} from '@/widgets/bottom-nav-bar';
import {
  BarExitHost,
  resetBarExitForTests,
} from '@/widgets/bottom-nav-bar/index.exit';
import { LiveBottomBar, type LiveBottomBarProps } from './LiveBottomBar';

// TRIP-1738 — 단계 함수 호출 수를 센다(BM-C). 실물을 감싼 스파이라 다른 묶음의 모양·타이밍은 같다.
jest.mock('@/widgets/bottom-nav-bar/model/barMorph', () => {
  const actual = jest.requireActual('@/widgets/bottom-nav-bar/model/barMorph');
  return { ...actual, barMorphFrame: jest.fn(actual.barMorphFrame) };
});

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
// TRIP-1831 — 퇴장 저장소(`barExitHandoff`)는 모듈 싱글턴이다. 뒤로를 누른 테스트의 퇴장 값이 다음 테스트로 새지 않게 파일 최상위(describe 밖)에서 비운다.
afterEach(() => resetBarExitForTests());

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
// 수정·챗봇·행사 등장을 재생하고, 뒤로는 **누르는 즉시** `onBack` 을 부르며(TRIP-1831 — 종전엔 역순이 끝난 뒤) 역순(ⓐ 즉시 사라짐 → ⓑ 펼침 → ⓒ 나머지 칸 등장)은
// 화면이 빠진 뒤에도 퇴장 호스트(`BarExitHost`)가 끝까지 재생한다. 출발 탭이 없으면 모션 없음.
// 입장은 OS 답 false + interactions 완료 + 마운트 후 `BAR_ENTER_DELAY_MS` 중 가장 늦은 때 시작하고, 그 전까지 시작 5칸이 그대로다.
const TAB_ID: Record<ShellTabKey, string> = {
  home: START_HOME,
  explore: START_EXPLORE,
  itinerary: SCHEDULE,
  records: START_RECORDS,
  my: START_MY,
};
const TABS = ['home', 'itinerary', 'records'] as const; // 경계 대표: 기본·일정(출발 탭=일정)·그 밖
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

  it('입장 신호 + 출발 탭이면 OS 답을 기다리는 동안 시작 칸은 눌러도 허브 콜백이 없고(일정 칸만 진짜 버튼), 답이 true 로 오면 최종 구조로 즉시 바뀐다', async () => {
    const os = deferOsAnswer();
    const handlers = renderBar({ departureTab: 'home', entrance: true });
    START_CELLS.forEach((id) => fireEvent.press(screen.getByTestId(id)));
    Object.values(handlers).forEach((fn) => expect(fn).not.toHaveBeenCalled());
    fireEvent.press(screen.getByTestId(SCHEDULE));
    expect(handlers.onPressSchedule).toHaveBeenCalledTimes(1);

    await act(async () => {
      os.resolve(true);
    });

    expect(visibleIds()).toEqual(FINAL_IDS);
    expect(screen.getByTestId(SCHEDULE)).toBeSelected();
  });

  it.each(TABS)(
    '[출발 탭 %s] 뒤로를 누르면 onBack 은 모션을 기다리지 않고 그 자리에서 정확히 1회다 — 연타해도, 타이머를 한참 흘려도 1회 (TRIP-1831)',
    async (tab) => {
      // 준비: 모션 켬 + 출발 탭이 있는 허브(퇴장 모프가 도는 조건).
      probe.setReduceMotion(false);
      const handlers = renderBar({ departureTab: tab });
      await flushOsAnswer();

      // 실행: 뒤로 한 번 — 가짜 시계는 한 틱도 안 흘렸다.
      fireEvent.press(screen.getByTestId(BACK));
      // 단언 1: 같은 틱에 이미 1회(종전엔 0회 — 400ms 타이머 뒤에야 불렸다).
      expect(handlers.onBack).toHaveBeenCalledTimes(1);

      // 실행: 모션이 흐르는 동안 연타하고, 타이머를 한참 더 흘린다.
      watchMotion(40, 16, (ms) => {
        if (ms === 16 || ms === 112 || ms === 304) pressBackIfMounted();
      });
      advance(1000);

      // 단언 2: 끝까지 1회.
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    }
  );

  it('뒤로: 동작 줄이기 true·출발 탭 없음은 퇴장 호스트 없이 즉시 1회, 답이 아직 안 와도 즉시 1회이고 퇴장 호스트가 선다 — 이동은 모션 때문에 늦어지지 않는다 (INV-4)', async () => {
    const withProbe = (overrides: Partial<LiveBottomBarProps>) => {
      const handlers = makeHandlers();
      render(
        <>
          <LiveBottomBar
            active="schedule"
            eventAvailable
            {...handlers}
            {...overrides}
          />
          <ExitProbe />
        </>
      );
      return handlers;
    };

    // 동작 줄이기 true — 모션이 없으니 호스트도 없다.
    probe.setReduceMotion(true);
    const reduced = withProbe({ departureTab: 'home' });
    await flushOsAnswer();
    expect(exitProbeText()).toBe('none'); // 앵커 — 누르기 전엔 퇴장이 없다
    fireEvent.press(screen.getByTestId(BACK));
    expect(reduced.onBack).toHaveBeenCalledTimes(1);
    expect(exitProbeText()).toBe('none');
    expect(moved(watchMotion(40))).toBe(false);
    expect(visibleIds()).toEqual(FINAL_IDS);
    screen.unmount();
    resetBarExitForTests();

    // 답은 모듈 캐시라(TRIP-1735) 한 테스트 안에서 "아직 답 없음"·다른 답을 보려면 캐시를 비운다.
    resetReduceMotionForTests();
    deferOsAnswer();
    const waiting = withProbe({ departureTab: 'home' });
    expect(exitProbeText()).toBe('none');
    fireEvent.press(screen.getByTestId(BACK));
    expect(waiting.onBack).toHaveBeenCalledTimes(1); // OS 답이 끝내 안 와도 이동한다 — 그것도 즉시
    expect(exitProbeText()).not.toBe('none'); // 답이 없어도 퇴장 모프는 선다
    screen.unmount();
    resetBarExitForTests();

    // 출발 탭 없음 — 끝 모양을 못 만들어 호스트가 없다.
    resetReduceMotionForTests();
    probe.setReduceMotion(false);
    const noTab = withProbe({});
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    expect(noTab.onBack).toHaveBeenCalledTimes(1);
    expect(exitProbeText()).toBe('none');
    expect(moved(watchMotion(40))).toBe(false);
    expect(visibleIds()).toEqual(FINAL_IDS);
  });

  it('누르는 즉시 이동한 뒤 바가 사라져도(화면이 빠짐) onBack 을 한 번 더 부르지 않는다 — router.back 이 두 번 불리지 않는다 (TRIP-1831)', async () => {
    probe.setReduceMotion(false);
    const handlers = renderBar({ departureTab: 'home' });
    await flushOsAnswer();
    fireEvent.press(screen.getByTestId(BACK));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    watchMotion(7);

    screen.unmount();
    advance(1000);

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
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

  // TRIP-1738 — 예전엔 스타일 8~9개가 프레임마다 각자 단계 함수를 불렀다. 이제 프레임 값 하나를 모두가 읽는다.
  // jest 의 reanimated 는 16ms 를 흘리면 애니메이션을 1ms 마다 진행한다(실측 — 바꾸기 전 16ms 당 144회, 뒤 16회) → "경과 ms 이하"가 곧 "틱당 1회 이하"다.
  it('BM-C 입장 모프 1회 동안 단계 함수는 애니메이션 틱마다 많아야 1번 불린다 (M-43 측정)', async () => {
    // 준비: 모션 켬, 출발 탭 + 입장 신호로 그리고 OS 답·시작 지연을 흘린다.
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    advance(BAR_ENTER_DELAY_MS + 16);
    const calls = barMorphFrame as unknown as jest.Mock;
    const before = calls.mock.calls.length;
    // 실행: 입장 모프 전 구간을 흘린다.
    const watch = watchMotion(Math.ceil(BAR_ENTER_MS / 16) + 2);
    // 단언: 모프가 실제로 돌았고(공허 통과 방지) 끝 모양이 최종 구조이며, 호출 수는 흘린 ms 이하다.
    expect(moved(watch)).toBe(true);
    expect(visibleIds()).toEqual(FINAL_IDS);
    const elapsed = watch.at[watch.at.length - 1];
    const during = calls.mock.calls.length - before;
    expect(during).toBeGreaterThan(0);
    expect(during).toBeLessThanOrEqual(elapsed);
  });

  // TRIP-1738 03b 경고-1 — 모양 값을 읽는 자리(칸 불투명도·확대, 새 칸 시차, 바 확대, 뒤로 원 크기)를 엉뚱한 값으로 바꿔도 green 이던 구멍.
  // 값 자체(곡선·숫자)는 barMorph.test 가 맡고, 여기선 "그 값이 실제로 칸에 걸린다"를 관계로만 본다 — 커졌다/덜 보였다/차례.
  it('BM-V 입장 모프 동안 바가 잠깐 커지고, 뒤로 원은 작은 데서 자라며, 새 칸은 덜 보이는 데서 왼→오 차례로 나타난다 — 끝은 전부 제 모습', async () => {
    // 준비: 모션 켬, 출발 탭 + 입장 신호.
    probe.setReduceMotion(false);
    renderBar({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    const rootScales: number[] = [];
    const backScales: number[] = [];
    const editOpacity: number[] = [];
    const eventOpacity: number[] = [];
    const mounted = (id: string) =>
      screen.queryByTestId(id, { includeHiddenElements: true }) !== null;
    // 실행: 지연 + 입장 전 구간을 프레임마다 읽는다(뒤로·새 칸은 컷 뒤에야 마운트된다).
    watchMotion(
      Math.ceil((BAR_ENTER_DELAY_MS + BAR_ENTER_MS + 64) / 16),
      16,
      () => {
        rootScales.push(rootScale());
        if (mounted(BACK)) backScales.push(slotEffect(BACK).scale);
        if (mounted(EDIT) && mounted(EVENT)) {
          editOpacity.push(slotEffect(EDIT).opacity);
          eventOpacity.push(slotEffect(EVENT).opacity);
        }
      }
    );
    // 단언: ① 바 확대가 1 보다 컸던 프레임이 있다 ② 뒤로 원이 1보다 작았던 프레임이 있다 ③ 수정 칸이 덜 보였던 프레임이 있다
    // ④ 같은 프레임에 수정(왼)이 행사(오)보다 더 보였던 적이 있다(차례) ⑤ 끝은 전부 1.
    expect(Math.max(...rootScales)).toBeGreaterThan(1);
    expect(backScales.some((scale) => scale > 0 && scale < 1)).toBe(true);
    expect(editOpacity.some((o) => o > 0 && o < 1)).toBe(true);
    expect(editOpacity.some((o, i) => o > eventOpacity[i])).toBe(true);
    expect(rootScales[rootScales.length - 1]).toBeCloseTo(1, 6);
    expect(backScales[backScales.length - 1]).toBeCloseTo(1, 6);
    expect(editOpacity[editOpacity.length - 1]).toBeCloseTo(1, 6);
    expect(eventOpacity[eventOpacity.length - 1]).toBeCloseTo(1, 6);
  });
});

// ── 이동과 동시에 퇴장 (TRIP-1831) ───────────────────────────────────────────────────────────────────────────────────────
// 뒤로를 누르면 화면이 곧바로 빠진다. 바의 퇴장 모프는 탭 레이아웃의 호스트(`BarExitHost`)가 같은 바를 이어서 끝까지 재생한다.
// 테스트의 `onBack` 은 목이라 `LeavingScreen` 이 "onBack 이 불리면 그 화면을 걷는다" 를 대신한다(원본 바가 남아 있으면 같은 testID 가 둘이 된다).
// 호스트 바는 낭독기에서 숨겨져 있어 `withHiddenBars` 로 숨김 요소까지 읽는다.
describe('LiveBottomBar · 이동과 동시에 퇴장 (TRIP-1831)', () => {
  const probe = useAnimatedProbe();
  useInteractionGate();
  withHiddenBars();

  function renderLeaving(overrides: Partial<LiveBottomBarProps> = {}) {
    const handlers = makeHandlers();
    render(
      <LeavingScreen
        screen={(leave) => (
          <LiveBottomBar
            active="schedule"
            eventAvailable
            {...handlers}
            {...overrides}
            onBack={leave(handlers.onBack)}
          />
        )}
      >
        <BarExitHost />
      </LeavingScreen>
    );
    return handlers;
  }
  const selectedStartHidden = () =>
    START5_IDS.filter(
      (id) =>
        screen.getByTestId(id, { includeHiddenElements: true }).props
          .accessibilityState?.selected === true
    );

  it.each(TABS)(
    '[출발 탭 %s] 누르는 즉시 이동하고, 바는 끊김 없이 호스트로 넘어가 퇴장을 끝까지 재생한다 — 바는 늘 하나, 끝 모양은 그 탭이 분홍인 시작 5칸',
    async (tab) => {
      // 준비: 모션 켬, 출발 탭이 있는 허브 + 호스트.
      probe.setReduceMotion(false);
      const handlers = renderLeaving({ departureTab: tab });
      await flushOsAnswer();
      expect(visibleIds()).toEqual(FINAL_IDS);
      expect(screen.queryByTestId('execution-live-bottom-bar')).not.toBeNull();

      // 실행: 뒤로 → 화면이 걷히고 호스트가 선다. 이어서 퇴장 전 구간을 프레임마다 읽는다(호스트는 BAR_EXIT_MS 에 걷히므로 그 직전까지).
      fireEvent.press(screen.getByTestId(BACK));
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
      const watch = watchMotion(Math.floor((BAR_EXIT_MS - 32) / 16));

      // 단언: 첫 프레임은 끝났던 모양 그대로(끊김 없음) · 바 루트가 프레임마다 하나, 일정 칸은 같은 노드 · 움직였다 ·
      // 새 칸은 사라져 돌아오지 않고 시작 칸은 나타나 남는다 · 끝 모양은 그 탭이 분홍인 5칸 · onBack 은 그대로 1회.
      expect(watch.shapes[0]).toEqual(FINAL_IDS);
      expect(structureSteady(watch)).toBe(true);
      expect(moved(watch)).toBe(true);
      NEW_CELLS.forEach((id) => expect(staysOnceGone(watch, id)).toBe(true));
      START_CELLS.forEach((id) => expect(staysOnceSeen(watch, id)).toBe(true));
      expect(visibleIds()).toEqual(START5_IDS);
      expect(selectedStartHidden()).toEqual([TAB_ID[tab]]);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    }
  );

  it.each([false, true])(
    '퇴장이 시작된 뒤 OS 답(%s)이 늦게 와도 호스트의 퇴장은 그대로 이어진다 — 입장을 다시 시작하지 않고 끝 모양으로 점프하지도 않으며 onBack 은 1회다',
    async (lateAnswer) => {
      const os = deferOsAnswer();
      const handlers = renderLeaving({ departureTab: 'home' });
      expect(visibleIds()).toEqual(FINAL_IDS);

      fireEvent.press(screen.getByTestId(BACK));
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
      const early = watchMotion(4);
      await act(async () => {
        os.resolve(lateAnswer);
      });
      const watch = joinWatches(early, watchMotion(18));

      NEW_CELLS.forEach((id) => expect(staysOnceGone(watch, id)).toBe(true));
      START_CELLS.forEach((id) => expect(staysOnceSeen(watch, id)).toBe(true));
      expect(visibleIds()).toEqual(START5_IDS);
      expect(handlers.onBack).toHaveBeenCalledTimes(1);
    }
  );

  it('입장 도중(④ 진행 중)에 뒤로를 눌러도 즉시 1회 이동하고, 호스트가 퇴장을 끝까지 재생하며 입장의 끝 표식이 퇴장을 망치지 않는다', async () => {
    probe.setReduceMotion(false);
    const handlers = renderLeaving({ departureTab: 'home', entrance: true });
    await flushOsAnswer();
    const entering = watchMotion(Math.ceil((BAR_ENTER_DELAY_MS + 304) / 16));
    expect(screen.queryByTestId(BACK)).not.toBeNull();

    fireEvent.press(screen.getByTestId(BACK));
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    const leaving = watchMotion(Math.floor((BAR_EXIT_MS - 32) / 16));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(visibleIds()).toEqual(START5_IDS);
    expect(selectedStartHidden()).toEqual([START_HOME]);
    NEW_CELLS.forEach((id) => expect(staysOnceGone(leaving, id)).toBe(true));
    START_CELLS.forEach((id) => expect(staysOnceSeen(leaving, id)).toBe(true));
    const tail = leaving.shapes.filter(
      (_, i) => leaving.at[i] >= BAR_EXIT_MS - 80
    );
    expect(tail.length).toBeGreaterThanOrEqual(3);
    expect(allShapes({ shapes: tail }, START5_IDS)).toBe(true);
    // 입장 바 → 호스트로 넘어가는 순간에도 바가 둘이거나 0 인 프레임이 없다.
    expect(
      joinWatches(entering, leaving).rootCounts.every((n) => n === 1)
    ).toBe(true);
  });
});
