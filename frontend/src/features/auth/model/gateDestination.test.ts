import {
  getGateDestination,
  publishGateDestination,
  resetGateDestination,
  waitForGateDestination,
} from './gateDestination';
import type { BootstrapDestination } from './resolveBootstrapDestination';

/**
 * TRIP-1034 AC-1 — 게이트 목적지 공개 통로(읽는 쪽).
 *
 * 무엇을 보장하나: 설정의 로그아웃은 "게이트가 LOGIN 이라고 말할 때까지" 기다린 뒤 로그인 화면으로 간다.
 * 그 기다림이
 *  - 지금 값이 이미 LOGIN 이면 곧바로 끝나고(구독 선례처럼 현재 값을 버리면 영원히 기다린다),
 *  - 지금 값이 LOGIN 이 아니면 LOGIN 이 공개될 때 끝나며(과거에 LOGIN 이었던 적은 따지지 않는다),
 *  - LOGIN 이 아닌 값이 공개돼도 끝나지 않는다(01b Q2).
 *
 * 모듈 싱글턴이라 파일 최상위 afterEach 에서 비운다.
 */

/** 줄 선 비동기 처리를 한 바퀴 흘린다 — "아직 안 끝났다"를 단언하기 전에 필요하다. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** LOGIN 대기를 걸고, 끝났는지 읽을 수 있는 창을 돌려준다. */
function startWaitingForLogin(): { arrived: () => boolean } {
  let arrived = false;
  void waitForGateDestination('LOGIN').then(() => {
    arrived = true;
  });
  return { arrived: () => arrived };
}

afterEach(() => {
  resetGateDestination();
});

describe('TRIP-1034 AC-1 · 게이트 목적지 대기', () => {
  it('U1 이미 LOGIN 이 공개돼 있으면 대기가 곧바로 끝난다', async () => {
    // 준비
    publishGateDestination('LOGIN');

    // 실행
    const waiting = startWaitingForLogin();
    await flush();

    // 단언
    expect(waiting.arrived()).toBe(true);
  });

  it('U2 지금 값이 HOME 이면(예전에 LOGIN 이었어도) 기다리고, LOGIN 이 공개되면 끝난다', async () => {
    // 준비: 로그아웃 → 재로그인 흉내. 지금 값은 HOME 이다.
    publishGateDestination('LOGIN');
    publishGateDestination('HOME');

    // 실행 ①: 대기 시작
    const waiting = startWaitingForLogin();
    await flush();

    // 단언 ①: 아직 안 끝났다.
    expect(waiting.arrived()).toBe(false);

    // 실행 ②: 게이트가 LOGIN 을 공개한다.
    publishGateDestination('LOGIN');
    await flush();

    // 단언 ②: 이제 끝났다.
    expect(waiting.arrived()).toBe(true);
  });

  it.each<BootstrapDestination>([
    'HOME',
    'ONBOARDING',
    'FORCE_UPDATE',
    'RECONSENT',
  ])('U3 %s 가 공개돼도 LOGIN 대기는 끝나지 않는다', async (other) => {
    // 준비: 아무것도 공개되지 않은 상태에서 대기 시작
    const waiting = startWaitingForLogin();

    // 실행
    publishGateDestination(other);
    await flush();

    // 단언
    expect(waiting.arrived()).toBe(false);
  });

  it('U4 reset 뒤에는 값이 비어 있고, 앞서 공개된 LOGIN 으로 대기가 끝나지 않는다', async () => {
    // 준비
    publishGateDestination('LOGIN');

    // 실행
    resetGateDestination();
    const waiting = startWaitingForLogin();
    await flush();

    // 단언
    expect(getGateDestination()).toBeNull();
    expect(waiting.arrived()).toBe(false);
  });
});
