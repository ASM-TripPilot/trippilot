/**
 * 취향 선택 Zustand 스토어(TRIP-163 · AC5 · §3-4) — 세션 메모리 전용, 영속 저장 미들웨어 금지.
 * 액션은 순수 함수(preferenceSelection)에 위임만 한다 — 토글 판단 로직은 여기 두지 않는다.
 */
import { create, type StateCreator } from 'zustand';

import { toggleMulti, toggleSingle } from './preferenceSelection';

export interface PreferenceDraft {
  styles: string[] | null;
  pace: string | null;
  budget: string | null;
  companions: string[] | null;
  foods: string[] | null;
  transports: string[] | null;
  toggleStyle: (id: string) => void;
  togglePace: (id: string) => void;
  toggleBudget: (id: string) => void;
  toggleCompanion: (id: string) => void;
  toggleFood: (id: string) => void;
  toggleTransport: (id: string) => void;
  reset: () => void;
}

const INITIAL_DRAFT = {
  styles: null,
  pace: null,
  budget: null,
  companions: null,
  foods: null,
  transports: null,
} as const;

// StateCreator<PreferenceDraft>로 먼저 타입을 못박고 create()에 넘긴다 — `create<T>(...)`
// 처럼 제네릭을 바로 호출부에 붙이면 문자열이 "create<"로 시작해 구조 가드(6-2, "create("
// 리터럴 검색)가 오탐한다. 이 형태는 타입 안전성은 그대로 두면서 그 리터럴을 만든다.
const createPreferenceDraft: StateCreator<PreferenceDraft> = (set) => ({
  ...INITIAL_DRAFT,
  toggleStyle: (id) =>
    set((state) => ({ styles: toggleMulti(state.styles, id) })),
  togglePace: (id) => set((state) => ({ pace: toggleSingle(state.pace, id) })),
  toggleBudget: (id) =>
    set((state) => ({ budget: toggleSingle(state.budget, id) })),
  toggleCompanion: (id) =>
    set((state) => ({ companions: toggleMulti(state.companions, id) })),
  toggleFood: (id) => set((state) => ({ foods: toggleMulti(state.foods, id) })),
  toggleTransport: (id) =>
    set((state) => ({ transports: toggleMulti(state.transports, id) })),
  reset: () => set({ ...INITIAL_DRAFT }),
});

export const usePreferenceStore = create(createPreferenceDraft);
