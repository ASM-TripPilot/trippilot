import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react-native';

/**
 * react-query gc 타이머 unref setup(`queryTimersUnref.ts`) 계약 (TRIP-1630).
 *
 * react-query 는 관찰자 없는 캐시(쿼리·뮤테이션)를 gcTime(기본 5분) 뒤 지우려 타이머를 건다. 이 타이머가 ref 상태면
 * 테스트 파일이 끝난 뒤에도 jest 워커를 붙잡아 "worker failed to exit gracefully" 가 난다. 전역 setup 이 그 타이머를
 * unref(프로세스를 붙잡지 않게)하되, 타이머는 그대로 발화해야 한다 — 이 파일이 그 둘을 잠근다.
 */

// 쿼리·뮤테이션 gcTime 에 서로 다른 눈에 띄는 값을 줘서, 전역 setTimeout 호출 기록에서 gc 타이머만 골라낸다.
const QUERY_GC = 123_457;
const MUTATION_GC = 123_459;

const clients: QueryClient[] = [];
const makeClient = (gcTime?: { queries: number; mutations: number }) => {
  const client = new QueryClient({
    defaultOptions: gcTime
      ? {
          queries: { gcTime: gcTime.queries },
          mutations: { gcTime: gcTime.mutations },
        }
      : undefined,
  });
  clients.push(client);
  return client;
};

// 모듈 싱글턴(react-query 타이머 공급자) 상태를 만지는 파일이라 정리는 파일 최상위 afterEach 에 건다.
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  clients.splice(0).forEach((client) => {
    client
      .getMutationCache()
      .getAll()
      .forEach((m) => m.destroy());
    client.clear();
  });
});

type Kind = 'query' | 'mutation';
const startGc = (client: QueryClient, kind: Kind) => {
  if (kind === 'query') client.setQueryData(['k'], 1);
  else client.getMutationCache().build(client, { mutationFn: async () => 1 });
};
const cached = (client: QueryClient, kind: Kind) =>
  kind === 'query'
    ? client.getQueryData(['k']) !== undefined
    : client.getMutationCache().getAll().length > 0;

describe('react-query gc 타이머 unref setup', () => {
  it.each<[Kind, number]>([
    ['query', QUERY_GC],
    ['mutation', MUTATION_GC],
  ])(
    'U1 · %s gc 타이머는 만들어질 때 unref 된다 (프로세스를 붙잡지 않는다)',
    (kind, delay) => {
      // 준비: 전역 setTimeout 호출을 기록(그대로 통과)하고, gcTime 이 눈에 띄는 클라이언트를 만든다.
      const spy = jest.spyOn(global, 'setTimeout');
      const client = makeClient({ queries: QUERY_GC, mutations: MUTATION_GC });

      // 실행: 관찰자 없는 캐시 항목을 하나 만든다 → react-query 가 gc 타이머를 건다.
      startGc(client, kind);

      // 단언: 그 gc 타이머가 전역 setTimeout 으로 만들어졌고(공허 방지), 전부 ref 가 풀려 있다.
      const handles = spy.mock.calls
        .map((call, i) => ({
          delay: call[1],
          handle: spy.mock.results[i].value,
        }))
        .filter((t) => t.delay === delay)
        .map((t) => t.handle as { hasRef(): boolean });
      expect(handles.length).toBeGreaterThan(0);
      handles.forEach((h) => expect(h.hasRef()).toBe(false));
    }
  );

  it.each<Kind>(['query', 'mutation'])(
    'U2 · unref 된 %s gc 타이머도 실제 시간이 지나면 발화해 캐시에서 지운다',
    async (kind) => {
      // 준비: gcTime 30ms 클라이언트에 관찰자 없는 항목을 만든다. 만든 직후엔 캐시에 있다(아직 없다 앵커).
      const client = makeClient({ queries: 30, mutations: 30 });
      startGc(client, kind);
      expect(cached(client, kind)).toBe(true);

      // 실행 + 단언: 가짜 시계 없이 실제로 기다리면 gc 타이머가 발화해 캐시에서 사라진다.
      await waitFor(() => expect(cached(client, kind)).toBe(false), {
        timeout: 2000,
        interval: 10,
      });
    }
  );

  it('U3 · 가짜 타이머 아래에서는 gc 타이머가 가짜 시계를 따른다 (공급자가 호출 시점의 전역 setTimeout 을 쓴다)', () => {
    // 준비: 가짜 타이머를 켠 뒤 gcTime 5초 항목을 만든다.
    jest.useFakeTimers();
    const client = makeClient({ queries: 5000, mutations: 5000 });
    client.setQueryData(['k'], 1);
    expect(client.getQueryData(['k'])).toBe(1);

    // 실행 + 단언: 5초 직전엔 남아 있고, 5초가 되는 순간 지워진다 — 진짜 시계로 건 타이머라면 지워지지 않는다.
    jest.advanceTimersByTime(4999);
    expect(client.getQueryData(['k'])).toBe(1);
    jest.advanceTimersByTime(1);
    expect(client.getQueryData(['k'])).toBeUndefined();
  });

  it('U4 · 타이머 핸들에 unref 가 없어도(숫자 id 등) 던지지 않는다', () => {
    // 준비: 전역 setTimeout 이 unref 없는 숫자 id 를 돌려주도록 바꾼다.
    jest.spyOn(global, 'setTimeout').mockImplementation(() => 7 as never);
    const client = makeClient({ queries: QUERY_GC, mutations: MUTATION_GC });

    // 실행 + 단언: gc 타이머를 거는 일이 TypeError 없이 끝난다.
    expect(() => client.setQueryData(['k'], 1)).not.toThrow();
  });

  it('U5 · 노드·통합 두 설정이 이 setup 을 둘 다 로드한다', () => {
    // 준비: 두 jest 설정 객체를 읽는다.
    const node = jest.requireActual('../../jest.config') as {
      setupFilesAfterEnv?: string[];
    };
    const integration = jest.requireActual('../../jest.integration.config') as {
      setupFilesAfterEnv?: string[];
    };

    // 실행 + 단언: 둘 다 setupFilesAfterEnv 에 setup 모듈이 들어 있다.
    const has = (c: { setupFilesAfterEnv?: string[] }) =>
      (c.setupFilesAfterEnv ?? []).some((f) =>
        f.endsWith('src/test-support/queryTimersUnref.ts')
      );
    expect(has(node)).toBe(true);
    expect(has(integration)).toBe(true);
  });
});
