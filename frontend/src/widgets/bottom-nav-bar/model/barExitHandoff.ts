import { useSyncExternalStore } from 'react';

import type { MorphNavBarProps } from '../ui/MorphNavBar';
import { BAR_EXIT_MS } from './barMorph';

/**
 * TRIP-1831 · 퇴장 인계 저장소 — 뒤로를 누른 바가 "나 지금 이 모양으로 나가는 중" 을 적어 두면, 탭 레이아웃의 호스트(`BarExitHost`)가
 * 그것을 읽어 같은 바를 끝까지 재생한다. 누른 화면은 같은 순간에 스택에서 빠지므로(바도 함께 사라진다) 모션을 이어 줄 자리가 화면 밖에 필요하다.
 * 값은 하나(번호 + 바 props)이고, 호스트가 없어도 `BAR_EXIT_MS` 뒤 스스로 비운다(INV-4 — 값이 영영 남지 않는다).
 * `Toast.tsx` 와 같은 `useSyncExternalStore` 모듈 싱글턴이다.
 */

export type BarExitProps = Omit<MorphNavBarProps, 'onBack' | 'entrance'>;
type BarExit = { id: number; props: BarExitProps };

let current: BarExit | null = null;
let nextId = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => current;

/** 퇴장을 알린다 — 연속 호출이면 새 번호(호스트가 바를 새로 세운다)이고 앞 타이머는 취소한다. */
export function beginBarExit(props: BarExitProps): void {
  clearTimeout(timer);
  nextId += 1;
  current = { id: nextId, props };
  timer = setTimeout(() => {
    timer = undefined;
    current = null;
    emit();
  }, BAR_EXIT_MS);
  emit();
}

export function useBarExit(): BarExit | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 테스트 전용 — 값과 대기 타이머를 함께 비우고 구독자에게 알린다. */
export function resetBarExitForTests(): void {
  clearTimeout(timer);
  timer = undefined;
  current = null;
  emit();
}
