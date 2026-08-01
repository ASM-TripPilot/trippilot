import { usePreferenceStore } from './preferenceStore';

/**
 * AC5 · AC4 · US-ONB-14 — Zustand 취향 스토어(preferenceStore).
 *
 * 무엇을 보장하나: 스토어가 세션 메모리 전용으로 6축(스타일·페이스·예산·동행·음식·이동)을
 * 들고, reset() 직후에는 항상 6축 전부 null이며, 액션이 model(preferenceSelection)의
 * 토글 규칙에 위임된 대로 상태를 바꾼다.
 *
 * *(개념)* Zustand 스토어: React 컴포넌트 밖 모듈 하나에 상태를 두는 라이브러리(§1 개념
 * 박스). `usePreferenceStore.getState()`로 렌더 없이 현재 상태를 읽고, 반환된 객체 안의
 * 액션 함수를 직접 호출해 상태를 바꾼다. 모듈 싱글턴이라 테스트끼리 상태가 새므로 매
 * 테스트 전 reset()이 필수다(§7-6).
 *
 * 3동작: 준비(reset·선택) → 실행(액션 호출/getState) → 단언(상태 값).
 */

beforeEach(() => {
  // 준비(공통) — 모듈 싱글턴이 이전 테스트의 선택값을 들고 있지 않도록 매번 되돌린다.
  usePreferenceStore.getState().reset();
});

describe('초기 상태 (AC5 · AC4 · US-ONB-14 · 2-1)', () => {
  it('reset() 직후에는 6축 전부 null이다(어느 축도 []로 시작하지 않는다)', () => {
    // 실행 — 현재 상태를 읽는다.
    const state = usePreferenceStore.getState();

    // 단언 — 복수 축(styles·companions·foods·transports)과 단일 축(pace·budget) 전부 null.
    expect(state.styles).toBeNull();
    expect(state.pace).toBeNull();
    expect(state.budget).toBeNull();
    expect(state.companions).toBeNull();
    expect(state.foods).toBeNull();
    expect(state.transports).toBeNull();
  });
});

describe('액션 위임 (AC5 · 2-2)', () => {
  it('toggleStyle은 복수로 쌓이고 togglePace는 마지막 값으로 교체된다', () => {
    // 실행 — 스타일(복수) 2회, 페이스(단일) 2회 토글.
    usePreferenceStore.getState().toggleStyle('rest');
    usePreferenceStore.getState().toggleStyle('gourmet');
    usePreferenceStore.getState().togglePace('balanced');
    usePreferenceStore.getState().togglePace('packed');

    // 단언 — styles는 toggleMulti 규칙대로 둘 다 남고, pace는 toggleSingle 규칙대로
    // 마지막 값만 남는다(getState로 확인).
    const state = usePreferenceStore.getState();
    expect(state.styles).toEqual(expect.arrayContaining(['rest', 'gourmet']));
    expect(state.styles).toHaveLength(2);
    expect(state.pace).toBe('packed');
  });
});

describe('reset (AC5 · 2-3)', () => {
  it('여러 축을 선택한 뒤 reset()하면 6축 전부 null로 돌아간다', () => {
    // 준비 — 여러 축에 값을 채운다.
    usePreferenceStore.getState().toggleStyle('rest');
    usePreferenceStore.getState().toggleBudget('mid');
    usePreferenceStore.getState().toggleCompanion('solo');
    usePreferenceStore.getState().toggleFood('hotspot');
    usePreferenceStore.getState().toggleTransport('walk');

    // 실행 — reset.
    usePreferenceStore.getState().reset();

    // 단언 — 6축 전부 null.
    const state = usePreferenceStore.getState();
    expect(state.styles).toBeNull();
    expect(state.pace).toBeNull();
    expect(state.budget).toBeNull();
    expect(state.companions).toBeNull();
    expect(state.foods).toBeNull();
    expect(state.transports).toBeNull();
  });
});
