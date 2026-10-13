import {
  guardPress,
  openPressGuardWindow,
  resetPressGuard,
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
