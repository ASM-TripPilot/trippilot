import { AxiosError } from 'axios';

import {
  resolveSlotSwapError,
  SLOT_SWAP_CONFLICT_CODES,
} from './slotSwapError';

/**
 * AC7 (INV-4) — PUT 실패를 침묵시키지 않고 갈래별 문구로 안내한다.
 *
 * 무엇을 보장하나: 409 는 전역 오류봉투의 `error.response.data.error.code` 로 확정일정·생성중·
 * 슬롯특정불가 **셋을 서로 다른 문구**로 가르고, code 가 없거나 모르는 값이면 **공통 폴백**으로
 * 안전하게 접는다(계약이 3 코드를 아직 문서화하지 않았으므로 — Seed 3-a). 404·400·네트워크도
 * 각각 안내한다. 어느 경우에도 빈 문구로 삼키지 않는다.
 *
 * 왜 status 만으론 안 되나: 기존 isNotFound(404)·isAlreadyRegistered(409)는 status 만 봐서
 * 409 세 갈래를 못 가른다 — 그래서 code 까지 보는 신규 판정이다.
 *
 * 3동작 뼈대: 준비=오류 객체 → 실행=resolveSlotSwapError → 단언=kind·문구.
 */

/**
 * `isAxiosError` 가 true 여야 판정이 도는 경로를 탄다(isNotFound.test 선례 — 평범한 객체는
 * false 다). code 를 주면 전역 봉투 `{error:{code,message}}` 로, 안 주면 code 필드 없는 봉투로.
 */
function httpError(status: number, code?: string): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: code === undefined ? {} : { error: { code, message: '서버 문구' } },
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

describe('🔴 resolveSlotSwapError — 실패 갈래별 안내 (AC7 · INV-4)', () => {
  it('C1 · 409 code 3분기: 확정일정·생성중·슬롯특정불가 를 서로 다른 kind 로', () => {
    // 대표 code 값은 계약 미문서화라 모듈 상수를 그대로 쓴다(테스트가 값을 발명하지 않음).
    expect(
      resolveSlotSwapError(httpError(409, SLOT_SWAP_CONFLICT_CODES.confirmed))
        .kind
    ).toBe('confirmed');
    expect(
      resolveSlotSwapError(httpError(409, SLOT_SWAP_CONFLICT_CODES.generating))
        .kind
    ).toBe('generating');
    expect(
      resolveSlotSwapError(httpError(409, SLOT_SWAP_CONFLICT_CODES.ambiguous))
        .kind
    ).toBe('ambiguous');
  });

  it('C2 · 409 인데 모르는 code → fallback (계약 공백 방어)', () => {
    expect(resolveSlotSwapError(httpError(409, '__UNKNOWN_CODE__')).kind).toBe(
      'fallback'
    );
  });

  it('C3 · 409 인데 code 필드 자체가 없음 → fallback', () => {
    expect(resolveSlotSwapError(httpError(409)).kind).toBe('fallback');
  });

  it('C4 · 404 → notFound, 400 → badRequest (각각 인라인)', () => {
    expect(resolveSlotSwapError(httpError(404)).kind).toBe('notFound');
    expect(resolveSlotSwapError(httpError(400)).kind).toBe('badRequest');
  });

  it('C5 · 응답이 아예 없는 오류(네트워크) → fallback, 문구는 비어 있지 않다', () => {
    const result = resolveSlotSwapError(new AxiosError('Network Error'));
    expect(result.kind).toBe('fallback');
    expect(result.message).toMatch(/\S/); // INV-4 — 침묵 금지
  });

  it('C6 · 네 문구(확정·생성중·특정불가·폴백)가 서로 다르다 — 한 문구로 뭉치지 않는다', () => {
    const messages = [
      resolveSlotSwapError(httpError(409, SLOT_SWAP_CONFLICT_CODES.confirmed))
        .message,
      resolveSlotSwapError(httpError(409, SLOT_SWAP_CONFLICT_CODES.generating))
        .message,
      resolveSlotSwapError(httpError(409, SLOT_SWAP_CONFLICT_CODES.ambiguous))
        .message,
      resolveSlotSwapError(httpError(409, '__UNKNOWN_CODE__')).message,
    ];
    // pairwise distinct — 개수만 세지 않고 서로 다름을 Set 크기로 확인.
    expect(new Set(messages).size).toBe(4);
    for (const message of messages) {
      expect(message).toMatch(/\S/);
    }
  });

  it('C7 · axios 오류가 아닌 것도 침묵하지 않는다 → fallback', () => {
    for (const input of [new Error('boom'), undefined, null]) {
      const result = resolveSlotSwapError(input);
      expect(result.kind).toBe('fallback');
      expect(result.message).toMatch(/\S/);
    }
  });
});
