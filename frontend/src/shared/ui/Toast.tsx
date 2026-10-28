import type { ReactElement } from 'react';
import { useContext, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { AlertCircleGlyph } from './glyphs';
import * as toastBottom from './toastBottom';
import { ToastSuccessGlyph } from './ToastGlyphs';

/**
 * 공용 성공 토스트 — TRIP-990. 화면은 `showToast` 로 요청만 하고, 그리기는 루트(`app/_layout`)에
 * 한 번 둔 `ToastHost` 가 맡는다. 그래서 요청한 화면이 떠나도(back) 토스트는 남는다.
 *
 * 상태는 모듈 스코프 값 + React 내장 `useSyncExternalStore` 구독이다(라이브러리 0). 한 번에 하나만
 * 보이고, 새로 띄우면 교체하며 표시 시간을 새로 센다. 형상은 Figma DS NoticeBar(`4464:1599`) — `tone` 이 success(체크, 기본)/
 * error(오류 원), `action` 이 있으면 오른쪽에 텍스트 버튼(TRIP-1618 — 생성 완료 토스트의 "보기"). 하단 위치는 고정값이 아니라
 * 화면들이 신고한 막힘 높이(CTA 바·탭 바·FAB 스택·여행 중 바 — `toastBottom` 레지스트리)의 최댓값 위 12, 신고가 없으면
 * 안전영역 위 16 이다(TRIP-1559). 실제 겹침은 6-b 실기 몫이다.
 *
 * 터치: 액션 없는 토스트는 루트가 `pointerEvents="none"`(터치가 아래 화면으로 통과)이다. 액션이 있으면 `box-none` — 루트는
 * 통과시키고 버튼만 터치를 받는다. 실제 통과·눌림은 jest 가 못 본다(6-b).
 */

export const TOAST_VISIBLE_MS = 2500;
/** 액션 토스트는 읽고 누를 시간이 필요해 더 오래 띄운다. 정본 없는 발명값 — 6-b 에서 조정. */
export const TOAST_ACTION_VISIBLE_MS = 6000;

interface Toast {
  message: string;
  testID: string;
  /** 생략하면 success. */
  tone?: 'success' | 'error';
  /** 버튼 testID 는 `${testID}-action`. 누르면 토스트가 먼저 사라지고 `onPress` 가 1번 불린다. */
  action?: { label: string; onPress: () => void };
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
  timer = setTimeout(
    hideToast,
    toast.action ? TOAST_ACTION_VISIBLE_MS : TOAST_VISIBLE_MS
  );
  emit();
}

/** 즉시 지우고 대기 중인 자동 숨김 타이머도 없앤다. */
export function hideToast(): void {
  clearTimer();
  current = null;
  emit();
}

/** 아직 이 토스트가 떠 있을 때만 — 같은 렌더 안의 두 번째 누름은 이미 사라진 뒤라 걸러진다. */
function pressAction(toast: Toast): void {
  if (current !== toast || !toast.action) return;
  const { onPress } = toast.action;
  hideToast();
  onPress();
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
      pointerEvents={toast.action ? 'box-none' : 'none'}
      style={{ bottom: toastBottom.resolveToastBottom(blockers, bottomInset) }}
      className="absolute left-lg right-lg min-h-[52px] flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-lg py-md"
    >
      {toast.tone === 'error' ? (
        <AlertCircleGlyph
          size={20}
          color="primary"
          strokeWidth={1.91667}
          testID={`${toast.testID}-error-icon`}
        />
      ) : (
        <ToastSuccessGlyph size={20} testID={`${toast.testID}-success-icon`} />
      )}
      <Text className="flex-1 font-noto text-card-title text-ink">
        {toast.message}
      </Text>
      {toast.action ? (
        <Pressable
          testID={`${toast.testID}-action`}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => pressAction(toast)}
        >
          <Text className="font-noto-bold text-card-title font-bold text-primary">
            {toast.action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
