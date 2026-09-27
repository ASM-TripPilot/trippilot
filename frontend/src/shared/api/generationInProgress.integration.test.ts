import { http, HttpResponse } from 'msw';

import { server } from '@/mocks/server';
import { postTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { resolveGenerationInProgress } from './generationInProgress';

/**
 * TRIP-1032 · AC-1 — 생성 POST 의 409 `GENERATION_IN_PROGRESS` 를 다른 실패와 가르고, 지금 생성 중인
 * 여행(`error.activeTripId`)을 꺼낸다(openapi POST /trips/{tripId}/itinerary 409 · TRIP-403).
 *
 * 무엇을 보장하나:
 *  - 🔴 P1 409 + `GENERATION_IN_PROGRESS` + activeTripId → `{ activeTripId }`.
 *  - 🔴 P2~P4 다른 409 code · 봉투 없는 409 · 500 → null (화면은 지금처럼 일반 실패 얼굴).
 *  - 🔴 P5 axios 오류가 아닌 값은 null — 생성 타입(`void | ErrorResponse`)대로 생긴 평범한 객체도 null.
 *
 * 왜 실제 요청으로 오류를 만드나: 오류를 손으로 만들면 "상상한 모양"을 잰다. 여기선 가짜 서버가 409 를
 * 돌려주고, 생성 함수 → mutator → 인증 클라이언트를 **실제로** 거친 오류를 판별한다(02a ★2).
 *
 * 3동작: 준비 = 가짜 서버 응답 → 실행 = 실제 생성 POST 를 보내 던져진 오류를 판별 → 단언 = 판별 결과.
 */

// 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(리포 통합 테스트 관례).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const ACTIVE_TRIP_ID = '22222222-2222-2222-2222-222222222222';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => setAccessToken('valid-access'));
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});
afterAll(() => server.close());

/** 가짜 서버가 생성 POST 에 `status`·`body` 로 답하게 하고, 실제 POST 가 던진 오류를 돌려준다. */
async function errorFromServer(
  status: number,
  body: unknown
): Promise<unknown> {
  server.use(
    http.post(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(body as Record<string, unknown>, { status })
    )
  );
  try {
    await postTripsTripIdItinerary(TRIP_ID, { generationMode: 'FULLY_AI' });
  } catch (error) {
    return error;
  }
  throw new Error('생성 POST 가 실패하지 않았다 — 준비가 잘못됐다');
}

describe('🔴 P1 · AC-1 — 다른 여행 생성 중(409 GENERATION_IN_PROGRESS)이면 그 여행 id 를 꺼낸다', () => {
  it('실제 409 응답에서 activeTripId 를 돌려준다', async () => {
    const error = await errorFromServer(409, {
      error: {
        code: 'GENERATION_IN_PROGRESS',
        message: '다른 여행의 일정을 만들고 있어요',
        activeTripId: ACTIVE_TRIP_ID,
      },
    });

    expect(resolveGenerationInProgress(error)).toEqual({
      activeTripId: ACTIVE_TRIP_ID,
    });
  });
});

describe('🔴 P2~P4 · AC-1 — 그 밖의 실패는 null (지금처럼 일반 실패로)', () => {
  it.each([
    [
      'P2 다른 code 의 409',
      409,
      { error: { code: 'CONFLICT', message: '충돌' } },
    ],
    ['P3 오류 봉투 없는 409', 409, {}],
    [
      'P4 500',
      500,
      { error: { code: 'INTERNAL_ERROR', message: '서버 오류' } },
    ],
  ])('%s → null', async (_label, status, body) => {
    const error = await errorFromServer(status, body);

    expect(resolveGenerationInProgress(error)).toBeNull();
  });
});

describe('🔴 P5 · ★1 — axios 오류가 아니면 null (생성 타입을 믿고 읽는 구현 차단)', () => {
  it('평범한 Error · undefined · 타입대로 생긴 평범한 객체 모두 null', () => {
    expect(resolveGenerationInProgress(new Error('x'))).toBeNull();
    expect(resolveGenerationInProgress(undefined)).toBeNull();
    // codegen 의 `ErrorResponse` 모양 그대로인 객체 — 런타임 오류는 이렇게 생기지 않는다(02a ★1).
    // 이걸 `{ activeTripId }` 로 읽는 구현은 실제 409(AxiosError)에서는 항상 놓친다.
    expect(
      resolveGenerationInProgress({
        error: {
          code: 'GENERATION_IN_PROGRESS',
          message: 'm',
          activeTripId: ACTIVE_TRIP_ID,
        },
      })
    ).toBeNull();
  });
});
