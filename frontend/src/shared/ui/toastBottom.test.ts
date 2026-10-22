import {
  getToastBottoms,
  registerToastBottom,
  resetToastBottoms,
  resolveToastBottom,
  subscribeToastBottoms,
} from './toastBottom';

/**
 * TRIP-1559 · T1(예시)·T2(등록 생애주기) — 토스트 바닥 규칙(`resolveToastBottom`)과 등록 목록(레지스트리).
 *
 * *(개념)* 레지스트리 = 화면들이 "나는 지금 화면 아래 이만큼을 막고 있다"를 적어 두는 공용 목록.
 * 토스트 호스트는 그 목록의 최댓값 위에 뜬다. 목록이 비면 안전영역 위 16.
 *
 * 무엇을 보장하나:
 *  - T1 등록이 없으면 `인셋+16`, 있으면 `max(등록)+12`(안전영역 바닥 아래로는 못 내려간다).
 *  - T2 등록은 해제 함수로만 빠진다. 같은 높이를 둘이 등록해도 서로 안 지운다(자리 하나 = 항목 하나).
 *  - 구독자는 바뀔 때만 불린다. 값이 안 바뀌면 같은 배열 참조를 돌려준다(useSyncExternalStore 가 무한 렌더하지 않게).
 *
 * 속성(임의 입력) 쪽은 `toastBottom.property.test.ts`. 위치(px)가 화면에 실제로 어떻게 보이는가는 6-b 실화면 몫.
 * 3동작 뼈대: 준비=등록 → 실행=해제/리셋 → 단언=목록.
 */

// 모듈 싱글턴이라 파일 최상위(describe 밖)에서 리셋한다 — describe 안에만 걸면 앞 테스트의 등록이 새어
// "해제하면 사라진다" 단언이 거짓 green 이 된다.
afterEach(() => resetToastBottoms());

describe('T2 · 앵커 — 이전 상태 없음', () => {
  it('이 파일 첫 테스트 시점에 등록이 없다 (앞 파일·앞 테스트의 상태가 새지 않았다)', () => {
    expect(getToastBottoms()).toEqual([]);
  });
});

describe('T1 · resolveToastBottom 예시', () => {
  it('등록이 없으면 안전영역 인셋 위 16', () => {
    expect(resolveToastBottom([], 0)).toBe(16);
    expect(resolveToastBottom([], 34)).toBe(50);
  });

  it('등록이 있으면 가장 높은 값 위 12 — 인셋은 더하지 않는다(등록 쪽이 이미 센다)', () => {
    expect(resolveToastBottom([70], 34)).toBe(82);
    // FAB 스택 윗변 208 이 탭 바 알약 윗변 70 을 이겨 220 — 옛 고정값(TRIP-1286)과 같다.
    expect(resolveToastBottom([70, 208], 34)).toBe(220);
  });

  it('(경계) 등록이 낮아도 안전영역 바닥(인셋+16) 아래로는 내려가지 않는다', () => {
    expect(resolveToastBottom([4], 34)).toBe(50);
  });

  it('(금지) 받은 배열을 바꾸지 않는다', () => {
    const registered = Object.freeze([70, 208]);
    expect(() => resolveToastBottom(registered, 0)).not.toThrow();
    expect(registered).toEqual([70, 208]);
  });
});

describe('T2 · 레지스트리 생애주기', () => {
  it('등록하면 목록에 보이고, 해제하면 사라진다', () => {
    const off = registerToastBottom(82);
    expect(getToastBottoms()).toEqual([82]);

    off();
    expect(getToastBottoms()).toEqual([]);
  });

  it('같은 높이를 둘이 등록해도 하나만 해제하면 다른 하나가 남는다', () => {
    const offA = registerToastBottom(70);
    registerToastBottom(70);
    expect(getToastBottoms()).toEqual([70, 70]);

    offA();
    expect(getToastBottoms()).toEqual([70]);

    // 같은 해제 함수를 또 불러도 남은 하나를 지우지 않는다.
    offA();
    expect(getToastBottoms()).toEqual([70]);
  });

  it('리셋하면 모두 비고, 리셋 전의 낡은 해제 함수는 새로 등록한 같은 높이를 지우지 않는다', () => {
    const stale = registerToastBottom(70);
    resetToastBottoms();
    expect(getToastBottoms()).toEqual([]);

    registerToastBottom(70);
    stale();

    expect(getToastBottoms()).toEqual([70]);
  });

  it('바뀌지 않으면 같은 배열 참조, 바뀌면 새 배열이고 먼저 받은 스냅샷은 그대로다', () => {
    const empty = getToastBottoms();
    expect(getToastBottoms()).toBe(empty);

    registerToastBottom(70);
    const one = getToastBottoms();

    expect(one).not.toBe(empty);
    expect(empty).toEqual([]);
    expect(getToastBottoms()).toBe(one);
  });

  it('구독자는 등록·해제마다 불리고, 구독을 끊으면 더는 안 불린다', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToastBottoms(listener);

    const off = registerToastBottom(70);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    registerToastBottom(70);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('등록이 있는 채 리셋하면 구독자에게 알린다(호스트가 낡은 값을 안 쥔다)', () => {
    registerToastBottom(70);
    const listener = jest.fn();
    subscribeToastBottoms(listener);

    resetToastBottoms();

    expect(listener).toHaveBeenCalled();
    expect(getToastBottoms()).toEqual([]);
  });
});
