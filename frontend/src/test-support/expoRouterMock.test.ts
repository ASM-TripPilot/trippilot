import { router, useLocalSearchParams, useRouter } from 'expo-router';
import * as mockModule from '@/test-support/expoRouterMock';
import {
  createExpoRouterMock,
  routerSpies,
  type RouterMember,
} from '@/test-support/expoRouterMock';

/**
 * 공용 expo-router 목(`expoRouterMock`)의 계약 잠금(TRIP-1626).
 *
 * 이 파일 자체가 사용 예다 — 아래 `jest.mock` 한 줄이 변환된 51개 파일이 쓰는 모양과 같다(여기서는 제한 없는 전체 형태).
 * 지키는 것 셋: ① 훅(`useRouter`)과 명령형(`router`) 호출이 **한 장부**(`routerSpies`)에 쌓인다 ② `params` 는 부를 때
 * 평가된다 ③ **옛 인라인 목이 가졌던 멤버·면만 내놓을 수 있다**(D8 — 옛 목에 없던 메서드를 운영 코드가 부르면 TypeError 로
 * 빨개지던 우연 심판을 공용 목이 지우지 않게).
 */
jest.mock('expo-router', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/expoRouterMock').createExpoRouterMock()
);

const ALL_MEMBERS: RouterMember[] = [
  'push',
  'replace',
  'back',
  'dismissTo',
  'navigate',
  'setParams',
  'canGoBack',
];

/** 타입은 멤버를 다 아는 것처럼 말하지만 여기서는 "런타임에 키가 있는가"를 본다. */
type Loose = Record<string, ((...args: unknown[]) => unknown) | undefined>;

// 모듈 싱글턴 장부 — describe 안이 아니라 파일 최상위에서 비운다(앞 케이스가 남긴 호출이 새지 않게).
afterEach(() => {
  for (const spy of Object.values(routerSpies)) spy.mockClear();
});

describe('한 장부 — jest.mock 으로 연결한 expo-router', () => {
  it('훅(useRouter)과 명령형(router) 호출이 같은 routerSpies.push 에 순서대로 쌓인다', () => {
    expect(routerSpies.push).toHaveBeenCalledTimes(0);

    useRouter().push('/a');
    router.push('/b');

    expect(routerSpies.push.mock.calls).toEqual([['/a'], ['/b']]);
  });

  it.each(ALL_MEMBERS)(
    '%s — useRouter()·router·routerSpies 가 같은 함수다',
    (member) => {
      expect(useRouter()[member]).toBe(routerSpies[member]);
      expect(router[member]).toBe(routerSpies[member]);
    }
  );

  it('useRouter() 는 부를 때마다 새 객체지만 안의 함수는 같다', () => {
    const first = useRouter();
    const second = useRouter();

    expect(first).not.toBe(second);
    expect(first.push).toBe(second.push);
  });

  it('params 를 안 주면 useLocalSearchParams() 는 빈 객체다', () => {
    expect(useLocalSearchParams()).toEqual({});
  });

  it('canGoBack 은 기본 true 이고 mockReturnValueOnce(false) 한 번 뒤에 다시 true 다', () => {
    expect(router.canGoBack()).toBe(true);

    routerSpies.canGoBack.mockReturnValueOnce(false);

    expect(router.canGoBack()).toBe(false);
    expect(router.canGoBack()).toBe(true);
  });

  it('모듈 자체를 목으로 쓸 때의 export 도 같은 장부다', () => {
    expect(mockModule.useRouter().push).toBe(routerSpies.push);
    expect(mockModule.router.back).toBe(routerSpies.back);
    expect(mockModule.useLocalSearchParams()).toEqual({});
  });
});

const hookOf = (mock: ReturnType<typeof createExpoRouterMock>): Loose =>
  mock.useRouter?.() as unknown as Loose;
const routerOf = (mock: ReturnType<typeof createExpoRouterMock>): Loose =>
  mock.router as unknown as Loose;

