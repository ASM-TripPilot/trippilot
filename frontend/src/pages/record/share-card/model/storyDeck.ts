/**
 * TRIP-1667 · j06 스토리 덱 — "지금 몇 번째 장이고 남은 시간이 얼마인가"를 정하는 순수 리듀서.
 * 초심자용: 리듀서 = "지금 상태와 사건 하나를 받아 다음 상태를 돌려주는 순수 함수". 시계를 모르고, 시간은 `elapse(ms)`(ms 만큼 흘렀다)
 * 사건으로만 들어온다. 타이머를 거는 일은 `useStoryDeck` 이 한다. 바뀔 게 없으면 같은 참조를 돌려준다(React 가 다시 그리지 않게).
 */

/** 한 장이 머무는 시간(ms) — 내부 타이머 값일 뿐 화면에 글자로 나오지 않는다(INV-3). */
export const SLIDE_MS = 3400;
/** 탭 영역이 "길게 누름"으로 보는 시간(ms) — 이보다 길면 탭이 아니다. */
export const HOLD_DELAY_MS = 250;

export interface DeckState {
  index: number;
  total: number;
  /** 지금 장의 남은 시간(ms). */
  remainingMs: number;
  /** 손가락이 닿아 있다. */
  pressed: boolean;
  /** 자동으로 넘기는가 — 동작 줄이기 답이 `false` 일 때만 true. */
  autoplay: boolean;
}

export type DeckEvent =
  | { type: 'motion'; reduce: boolean | null }
  | { type: 'elapse'; ms: number }
  | { type: 'pressIn' }
  | { type: 'pressOut' }
  | { type: 'tap'; side: 'left' | 'right' };

export function initDeck(total: number, startAt: 'first' | 'last'): DeckState {
  return {
    index: startAt === 'last' ? Math.max(total - 1, 0) : 0,
    total,
    remainingMs: SLIDE_MS,
    pressed: false,
    autoplay: false,
  };
}

export const isRunning = (state: DeckState): boolean =>
  state.autoplay && !state.pressed && state.remainingMs > 0;

export function deckReducer(state: DeckState, event: DeckEvent): DeckState {
  switch (event.type) {
    case 'motion': {
      const autoplay = event.reduce === false;
      return autoplay === state.autoplay ? state : { ...state, autoplay };
    }
    case 'elapse': {
      if (!isRunning(state) || event.ms <= 0) return state;
      const remainingMs = state.remainingMs - event.ms;
      if (remainingMs > 0) return { ...state, remainingMs };
      // 한 번에 한 장만 — 아무리 많이 흘러도 몰아 넘기지 않는다. 마지막 장은 0 에서 멈춘다.
      return state.index < state.total - 1
        ? { ...state, index: state.index + 1, remainingMs: SLIDE_MS }
        : { ...state, remainingMs: 0 };
    }
    case 'pressIn':
      return state.pressed ? state : { ...state, pressed: true };
    case 'pressOut':
      return state.pressed ? { ...state, pressed: false } : state;
    case 'tap': {
      // 눌린 채로 와도(onPress 가 onPressOut 보다 먼저 올 수 있다)·자동 재생이 꺼져도 늘 동작한다.
      const index = state.index + (event.side === 'right' ? 1 : -1);
      return index < 0 || index >= state.total
        ? state
        : { ...state, index, remainingMs: SLIDE_MS };
    }
  }
}

/** 진행 바 구간 상태 — 지난 장 done · 지금 장 current · 다음 장 upcoming. */
export function segmentState(
  state: DeckState,
  i: number
): 'done' | 'current' | 'upcoming' {
  return i < state.index ? 'done' : i === state.index ? 'current' : 'upcoming';
}
