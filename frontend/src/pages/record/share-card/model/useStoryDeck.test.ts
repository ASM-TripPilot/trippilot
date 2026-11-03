import { AccessibilityInfo } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { answerReduceMotionSynchronously } from '@/test-support/animatedProbe';

import { SLIDE_MS } from './storyDeck';
import { useStoryDeck } from './useStoryDeck';

/**
 * TRIP-1667 · j06 스토리 덱 훅 — 리듀서(`storyDeck.test.ts`)에 "진짜 시간"을 이어 주는 얇은 훅의 계약.
 * 초심자용: 가짜 타이머 = `jest.useFakeTimers()` 로 시계를 우리가 손으로 돌린다(`advanceTimersByTime(ms)` = ms 가 지난 척).
 * 그래서 3.4초짜리 규칙을 실제로 3.4초 기다리지 않고 잰다. 3동작: 준비(훅 마운트·동작 줄이기 답) → 실행(시간을 흘리거나 누름 핸들러 호출) → 단언(장 번호).
 *
 * 무엇을 보장하나:
 *  - AC-3 3.4초 뒤 다음 장 · 마지막 장에서 멈춤(타이머도 남지 않는다).
 *  - AC-4 탭하면 그 장의 3.4초가 처음부터 · 첫 장의 왼쪽 탭은 흐르던 시간을 건드리지 않는다.
 *  - AC-5 누르는 동안 안 넘어가고 떼면 **남은 시간부터** · 장이 바뀐 뒤 누르면 그 장의 시작 시각 기준으로 센다 · `onLongPress` 는 아무 일도 안 한다(noop).
 *  - AC-6 동작 줄이기 true → 타이머 0개 · 답 오기 전(null) → 시작도 안 함, 답이 false 로 오면 그때부터 센다.
 *  - AC-8 언마운트하면 타이머가 사라지고 이후 상태 갱신이 없다.
 *
 * 시간 규칙은 이 파일(MSW 없음)에서만 잰다 — 가짜 타이머는 MSW 응답을 멈추므로 통합 테스트는 시간을 흘리지 않는다.
 */

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });
const setup = (total = 3, startAt: 'first' | 'last' = 'first') =>
  renderHook(() => useStoryDeck(total, startAt));

beforeEach(() => {
  jest.useFakeTimers();
  answerReduceMotionSynchronously(false);
});
// 가짜 시계는 모듈 싱글턴이다 — 파일 최상위에서 되돌린다.
afterEach(() => {
  jest.useRealTimers();
});

describe('자동 넘김(AC-3)', () => {
  it('UH-1 · 3.4초가 되는 순간 다음 장, 마지막 장에서는 멈추고 타이머도 남지 않는다', () => {
    const { result } = setup(3);
    expect(result.current.index).toBe(0);

    advance(SLIDE_MS - 1);
    expect(result.current.index).toBe(0);
    advance(1);
    expect(result.current.index).toBe(1);

    advance(SLIDE_MS);
    expect(result.current.index).toBe(2);
    advance(60_000);
    expect(result.current.index).toBe(2); // 마지막에서 멈춤 — 처음으로 돌아가지 않는다
    expect(jest.getTimerCount()).toBe(0);
  });

  it('UH-2 · 처음 마운트 때 구간 상태가 지금/남음으로 나오고, startAt "last" 는 마지막 장에서 시작한다', () => {
    expect(setup(3).result.current.segments).toEqual([
      'current',
      'upcoming',
      'upcoming',
    ]);

    const last = setup(3, 'last').result.current;
    expect(last.index).toBe(2);
    expect(last.segments).toEqual(['done', 'done', 'current']);
    expect(last.total).toBe(3);
  });
});

describe('탭 이동(AC-4)', () => {
  it('UH-3 · 탭하면 그 장의 3.4초가 처음부터 다시 센다(오른쪽·왼쪽 모두)', () => {
    const { result } = setup(3);

    advance(2000);
    act(() => result.current.onTap('right'));
    expect(result.current.index).toBe(1);
    advance(SLIDE_MS - 1);
    expect(result.current.index).toBe(1); // 2000ms 쓴 시간이 이월되지 않았다
    advance(1);
    expect(result.current.index).toBe(2);

    advance(1000);
    act(() => result.current.onTap('left'));
    expect(result.current.index).toBe(1);
    advance(SLIDE_MS - 1);
    expect(result.current.index).toBe(1);
    advance(1);
    expect(result.current.index).toBe(2);
  });

  it('UH-4 · 첫 장의 왼쪽 탭·마지막 장의 오른쪽 탭은 무동작 — 흐르던 시간도 그대로', () => {
    const { result } = setup(3);

    advance(2000);
    act(() => result.current.onTap('left')); // 첫 장의 왼쪽
    advance(SLIDE_MS - 2000 - 1);
    expect(result.current.index).toBe(0);
    advance(1);
    expect(result.current.index).toBe(1); // 처음부터 센 3.4초 시점에 넘어갔다(리셋 안 됨)

    act(() => result.current.onTap('right'));
    expect(result.current.index).toBe(2);
    act(() => result.current.onTap('right')); // 마지막 장의 오른쪽
    expect(result.current.index).toBe(2);
  });
});

