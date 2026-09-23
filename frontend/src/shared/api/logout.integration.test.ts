import { waitFor } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import { clearTokens, getTokens, saveTokens } from '@/shared/storage';
import { logout } from '.';
import { getAccessToken, setAccessToken } from './tokenManager';

/**
 * TRIP-938 — `logout()` 계약(BR-U0-09: 이 기기 체인만 revoke + 클라 저장 토큰 즉시 삭제).
 *
 * 무엇을 보장하나:
 *  (1) 저장돼 있던 refresh 토큰을 **바디에 실어** `POST /auth/logout` 을 정확히 1번 보낸다(AC-1·AC-5).
 *      무인증 경로라 `Authorization` 헤더가 없다 — 메모리에 access 가 있어도 붙이지 않는다.
 *  (2) 끝나면 기기 저장소와 메모리의 토큰이 모두 비어 있다(AC-1).
 *  (3) 서버가 500 이든 네트워크가 끊겼든 reject 하지 않고 토큰을 지운다 — 미처리 rejection 도 없다(AC-2).
 *  (4) 서버 응답을 기다리지 않는다 — 응답이 오기 전에 resolve 한다(01 Q4, fire-and-forget).
 *
 * 왜 바디 값까지 보나(02a ★1): 실서버는 refreshToken 이 없으면 400 인데, (3) 이 그 실패를 삼킨다.
 *  "요청 1번"만 세면 바디 없는 구현도 통과하고, 서버 체인은 한 번도 안 끊긴다.
 *
 * 3동작 뼈대: 준비=토큰 저장·MSW 핸들러 → 실행=await logout() → 단언=요청 바디/헤더·저장소·메모리.
 *
 * *(개념)* fire-and-forget: 요청을 보내 놓고 결과를 기다리지 않는 방식. 실패해도 할 일이 같으니
 *  기다릴 이유가 없다. 대신 실패를 `.catch` 로 받아 두지 않으면 "처리 안 된 실패"가 남는다.
 */

// secure-store 3함수만 메모리 Map 으로 바꾼다 — 실제 shared/storage 가 돌아 "읽기 → 삭제"를 본다(02a ★6).
// jest.mock 팩토리는 파일 맨 위로 끌어올려지므로 Map 은 팩토리 **안에서** 만든다.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      store.set(key, value);
    },
    deleteItemAsync: async (key: string) => {
      store.delete(key);
    },
  };
});

const BASE = 'http://localhost:8080/api/v1';
const LOGOUT_PATH = '/api/v1/auth/logout';

/** 로그아웃 요청이 서버에 도착한 기록(헤더·바디). */
let received: { authorization: string | null; body: unknown }[] = [];
/** 끝난 요청 수 — 응답·네트워크 실패 모두에서 울린다(02a §5-U3). */
let ended = 0;
/** 응답 보류 게이트 해제 함수(L5). afterEach 에서도 한 번 더 부른다(02a ★13). */
let releaseGate: () => void = () => {};

/** 캡처 핸들러 — 받은 헤더·바디를 적고 `respond()` 결과를 돌려준다. */
function captureLogout(respond: () => Response | Promise<Response>) {
  server.use(
    http.post(`${BASE}/auth/logout`, async ({ request }) => {
      received.push({
        authorization: request.headers.get('authorization'),
        body: await request.json().catch(() => null),
      });
      return respond();
    })
  );
}

/** 요청이 끝날 때까지 기다린 뒤 한 번 더 흘린다 — 미처리 rejection 이 이 테스트 안에서 드러나게(02a ★2). */
async function settle() {
  await waitFor(() => expect(ended).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:end', ({ request }) => {
    if (new URL(request.url).pathname === LOGOUT_PATH) ended += 1;
  });
});