describe('createExpoRouterMock — params', () => {
  it('params 는 만들 때가 아니라 부를 때마다 평가한다(재할당이 보인다)', () => {
    let current: Record<string, string> = { tripId: '1' };
    const params = jest.fn(() => current);

    const mock = createExpoRouterMock({ params });

    expect(params).toHaveBeenCalledTimes(0);
    expect(mock.useLocalSearchParams?.()).toEqual({ tripId: '1' });
    current = { tripId: '2' };
    expect(mock.useLocalSearchParams?.()).toEqual({ tripId: '2' });
    expect(params).toHaveBeenCalledTimes(2);
  });
});

describe('createExpoRouterMock — 옛 목이 가졌던 것만 내놓는다(D8)', () => {
  it('멤버 배열에 적지 않은 멤버는 키가 없고 호출하면 TypeError 다', () => {
    const hook = hookOf(createExpoRouterMock({ useRouter: ['push', 'back'] }));

    expect(Object.keys(hook).sort()).toEqual(['back', 'push']);
    expect(hook.replace).toBeUndefined();
    expect(() => (hook.replace as unknown as () => void)()).toThrow(TypeError);
  });

  it('적지 않은 면은 export 자체가 없다', () => {
    const hookOnly = createExpoRouterMock({ useRouter: ['push'] });
    const routerOnly = createExpoRouterMock({ router: ['push'] });

    expect(hookOnly.router).toBeUndefined();
    expect(hookOnly.useLocalSearchParams).toBeUndefined();
    expect(routerOnly.useRouter).toBeUndefined();
    expect(routerOnly.useLocalSearchParams).toBeUndefined();
    expect(() => (routerOf(hookOnly).push as () => void)()).toThrow(TypeError);
  });

  it('면마다 멤버를 따로 정한다', () => {
    const mock = createExpoRouterMock({
      useRouter: ['push', 'back'],
      router: ['push'],
    });

    expect(hookOf(mock).back).toBe(routerSpies.back);
    expect(routerOf(mock).back).toBeUndefined();
  });

  it('인자를 안 주면 전 면·전 멤버를 내놓는다(빈 객체 {} 와 다르다)', () => {
    const full = createExpoRouterMock();
    const empty = createExpoRouterMock({});

    expect(Object.keys(hookOf(full)).sort()).toEqual([...ALL_MEMBERS].sort());
    expect(Object.keys(routerOf(full)).sort()).toEqual([...ALL_MEMBERS].sort());
    expect(full.useLocalSearchParams).toBeDefined();
    expect(empty.useRouter).toBeUndefined();
    expect(empty.router).toBeUndefined();
    expect(empty.useLocalSearchParams).toBeUndefined();
  });

  it('canGoBack 은 배열에 적어야 노출된다', () => {
    const without = hookOf(createExpoRouterMock({ useRouter: ['push'] }));
    const withIt = hookOf(
      createExpoRouterMock({ useRouter: ['push', 'canGoBack'] })
    );

    expect(without.canGoBack).toBeUndefined();
    expect(withIt.canGoBack).toBe(routerSpies.canGoBack);
    expect((withIt.canGoBack as () => boolean)()).toBe(true);
  });

  it('제한한 목이 부른 호출도 같은 장부에 기록된다', () => {
    const imperative = routerOf(createExpoRouterMock({ router: ['replace'] }));
    expect(routerSpies.replace).toHaveBeenCalledTimes(0);

    (imperative.replace as (href: string) => void)('/x');

    expect(routerSpies.replace.mock.calls).toEqual([['/x']]);
  });

  it('목 인스턴스를 둘 만들어도 장부는 하나다', () => {
    const one = hookOf(createExpoRouterMock({ useRouter: ['push'] }));
    const two = routerOf(createExpoRouterMock({ router: ['push'] }));

    expect(one.push).toBe(two.push);
  });
});
