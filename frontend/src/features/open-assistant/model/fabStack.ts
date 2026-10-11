/**
 * ✦ AI 도우미 FAB 스택 배치 계산(TRIP-1320 · BR-U8-50~52 · PBT-U8-F1).
 *
 * 기존 FAB 은 56×56, 단 간격 12 로 쌓인다. 탭 화면(홈·숙소 검색)의 첫 단 바닥은 84(탭바 알약 위 —
 * `HomeScreen.tsx` CreateTripFab 머리 주석) 이라 2단 스택 윗변이 208 이다. ✦ 는 그 위 12 에 얹고(220),
 * 토스트는 ✦ 윗변 위 12 로 올린다(288, G-U8-10).
 *
 * ⚠️ 실제 겹침은 jest 가 못 본다(Toast.tsx 머리 주석과 같은 처지) — 숫자만 여기서 굳히고 화면은 6-b 실기.
 */

export const ASSISTANT_FAB_SIZE = 56;
export const FAB_STACK_GAP = 12;
/** 탭 화면 FAB 스택 첫 단 바닥(px). */
export const TAB_FAB_BASE = 84;

export interface FabStack {
  /** 스택 첫 단의 바닥(px) — 탭 화면은 84, 탭 밖 화면은 그 화면의 하단 여백. */
  base: number;
  /** ✦ 아래에 이미 있는 FAB 단 수(0~2). */
  count: number;
}

/** 기존 스택의 윗변(px). 단이 없으면 바닥 그대로. */
export function stackTop({ base, count }: FabStack): number {
  if (count <= 0) return base;
  return base + count * ASSISTANT_FAB_SIZE + (count - 1) * FAB_STACK_GAP;
}

/** ✦ 의 바닥(px) — 기존 스택 윗변 + 12, 스택이 없으면 바닥 그대로. */
export function assistantFabBottom(stack: FabStack): number {
  return stack.count <= 0 ? stack.base : stackTop(stack) + FAB_STACK_GAP;
}

/** ✦ 가 있는 화면의 토스트 바닥(px) — ✦ 윗변 + 12. */
export function toastBottomWith(stack: FabStack): number {
  return assistantFabBottom(stack) + ASSISTANT_FAB_SIZE + FAB_STACK_GAP;
}

/** 탭 화면 2단 스택(홈 · 숙소 검색) — FD §5 표의 값. */
export const TAB_TWO_STACK: FabStack = { base: TAB_FAB_BASE, count: 2 };
