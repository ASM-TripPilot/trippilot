import { newTestQueryClient } from './queryRender';

/**
 * `newTestQueryClient` 의 옵션 계약 잠금(TRIP-1626 — 인라인 `new QueryClient` 를 이 팩토리로 모은다).
 *
 * 인라인 클라이언트 7군 중 `staleTime` 을 쓰던 6곳을 흡수하려고 옵션이 하나 늘었다. 기본값(gcTime Infinity·staleTime 없음)은
 * 바꾸지 않는다 — 기존 소비자 31곳이 이 기본값 위에 서 있다. 그래서 "안 주면 키 자체가 없다" 쪽을 선제 green 으로 잠근다.
 */
describe('newTestQueryClient — staleTime 옵션', () => {
  it('staleTime 을 주면 조회 기본값에 실리고 뮤테이션에는 실리지 않는다', () => {
    const client = newTestQueryClient({ staleTime: 30_000 });

    const options = client.getDefaultOptions();

    expect(options.queries).toEqual({
      retry: false,
      gcTime: Infinity,
      staleTime: 30_000,
    });
    expect(options.mutations).toEqual({ retry: false, gcTime: Infinity });
  });

  it('staleTime: Infinity 도 그대로 실린다', () => {
    const client = newTestQueryClient({ staleTime: Infinity });

    expect(client.getDefaultOptions().queries?.staleTime).toBe(Infinity);
  });

  it('gcTime 과 staleTime 은 서로 독립이다', () => {
    const client = newTestQueryClient({ gcTime: 0, staleTime: 5 });

    const options = client.getDefaultOptions();

    expect(options.queries).toEqual({ retry: false, gcTime: 0, staleTime: 5 });
    expect(options.mutations).toEqual({ retry: false, gcTime: 0 });
  });
});

describe('newTestQueryClient — 기본값 잠금(기존 동작)', () => {
  it('아무것도 안 주면 staleTime 키가 아예 없다(라이브러리 기본 0 유지)', () => {
    const client = newTestQueryClient();

    const queries = client.getDefaultOptions().queries ?? {};

    expect(queries).toEqual({ retry: false, gcTime: Infinity });
    expect('staleTime' in queries).toBe(false);
  });

  it('gcTime: 0 은 조회와 뮤테이션 둘 다에 걸린다', () => {
    const client = newTestQueryClient({ gcTime: 0 });

    const options = client.getDefaultOptions();

    expect(options.queries).toEqual({ retry: false, gcTime: 0 });
    expect(options.mutations).toEqual({ retry: false, gcTime: 0 });
  });
});
