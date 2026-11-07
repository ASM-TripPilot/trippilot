import { renderHook } from '@testing-library/react-native';

import {
  createPressLock,
  guardPress,
  openPressGuardWindow,
  PRESS_GUARD_SCREEN_LISTENERS,
  resetPressGuard,
  respectPressGuard,
  usePressLock,
} from './pressGuard';

/**
 * TRIP-1013 — 연타 관통 공용 가드(모듈 전역 400ms 창) 자체 계약.
 *
 * 무엇을 보장하나: 가드를 건 콜백이 한 번 받아들여지면 **모듈 하나에 든 창**이 400ms 열리고, 그동안
 * 가드를 건 **다른** 콜백(같은 콜백도)은 원래 함수를 부르지 않는다. 창은 화면을 건너가야 하므로
 * 감싼 함수마다가 아니라 모듈에 하나다 — 그래서 아래 A·B 는 서로 다른 `guardPress` 호출로 만든다.
 *
 * 시계는 jest 가짜 타이머로 움직인다(`advanceTimersByTime` 이 `Date.now()` 도 함께 옮긴다).
 * 창 경계는 "399ms 는 무시, 400ms 는 통과"다(02a §3 판정).
 *
 * 3동작: 준비(가드 콜백 만들기) → 실행(부르기·시계 옮기기) → 단언(원래 함수 호출 횟수).
 */

beforeEach(() => {
  jest.useFakeTimers();
  resetPressGuard();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AC-G1 · 창 안의 다른 가드 콜백은 무시된다', () => {
  it('A 가 받아들여진 직후 B 를 부르면 B 의 원래 함수는 0회다', () => {
    // 준비
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);

    // 실행
    a();
    b();

    // 단언 — 앵커: A 는 실제로 불렸다(창을 연 누름이 있었다).
    expect(rawA).toHaveBeenCalledTimes(1);
    expect(rawB).toHaveBeenCalledTimes(0);
  });

  it('01b Q3 · 같은 가드 콜백을 창 안에서 다시 불러도 원래 함수는 1회에 머문다', () => {
    const rawA = jest.fn();
    const a = guardPress(rawA);

    a();
    jest.advanceTimersByTime(60); // QA 연타 간격
    a();

    expect(rawA).toHaveBeenCalledTimes(1);
  });

  it('창 밖에서 받아들여진 B 도 새 창을 연다 — 그 직후 A 는 무시된다', () => {
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);

    a();
    jest.advanceTimersByTime(400);
    b();
    a();

    expect(rawB).toHaveBeenCalledTimes(1);
    expect(rawA).toHaveBeenCalledTimes(1);
  });
});

describe('AC-G2·G3 · 창 길이는 400ms — 399ms 는 무시, 400ms 는 정확히 1회', () => {
  it('399ms 뒤의 B 는 무시된다', () => {
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);

    a();
    jest.advanceTimersByTime(399);
    b();

    expect(rawA).toHaveBeenCalledTimes(1);
    expect(rawB).toHaveBeenCalledTimes(0);
  });

  it('400ms 뒤의 B 는 정확히 1회 불린다 (무회귀 — 가드가 정상 탭을 먹지 않는다)', () => {
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);

    a();
    jest.advanceTimersByTime(400);
    b();

    expect(rawB).toHaveBeenCalledTimes(1);
  });

  it('창 안에서 무시된 누름은 창을 늘리지 않는다 — 399ms 에 무시된 B 가 400ms 에는 통과한다', () => {
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);

    a();
    jest.advanceTimersByTime(399);
    b(); // 무시 — 창은 여전히 A 의 누름 시각 기준
    jest.advanceTimersByTime(1);
    b();

    expect(rawB).toHaveBeenCalledTimes(1);
  });
});

