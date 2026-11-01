import fc from 'fast-check';

import { goBackOr, type BackRouter } from './goBackOr';

/**
 * TRIP-1685 — 공용 뒤로 헬퍼 `goBackOr(router, fallback)` 자체 계약.
 *
 * 무엇을 보장하나: "돌아갈 화면이 스택(쌓인 화면 목록)에 있으면 한 장 뒤로, 없으면 폴백 경로로 갈아 끼운다"
 * 한 가지 분기를 **정확히 한 번만** 한다. 그래서 (1) 스택 있음 → `back` 1회·`replace` 0회,
 * (2) 스택 없음 → `replace(폴백)` 1회·`back` 0회, (3) 어느 쪽이든 `canGoBack` 은 1회만 묻는다.
 * 폴백 값은 호출부가 넘기는 것이라 헬퍼는 그대로 전달만 한다(가공·복사 없음 → 같은 객체).
 *
 * 왜 가짜 라우터로 충분한가: 이 파일이 재는 것은 "무엇을 몇 번 부르나"라는 분기뿐이다. 실제로 화면이 어디에
 * 도착하는지는 실물 라우터를 쓰는 `src/__tests__/backFallback.integration.test.tsx` 가 잰다.
 * (개념: 가짜 라우터 = `canGoBack`·`back`·`replace` 세 멤버만 가진 `jest.fn` 묶음. `BackRouter` 는
 * 헬퍼가 요구하는 라우터의 최소 모양 — 훅이 준 router 든 정적 router 든 이 세 멤버만 있으면 넘길 수 있다.)
 *
 * 3동작 뼈대: 준비 = 스택 유무를 정한 가짜 라우터 → 실행 = `goBackOr` 호출 → 단언 = 세 멤버의 호출 횟수·인자.
 */

type Fake = BackRouter & {
  canGoBack: jest.Mock;
  back: jest.Mock;
  replace: jest.Mock;
};

/** 준비 — `canGoBack` 의 대답을 케이스가 정한다(공용 목의 기본값 true 에 기대지 않는다). */
function fakeRouter(canGoBack: boolean): Fake {
  return {
    canGoBack: jest.fn(() => canGoBack),
    back: jest.fn(),
    replace: jest.fn(),
  };
}

describe('AC3-a · 스택이 있으면 한 장 뒤로', () => {
  it('canGoBack()===true → back() 1회, replace() 0회', () => {
    // 준비
    const router = fakeRouter(true);

    // 실행
    goBackOr(router, '/(tabs)');

    // 단언
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('back() 은 인자 없이 부른다 — 몇 장 뒤로 같은 변형을 얹지 않는다', () => {
    // 준비
    const router = fakeRouter(true);

    // 실행
    goBackOr(router, '/(tabs)');

    // 단언 — toHaveBeenCalledWith() 는 "인자 0개"로 부른 호출만 맞는다.
    expect(router.back).toHaveBeenCalledWith();
  });
});

describe('AC1-a · 스택이 없으면 폴백으로 replace', () => {
  it('canGoBack()===false → replace(폴백) 1회, back() 0회', () => {
    // 준비
    const router = fakeRouter(false);

    // 실행
    goBackOr(router, '/my');

    // 단언
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/my');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('객체 모양 Href(동적 경로) 도 같은 객체 그대로 넘긴다 — 복사·문자열화하지 않는다', () => {
    // 준비 — `{ pathname, params }` 는 /trips/[tripId]/… 폴백이 쓰는 모양이다.
    const router = fakeRouter(false);
    const fallback = {
      pathname: '/trips/[tripId]/live',
      params: { tripId: 'trip-1' },
    } as const;

    // 실행
    goBackOr(router, fallback);

    // 단언 — toBe 는 "같은 객체"(참조 동일)를 본다. toEqual 이면 복사해도 통과해 버린다.
    expect(router.replace.mock.calls[0]?.[0]).toBe(fallback);
  });

  it('replace 는 폴백 하나만 받는다 — 두 번째 인자를 붙이지 않는다', () => {
    // 준비
    const router = fakeRouter(false);

    // 실행
    goBackOr(router, '/explore');

    // 단언
    expect(router.replace.mock.calls[0]).toHaveLength(1);
  });
});

describe('AC6 · 헬퍼 계약 — 동기 한 번', () => {
  it.each([true, false])(
    'canGoBack(%s) 이든 canGoBack 은 정확히 1회만 묻고, 부른 쪽은 둘 중 하나뿐이다',
    (can) => {
      // 준비
      const router = fakeRouter(can);

      // 실행
      goBackOr(router, '/(tabs)');

      // 단언
      expect(router.canGoBack).toHaveBeenCalledTimes(1);
      expect(
        router.back.mock.calls.length + router.replace.mock.calls.length
      ).toBe(1);
    }
  );

  it('값을 돌려주지 않고 동기로 끝난다 — 호출 직후 곧바로 push 하는 호출부(D6)의 순서를 지킨다', () => {
    // 준비
    const router = fakeRouter(false);
    const order: string[] = [];
    router.replace.mockImplementation(() => order.push('replace'));

    // 실행
    const result = goBackOr(router, '/(tabs)');
    order.push('after');

    // 단언 — replace 는 헬퍼가 돌아오기 전에 이미 불렸다(비동기로 미루지 않는다).
    expect(result).toBeUndefined();
    expect(order).toEqual(['replace', 'after']);
  });

  it('누른 시점의 폴백을 쓴다 — 호출마다 받은 폴백을 그대로 쓰고 기억하지 않는다', () => {
    // 준비 — 같은 라우터에 폴백만 바꿔 두 번 부른다(약관 AC5: 렌더 때가 아니라 누를 때 값).
    const router = fakeRouter(false);

    // 실행
    goBackOr(router, '/settings');
    goBackOr(router, '/login');

    // 단언
    expect(router.replace.mock.calls).toEqual([['/settings'], ['/login']]);
  });

  it('속성 — 어떤 폴백·어떤 스택 상태에서도 back 과 replace 중 정확히 하나만 부른다', () => {
    // 준비·실행·단언을 fast-check 가 반복한다(무작위 입력 100회, 실패 시 가장 작은 반례로 줄여 보여 준다).
    fc.assert(
      fc.property(fc.boolean(), fc.string(), (can, path) => {
        const router = fakeRouter(can);

        goBackOr(router, path as never);

        const backCalls = router.back.mock.calls.length;
        const replaceCalls = router.replace.mock.calls.length;
        return can
          ? backCalls === 1 && replaceCalls === 0
          : backCalls === 0 &&
              replaceCalls === 1 &&
              router.replace.mock.calls[0]?.[0] === path;
      })
    );
  });
});