beforeEach(async () => {
  received = [];
  ended = 0;
  // 준비(공통): 로그인 상태 — 기기 저장소에 토큰 쌍, 메모리에 access.
  await clearTokens();
  await saveTokens({ accessToken: 'access-A', refreshToken: 'refresh-A' });
  setAccessToken('access-A');
});

afterEach(() => {
  releaseGate();
  server.resetHandlers();
});

afterAll(() => server.close());

describe('TRIP-938 · logout() — 서버 폐기 요청 (AC-1 · AC-5)', () => {
  it('L1 저장돼 있던 refresh 토큰을 바디에 실어 정확히 1번, Authorization 헤더 없이 보낸다', async () => {
    // 준비: 서버는 204(openapi 응답).
    captureLogout(() => new HttpResponse(null, { status: 204 }));

    // 실행
    await logout();
    await settle();

    // 단언(앵커): 요청이 정확히 1번 도착했다 — 아래 헤더·바디 단언이 공허하지 않다.
    expect(received).toHaveLength(1);
    // 단언(급소 · 완전일치): 바디는 저장돼 있던 refresh 값 한 필드다(02a ★1).
    expect(received[0].body).toEqual({ refreshToken: 'refresh-A' });
    // 단언: 메모리에 access 가 있는데도 헤더를 안 붙였다 = 무인증 경로다(02a ★12).
    expect(received[0].authorization).toBeNull();
  });

  it('L2 끝나면 기기 저장소와 메모리의 토큰이 모두 비어 있다(BR-U0-09)', async () => {
    captureLogout(() => new HttpResponse(null, { status: 204 }));

    await logout();
    await settle();

    // 단언: 저장소(부분 저장도 null 로 보는 getTokens)와 메모리 둘 다 비었다.
    await expect(getTokens()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});

describe('TRIP-938 · logout() — 서버가 실패해도 로그아웃한다 (AC-2)', () => {
  it('L3 서버 500 이어도 reject 없이 토큰을 지우고, 처리 안 된 실패를 남기지 않는다', async () => {
    // 준비: 서버 오류.
    captureLogout(() => new HttpResponse(null, { status: 500 }));

    // 실행: reject 하면 여기서 테스트가 실패한다.
    await expect(logout()).resolves.toBeUndefined();
    // 요청이 끝날 때까지 기다린다 — `.catch` 가 없으면 여기서 jest 가 이 테스트를 FAIL 시킨다(02a ★2).
    await settle();

    // 단언: 사용자 의도가 우선 — 토큰은 지워졌다.
    await expect(getTokens()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('L4 네트워크가 끊겨도(응답 없음) reject 없이 토큰을 지운다', async () => {
    // 준비: 응답 자체가 오지 않는 실패.
    captureLogout(() => HttpResponse.error());

    await expect(logout()).resolves.toBeUndefined();
    await settle();

    await expect(getTokens()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
  });
});

describe('TRIP-938 · logout() — 서버 응답을 기다리지 않는다 (01 Q4)', () => {
  it('L5 서버가 응답하기 전에 resolve 하고, 그때 이미 토큰이 지워져 있다', async () => {
    // 준비: 게이트를 풀기 전까지 응답을 보류하는 서버.
    let responded = false;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    captureLogout(async () => {
      await gate;
      responded = true;
      return new HttpResponse(null, { status: 204 });
    });

    // 실행: 응답을 기다리는 구현이면 여기서 멈춰 타임아웃으로 red 가 난다.
    await logout();

    // 단언(급소): resolve 시점에 서버는 아직 응답 전이다.
    expect(responded).toBe(false);
    // 단언: 요청은 이미 나가 도착했고, 토큰은 이미 지워졌다.
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0].body).toEqual({ refreshToken: 'refresh-A' });
    await expect(getTokens()).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();

    // 정리: 게이트를 풀고 요청이 끝날 때까지 기다린다(다음 테스트로 새지 않게, 02a ★13).
    releaseGate();
    await settle();
    expect(responded).toBe(true);
  });
});
