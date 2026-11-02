import { AccessibilityInfo } from 'react-native';

import type { Animated } from 'react-native';

import { onReduceMotionAnswer, startUnlessReduceMotion } from './reduceMotion';

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
  /** start·stop 호출만 세는 가짜 애니메이션. */
  const fakeAnimation = () =>
    ({
      start: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
    }) as unknown as Animated.CompositeAnimation;

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
