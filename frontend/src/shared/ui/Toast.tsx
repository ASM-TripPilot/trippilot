import type { ReactElement } from 'react';
import { useEffect, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';

import { ToastSuccessGlyph } from './ToastGlyphs';

/**
 * 공용 성공 토스트 — TRIP-990. 화면은 `showToast` 로 요청만 하고, 그리기는 루트(`app/_layout`)에
 * 한 번 둔 `ToastHost` 가 맡는다. 그래서 요청한 화면이 떠나도(back) 토스트는 남는다.
 *
 * 상태는 모듈 스코프 값 + React 내장 `useSyncExternalStore` 구독이다(라이브러리 0). 한 번에 하나만
 * 보이고, 새로 띄우면 교체하며 표시 시간을 새로 센다. 형상은 Figma DS NoticeBar tone=success
 * (액션 "보기" 슬롯은 소비처가 없어 두지 않는다). 하단 위치 220 은 FAB 스택 윗변(바닥 208, 홈·탐색 랜딩·
 * 장소 탐색·숙소 검색 공통) 위 12 다(TRIP-1286) — 실제 겹침은 6-b 실기 몫이다.
 *
 * TRIP-1321(G-U8-10) — 스택 위에 ✦ 도우미 FAB 를 더 얹은 화면은 `useRaisedToastBottom` 으로 바닥을 올린다.
 * 붙어 있는 화면들의 값 중 가장 높은 것을 쓰고, 모두 떨어지면 220 으로 돌아간다. ⚠️ 탭 화면은 다른 탭으로
 * 가도 마운트가 유지되므로 그 동안에도 올라간 채다 — 겹침이 아니라 "필요보다 높게 뜬다" 쪽으로 틀린다.
 */

export const TOAST_VISIBLE_MS = 2500;

interface Toast {
  message: string;
  testID: string;
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Toast | null {
  return current;
}

export function showToast(toast: Toast): void {
  clearTimer();
  current = toast;
  timer = setTimeout(hideToast, TOAST_VISIBLE_MS);
  emit();
}

/** 즉시 지우고 대기 중인 자동 숨김 타이머도 없앤다. */
export function hideToast(): void {
  clearTimer();
  current = null;
  emit();
}

// 화면별 바닥 올림 — 등록 토큰 → 바닥(px). 가장 높은 값이 이긴다.
const raises = new Map<symbol, number>();
const raiseListeners = new Set<() => void>();

function subscribeRaise(listener: () => void): () => void {
  raiseListeners.add(listener);
  return () => raiseListeners.delete(listener);
}

function raisedBottom(): number | null {
  return raises.size === 0 ? null : Math.max(...raises.values());
}

/** 이 훅을 부른 컴포넌트가 붙어 있는 동안 토스트 바닥을 `bottom`(px) 이상으로 올린다. undefined 면 아무것도 안 한다. */
export function useRaisedToastBottom(bottom: number | undefined): void {
  useEffect(() => {
    if (bottom === undefined) return undefined;
    const token = Symbol('toast-raise');
    raises.set(token, bottom);
    raiseListeners.forEach((listener) => listener());
    return () => {
      raises.delete(token);
      raiseListeners.forEach((listener) => listener());
    };
  }, [bottom]);
}

export function ToastHost(): ReactElement | null {
  const toast = useSyncExternalStore(subscribe, snapshot);
  const raised = useSyncExternalStore(subscribeRaise, raisedBottom);
  if (toast === null) return null;

  return (
    <View
      testID={toast.testID}
      pointerEvents="none"
      style={raised === null ? undefined : { bottom: raised }}
      className={`absolute ${raised === null ? 'bottom-[220px] ' : ''}left-lg right-lg min-h-[52px] flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-lg py-md`}
    >
      <ToastSuccessGlyph size={20} />
      <Text className="flex-1 font-noto text-card-title text-ink">
        {toast.message}
      </Text>
    </View>
  );
}
