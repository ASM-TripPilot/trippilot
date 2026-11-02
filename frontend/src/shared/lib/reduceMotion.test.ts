import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { Animated } from 'react-native';

import { emitReduceMotionChange } from '@/test-support/animatedProbe';

import {
  onReduceMotionAnswer,
  resetReduceMotionForTests,
  startUnlessReduceMotion,
  useReduceMotion,
} from './reduceMotion';

/**
 * TRIP-1734 · OS "동작 줄이기" 답을 받는 원시 함수. 하단 바(MorphNavBar)가 "화면을 떠난 뒤 늦게 온 답"을 버리는 것은
 * 이 함수의 정리에 기댄다 — 늦은 답이 바꾸는 값은 이미 사라진 화면의 것이라 렌더 테스트로는 관측할 수 없어 여기서 직접 잰다.
 */

const isReduceMotionEnabled = jest.mocked(
  AccessibilityInfo.isReduceMotionEnabled
);

/** 이번 한 번의 OS 답을 붙잡아 둔다 — 나중에 `resolve(답)`. */
function deferAnswer(): { resolve: (reduce: boolean) => void } {
  let resolve!: (reduce: boolean) => void;
  isReduceMotionEnabled.mockReturnValueOnce(
    new Promise<boolean>((done) => {
      resolve = done;
    })
  );
  return { resolve };
}

/** 밀린 Promise 콜백을 전부 돌린다. */
const flush = () => new Promise<void>((done) => setImmediate(done));

/** start·stop 호출만 세는 가짜 애니메이션. */
const fakeAnimation = () =>
  ({
    start: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
  }) as unknown as Animated.CompositeAnimation;

const addEventListener = jest.mocked(AccessibilityInfo.addEventListener);

/** 지금까지 건 `reduceMotionChanged` 구독 수. */
const changeSubscriptions = () =>
  (addEventListener.mock.calls as unknown[][]).filter(
    ([event]) => event === 'reduceMotionChanged'
  ).length;

/** `useReduceMotion` 을 마운트하고, 렌더마다 돌려준 값을 순서대로 모은다(첫 렌더 값을 따로 보기 위해). */
function mountHook(): { renders: (boolean | null)[] } {
  const renders: (boolean | null)[] = [];
  renderHook(() => {
    const reduce = useReduceMotion();
    renders.push(reduce);
    return reduce;
  });
  return { renders };
}

/** OS 답을 한 번 받아 캐시를 채운 뒤 네이티브 질문 기록을 비운다(구독 기록은 남긴다 — 바뀜 이벤트가 그 핸들러를 쓴다). */
async function fillCache(answer: boolean): Promise<void> {
  const os = deferAnswer();
  onReduceMotionAnswer(() => {});
  os.resolve(answer);
  await flush();
  isReduceMotionEnabled.mockClear();
}