describe('AC-G4 · 테스트 리셋 — resetPressGuard 는 창을 닫는다', () => {
  it('창 안이라 무시되던 B 가, 리셋 직후에는 즉시 통과한다', () => {
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);

    a();
    b(); // 앵커 — 리셋 전에는 창 안이라 무시된다
    expect(rawB).toHaveBeenCalledTimes(0);

    resetPressGuard();
    b();

    expect(rawB).toHaveBeenCalledTimes(1);
  });
});

describe('AC-G5 · 감싼 콜백은 인자를 그대로 넘긴다', () => {
  it('객체 인자는 같은 참조로, 여러 인자는 순서대로 간다', () => {
    const raw = jest.fn();
    const pressed = guardPress((item: { key: string }, index: number) =>
      raw(item, index)
    );
    const item = { key: 'NAVER:s1' };

    pressed(item, 3);

    expect(raw).toHaveBeenCalledTimes(1);
    expect(raw.mock.calls[0][0]).toBe(item);
    expect(raw.mock.calls[0][1]).toBe(3);
  });
});

describe('01b Q2 · openPressGuardWindow — 표면이 바뀌는 순간 창을 다시 연다', () => {
  it('첫 누름의 창이 이미 닫힌 뒤(1000ms)에 다시 열면, 그 시점부터 399ms 는 무시·400ms 는 통과', () => {
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);

    a();
    jest.advanceTimersByTime(1000); // 서버 응답이 창보다 늦게 왔다
    openPressGuardWindow(); // 응답으로 표면이 바뀌는 순간
    jest.advanceTimersByTime(399);
    b();
    expect(rawB).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    b();

    expect(rawB).toHaveBeenCalledTimes(1);
  });

  it('누름 없이도 창을 연다 — 리셋 직후 열면 바로 다음 가드 콜백이 무시된다', () => {
    const rawB = jest.fn();
    const b = guardPress(rawB);

    openPressGuardWindow();
    b();

    expect(rawB).toHaveBeenCalledTimes(0);
  });
});

