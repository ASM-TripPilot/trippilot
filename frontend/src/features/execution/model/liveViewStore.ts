import { create, type StateCreator } from 'zustand';

/**
 * TRIP-395 · liveViewStore — 여행 중 화면의 UI 상태 상자(frontend-components.md §3).
 *
 * 서버가 모르는 **UI 상태만** 둔다(frontend/README.md): 일정｜지도 세그먼트 · 계획｜실제 토글 ·
 * 시트 열림. 서버 데이터(일정)는 react-query가 갖고 여기 두지 않는다. `persist` 없음.
 *
 * `create(변수)` 형태로 호출하는 이유는 `tripWizardStore`·`preferenceStore`와 같다 — 스토어
 * 구조가드 정규식 `/\bcreate\(/`을 피하려 타입을 `StateCreator` 변수로 먼저 확정한다.
 */

export type LiveSegment = 'itinerary' | 'map'; // 일정 | 지도
export type LivePlanToggle = 'plan' | 'actual'; // 계획 | 실제

export interface LiveViewState {
  segment: LiveSegment;
  toggle: LivePlanToggle;
  sheetOpen: boolean;
  setSegment: (segment: LiveSegment) => void;
  setToggle: (toggle: LivePlanToggle) => void;
  setSheetOpen: (sheetOpen: boolean) => void;
  reset: () => void;
}

const INITIAL: Pick<LiveViewState, 'segment' | 'toggle' | 'sheetOpen'> = {
  segment: 'itinerary',
  toggle: 'plan',
  sheetOpen: false,
};

const createLiveViewState: StateCreator<LiveViewState> = (set) => ({
  ...INITIAL,
  setSegment: (segment) => set({ segment }),
  setToggle: (toggle) => set({ toggle }),
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  reset: () => set({ ...INITIAL }),
});

export const useLiveViewStore = create(createLiveViewState);
