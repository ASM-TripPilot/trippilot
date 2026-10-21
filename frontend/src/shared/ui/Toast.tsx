import type { ReactElement } from 'react';
import { useContext, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import * as toastBottom from './toastBottom';
import { ToastSuccessGlyph } from './ToastGlyphs';

/**
 * 공용 성공 토스트 — TRIP-990. 화면은 `showToast` 로 요청만 하고, 그리기는 루트(`app/_layout`)에
 * 한 번 둔 `ToastHost` 가 맡는다. 그래서 요청한 화면이 떠나도(back) 토스트는 남는다.
 *
 * 상태는 모듈 스코프 값 + React 내장 `useSyncExternalStore` 구독이다(라이브러리 0). 한 번에 하나만
 * 보이고, 새로 띄우면 교체하며 표시 시간을 새로 센다. 형상은 Figma DS NoticeBar tone=success
 * (액션 "보기" 슬롯은 소비처가 없어 두지 않는다). 하단 위치는 고정값이 아니라 화면들이 신고한 막힘 높이(CTA 바·탭 바·
 * FAB 스택·여행 중 바 — `toastBottom` 레지스트리)의 최댓값 위 12, 신고가 없으면 안전영역 위 16 이다(TRIP-1559).
 * 실제 겹침은 6-b 실기 몫이다.
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

export function ToastHost(): ReactElement | null {
  const toast = useSyncExternalStore(subscribe, snapshot);
  const blockers = useSyncExternalStore(
    toastBottom.subscribeToastBottoms,
    toastBottom.getToastBottoms
  );
  // Provider 없는 렌더(jest)에서도 그려지게 useSafeAreaInsets 대신 컨텍스트를 null 허용으로 읽는다.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  if (toast === null) return null;

  return (
    <View
      testID={toast.testID}
      pointerEvents="none"
      style={{ bottom: toastBottom.resolveToastBottom(blockers, bottomInset) }}
      className="absolute left-lg right-lg min-h-[52px] flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-lg py-md"
    >
      <ToastSuccessGlyph size={20} />
      <Text className="flex-1 font-noto text-card-title text-ink">
        {toast.message}
      </Text>
    </View>
  );
}