describe('길게 누르면 멈춤(AC-5)', () => {
  it('UH-5 · 누르는 동안은 아무리 지나도 안 넘어가고, 떼면 "남은 시간"부터 이어 센다', () => {
    const { result } = setup(3);
    advance(1000);

    act(() => result.current.onPressIn());
    advance(60_000);
    expect(result.current.index).toBe(0);
    act(() => result.current.onPressOut());
    advance(SLIDE_MS - 1000 - 1);
    expect(result.current.index).toBe(0);
    advance(1);
    expect(result.current.index).toBe(1); // 1000ms 쓴 장 → 남은 2400ms 뒤에 넘어갔다
  });

  it('UH-6 · 장이 바뀐 뒤 누르면 그 장이 시작된 시각부터 잰 시간을 쓴다(시작 시각이 장마다 새로 잡힌다)', () => {
    const { result } = setup(3);

    advance(SLIDE_MS); // 1장으로 넘어감 — 이 시각이 1장의 시작
    advance(1000);
    act(() => result.current.onPressIn());
    act(() => result.current.onPressOut());
    advance(SLIDE_MS - 1000 - 1);
    expect(result.current.index).toBe(1);
    advance(1);
    expect(result.current.index).toBe(2);
  });

  it('UH-7 · 누른 채로 탭이 먼저 오는 순서(onPress → onPressOut)에서도 새 장은 3.4초를 온전히 받는다', () => {
    const { result } = setup(3);

    act(() => result.current.onPressIn());
    act(() => result.current.onTap('right'));
    expect(result.current.index).toBe(1);
    advance(60_000);
    expect(result.current.index).toBe(1); // 아직 누르는 중

    act(() => result.current.onPressOut());
    advance(SLIDE_MS - 1);
    expect(result.current.index).toBe(1);
    advance(1);
    expect(result.current.index).toBe(2);
  });

  it('UH-8 · onLongPress 는 있되 아무 일도 하지 않는다(긴 누름 뒤 onPress 억제용 noop) — 장도 시간도 그대로', () => {
    const { result } = setup(3);
    advance(1000);

    act(() => {
      result.current.onPressIn();
      result.current.onLongPress();
      result.current.onPressOut();
    });

    expect(typeof result.current.onLongPress).toBe('function');
    expect(result.current.index).toBe(0);
    advance(SLIDE_MS - 1000 - 1);
    expect(result.current.index).toBe(0);
    advance(1);
    expect(result.current.index).toBe(1);
  });
});

describe('동작 줄이기(AC-6)', () => {
  it('UH-9 · true → 타이머가 하나도 안 걸리고 아무리 지나도 안 넘어가지만, 탭으로는 이동한다', () => {
    answerReduceMotionSynchronously(true);
    const { result } = setup(3);

    expect(jest.getTimerCount()).toBe(0);
    advance(60_000);
    expect(result.current.index).toBe(0);

    act(() => result.current.onTap('right'));
    expect(result.current.index).toBe(1);
    expect(result.current.segments).toEqual(['done', 'current', 'upcoming']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('UH-10 · 답이 오기 전(null)에는 시작도 안 하고, 답이 false 로 오면 그 순간부터 3.4초를 센다(흘러간 시간은 안 쳐 준다)', async () => {
    let answer!: (reduce: boolean) => void;
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        })
    );
    const { result } = setup(3);

    advance(60_000);
    expect(result.current.index).toBe(0);
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      answer(false);
    });
    advance(SLIDE_MS - 1);
    expect(result.current.index).toBe(0);
    advance(1);
    expect(result.current.index).toBe(1);
  });
});

describe('정리(AC-8)', () => {
  it('UH-11 · 언마운트하면 타이머가 0개가 되고 이후 시간이 흘러도 오류·경고가 없다', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = setup(3);
      advance(1000);

      unmount();

      expect(jest.getTimerCount()).toBe(0);
      jest.advanceTimersByTime(60_000);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe('진행 바가 읽는 값(fill)', () => {
  it('UH-12 · 도는 중엔 (지금까지 비율, 남은 ms) · 누르는 동안엔 길이 null · 떼면 남은 ms · 마지막 장에서 멈추면 null', () => {
    const { result } = setup(2);
    expect(result.current.fill).toEqual({ from: 0, durationMs: SLIDE_MS });

    advance(1000);
    act(() => result.current.onPressIn());
    expect(result.current.fill.durationMs).toBeNull();
    expect(result.current.fill.from).toBeCloseTo(1000 / SLIDE_MS, 5);

    act(() => result.current.onPressOut());
    expect(result.current.fill.durationMs).toBe(SLIDE_MS - 1000);
    expect(result.current.fill.from).toBeCloseTo(1000 / SLIDE_MS, 5);

    advance(SLIDE_MS); // 마지막 장(1)으로 → 거기서 3.4초 더 → 정지
    advance(SLIDE_MS);
    expect(result.current.index).toBe(1);
    expect(result.current.fill.durationMs).toBeNull();
    expect(result.current.fill.from).toBe(1);
  });
});
