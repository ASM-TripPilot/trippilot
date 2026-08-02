/**
 * 취향 6축 세션 메모리 Zustand 스토어 (AC5 · AC4 · US-ONB-14).
 *
 * 6축 = 복수(styles·companions·foods·transports) + 단일(pace·budget). 1/2 화면은 이 중
 * styles·pace만 쓰지만, 2/2 화면(범위 밖 `PrefStep2Page`)이 나머지 4축을 셀렉터로 꺼내
 * 쓰므로 여기서 줄이면 안 된다. 토글 판단은 여기서 다시 쓰지 않고 전부
 * `preferenceSelection`의 `toggleMulti`/`toggleSingle`에 위임한다.
 *
 * 세션 메모리 전용 — 기기 로컬 저장소에 값을 남기는 저장 미들웨어·비동기 저장소·보안
 * 저장소 모듈은 쓰지 않는다(`frontend/README.md`: Zustand는 서버가 모르는 UI 상태만 둔다).
 * 관련 구조 가드(`onboardingPrefStructure.test.ts` 하나뿐 — `fsdStructure.test.ts`는 이
 * 파일의 저장 계층·`create(` 리터럴을 검사하지 않는다)가 그런 저장 계층을 가리키는
 * 문자열 자체를 이 파일 소스에서 금지한다 — 이 주석에도 그대로 옮겨 적으면 가드가
 * 스스로 걸린다.
 *
 * `create(` 리터럴 우회: 그 가드는 정규식 `/\bcreate\(/`로 소스를 스캔한다.
 * `create<PreferenceDraft>((set) => …)`처럼 제네릭을 호출부에 바로 붙이면 소스 문자열이
 * `create<`로 시작해 이 정규식이 매치하지 않는다(가드 오탐). 그래서 스토어 생성 함수를
 * `StateCreator<PreferenceDraft>` 타입의 변수에 먼저 담아 타입을 확정한 뒤, `create(그변수)`
 * 형태로 호출해 소스에 `create(` 리터럴이 그대로 남게 한다.
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
  // 로그아웃 등에서도 쓸 수 있는 정당한 프로덕션 액션 — 테스트 전용 뒷문이 아니다.
  reset: () => set(INITIAL_DRAFT),
});

export const usePreferenceStore = create(createPreferenceDraft);
