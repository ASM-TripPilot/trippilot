import fc from 'fast-check';

import {
  applyFaultAction,
  faultErrorBody,
  findRule,
  matchesPath,
  parseFaultLink,
  type FaultRule,
} from './rules';

/**
 * 실패 주입(개발 빌드 전용) — 규칙 순수 함수.
 *
 * 무엇을 보장하나:
 *  - 경로 글롭: `*` = 경로 한 칸(`/` 를 넘지 않는다) · `**` = 몇 칸이든 · 쿼리는 무시 · 나머지 글자는 글자 그대로.
 *  - 규칙은 GET 에만 걸린다(쓰기 요청은 어떤 규칙이 있어도 null) — 쓰기 요청이 가짜로 성공·실패하면 서버에 갔는지 헷갈린다.
 *  - 상대 경로(`/trips/…`)든 baseURL 을 붙인 전체 경로(`/api/v1/trips/…`)든 글롭이 맞으면 잡는다.
 *  - 딥링크 파라미터 → 동작(clear·set·invalid). 같은 경로 규칙은 덮어쓴다.
 */

// `/` 가 없는 경로 한 칸.
const segment = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
const writeMethod = fc.constantFrom(
  'post',
  'put',
  'patch',
  'delete',
  'POST',
  'PUT',
  'PATCH',
  'DELETE'
);

describe('matchesPath — 경로 글롭', () => {
  it('P1 `*` 는 어떤 한 칸과도 맞고, 두 칸 이상과는 맞지 않는다', () => {
    fc.assert(
      fc.property(segment, segment, (a, b) => {
        expect(matchesPath('/trips/*/itinerary', `/trips/${a}/itinerary`)).toBe(
          true
        );
        expect(
          matchesPath('/trips/*/itinerary', `/trips/${a}/${b}/itinerary`)
        ).toBe(false);
      })
    );
  });

  it('P2 `**` 는 몇 칸이든 맞는다', () => {
    fc.assert(
      fc.property(fc.array(segment, { maxLength: 4 }), (parts) => {
        const middle = parts.length ? `/${parts.join('/')}` : '';
        expect(matchesPath('/trips/**', `/trips${middle}/x`)).toBe(true);
      })
    );
  });

  it('쿼리 문자열은 무시하고, 글롭 밖 글자(.)는 글자 그대로다', () => {
    expect(matchesPath('/stays/search', '/stays/search?q=a&page=2')).toBe(true);
    expect(matchesPath('/a.b', '/axb')).toBe(false);
    expect(matchesPath('/trips/*', '/trips')).toBe(false);
  });
});

describe('findRule — GET 만, 상대·전체 경로', () => {
  const rule: FaultRule = { path: '/trips/*/itinerary', status: 500 };

  it('P3 쓰기 요청은 어떤 규칙이 있어도 null 이다', () => {
    fc.assert(
      fc.property(writeMethod, segment, (method, id) => {
        const everything: FaultRule[] = [rule, { path: '/**', status: 500 }];
        expect(
          findRule(everything, { method, url: `/trips/${id}/itinerary` })
        ).toBeNull();
      })
    );
  });

  it('GET(또는 메서드 생략)이고 경로가 맞으면 그 규칙을 돌려준다', () => {
    expect(
      findRule([rule], { method: 'get', url: '/trips/t1/itinerary' })
    ).toBe(rule);
    expect(findRule([rule], { url: '/trips/t1/itinerary' })).toBe(rule);
    expect(findRule([rule], { method: 'get', url: '/trips/t1' })).toBeNull();
  });

  it('baseURL 을 붙인 전체 경로 글롭도 잡는다(출처는 뺀다)', () => {
    const full: FaultRule = { path: '/api/v1/trips/*/itinerary', status: 503 };
    expect(
      findRule([full], {
        method: 'get',
        baseURL: 'https://dev-api.trippilot.co.kr/api/v1',
        url: '/trips/t1/itinerary',
      })
    ).toBe(full);
  });
});

describe('parseFaultLink — 딥링크 파라미터 → 동작', () => {
  it('clear=1 은 모두 지우기다', () => {
    expect(parseFaultLink({ clear: '1' })).toEqual({ type: 'clear' });
  });

  it('path+status / path+delay / 셋 다 / code 는 규칙 하나다', () => {
    expect(parseFaultLink({ path: '/a', status: '500' })).toEqual({
      type: 'set',
      rule: { path: '/a', status: 500 },
    });
    expect(parseFaultLink({ path: '/a', delay: '5000' })).toEqual({
      type: 'set',
      rule: { path: '/a', delayMs: 5000 },
    });
    expect(
      parseFaultLink({ path: '/a', status: '409', delay: '10', code: 'X' })
    ).toEqual({
      type: 'set',
      rule: { path: '/a', status: 409, delayMs: 10, code: 'X' },
    });
  });

  it('path 가 / 로 시작하지 않으면 invalid 다 — 켜졌다고 표시되는데 아무 요청도 안 잡히는 일을 막는다', () => {
    expect(
      parseFaultLink({ path: 'trips/*/itinerary', status: '500' })
    ).toEqual({ type: 'invalid', reason: 'path 는 / 로 시작한다' });
  });

  it('배열 파라미터(중복 쿼리)는 첫 값을 쓴다', () => {
    expect(parseFaultLink({ path: ['/a', '/b'], status: ['404'] })).toEqual({
      type: 'set',
      rule: { path: '/a', status: 404 },
    });
  });

  it.each([
    ['경로 없음', { status: '500' }],
    ['상태·지연 둘 다 없음', { path: '/a' }],
    ['상태가 숫자 아님', { path: '/a', status: 'abc' }],
    ['상태가 범위 밖', { path: '/a', status: '700' }],
    ['지연이 음수', { path: '/a', delay: '-1' }],
    ['지연이 60초 초과', { path: '/a', delay: '60001' }],
  ])('%s 이면 invalid 다', (_label, params) => {
    expect(parseFaultLink(params).type).toBe('invalid');
  });
});

describe('applyFaultAction', () => {
  it('같은 경로 규칙은 덮어쓰고, 다른 경로는 더하고, clear 는 비운다', () => {
    const one = applyFaultAction([], {
      type: 'set',
      rule: { path: '/a', status: 500 },
    });
    const replaced = applyFaultAction(one, {
      type: 'set',
      rule: { path: '/a', status: 404 },
    });
    const two = applyFaultAction(replaced, {
      type: 'set',
      rule: { path: '/b', delayMs: 10 },
    });

    expect(replaced).toEqual([{ path: '/a', status: 404 }]);
    expect(two).toHaveLength(2);
    expect(applyFaultAction(two, { type: 'clear' })).toEqual([]);
    expect(applyFaultAction(two, { type: 'invalid', reason: 'x' })).toBe(two);
  });
});

describe('faultErrorBody — 백엔드 공통 에러 봉투(ErrorResponse) 모양', () => {
  it('상태별 기본 코드와 message 를 담고, code 를 주면 그 코드를 쓴다', () => {
    expect(faultErrorBody({ path: '/a', status: 500 }).error.code).toBe(
      'INTERNAL'
    );
    expect(faultErrorBody({ path: '/a', status: 404 }).error.code).toBe(
      'NOT_FOUND'
    );
    const custom = faultErrorBody({
      path: '/a',
      status: 409,
      code: 'GENERATION_IN_PROGRESS',
    });
    expect(custom.error.code).toBe('GENERATION_IN_PROGRESS');
    expect(typeof custom.error.message).toBe('string');
  });
});
