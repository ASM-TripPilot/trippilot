import { AccessibilityInfo } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

/**
 * 애니메이션 "움직이는가 · 멈췄는가" 심판의 공용 장치(TRIP-1352 — `GeneratingScreen.test` 의 진행 바·단계 펄스가
 * 각자 복사하던 것을 한 벌로).
 *
 * ⚠️ jest 의 RN 목은 네이티브 드라이버 애니메이션을 JS 값에 반영하지 않는다(02a ★2 실측) — 그래서
 * `shouldUseNativeDriver` 를 false 로 스파이해 JS 로 돌리고, 시간은 가짜 타이머로 흘린다. 이 두 가지가 켜져 있어야
 * "동작 줄이기가 켜져 있으면 안 움직인다" 단언이 의미를 갖는다 — 켜지 않으면 동작 줄이기를 무시하는 코드도
 * 값이 원래 안 바뀌어 공허하게 통과한다.
 */

// RN 0.81 내부 경로 — 바뀌면 require 가 throw 해 조용히 green 이 되지 않는다.
const NativeAnimatedHelper =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native/src/private/animated/NativeAnimatedHelper') as {
    default: { shouldUseNativeDriver: (config: unknown) => boolean };
  };

export interface AnimatedProbe {
  /** 기기 "동작 줄이기" 답을 바꾼다. 마운트 **전**에 부른다. 기본은 목의 원래 답. */
  setReduceMotion: (on: boolean) => void;
}

/**
 * describe 본문에서 한 번 부른다 — 그 describe 의 beforeEach/afterEach 에 가짜 타이머 + JS 드라이버 강제를
 * 걸고, 끝나면 모두 되돌린다(최상위에서 부르면 같은 파일의 다른 테스트가 가짜 타이머 아래서 돈다).
 */
export function useAnimatedProbe(): AnimatedProbe {
  const reduceMotionMock = jest.mocked(AccessibilityInfo.isReduceMotionEnabled);
  const reduceMotionDefault = reduceMotionMock.getMockImplementation();
  let driverSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    driverSpy = jest
      .spyOn(NativeAnimatedHelper.default, 'shouldUseNativeDriver')
      .mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    driverSpy?.mockRestore();
    driverSpy = null;
    if (reduceMotionDefault) {
      reduceMotionMock.mockImplementation(reduceMotionDefault);
    }
  });

  return {
    setReduceMotion: (on) => {
      reduceMotionMock.mockResolvedValue(on);
    },
  };
}

/** 서브트리(자기 자신 포함)의 호스트 노드들. */
export function hostNodes(node: ReactTestInstance): ReactTestInstance[] {
  const own = typeof node.type === 'string' ? [node] : [];
  const kids = node.children.filter(
    (child): child is ReactTestInstance => typeof child !== 'string'
  );
  return [...own, ...kids.flatMap(hostNodes)];
}

/**
 * `AccessibilityInfo.isReduceMotionEnabled()` 가 **그 자리에서** 답하게 한다(TRIP-1624). `beforeEach` 에서 부른다.
 *
 * 왜: `useReduceMotion` 은 Promise 답으로 `setReduce` 를 부르는데, 동기 테스트에선 그 답이 render 의 act 밖(다음 마이크로태스크)에 와서
 * "not wrapped in act" 경고가 찍힌다. 답이 effect 안에서 동기로 오면 render 의 act 가 감싼다. 렌더 헬퍼를 전부 async 로 바꿀 필요가 없다.
 * ⚠️ "답이 오기 전(reduce===null)"을 일부러 보는 테스트에서는 쓰지 마라 — 그 상태가 사라진다.
 * 반환값은 `then` 하나만 가진 thenable 이다(소비처가 `.then` 만 쓴다 — `grep isReduceMotionEnabled src`).
 */
export function answerReduceMotionSynchronously(reduce: boolean): void {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockImplementation(
    () =>
      ({
        then: (onAnswer: (value: boolean) => void) => {
          onAnswer(reduce);
        },
      }) as unknown as Promise<boolean>
  );
}
