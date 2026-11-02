/**
 * @jest-environment node
 */

/**
 * TRIP-1649 · AC-W3-SEC-1 보강(5-b 경고) — OAuth state 의 세기와 대조 규칙을 직접 잠근다.
 *
 * 무엇을 보장하나:
 *  - state 는 암호학적 난수 128비트(16진 32자)다 — 짧게 줄이면 추측 공격에 약해진다.
 *  - 안전한 난수원(crypto.getRandomValues)이 없으면 약한 값으로 때우지 않고 던진다(INV-4).
 *  - 대조는 정확히 같은 문자열만 통과시킨다 — 다르거나 비어 있으면 던진다(CSRF 방어).
 */
import { assertOAuthStateMatches, generateOAuthState } from './oauthState';

describe('OAuth state 생성', () => {
  it('16진수 32자(128비트)이고 부를 때마다 다르다', () => {
    // 준비·실행 — 두 번 만든다
    const a = generateOAuthState();
    const b = generateOAuthState();

    // 단언 — 길이·문자 집합이 128비트 16진이고, 두 값이 다르다
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('getRandomValues 가 준 바이트를 그대로 16진으로 옮긴다(Math.random 같은 다른 난수원을 쓰지 않는다)', () => {
    // 준비 — 난수원을 고정 바이트를 주는 가짜로 바꾼다
    const spy = jest
      .spyOn(globalThis.crypto, 'getRandomValues')
      .mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
        const view = arr as unknown as Uint8Array;
        view.fill(0xab);
        return arr;
      });
    try {
      // 실행
      const state = generateOAuthState();

      // 단언 — 16바이트를 요청했고, 결과가 그 바이트의 16진 표기다
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as Uint8Array).length).toBe(16);
      expect(state).toBe('ab'.repeat(16));
    } finally {
      spy.mockRestore();
    }
  });

  it('안전한 난수원이 없으면 약한 값으로 때우지 않고 던진다', () => {
    // 준비 — 전역 crypto 를 잠시 없앤다
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    try {
      // 실행·단언
      expect(() => generateOAuthState()).toThrow(/난수원/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
    }
  });
});

describe('OAuth state 대조', () => {
  it('보낸 값과 정확히 같으면 통과한다', () => {
    expect(() => assertOAuthStateMatches('abc123', 'abc123')).not.toThrow();
  });

  it.each([
    ['다른 값', 'abc124'],
    ['빈 문자열', ''],
    ['없음', undefined],
    ['앞부분만 같은 값', 'abc'],
  ])('%s 이면 던진다', (_label, returned) => {
    expect(() => assertOAuthStateMatches('abc123', returned)).toThrow(/state/);
  });
});