describe('5-b 경고-1 · 시계가 뒤로 가도 창이 400ms 보다 길어지지 않는다 (오케 보강)', () => {
  it('창을 연 뒤 기기 시계가 하루 뒤로 가면, 다음 가드 콜백은 무시되지 않는다', () => {
    // 준비 — A 로 창을 연다.
    const rawA = jest.fn();
    const rawB = jest.fn();
    const a = guardPress(rawA);
    const b = guardPress(rawB);
    a();
    expect(rawA).toHaveBeenCalledTimes(1);

    // 실행 — 시계를 하루 전으로 돌린다(NTP 보정·사용자 수동 변경).
    jest.setSystemTime(Date.now() - 24 * 60 * 60 * 1000);
    b();

    // 단언 — 경과 시간이 음수면 창 밖이다(아니면 다음 날까지 먹통).
    expect(rawB).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-1793 D4 — `respectPressGuard` 는 창을 **따르기만** 한다: 창 안이면 무시하고, 받아들인 누름이 창을 열지는 않는다
 * (편집기 저장 CTA — 실패 뒤 곧바로 다시 저장은 눌려야 하고, 저장 자신의 연타는 페이지 잠금이 막는다).
 */
describe('AC-G6 · respectPressGuard — 창을 따르되 열지 않는다', () => {
  it('창 안(399ms)이면 0회, 400ms 면 1회 · 받아들인 누름 뒤 다른 가드 콜백은 곧바로 통과한다', () => {
    // 준비
    const rawSave = jest.fn();
    const rawOther = jest.fn();
    const save = respectPressGuard(rawSave);
    const other = guardPress(rawOther);

    // 실행·단언 — 시트 [적용]이 창을 연 직후
    openPressGuardWindow();
    save();
    expect(rawSave).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(399);
    save();
    expect(rawSave).toHaveBeenCalledTimes(0);
    jest.advanceTimersByTime(1);
    save('arg');
    expect(rawSave).toHaveBeenCalledTimes(1);
    expect(rawSave).toHaveBeenLastCalledWith('arg');

    // 받아들인 누름이 창을 열지 않았다 — 같은 순간 다른 가드 콜백도, 자기 자신도 통과한다
    other();
    expect(rawOther).toHaveBeenCalledTimes(1);
    resetPressGuard();
    save();
    save();
    expect(rawSave).toHaveBeenCalledTimes(3);
  });
});

/**
 * TRIP-1827 — 판정이 시간 창 하나에서 "창 ∨ 화면 전환 중"으로 넓어진다.
 * 전환 신호는 Stack 의 `screenListeners` 가 주는 이벤트다(`closing:false` = 오는 화면 쪽만 믿는다 — JS back·replace 에선
 * 떠나는 화면의 끝 이벤트가 안 온다). 그래서 아래 `start`·`end` 는 오는 화면 쪽 이벤트를 그대로 흉내 낸다.
 */
const start = (closing = false) =>
  PRESS_GUARD_SCREEN_LISTENERS.transitionStart({ data: { closing } });
const end = (closing = false) =>
  PRESS_GUARD_SCREEN_LISTENERS.transitionEnd({ data: { closing } });

// 창을 여는 누름과 창을 따르는 누름 둘 다 같은 판정을 탄다.
const WRAPS: [string, (handler: () => void) => () => void][] = [
  ['guardPress', (handler) => guardPress(handler)],
  ['respectPressGuard', (handler) => respectPressGuard(handler)],
];

describe('TRIP-1827 · 화면 전환 중에는 누름을 무시한다', () => {
  it.each(WRAPS)('%s — 전환이 시작되면 무시된다', (_name, wrap) => {
    // 준비
    const raw = jest.fn();
    const pressed = wrap(raw);

    // 실행
    start();
    pressed();

    // 단언
    expect(raw).toHaveBeenCalledTimes(0);
  });

  it.each(WRAPS)(
    '%s — 전환이 끝나면 그때부터 400ms 창: 399 무시, 400 통과',
    (_name, wrap) => {
      const raw = jest.fn();
      const pressed = wrap(raw);

      start();
      jest.advanceTimersByTime(1000); // 전환 길이는 창과 무관하다
      end();
      jest.advanceTimersByTime(399);
      pressed();
      expect(raw).toHaveBeenCalledTimes(0);

      jest.advanceTimersByTime(1);
      pressed();
      expect(raw).toHaveBeenCalledTimes(1);
    }
  );

  it('떠나는 화면의 시작(closing:true)은 전환을 켜지 않는다', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    start(true);
    pressed();

    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('떠나는 화면의 끝(closing:true)은 창을 열지 않는다', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    end(true);
    pressed();

    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('떠나는 화면의 끝(closing:true)은 오는 화면의 전환을 지우지 않는다', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    start();
    end(true);
    pressed();

    expect(raw).toHaveBeenCalledTimes(0);
  });

  it('끝 이벤트가 안 와도 상한 2000ms 에 풀린다 — 1999 무시(무시된 누름은 늘리지 않는다), 2000 통과', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    start();
    jest.advanceTimersByTime(1999);
    pressed();
    expect(raw).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    pressed();
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('스와이프 취소(gestureCancel)는 즉시 풀고 창을 열지 않는다', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    start();
    PRESS_GUARD_SCREEN_LISTENERS.gestureCancel();
    pressed();

    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('전환 중 기기 시계가 하루 뒤로 가도 먹통이 되지 않는다', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    start();
    jest.setSystemTime(Date.now() - 24 * 60 * 60 * 1000);
    pressed();

    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('resetPressGuard 는 전환까지 지운다', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    start();
    pressed(); // 앵커 — 리셋 전에는 전환 중이라 무시된다
    expect(raw).toHaveBeenCalledTimes(0);

    resetPressGuard();
    pressed();

    expect(raw).toHaveBeenCalledTimes(1);
  });
});

/**
 * 5-b W3 — 오는 중인 화면이 끝 이벤트 없이 지워지는 길(등장 중 닫힌 `transparentModal`).
 * `beforeRemove` 는 **전환을 시작한 그 화면**(target 이 같을 때)만 끝으로 친다. 다른 화면이 지워지는 것은 무관하다.
 * 400ms 경계로 두 가지를 한 번에 본다: 399 무시 = 창이 열렸다 · 400 통과 = 전환이 풀렸다(안 풀렸으면 2000 까지 막힌다).
 */
describe('TRIP-1827 5-b W3 · 전환을 시작한 화면이 끝 없이 지워지면(beforeRemove) 끝과 같다', () => {
  const startOn = (target: string) =>
    PRESS_GUARD_SCREEN_LISTENERS.transitionStart({
      target,
      data: { closing: false },
    });

  it('같은 화면(A)이 지워지면 전환이 풀리고 400ms 창이 열린다 — 399 무시, 400 통과', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    startOn('route-A');
    jest.advanceTimersByTime(100);
    PRESS_GUARD_SCREEN_LISTENERS.beforeRemove({ target: 'route-A' });
    jest.advanceTimersByTime(399);
    pressed();
    expect(raw).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    pressed();
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('다른 화면(B)이 지워지면 그대로 전환 중이다 — 1000ms 뒤에도 무시, 상한 2000 에 통과', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    startOn('route-A');
    PRESS_GUARD_SCREEN_LISTENERS.beforeRemove({ target: 'route-B' });
    jest.advanceTimersByTime(1000);
    pressed();
    expect(raw).toHaveBeenCalledTimes(0);

    // 앵커 — 막힌 이유가 전환이라는 것(상한에서 풀린다).
    jest.advanceTimersByTime(1000);
    pressed();
    expect(raw).toHaveBeenCalledTimes(1);
  });
});

describe('TRIP-1827 · 창 길이 — guardPress 둘째 인자와 재오픈', () => {
  it('guardPress(fn, 800) 이 연 창: 다른 가드·따르는 가드 모두 799 무시, 800 통과', () => {
    // 준비
    const rawOpener = jest.fn();
    const rawOther = jest.fn();
    const rawFollower = jest.fn();
    const other = guardPress(rawOther);
    const follower = respectPressGuard(rawFollower);

    // 실행
    guardPress(rawOpener, 800)();
    jest.advanceTimersByTime(799);
    follower();
    other();

    // 단언
    expect(rawOpener).toHaveBeenCalledTimes(1);
    expect(rawFollower).toHaveBeenCalledTimes(0);
    expect(rawOther).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    follower();
    other();
    expect(rawFollower).toHaveBeenCalledTimes(1);
    expect(rawOther).toHaveBeenCalledTimes(1);
  });

  it('openPressGuardWindow 는 남은 창을 줄이지 않는다 — 800 창 100ms 뒤 400 재오픈, 첫 누름 기준 799 무시·800 통과', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    guardPress(jest.fn(), 800)();
    jest.advanceTimersByTime(100);
    openPressGuardWindow();
    jest.advanceTimersByTime(699);
    pressed();
    expect(raw).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    pressed();
    expect(raw).toHaveBeenCalledTimes(1);
  });

  it('남은 창이 더 짧으면 늘린다 — 400 창 300ms 뒤 재오픈, 재오픈 기준 399 무시·400 통과', () => {
    const raw = jest.fn();
    const pressed = guardPress(raw);

    guardPress(jest.fn())();
    jest.advanceTimersByTime(300);
    openPressGuardWindow();
    jest.advanceTimersByTime(399);
    pressed();
    expect(raw).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1);
    pressed();
    expect(raw).toHaveBeenCalledTimes(1);
  });
});

/**
 * TRIP-1827 — 손으로 짜던 `useRef` 잠금의 자리. 쥐고 푸는 시점은 호출부 몫이고(성공하면 쥔 채 떠나는 화면이 있다),
 * 잠금은 "쥐고 있거나 화면 전환 중"만 본다. **창은 안 본다** — 아래 ★ 참고.
 */
describe('TRIP-1827 · createPressLock', () => {
  it('같은 틱에 두 번 쥐면 true, false', () => {
    // 준비
    const lock = createPressLock();

    // 실행
    const first = lock.acquire();
    const second = lock.acquire();

    // 단언
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('풀면 다시 쥘 수 있다', () => {
    const lock = createPressLock();
    lock.acquire();

    lock.release();

    expect(lock.acquire()).toBe(true);
  });

  it('전환 중에는 못 쥐고(실패가 잠금을 남기지 않는다), 전환이 끝나면 쥔다', () => {
    const lock = createPressLock();

    start();
    expect(lock.acquire()).toBe(false);
    expect(lock.isHeld()).toBe(false);

    end();
    expect(lock.acquire()).toBe(true);
  });

  it('흐름 안 호출은 전환을 무시하고 쥔다 — 이미 쥐고 있으면 그래도 false', () => {
    // 왜: 응답 뒤에 이어 부르는 잠금이 전환 때문에 조용히 빠지면 등록이 유실된다(registerMustVisits).
    const lock = createPressLock();

    start();
    expect(lock.acquire({ transition: 'ignore' })).toBe(true);
    expect(lock.acquire({ transition: 'ignore' })).toBe(false);
  });

  it('전환 상한은 잠금도 같다 — 1999 false, 2000 true', () => {
    const lock = createPressLock();

    start();
    jest.advanceTimersByTime(1999);
    expect(lock.acquire()).toBe(false);

    jest.advanceTimersByTime(1);
    expect(lock.acquire()).toBe(true);
  });

  it('★ 창이 열려 있어도 쥔다', () => {
    const lock = createPressLock();

    openPressGuardWindow();

    expect(lock.acquire()).toBe(true);
  });

  // guardPress 는 핸들러를 부르기 전에 창을 연다 — 잠금이 창까지 보면 이 조합의 모든 누름이 삼켜진다.
  it('★ guardPress 안에서 쥐면 자기가 연 창에 걸리지 않는다', () => {
    const lock = createPressLock();
    const acquired = jest.fn();

    guardPress(() => acquired(lock.acquire()))();

    expect(acquired).toHaveBeenCalledTimes(1);
    expect(acquired).toHaveBeenCalledWith(true);
  });

  it('isHeld 는 쥔 동안만 true', () => {
    const lock = createPressLock();
    expect(lock.isHeld()).toBe(false);

    lock.acquire();
    expect(lock.isHeld()).toBe(true);

    lock.release();
    expect(lock.isHeld()).toBe(false);
  });

  it('잠금끼리는 독립이다', () => {
    const a = createPressLock();
    const b = createPressLock();

    a.acquire();

    expect(b.acquire()).toBe(true);
  });
});

describe('TRIP-1827 · usePressLock', () => {
  it('리렌더해도 같은 객체이고 쥔 상태가 남는다', () => {
    // 준비
    const hook = renderHook(() => usePressLock());
    const lock = hook.result.current;
    lock.acquire();

    // 실행
    hook.rerender(undefined);

    // 단언
    expect(hook.result.current).toBe(lock);
    expect(hook.result.current.isHeld()).toBe(true);
  });

  it('마운트마다 다른 잠금이다', () => {
    const one = renderHook(() => usePressLock());
    const two = renderHook(() => usePressLock());

    expect(one.result.current).not.toBe(two.result.current);
  });

  it('언마운트 뒤 늦게 풀어도 던지지 않는다', () => {
    const hook = renderHook(() => usePressLock());
    const lock = hook.result.current;
    lock.acquire();

    hook.unmount();

    expect(() => lock.release()).not.toThrow();
    expect(lock.acquire()).toBe(true);
  });
});
