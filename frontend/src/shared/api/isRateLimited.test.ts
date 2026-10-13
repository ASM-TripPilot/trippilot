import { AxiosError } from 'axios';

import {
  isGenerationDailyLimit,
  isRateLimited,
  retryAfterSeconds,
} from './isRateLimited';

/** `isAxiosError` 가 true 여야 판정이 도는 경로를 탄다(`isNotFound.test.ts` 선례). */
function httpError(
  status: number,
  headers: Record<string, string> = {},
  data: unknown = {}
): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data,
    headers,
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

describe('429 만 "한도 초과" 로 읽는다 (TRIP-1368)', () => {
  it('429 는 true 다 (긍정 앵커)', () => {
    expect(isRateLimited(httpError(429))).toBe(true);
  });

  it('다른 상태 코드는 false 다 — 409·500 은 기존 얼굴을 지킨다', () => {
    for (const status of [400, 401, 404, 409, 500, 503]) {
      expect(isRateLimited(httpError(status))).toBe(false);
    }
  });

  it('응답 없는 오류·axios 오류가 아닌 것은 false 다', () => {
    expect(isRateLimited(new AxiosError('Network Error'))).toBe(false);
    expect(isRateLimited(new Error('boom'))).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
    expect(isRateLimited({ response: { status: 429 } })).toBe(false);
  });
});

describe('Retry-After — 숫자 초만 읽고 나머지는 null (TRIP-1368)', () => {
  it('정수 초를 읽는다 (헤더 대소문자 무관)', () => {
    expect(retryAfterSeconds(httpError(429, { 'retry-after': '3600' }))).toBe(
      3600
    );
    expect(retryAfterSeconds(httpError(429, { 'Retry-After': '90' }))).toBe(90);
  });

  it('🔴 헤더가 없으면 null 이다 — 호출부가 시각 없이 안내한다 (INV-4)', () => {
    expect(retryAfterSeconds(httpError(429))).toBeNull();
  });

  it('숫자가 아닌 값(HTTP-date·빈 문자열·음수·소수)은 null 이다', () => {
    for (const bad of [
      'Wed, 21 Oct 2026 07:28:00 GMT',
      '',
      '-5',
      '1.5',
      'abc',
    ]) {
      expect(
        retryAfterSeconds(httpError(429, { 'retry-after': bad }))
      ).toBeNull();
    }
  });

  it('응답 없는 오류는 null 이다', () => {
    expect(retryAfterSeconds(new AxiosError('Network Error'))).toBeNull();
    expect(retryAfterSeconds(new Error('boom'))).toBeNull();
  });
});

describe('일일 한도는 429 + GENERATION_DAILY_LIMIT 일 때만 (TRIP-1368)', () => {
  const body = (code?: string) => ({ error: code ? { code } : {} });

  it('429 + GENERATION_DAILY_LIMIT 은 true 다 (긍정 앵커)', () => {
    expect(
      isGenerationDailyLimit(httpError(429, {}, body('GENERATION_DAILY_LIMIT')))
    ).toBe(true);
  });

  it('429 + RATE_LIMITED·모르는 코드·코드 없음·바디 없음은 false 다', () => {
    expect(
      isGenerationDailyLimit(httpError(429, {}, body('RATE_LIMITED')))
    ).toBe(false);
    expect(isGenerationDailyLimit(httpError(429, {}, body('X')))).toBe(false);
    expect(isGenerationDailyLimit(httpError(429, {}, body()))).toBe(false);
    expect(isGenerationDailyLimit(httpError(429, {}, {}))).toBe(false);
    expect(isGenerationDailyLimit(httpError(429, {}, undefined))).toBe(false);
    expect(isGenerationDailyLimit(httpError(429, {}, 'oops'))).toBe(false);
    expect(isGenerationDailyLimit(httpError(429, {}, null))).toBe(false);
  });

  it('상태가 429 가 아니면 코드가 같아도 false 다 · axios 오류가 아닌 것도 false', () => {
    expect(
      isGenerationDailyLimit(httpError(409, {}, body('GENERATION_DAILY_LIMIT')))
    ).toBe(false);
    expect(isGenerationDailyLimit(new Error('boom'))).toBe(false);
    expect(isGenerationDailyLimit(undefined)).toBe(false);
  });
});
