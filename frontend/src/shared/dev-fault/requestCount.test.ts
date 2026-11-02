import { createRequestCount } from './requestCount';

/**
 * 개발용 요청 카운터 저장소(TRIP-1714 · M-61) — 서버로 나간 요청을 세고, 화면 진입·앱 복귀 같은 **구간 표식** 이후 몇 건인지 알려 준다.
 *
 * 무엇을 보장하나:
 *  - 표식(`mark`)을 찍으면 건수가 0 으로 돌아가고, 그 뒤의 `hit` 만 센다 — "복귀 뒤 N건"을 읽는 방법이다.
 *  - 스냅샷은 값이 안 바뀌면 같은 객체다 — 리액트 `useSyncExternalStore` 는 읽을 때마다 새 객체를 주면 무한 재렌더한다.
 *    값이 바뀌면 새 객체이고, 이미 받아 둔 옛 스냅샷은 변하지 않는다.
 *  - 구독자는 `hit`·`mark` 마다 한 번씩 불리고, 해지하면 더 안 불린다.
 *
 * 배지(화면 구석 표시)·요청 인터셉터 설치는 `__DEV__ && NODE_ENV !== 'test'` 뒤라 jest 가 렌더하지 않는다 — 실기(6-b)에서 본다.
 * 저장소는 모듈 싱글턴(`requestCount`)과 같은 모양의 팩토리로 만들어 파일마다 새로 시작한다.
 */
describe('createRequestCount', () => {
  it('처음엔 표식 없이 0건이다', () => {
    const counter = createRequestCount();

    expect(counter.snapshot()).toEqual({ label: '', count: 0 });
  });

  it('hit 마다 건수가 한 건씩 는다', () => {
    const counter = createRequestCount();

    counter.hit();
    counter.hit();
    counter.hit();

    expect(counter.snapshot().count).toBe(3);
  });

  it('mark 는 건수를 0 으로 돌리고 라벨을 바꾼다 — 표식 이후의 요청만 센다', () => {
    const counter = createRequestCount();
    counter.hit();
    counter.hit();

    counter.mark('홈 진입');
    expect(counter.snapshot()).toEqual({ label: '홈 진입', count: 0 });

    counter.hit();
    counter.hit();
    counter.hit();
    expect(counter.snapshot()).toEqual({ label: '홈 진입', count: 3 });

    // 다음 구간(앱 복귀)은 다시 0 에서 센다.
    counter.mark('앱 복귀');
    counter.hit();
    expect(counter.snapshot()).toEqual({ label: '앱 복귀', count: 1 });
  });

  it('값이 안 바뀌면 같은 스냅샷 객체이고, 바뀌면 새 객체다 — 받아 둔 옛 스냅샷은 그대로다', () => {
    const counter = createRequestCount();
    counter.mark('A');
    counter.hit();
    const before = counter.snapshot();

    expect(counter.snapshot()).toBe(before);

    counter.hit();
    const after = counter.snapshot();

    expect(after).not.toBe(before);
    expect(after.count).toBe(2);
    expect(before.count).toBe(1);
  });

  it('구독자는 hit·mark 마다 한 번씩 불리고, 해지하면 더 안 불린다', () => {
    const counter = createRequestCount();
    const listener = jest.fn();
    const unsubscribe = counter.subscribe(listener);

    counter.hit();
    counter.mark('B');
    counter.hit();
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    counter.hit();
    counter.mark('C');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('구독자가 둘이어도 서로 해지에 영향받지 않는다', () => {
    const counter = createRequestCount();
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribeFirst = counter.subscribe(first);
    counter.subscribe(second);

    unsubscribeFirst();
    counter.hit();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
