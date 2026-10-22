import { act, renderHook } from '@testing-library/react-native';

import { useScrollHide } from './useScrollHide';

/**
 * `useScrollHide` 단위 — "세로 스크롤 중이면 hidden" 을 돌려주는 공용 훅(TRIP-1555: 홈의 인라인 로직을
 * 탐색 랜딩·장소 탐색 d04 와 같이 쓰려고 승격). 이벤트가 올 때마다 타이머를 새로 걸어 **마지막 이벤트로부터**
 * settleMs(기본 250) 뒤에 다시 보인다(디바운스). 3동작: 준비=훅 렌더 → 실행=onScroll 호출·시간 진행 → 단언=hidden.
 *
 * 개념: 가짜 타이머(`jest.useFakeTimers`)는 시계를 우리가 돌린다 — `advanceTimersByTime(ms)` 로만 시간이 간다.
 * 상태 변경을 일으키는 호출은 `act` 로 감싼다.
 */

// 가짜 시계는 파일 최상위에서 켜고 끈다(02a ★6) — 안쪽 describe 에만 걸면 그 밖 케이스가 실시간으로 돈다.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const tick = (ms: number) => act(() => jest.advanceTimersByTime(ms));

describe('useScrollHide — 스크롤 중 숨김', () => {
  it('스크롤 전엔 숨기지 않는다(앵커)', () => {
    const { result } = renderHook(() => useScrollHide());

    expect(result.current.hidden).toBe(false);
  });

  it('onScroll 이 불리면 곧바로 숨긴다', () => {
    const { result } = renderHook(() => useScrollHide());

    act(() => result.current.onScroll());

    expect(result.current.hidden).toBe(true);
  });

  it('마지막 스크롤로부터 250ms 에 다시 보인다 — 249ms 는 아직 숨김(경계)', () => {
    const { result } = renderHook(() => useScrollHide());
    act(() => result.current.onScroll());

    tick(249);
    expect(result.current.hidden).toBe(true);

    tick(1);
    expect(result.current.hidden).toBe(false);
  });

  it('settleMs 를 넘기면 그 시간으로 재표시한다', () => {
    const { result } = renderHook(() => useScrollHide(false, 100));
    act(() => result.current.onScroll());

    tick(99);
    expect(result.current.hidden).toBe(true);

    tick(1);
    expect(result.current.hidden).toBe(false);
  });

  it('스크롤이 이어지면 숨김이 연장된다(디바운스) — 타이머는 하나만 산다', () => {
    const { result } = renderHook(() => useScrollHide());
    act(() => result.current.onScroll());
    tick(200);
    act(() => result.current.onScroll());

    expect(jest.getTimerCount()).toBe(1);

    // 첫 호출 기준 250ms 는 이미 지났지만(=450 중 250) 두 번째 호출 기준으로는 49ms 남았다.
    tick(249);
    expect(result.current.hidden).toBe(true);

    tick(1);
    expect(result.current.hidden).toBe(false);
  });

  it('연타(16ms 간격 10회)해도 재렌더가 폭주하지 않는다', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useScrollHide();
    });
    act(() => result.current.onScroll());
    const afterFirst = renders;

    for (let i = 0; i < 10; i += 1) {
      tick(16);
      act(() => result.current.onScroll());
    }

    // 같은 값 setState 는 React 가 한 번 더 그린 뒤 건너뛴다(실측) — "0" 이 아니라 "≤1" 이 올바른 계약이다.
    expect(renders - afterFirst).toBeLessThanOrEqual(1);
  });
});

describe('useScrollHide — keepVisible(담은 곳 메뉴 열림)', () => {
  it('keepVisible 이면 스크롤해도 숨기지 않는다', () => {
    const { result } = renderHook(() => useScrollHide(true));

    act(() => result.current.onScroll());

    expect(result.current.hidden).toBe(false);
  });

  it('keepVisible 은 파생이다 — 스크롤 도중 열면 즉시 보이고, 창이 안 끝났을 때 닫으면 다시 숨는다', () => {
    const { result, rerender } = renderHook(
      ({ keep }: { keep: boolean }) => useScrollHide(keep),
      { initialProps: { keep: false } }
    );
    act(() => result.current.onScroll());
    expect(result.current.hidden).toBe(true);

    rerender({ keep: true });
    expect(result.current.hidden).toBe(false);

    rerender({ keep: false });
    expect(result.current.hidden).toBe(true);

    tick(250);
    expect(result.current.hidden).toBe(false);
  });
});

describe('useScrollHide — 정리', () => {
  it('언마운트하면 대기 중인 타이머가 남지 않는다', () => {
    const { result, unmount } = renderHook(() => useScrollHide());
    act(() => result.current.onScroll());
    expect(jest.getTimerCount()).toBe(1);

    unmount();

    expect(jest.getTimerCount()).toBe(0);
  });
});
