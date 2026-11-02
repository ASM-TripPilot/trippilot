/**
 * TRIP-1681 — gorhom 바텀시트 스크롤 잠금 재귀 패치(`patches/@gorhom__bottom-sheet@5.2.14.patch`)를 지키는 심판.
 *
 * 운영 크래시(Sentry REACT-NATIVE-1): 시트가 중간 칸이라 안쪽 목록이 잠긴(LOCKED) 상태에서,
 * gorhom 이 목록을 제자리로 되돌리려고 reanimated `scrollTo` 를 부르면 Fabric 이 스크롤 이벤트를
 * **같은 호출 안에서 동기로** 다시 쏘고, 그 이벤트가 다시 `scrollTo` 를 불러 스택이 터졌다.
 *
 * 여기서는 `scrollTo` 목이 그 동기 재진입을 그대로 흉내 낸다 — 패치가 빠지면(gorhom 업그레이드 등)
 * 재진입이 끝없이 돌아 RangeError 로 red 가 된다. 실제 Fabric 동작·시트 런타임은 jest 가 못 보므로
 * (repo-traps 바텀시트 절) 실기 확인은 별도다.
 */
import { renderHook } from '@testing-library/react-native';

// gorhom 의 .ts 원본을 깊은 경로로 쓴다 — `import` 로 받으면 tsc 가 라이브러리 소스까지 strict 검사해
// CI 의 `pnpm tsc` 가 깨진다. `require` 는 타입을 따라가지 않으므로(any) 런타임에만 원본을 태운다.
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  SCROLLABLE_STATUS,
  SHEET_STATE,
} = require('@gorhom/bottom-sheet/src/constants');
const {
  useScrollEventsHandlersDefault,
} = require('@gorhom/bottom-sheet/src/hooks/useScrollEventsHandlersDefault');
/* eslint-enable @typescript-eslint/no-require-imports */

const mockScrollTo = jest.fn();
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated'),
  scrollTo: (...args: unknown[]) => mockScrollTo(...args),
}));

// 시트 내부 상태 — 중간 칸(EXTENDED 아님)·안쪽 스크롤 잠김·핸들 드래그 없음.
const sv = <T>(value: T) => ({ value, get: () => value, set: jest.fn() });
jest.mock('@gorhom/bottom-sheet/src/hooks/useBottomSheetInternal', () => ({
  useBottomSheetInternal: () => ({
    animatedSheetState: sv(mockSheetState),
    animatedScrollableState: sv({ contentOffsetY: 0 }),
    animatedScrollableStatus: sv(mockLockedStatus),
    animatedAnimationState: sv({ status: 0 }),
    animatedHandleGestureState: sv(0),
  }),
}));
// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로(호이스팅) 바깥 값은 mock 접두 변수로만 참조한다.
const mockSheetState = SHEET_STATE.OPENED;
const mockLockedStatus = SCROLLABLE_STATUS.LOCKED;

type Handler = (
  event: { contentOffset: { y: number } },
  context: Record<string, unknown>
) => void;

describe('바텀시트 스크롤 잠금 — scrollTo 동기 재진입 (TRIP-1681)', () => {
  beforeEach(() => mockScrollTo.mockReset());

  it.each([
    'handleOnScroll',
    'handleOnEndDrag',
    'handleOnMomentumEnd',
  ] as const)(
    '%s: scrollTo 가 같은 핸들러를 동기로 다시 불러도 scrollTo 는 한 번만 불린다',
    (name) => {
      // Arrange — 훅의 핸들러를 꺼내고, scrollTo 가 Fabric 처럼 그 자리에서 스크롤 이벤트를 다시 쏘게 한다.
      const ref = { current: null };
      const offset = { value: 0 };
      const { result } = renderHook(() =>
        useScrollEventsHandlersDefault(ref as never, offset as never)
      );
      const handler = result.current[name] as unknown as Handler;
      const context: Record<string, unknown> = {
        shouldLockInitialPosition: false,
      };
      mockScrollTo.mockImplementation(() =>
        handler({ contentOffset: { y: 0 } }, context)
      );

      // Act — 잠긴 목록이 y=50 으로 밀린 이벤트.
      const act = () => handler({ contentOffset: { y: 50 } }, context);

      // Assert — 재귀 없이 끝나고, 제자리(0)로 되돌리는 scrollTo 는 정확히 한 번.
      expect(act).not.toThrow();
      expect(mockScrollTo).toHaveBeenCalledTimes(1);
      expect(mockScrollTo).toHaveBeenCalledWith(ref, 0, 0, false);
    }
  );

  it('재진입이 끝나면 다음 이벤트에서 다시 잠금 scrollTo 를 부른다 (잠금 동작 보존)', () => {
    // Arrange — 이번엔 scrollTo 가 재진입하지 않는다(평범한 호출).
    const ref = { current: null };
    const { result } = renderHook(() =>
      useScrollEventsHandlersDefault(ref as never, { value: 0 } as never)
    );
    const handler = result.current.handleOnScroll as unknown as Handler;
    const context: Record<string, unknown> = {
      shouldLockInitialPosition: false,
    };

    // Act — 잠긴 목록이 두 번 밀린다.
    handler({ contentOffset: { y: 30 } }, context);
    handler({ contentOffset: { y: 60 } }, context);

    // Assert — 매번 제자리로 되돌린다(플래그가 finally 로 풀려 다음 잠금을 막지 않는다).
    expect(mockScrollTo).toHaveBeenCalledTimes(2);
  });
});