describe('onReduceMotionAnswer', () => {
  it.each([true, false])(
    'R-1 OS 답(%s)이 오면 그 값으로 콜백을 정확히 한 번 부르고, 답 전엔 부르지 않는다',
    async (answer) => {
      const os = deferAnswer();
      const cb = jest.fn();

      onReduceMotionAnswer(cb);
      await flush();
      expect(cb).not.toHaveBeenCalled();

      os.resolve(answer);
      await flush();

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(answer);
    }
  );

  it('R-2 정리 함수를 부른 뒤 늦게 온 답은 버린다', async () => {
    const os = deferAnswer();
    const cb = jest.fn();
    isReduceMotionEnabled.mockClear();

    const stop = onReduceMotionAnswer(cb);
    stop();
    os.resolve(false);
    await flush();

    // 짝 — OS 에 물어는 봤다(아예 안 물어서 0회인 공허 통과가 아니다).
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('startUnlessReduceMotion', () => {
  it.each([
    [false, 1, 0],
    [true, 0, 1],
  ])(
    'R-3 답(%s) 전엔 시작하지 않고(첫 프레임 번쩍임 없음), 답 뒤엔 start %i회 · onReduce %i회',
    async (answer, starts, reduces) => {
      const os = deferAnswer();
      const animation = fakeAnimation();
      const onReduce = jest.fn();

      startUnlessReduceMotion(animation, onReduce);
      await flush();
      expect(animation.start).not.toHaveBeenCalled();
      expect(animation.stop).not.toHaveBeenCalled();

      os.resolve(answer);
      await flush();

      expect(animation.start).toHaveBeenCalledTimes(starts);
      expect(onReduce).toHaveBeenCalledTimes(reduces);
    }
  );
});

// TRIP-1735 · 답을 모듈에 캐시하고 OS 바뀜 이벤트로 갈아 끼운다. 캐시는 jest 셋업(`test-support/reduceMotionReset`)이 테스트마다
// 비우므로 각 테스트는 빈 캐시에서 시작한다.
describe('답 캐시 · 바뀜 구독', () => {
  it('M-1 캐시가 빈 채로 소비처 6개(원시 2·게이트 2·훅 2)가 한꺼번에 물어도 OS 에는 한 번만 묻고, 답이 오면 전원에게 한 번씩 준다', async () => {
    const os = deferAnswer();
    isReduceMotionEnabled.mockClear();
    addEventListener.mockClear();
    const raws = [jest.fn(), jest.fn()];
    const gates = [0, 1].map(() => ({
      animation: fakeAnimation(),
      onReduce: jest.fn(),
    }));

    raws.forEach((cb) => onReduceMotionAnswer(cb));
    gates.forEach(({ animation, onReduce }) =>
      startUnlessReduceMotion(animation, onReduce)
    );
    const hooks = [mountHook(), mountHook()];
    await flush();

    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(changeSubscriptions()).toBe(1);
    // 답 전 — 아무도 답을 받지 않았다(번쩍임 금지: 시작 안 함 · 훅은 null).
    raws.forEach((cb) => expect(cb).not.toHaveBeenCalled());
    gates.forEach(({ animation, onReduce }) => {
      expect(animation.start).not.toHaveBeenCalled();
      expect(onReduce).not.toHaveBeenCalled();
    });
    hooks.forEach(({ renders }) => expect(renders.at(-1)).toBeNull());

    await act(async () => {
      os.resolve(true);
      await flush();
    });

    raws.forEach((cb) => {
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(true);
    });
    gates.forEach(({ animation, onReduce }) => {
      expect(onReduce).toHaveBeenCalledTimes(1);
      expect(animation.start).not.toHaveBeenCalled();
    });
    hooks.forEach(({ renders }) => expect(renders.at(-1)).toBe(true));
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'M-2 캐시(%s)가 찬 뒤 새로 묻는 소비처는 OS 에 다시 묻지 않고 그 자리에서(동기) 답을 받는다',
    async (cached) => {
      await fillCache(cached);
      const subscriptions = changeSubscriptions();
      const cb = jest.fn();
      const animation = fakeAnimation();
      const onReduce = jest.fn();

      onReduceMotionAnswer(cb);
      startUnlessReduceMotion(animation, onReduce);

      // flush 없이 곧장 — 답 대기 구간이 없다.
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(cached);
      expect(onReduce).toHaveBeenCalledTimes(cached ? 1 : 0);
      expect(animation.start).toHaveBeenCalledTimes(cached ? 0 : 1);
      expect(isReduceMotionEnabled).not.toHaveBeenCalled();
      expect(changeSubscriptions()).toBe(subscriptions);
    }
  );

  it.each([
    [false, true],
    [true, false],
  ])(
    'M-3 캐시가 %s 인데 OS 가 바뀜(%s)을 알리면 그 뒤 새로 묻는 소비처는 새 값을 받고, 이미 돌던 것은 건드리지 않는다',
    async (before, after) => {
      await fillCache(before);
      const runningAnimation = fakeAnimation();
      startUnlessReduceMotion(runningAnimation);
      const mounted = mountHook();
      const rendersBefore = mounted.renders.length;

      emitReduceMotionChange(after);

      const cb = jest.fn();
      const animation = fakeAnimation();
      const onReduce = jest.fn();
      onReduceMotionAnswer(cb);
      startUnlessReduceMotion(animation, onReduce);
      const fresh = mountHook();

      expect(cb).toHaveBeenCalledWith(after);
      expect(onReduce).toHaveBeenCalledTimes(after ? 1 : 0);
      expect(animation.start).toHaveBeenCalledTimes(after ? 0 : 1);
      expect(fresh.renders[0]).toBe(after);
      expect(isReduceMotionEnabled).not.toHaveBeenCalled();
      // 이미 마운트된 훅은 다시 그리지 않고(카운트업 재시작 등 회피), 돌던 반복 모션은 멈추지 않는다.
      expect(mounted.renders).toHaveLength(rendersBefore);
      expect(mounted.renders.at(-1)).toBe(before);
      expect(runningAnimation.stop).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    'M-4 캐시(%s)가 찬 뒤 마운트한 useReduceMotion 은 첫 렌더부터 그 값이다(null 프레임 없음)',
    async (cached) => {
      await fillCache(cached);

      const { renders } = mountHook();

      expect(renders[0]).toBe(cached);
      expect(renders).not.toContain(null);
      expect(isReduceMotionEnabled).not.toHaveBeenCalled();
    }
  );

  it('M-4 짝 — 캐시가 비었으면 useReduceMotion 첫 렌더는 기존처럼 null(답 대기)이다', () => {
    deferAnswer();

    const { renders } = mountHook();

    expect(renders[0]).toBeNull();
  });

  it('M-5 리셋하면 캐시·구독을 비워 다음 소비처가 OS 에 다시 묻고 구독도 다시 건다', async () => {
    const first = deferAnswer();
    onReduceMotionAnswer(() => {});
    first.resolve(true);
    await flush();
    const subscription = addEventListener.mock.results.at(-1)?.value as {
      remove: jest.Mock;
    };
    isReduceMotionEnabled.mockClear();
    addEventListener.mockClear();

    resetReduceMotionForTests();
    const os = deferAnswer();
    const cb = jest.fn();
    onReduceMotionAnswer(cb);

    expect(subscription.remove).toHaveBeenCalledTimes(1);
    expect(cb).not.toHaveBeenCalled(); // 동기 답이 없다 — 캐시가 비었다
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(changeSubscriptions()).toBe(1);

    os.resolve(false);
    await flush();
    expect(cb).toHaveBeenCalledWith(false);
  });

  it('M-5 리셋은 진행 중 질문도 버린다 — 리셋 전 질문의 늦은 답은 리셋 뒤 소비처·캐시에 닿지 않는다', async () => {
    isReduceMotionEnabled.mockClear();
    const stale = deferAnswer();
    const before = jest.fn();
    onReduceMotionAnswer(before);

    resetReduceMotionForTests();
    const os = deferAnswer();
    const after = jest.fn();
    onReduceMotionAnswer(after);
    expect(isReduceMotionEnabled).toHaveBeenCalledTimes(2);

    stale.resolve(true);
    await flush();
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();

    os.resolve(false);
    await flush();
    expect(after).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledWith(false);
    const later = jest.fn();
    onReduceMotionAnswer(later);
    expect(later).toHaveBeenCalledWith(false);
  });
});
