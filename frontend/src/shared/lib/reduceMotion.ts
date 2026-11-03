import { useEffect, useState } from 'react';
import { AccessibilityInfo, type Animated } from 'react-native';

type Answer = (reduce: boolean) => void;

// 앱 전체가 OS 답 하나를 나눠 쓴다(TRIP-1735). `waiting` 이 있으면 질문이 진행 중이고, 그 집합이 질문의 신분증이다 —
// 리셋이 `waiting` 을 비우면 그 질문의 늦은 답은 자기 집합이 아니라서 버려진다.
let cached: boolean | undefined;
let waiting: Set<Answer> | null = null;
let subscription: { remove: () => void } | undefined;

function ask(first: Answer): void {
  const asking = new Set<Answer>([first]);
  // 동기로 답하는 목은 `then` 안에서 곧장 답하므로, 진행 중 표시·대기자 등록은 `then` 을 걸기 **전에** 한다.
  waiting = asking;
  subscription ??= AccessibilityInfo.addEventListener(
    'reduceMotionChanged',
    (reduce) => {
      cached = reduce;
    }
  );
  // `.catch` 대신 `then` 두 번째 인자 — 목이 `then` 하나만 가진다. 질문이 실패하면 진행 중 표시만 내려 다음 소비처가 다시 묻는다.
  void AccessibilityInfo.isReduceMotionEnabled().then(
    (reduce) => {
      if (waiting !== asking) return;
      // 질문 중에 바뀜 이벤트가 왔으면 그 값이 더 새롭다.
      cached ??= reduce;
      waiting = null;
      const answerNow = cached;
      asking.forEach((answer) => answer(answerNow));
    },
    () => {
      if (waiting === asking) waiting = null;
    }
  );
}

/**
 * 기기 "동작 줄이기" 답을 받는 원시 함수(TRIP-1734). 답이 모듈에 캐시돼 있으면 반환하기 **전에** 그 자리에서
 * `onAnswer(reduce)` 를 부르고, 없으면 OS 답이 올 때 한 번 부른다 — 여러 소비처가 동시에 물어도 OS 질문은 하나다
 * (TRIP-1735). 답 전에 반환 함수(정리)가 불리면 답을 버린다. 첫 질문 때 OS 바뀜 이벤트(`reduceMotionChanged`)를 한 번
 * 구독해 캐시를 갈아 끼우므로, 설정을 바꾼 뒤 **새로 묻는** 소비처는 새 값을 받는다(이미 받은 쪽에는 다시 알리지 않는다).
 * 이 파일만 OS 에 직접 묻는다(eslint 잠금).
 */
export function onReduceMotionAnswer(onAnswer: Answer): () => void {
  if (cached !== undefined) {
    onAnswer(cached);
    return () => {};
  }
  // 호출마다 새로 감싼다 — 같은 콜백을 두 번 걸어도 Set 이 하나로 합치지 않게.
  const answer: Answer = (reduce) => onAnswer(reduce);
  if (waiting) waiting.add(answer);
  else ask(answer);
  return () => {
    waiting?.delete(answer);
  };
}

/**
 * 기기 "동작 줄이기" 공용 게이트(TRIP-1125). 켜져 있으면 `animation` 을 시작하지 않고 `onReduce` 만
 * 부른다(정지 모양을 보이는 자리에 둘 때). 답이 오기 전에 반환 함수(정리)가 불리면 시작하지 않는다. 답은 위 함수의
 * 캐시를 따른다 — 설정이 바뀌어도 이미 돌던 애니메이션은 멈추지 않고, 다음에 시작하는 것부터 새 값을 따른다.
 */
export function startUnlessReduceMotion(
  animation: Animated.CompositeAnimation,
  onReduce?: () => void
): () => void {
  const cancel = onReduceMotionAnswer((reduce) => {
    if (reduce) onReduce?.();
    else animation.start();
  });
  return () => {
    cancel();
    animation.stop();
  };
}

/**
 * reanimated 모션용 "동작 줄이기" 훅(TRIP-1383). 캐시된 답이 있으면 첫 렌더부터 그 값, 없으면 답이 오기 전엔 `null` —
 * 호출 쪽은 그동안 모션 요소를 그리지 않아 정지→모션으로 한 프레임 번쩍이는 것을 피한다. 위 함수와 같은 원천
 * (AccessibilityInfo)이라 같은 규칙이다(reanimated 의 useReducedMotion 은 jest-expo 의 reanimated 목에 없어 쓰지 않는다).
 * 마운트 때 한 번만 받는다 — 설정이 바뀌어도 이미 마운트된 훅은 다시 그리지 않는다.
 */
export function useReduceMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(() => cached ?? null);
  useEffect(() => onReduceMotionAnswer(setReduce), []);
  return reduce;
}

/** 테스트 전용 — 캐시·진행 중 질문·바뀜 구독을 비운다(jest 셋업 `test-support/reduceMotionReset` 이 테스트마다 부른다). */
export function resetReduceMotionForTests(): void {
  cached = undefined;
  waiting = null;
  subscription?.remove();
  subscription = undefined;
}
