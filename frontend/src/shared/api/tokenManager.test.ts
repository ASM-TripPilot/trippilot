import {
  clearAccessToken,
  getAccessToken,
  hydrate,
  setAccessToken,
} from './tokenManager';

/**
 * T1-6 · tokenManager — 동기 in-memory access-token holder.
 *
 * 무엇을 보장하나: 인증 클라이언트의 요청 인터셉터는 매 요청마다 토큰을 **동기로**(즉시) 읽어야
 * 하는데(getAccessToken), 실제 토큰은 async SecureStore 에만 있다. 그 간극을 메우는 메모리 홀더가
 * 로그인 시 set 한 값을 즉시 돌려주고, 세션 만료 시 clear 로 비우며, 콜드 재시작 시 hydrate 로
 * 복원 값을 실을 수 있어야 한다.
 *
 * 홀더는 모듈 스코프 상태라 테스트 간 값이 새지 않게 매번 비운다.
 */

afterEach(() => {
  clearAccessToken();
});

describe('tokenManager — 동기 홀더 (T1-6)', () => {
  it('set 한 access 토큰을 getAccessToken 이 동기로 돌려주고, clear 하면 비워진다', () => {
    // 준비/실행 — 로그인 성공이 홀더에 토큰을 심는 상황.
    setAccessToken('access-abc');

    // 단언(긍정) — await 없이 즉시 그 값이 나와야 인터셉터가 헤더에 실을 수 있다.
    expect(getAccessToken()).toBe('access-abc');

    // 실행 — 세션 만료/로그아웃이 홀더를 비운다.
    clearAccessToken();

    // 단언(부정) — 비운 뒤에는 토큰이 남지 않는다. 긍정 단언과 한 it 에 묶어 공허한 통과를 막는다.
    expect(getAccessToken()).toBeNull();
  });

  it('hydrate 로 복원 값을 실으면 getAccessToken 이 그 값을 돌려준다(콜드 재시작 복원)', () => {
    // 준비/실행 — 콜드 재시작 후 SecureStore 에서 읽어 온 값을 홀더에 복원.
    hydrate('access-restored');

    // 단언 — 복원 값이 즉시 읽혀야 재진입 요청이 인증된다.
    expect(getAccessToken()).toBe('access-restored');
  });
});
