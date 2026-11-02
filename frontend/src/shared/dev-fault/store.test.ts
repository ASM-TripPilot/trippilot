import { createFaultStore } from './store';

/**
 * 실패 주입 규칙 저장소 — 끄기 전까지 유지(앱 재시작 후에도).
 *
 * 무엇을 보장하나:
 *  - ready() 는 저장된 규칙을 한 번만 읽어 rules() 로 돌려준다(여러 번 불러도 읽기 1회).
 *  - 저장값이 깨졌거나(JSON 아님·배열 아님) 읽기가 실패해도 빈 규칙으로 열린다 — 개발 도구가 앱을 막지 않는다.
 *  - apply() 는 딥링크 파라미터를 규칙에 반영하고 저장·구독자 알림까지 한다. invalid 는 아무것도 바꾸지 않는다.
 */

function memory(initial: string | null) {
  let value = initial;
  return {
    read: jest.fn(async () => value),
    write: jest.fn(async (next: string) => {
      value = next;
    }),
  };
}

describe('createFaultStore', () => {
  it('저장된 규칙을 한 번만 읽어 돌려준다', async () => {
    const storage = memory('[{"path":"/a","status":500}]');
    const store = createFaultStore(storage);

    await Promise.all([store.ready(), store.ready()]);

    expect(store.rules()).toEqual([{ path: '/a', status: 500 }]);
    expect(storage.read).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['JSON 아님', memory('{oops')],
    ['배열 아님', memory('{"path":"/a"}')],
    [
      '읽기 실패',
      {
        read: jest.fn(async () => Promise.reject(new Error('x'))),
        write: jest.fn(),
      },
    ],
  ])('저장값이 %s 이면 빈 규칙으로 열린다', async (_label, storage) => {
    const store = createFaultStore(storage);

    await store.ready();

    expect(store.rules()).toEqual([]);
  });

  it('배열 안의 모양이 깨진 규칙은 버리고 멀쩡한 규칙만 남긴다 — 깨진 한 줄이 모든 GET 을 막지 않는다', async () => {
    const store = createFaultStore(
      memory(
        '[null,{"path":1},{"path":"no-slash","status":500},{"path":"/a","status":"500"},{"path":"/b","delayMs":10}]'
      )
    );

    await store.ready();

    expect(store.rules()).toEqual([{ path: '/b', delayMs: 10 }]);
  });

  it('apply 는 규칙을 반영하고 저장·알림한다 — clear 는 비우고, invalid 는 아무것도 안 한다', async () => {
    const storage = memory(null);
    const store = createFaultStore(storage);
    await store.ready();
    const listener = jest.fn();
    store.subscribe(listener);

    await store.apply({ path: '/a', status: '500' });
    expect(store.rules()).toEqual([{ path: '/a', status: 500 }]);
    expect(JSON.parse(storage.write.mock.calls.at(-1)?.[0] ?? '')).toEqual([
      { path: '/a', status: 500 },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);

    const invalid = await store.apply({ path: '/b' });
    expect(invalid.type).toBe('invalid');
    expect(storage.write).toHaveBeenCalledTimes(1);

    await store.apply({ clear: '1' });
    expect(store.rules()).toEqual([]);
    expect(storage.write.mock.calls.at(-1)?.[0]).toBe('[]');
  });
});
