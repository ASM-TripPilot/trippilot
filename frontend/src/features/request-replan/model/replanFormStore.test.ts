import { useReplanFormStore } from './replanFormStore';

/**
 * TRIP-439 · BR-U4-11·12 — i10 폼 상태 상자(zustand). RHF 미도입(D1 — 리포 RHF 사용 0,
 * stayRegisterForm zod+useState 선례). 칩 토글 + 텍스트 1개 + 시트 열림만 든다.
 *
 * 무엇을 보장하나:
 *  - 🔴 범위는 **단일 선택**(기본 `지금 이후`=PARTIAL_SLOTS, BR-U4-11) — setScope 는 누적이 아니라 대체.
 *  - 🔴 사유·방향은 **다중 토글**(BR-U4-12) — 있으면 제거, 없으면 append. 배열(Set 아님, 와이어 shape 동형).
 *  - 🔴 reset 이 전 필드를 초기값으로 되돌린다(통합 테스트가 싱글턴 격리에 의존, ★8).
 *
 * store 는 모듈 싱글턴이라 각 it 전에 reset 으로 격리한다.
 */

beforeEach(() => {
  useReplanFormStore.getState().reset();
});

describe('🔴 S1 · 초기값', () => {
  it('범위 기본은 지금 이후, 선택은 빈 배열, 자유텍스트 빈 문자열, 시트 닫힘', () => {
    const s = useReplanFormStore.getState();
    expect(s.scope).toBe('PARTIAL_SLOTS');
    expect(s.reasons).toEqual([]);
    expect(s.directives).toEqual([]);
    expect(s.freeText).toBe('');
    expect(s.sheetOpen).toBe(false);
  });
});

describe('🔴 S2 · 범위 단일선택 (BR-U4-11)', () => {
  it('setScope 는 이전 값을 대체한다(누적 아님)', () => {
    useReplanFormStore.getState().setScope('FULL_DAY');
    expect(useReplanFormStore.getState().scope).toBe('FULL_DAY');

    useReplanFormStore.getState().setScope('PARTIAL_SLOTS');
    expect(useReplanFormStore.getState().scope).toBe('PARTIAL_SLOTS');
  });
});

describe('🔴 S3 · 사유 다중 토글 (BR-U4-12)', () => {
  it('없으면 담고 있으면 뺀다(다중·idempotent)', () => {
    const { toggleReason } = useReplanFormStore.getState();

    toggleReason('WEATHER');
    expect(useReplanFormStore.getState().reasons).toEqual(['WEATHER']);

    toggleReason('SLOW_MOVE');
    expect(useReplanFormStore.getState().reasons).toEqual([
      'WEATHER',
      'SLOW_MOVE',
    ]);

    // 같은 key 를 다시 토글하면 그것만 빠진다(다른 선택은 유지).
    toggleReason('WEATHER');
    expect(useReplanFormStore.getState().reasons).toEqual(['SLOW_MOVE']);
  });
});

describe('🔴 S4 · 방향 다중 토글 (BR-U4-12)', () => {
  it('directives 도 같은 토글 규칙을 따른다', () => {
    const { toggleDirective } = useReplanFormStore.getState();

    toggleDirective('RELAX');
    expect(useReplanFormStore.getState().directives).toEqual(['RELAX']);

    toggleDirective('RELAX');
    expect(useReplanFormStore.getState().directives).toEqual([]);
  });
});

describe('🔴 S5 · freeText · reset', () => {
  it('setFreeText 가 값을 담고, reset 이 전부 초기값으로 되돌린다', () => {
    const st = useReplanFormStore.getState();
    st.setScope('FULL_DAY');
    st.toggleReason('WEATHER');
    st.setFreeText('저녁은 광안리');
    st.setSheetOpen(true);

    expect(useReplanFormStore.getState().freeText).toBe('저녁은 광안리');

    useReplanFormStore.getState().reset();

    const after = useReplanFormStore.getState();
    expect(after.scope).toBe('PARTIAL_SLOTS');
    expect(after.reasons).toEqual([]);
    expect(after.directives).toEqual([]);
    expect(after.freeText).toBe('');
    expect(after.sheetOpen).toBe(false);
  });
});
