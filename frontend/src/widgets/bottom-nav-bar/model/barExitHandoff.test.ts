import { act, renderHook } from '@testing-library/react-native';

import { BAR_EXIT_MS } from './barMorph';
import {
  beginBarExit,
  resetBarExitForTests,
  useBarExit,
  type BarExitProps,
} from './barExitHandoff';

/**
 * TRIP-1831 · 퇴장 인계 저장소 — 뒤로를 누른 바가 "나 지금 이 모양으로 나가는 중" 을 적어 두면, 탭 레이아웃의 호스트가 그것을 읽어 같은 바를 끝까지 재생한다.
 * 저장소는 값 하나(번호 + 바 props)와 스스로 비우는 타이머(`BAR_EXIT_MS`)만 쥔다 — 호스트가 없어도·구독자가 없어도 값이 영영 남지 않는다(INV-4).
 * 3동작: 준비(가짜 시계 + 구독하는 훅) → 실행(`beginBarExit`·시계 전진) → 단언(훅이 읽는 값).
 */

// 모듈 싱글턴이라 리셋은 파일 최상위(describe 밖)에 둔다 — 앞 테스트의 값·타이머가 새면 "아직 없다" 단언이 거짓 green 이 된다.
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  resetBarExitForTests();
  jest.useRealTimers();
});

/** 바 props 한 벌(허브·기록 공통 모양) — `tag` 로 어느 호출인지 구분한다. */
const barProps = (tag: string): BarExitProps => ({
  testID: `${tag}-bar`,
  capsuleTestID: `${tag}-capsule`,
  backTestID: `${tag}-back`,
  startCellTestID: (tab) => `${tag}-start-${tab}`,
  survivorTab: 'records',
  survivorSelected: true,
  renderSurvivor: () => null,
  newCells: [],
  departureTab: 'home',
  exitTab: 'records',
});

describe('barExitHandoff · 퇴장 인계 저장소', () => {
  it('아직 아무도 나가지 않았으면 비어 있다(앵커)', () => {
    const { result } = renderHook(() => useBarExit());

    expect(result.current).toBeNull();
  });

  it('beginBarExit 을 부르면 구독자가 그 순간 번호와 넘긴 바 props 를 읽는다', () => {
    // 준비
    const { result } = renderHook(() => useBarExit());
    const props = barProps('a');

    // 실행
    act(() => beginBarExit(props));

    // 단언: 넘긴 props 그대로(복사·가공 없음) + 숫자 번호.
    expect(result.current).not.toBeNull();
    expect(result.current?.props).toBe(props);
    expect(typeof result.current?.id).toBe('number');
  });

  it('BAR_EXIT_MS 가 지나면 스스로 비워진다 — 직전(−1ms)까지는 남아 있다', () => {
    const { result } = renderHook(() => useBarExit());
    act(() => beginBarExit(barProps('a')));

    act(() => {
      jest.advanceTimersByTime(BAR_EXIT_MS - 1);
    });
    expect(result.current).not.toBeNull();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBeNull();
  });

  it('구독자가 없어도 타이머는 돈다 — 호스트가 없는 화면에서 부른 퇴장이 값으로 남지 않는다', () => {
    act(() => beginBarExit(barProps('a')));
    act(() => {
      jest.advanceTimersByTime(BAR_EXIT_MS);
    });

    const { result } = renderHook(() => useBarExit());

    expect(result.current).toBeNull();
  });

  it('연속으로 부르면 값이 새 번호·새 props 로 바뀌고, 앞 호출의 타이머가 뒤 호출을 일찍 비우지 않는다', () => {
    // 준비: a 로 시작 → 200ms 뒤 b 로 교체.
    const { result } = renderHook(() => useBarExit());
    act(() => beginBarExit(barProps('a')));
    const first = result.current;
    act(() => {
      jest.advanceTimersByTime(200);
    });
    const second = barProps('b');
    act(() => beginBarExit(second));

    // 단언 1: 값이 b 로 바뀌었고 번호가 달라졌다(호스트가 바를 새로 세운다).
    expect(result.current?.props).toBe(second);
    expect(result.current?.id).not.toBe(first?.id);

    // 단언 2: a 의 타이머가 울릴 시각(a 로부터 BAR_EXIT_MS)에 b 는 아직 남아 있다.
    act(() => {
      jest.advanceTimersByTime(BAR_EXIT_MS - 200);
    });
    expect(result.current?.props).toBe(second);

    // 단언 3: b 로부터 BAR_EXIT_MS 가 되는 순간 비워진다.
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBeNull();
  });

  it('resetBarExitForTests 는 값과 대기 중인 타이머를 함께 지운다 — 리셋 뒤 새 호출은 자기 시각에만 비워진다', () => {
    // 준비: a 를 걸고 바로 리셋 → 100ms 뒤 b.
    const { result } = renderHook(() => useBarExit());
    act(() => beginBarExit(barProps('a')));
    act(() => resetBarExitForTests());
    expect(result.current).toBeNull();
    act(() => {
      jest.advanceTimersByTime(100);
    });
    const props = barProps('b');
    act(() => beginBarExit(props));

    // 단언: a 의 옛 타이머 시각(a 로부터 400)에도 b 는 남고, b 로부터 400 에 비워진다.
    act(() => {
      jest.advanceTimersByTime(BAR_EXIT_MS - 100);
    });
    expect(result.current?.props).toBe(props);
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current).toBeNull();
  });
});
