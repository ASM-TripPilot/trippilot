import { useState } from 'react';

/**
 * 연타 관통 공용 가드 — 시간 창 + 화면 전환 상태 + 진행 중 잠금(TRIP-1013 → TRIP-1827).
 * - **시간 창**: 누름·응답 뒤 잠깐 다른 누름을 무시한다. 화면을 건너가야 하므로(첫 탭 화면 → 바뀐 화면의 다른 버튼)
 *   감싼 함수마다가 아니라 모듈에 하나다.
 * - **화면 전환 상태**: 오는 화면의 `transitionStart`~`transitionEnd`(Stack `screenListeners`) 동안도 무시하고, 끝나면 창을
 *   연다 — 시간 창만으로는 전환이 400ms 를 넘길 때 뚫린다. 웹은 이벤트가 없어 창만 남는다.
 * - **진행 중 잠금**(`usePressLock`): 요청이 끝날 때까지 쥔다. 언제 푸는지는 호출부 몫이다.
 * 타이머로 닫지 않고 `Date.now()` 비교로 판정한다(페이지 테스트가 `Date.now`를 멈춘다).
 */

const WINDOW_MS = 400;
// 끝 이벤트가 안 오는 길(전환 중 unmount 등)의 안전장치. 짧으면 JS 가 막힌 사이 [시작, 탭, 끝] 줄의 탭이 "상한 지남"으로 뚫린다.
const TRANSITION_CAP_MS = 2000;

/** 위저드 시트 [적용] — 닫히는 시트 자리의 [다음]에 떨어지는 둘째 탭(0.6초 + JS 지연)까지 덮는다(QA L1). */
export const SHEET_APPLY_WINDOW_MS = 800;

let openedAt = -Infinity;
let windowLen = WINDOW_MS;
let transitionAt: number | null = null;
// 전환을 시작한 화면의 route key — 그 화면이 끝 이벤트 없이 지워지는 길(W3)을 알아보려고 쥔다.
let transitionTarget: string | undefined;

/** 콜백을 감싼다. 창이 열려 있거나 화면 전환 중이면 무시하고, 아니면 창을 열고 원래 콜백을 부른다. */
export function guardPress<Args extends unknown[]>(
  handler: (...args: Args) => void,
  windowMs: number = WINDOW_MS
): (...args: Args) => void {
  return (...args) => {
    // 무시된 누름은 창을 늘리지 않는다 — 연타를 계속해도 창이 끝나면 누를 수 있어야 한다.
    if (blocked()) return;
    openPressGuardWindow(windowMs);
    handler(...args);
  };
}

/**
 * 창을 **따르기만** 한다 — 창이 열려 있거나 전환 중이면 무시하고, 누름이 창을 열지는 않는다. 자기 연타는 다른 잠금이 막는 버튼용이다
 * (편집기 저장 CTA 의 `inFlightLock` — 저장이 창을 열면 실패 뒤 곧바로 다시 저장하는 누름까지 삼킨다, TRIP-1793 D4).
 */
export function respectPressGuard<Args extends unknown[]>(
  handler: (...args: Args) => void
): (...args: Args) => void {
  return (...args) => {
    if (blocked()) return;
    handler(...args);
  };
}

// 음수 경과(기기 시계가 뒤로 감)는 창 밖으로 본다 — 아니면 뒤로 간 만큼 먹통이 된다(5-b 경고-1).
function windowOpen(): boolean {
  const elapsed = Date.now() - openedAt;
  return elapsed >= 0 && elapsed < windowLen;
}

function transiting(): boolean {
  if (transitionAt === null) return false;
  const elapsed = Date.now() - transitionAt;
  return elapsed >= 0 && elapsed < TRANSITION_CAP_MS;
}

function blocked(): boolean {
  return windowOpen() || transiting();
}

/** 누름 없이 창을 연다 — 서버 응답으로 표면이 바뀌는 순간에 부른다(01b Q2). 남은 창이 더 길면 줄이지 않는다. */
export function openPressGuardWindow(ms: number = WINDOW_MS): void {
  const now = Date.now();
  if (windowOpen() && openedAt + windowLen - now >= ms) return;
  openedAt = now;
  windowLen = ms;
}

/** 테스트 전용 — 창과 전환 상태를 지운다(=충분히 시간이 흐른 것과 같다). */
export function resetPressGuard(): void {
  openedAt = -Infinity;
  transitionAt = null;
  transitionTarget = undefined;
}

export interface PressLock {
  /** 쥐고 있거나 화면 전환 중이면 false(`transition:'ignore'` 면 전환은 안 본다 — 누름이 아닌 흐름 안·effect 호출용). 창은 보지 않는다. */
  acquire(opts?: { transition?: 'ignore' }): boolean;
  release(): void;
  /** 핸들러 안에서만 읽는다 — 렌더 중에 읽으면 그 컴포넌트의 컴파일러 최적화가 꺼진다. */
  isHeld(): boolean;
}

export function createPressLock(): PressLock {
  let held = false;
  return {
    acquire(opts) {
      // 창은 일부러 안 본다: guardPress 가 핸들러 부르기 전에 연 창에 자기가 걸려 모든 누름이 삼켜진다.
      if (held || (opts?.transition !== 'ignore' && transiting())) return false;
      held = true;
      return true;
    },
    release() {
      held = false;
    },
    isHeld() {
      return held;
    },
  };
}

/** 마운트마다 잠금 하나 — 리렌더해도 같은 객체다. */
export function usePressLock(): PressLock {
  return useState(createPressLock)[0];
}

/**
 * Stack 의 `screenListeners` 에 그대로 넘긴다. 구조 타입이라 react-navigation 을 import 하지 않는다(node 버킷이 죽는다).
 * `closing:false`(오는 화면)만 믿는다 — JS back·replace 에선 떠나는 화면의 끝 이벤트가 안 온다.
 */
export const PRESS_GUARD_SCREEN_LISTENERS = {
  // ponytail: 값이 하나라 안쪽 스택의 끝 이벤트가 루트 전환 표시까지 일찍 지운다. 그 뒤는 400ms 창이 덮고 루트 끝이 창을 다시 연다. route 별 Set 은 전환 중 unmount 때 2초 먹통이 되어 버렸다.
  transitionStart(e: { target?: string; data: { closing: boolean } }): void {
    if (e.data.closing) return;
    transitionAt = Date.now();
    transitionTarget = e.target;
  },
  transitionEnd(e: { data: { closing: boolean } }): void {
    if (e.data.closing) return;
    endTransition();
  },
  /** 스와이프 뒤로 취소 — `transitionEnd` 가 안 오는 길의 유일한 신호. 그 화면에 머무니 창은 안 연다. */
  gestureCancel(): void {
    transitionAt = null;
    transitionTarget = undefined;
  },
  /**
   * 오는 중인 화면이 끝 이벤트 없이 지워지는 길(등장 중 닫힌 `transparentModal` — 뒤 화면은 will/did 를 못 받는다).
   * 끝과 같게 처리한다. 듣기만 한다 — `preventDefault` 를 부르지 않으니 다른 화면의 `usePreventRemove` 와 겹치지 않는다.
   */
  beforeRemove(e: { target?: string }): void {
    if (e.target !== undefined && e.target === transitionTarget)
      endTransition();
  },
};

function endTransition(): void {
  transitionAt = null;
  transitionTarget = undefined;
  openPressGuardWindow();
}
