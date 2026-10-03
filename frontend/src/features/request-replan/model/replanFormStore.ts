import { create, type StateCreator } from 'zustand';

import type { StartReplanRequestScope } from '@/shared/api/generated/schemas/startReplanRequestScope';

import { DEFAULT_REPLAN_SCOPE } from './replanScope';

/**
 * TRIP-439 · BR-U4-11·12 · D1 — i10 폼 상태 상자(Zustand).
 *
 * RHF 미도입(리포 RHF 프로덕션 사용 0, `stayRegisterForm` 의 zod+useState 선례). 이 폼은 칩
 * 토글 + 텍스트 1개 + 시트 열림뿐이라 스토어 하나로 충분하다.
 *
 * 무엇을 보장하나:
 *  - 범위는 **단일 선택**(기본 지금 이후=`PARTIAL_SLOTS`) — `setScope` 는 누적이 아니라 대체.
 *  - 사유·방향은 **다중 토글** — 있으면 제거, 없으면 뒤에 append(배열, Set 아님 — 와이어 shape 동형).
 *  - `reset` 이 전 필드를 초기값으로 되돌린다(통합 테스트가 싱글턴 격리에 의존).
 *
 * 개념: **Zustand 스토어** — 컴포넌트 밖에 사는 전역 상태 상자. `useReplanFormStore(셀렉터)` 로
 * 값을 구독하고, `useReplanFormStore.getState()` 로 렌더 밖(이벤트 핸들러)에서 최신값을 읽는다.
 */

export interface ReplanFormState {
  scope: StartReplanRequestScope;
  reasons: string[];
  directives: string[];
  freeText: string;
  sheetOpen: boolean;
  setScope: (scope: StartReplanRequestScope) => void;
  toggleReason: (key: string) => void;
  toggleDirective: (key: string) => void;
  setFreeText: (text: string) => void;
  setSheetOpen: (open: boolean) => void;
  reset: () => void;
}

/** 있으면 빼고 없으면 뒤에 붙인다(비파괴 — 매번 새 배열). */
function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

const createReplanForm: StateCreator<ReplanFormState> = (set) => ({
  scope: DEFAULT_REPLAN_SCOPE,
  reasons: [],
  directives: [],
  freeText: '',
  sheetOpen: false,
  setScope: (scope) => set({ scope }),
  toggleReason: (key) => set((s) => ({ reasons: toggle(s.reasons, key) })),
  toggleDirective: (key) =>
    set((s) => ({ directives: toggle(s.directives, key) })),
  setFreeText: (freeText) => set({ freeText }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  reset: () =>
    set({
      scope: DEFAULT_REPLAN_SCOPE,
      reasons: [],
      directives: [],
      freeText: '',
      sheetOpen: false,
    }),
});

export const useReplanFormStore = create(createReplanForm);
