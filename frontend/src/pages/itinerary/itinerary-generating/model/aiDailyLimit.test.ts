import fc from 'fast-check';

import {
  AI_DAILY_LIMIT,
  isAiDailyLimitReached,
  readTodayAiCount,
  recordAiGeneration,
  type AiUsageStore,
} from './aiDailyLimit';

/**
 * TRIP-1268 · AI 일정 생성 일일 한도 카운터(클라이언트 임시 장치 — 서버 한도가 배포되면 지운다).
 *
 * 무엇을 보장하나:
 *  - 오늘(KST) 쓴 횟수를 계정별 키 `aiGenUsage.{accountId}` 의 `{"d","n"}` 에서 읽는다. 값이 없거나 날짜가
 *    오늘이 아니거나 깨졌으면 0 이다(AC-1).
 *  - "오늘"은 기기 시간대가 아니라 KST 다 — UTC 14:59:59 는 그날, 15:00:00 은 다음 날이다(AC-2).
 *  - 계정 A 의 횟수가 B 에 섞이지 않는다(AC-3). 성공 1회마다 +1, 날짜가 바뀌면 1부터(AC-4).
 *  - 한도 5 는 상수 한 곳이고 4회까지 허용·5회부터 차단이다(AC-5).
 *  - 계정을 모르거나 저장소 읽기가 실패하면 막지 않는다(fail-open). 판정·기록 함수는 절대 reject 하지
 *    않는다 — 생성 성공 흐름을 저장소 오류가 막으면 안 된다(AC-6).
 *
 * *(개념)* 이 모듈은 시계(`now`)와 저장소(`store`)를 **인자로 받는다**(의존성 주입). 그래서 테스트는 고정된
 * 시각과 메모리 `Map` 저장소를 넣어 결과를 정확히 통제한다. 실제 화면은 `new Date()` 와 SecureStore 를 넣는다.
 *
 * 3동작 뼈대: 준비 = 가짜 저장소에 값 심기·시각 고정 → 실행 = 읽기/판정/기록 → 단언 = 돌려준 값·저장된 값·호출.
 */

/** 메모리 저장소 — read/write 를 jest.fn 으로 감싸 몇 번, 어떤 키로 불렸는지 볼 수 있다. */
function memoryStore(seed: Record<string, string> = {}) {
  const vault = new Map<string, string>(Object.entries(seed));
  const store = {
    read: jest.fn(async (key: string) => vault.get(key) ?? null),
    write: jest.fn(async (key: string, value: string) => {
      vault.set(key, value);
    }),
  } satisfies AiUsageStore;
  return { vault, store };
}

const usage = (d: string, n: number): string => JSON.stringify({ d, n });
/** 저장된 값을 객체로 편다 — 키 순서를 강요하지 않고 `toEqual` 로 비교하려고. */
const parsed = (raw: string | undefined): unknown =>
  raw === undefined ? undefined : JSON.parse(raw);

/** KST 2026-10-07 12:00 — 대부분의 케이스가 쓰는 "지금". */
const NOW = new Date('2026-10-07T03:00:00Z');
const TODAY = '2026-10-07';
const YESTERDAY = '2026-10-06';
const KEY_A = 'aiGenUsage.A';

describe('🔴 C1 · AC-1 — 오늘 쓴 횟수 읽기', () => {
  it.each([
    { label: '① 저장값 없음', raw: undefined, expected: 0 },
    { label: '② 어제 날짜 5회', raw: usage(YESTERDAY, 5), expected: 0 },
    { label: '③ 오늘 날짜 3회', raw: usage(TODAY, 3), expected: 3 },
    { label: '④ JSON 이 아닌 값', raw: 'garbage', expected: 0 },
    { label: '⑤ JSON null', raw: 'null', expected: 0 },
    {
      label: '⑥ n 이 빠진 오늘 값',
      raw: JSON.stringify({ d: TODAY }),
      expected: 0,
    },
  ])('$label → $expected', async ({ raw, expected }) => {
    // 준비
    const { store } = memoryStore(raw === undefined ? {} : { [KEY_A]: raw });

    // 실행
    const count = await readTodayAiCount('A', { store, now: NOW });

    // 단언 — 정확히 그 숫자(NaN·undefined 도 red)
    expect(count).toBe(expected);
    expect(store.read).toHaveBeenCalledWith(KEY_A);
  });
});

describe('🔴 C2·C3 · AC-2 — 날짜 경계는 KST 자정이다', () => {
  const BEFORE_MIDNIGHT_KST = new Date('2026-10-07T14:59:59Z'); // KST 10-07 23:59:59
  const MIDNIGHT_KST = new Date('2026-10-07T15:00:00Z'); // KST 10-08 00:00:00

  it('C2 KST 23:59:59 엔 그날 5회라 막히고, KST 00:00 엔 0부터 다시 허용된다', async () => {
    // 준비 — 10-07 에 5번 썼다
    const { store } = memoryStore({ [KEY_A]: usage('2026-10-07', 5) });

    // 실행
    const before = await isAiDailyLimitReached('A', {
      store,
      now: BEFORE_MIDNIGHT_KST,
    });
    const after = await isAiDailyLimitReached('A', {
      store,
      now: MIDNIGHT_KST,
    });
    const countAfter = await readTodayAiCount('A', {
      store,
      now: MIDNIGHT_KST,
    });

    // 단언
    expect(before).toBe(true);
    expect(after).toBe(false);
    expect(countAfter).toBe(0);
  });

  it('C3 KST 00:00 에 기록하면 새 날짜 1회로 시작한다', async () => {
    const { store, vault } = memoryStore({ [KEY_A]: usage('2026-10-07', 5) });

    await recordAiGeneration('A', { store, now: MIDNIGHT_KST });

    expect(parsed(vault.get(KEY_A))).toEqual({ d: '2026-10-08', n: 1 });
  });
});

describe('🔴 C4 · AC-3 — 계정끼리 섞이지 않는다', () => {
  it('A 가 5회여도 B 는 허용되고, B 를 기록해도 A 값은 그대로다', async () => {
    // 준비
    const aRaw = usage(TODAY, 5);
    const { store, vault } = memoryStore({ [KEY_A]: aRaw });

    // 실행
    const reached = await isAiDailyLimitReached('B', { store, now: NOW });
    await recordAiGeneration('B', { store, now: NOW });

    // 단언
    expect(reached).toBe(false);
    expect(store.read).toHaveBeenCalledWith('aiGenUsage.B');
    expect(vault.get(KEY_A)).toBe(aRaw);
    expect(parsed(vault.get('aiGenUsage.B'))).toEqual({ d: TODAY, n: 1 });
  });
});

describe('🔴 C5 · AC-4 — 성공 1회마다 +1, 날짜가 바뀌면 1부터', () => {
  it.each([
    { label: '① 어제 4회', raw: usage(YESTERDAY, 4), expected: 1 },
    { label: '② 오늘 3회', raw: usage(TODAY, 3), expected: 4 },
    { label: '③ 저장값 없음', raw: undefined, expected: 1 },
    { label: '④ 깨진 값', raw: 'garbage', expected: 1 },
  ])('$label → 오늘 $expected회', async ({ raw, expected }) => {
    const { store, vault } = memoryStore(
      raw === undefined ? {} : { [KEY_A]: raw }
    );

    await recordAiGeneration('A', { store, now: NOW });

    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.write.mock.calls[0][0]).toBe(KEY_A);
    expect(parsed(vault.get(KEY_A))).toEqual({ d: TODAY, n: expected });
  });
});

describe('🔴 C6 · AC-5 — 한도는 5, 4회까지 허용·5회부터 차단', () => {
  it('상수가 5 다', () => {
    expect(AI_DAILY_LIMIT).toBe(5);
  });

  it.each([
    { n: 4, reached: false },
    { n: 5, reached: true },
    { n: 6, reached: true },
  ])('오늘 $n회 → 한도 도달 $reached', async ({ n, reached }) => {
    const { store } = memoryStore({ [KEY_A]: usage(TODAY, n) });

    await expect(isAiDailyLimitReached('A', { store, now: NOW })).resolves.toBe(
      reached
    );
  });
});

describe('🔴 C7~C10 · AC-6 — 모르면 막지 않고, 저장소 오류는 삼킨다', () => {
  it('C7 계정 id 가 없으면 허용하고 저장소를 읽지도 않는다', async () => {
    const { store } = memoryStore({ [KEY_A]: usage(TODAY, 5) });

    const reached = await isAiDailyLimitReached(undefined, {
      store,
      now: NOW,
    });

    expect(reached).toBe(false);
    expect(store.read).not.toHaveBeenCalled();
  });

  it('C8 저장소 읽기가 실패해도 reject 하지 않고 허용한다', async () => {
    const { store } = memoryStore();
    store.read.mockRejectedValue(new Error('keychain locked'));

    // resolves = Promise 가 거절되지 않고 값으로 끝났다
    await expect(isAiDailyLimitReached('A', { store, now: NOW })).resolves.toBe(
      false
    );
    // 짝 — 정말 읽기를 시도했다(시도도 안 하고 false 면 공허 통과)
    expect(store.read).toHaveBeenCalledWith(KEY_A);
  });

  it('C9 저장소 쓰기가 실패해도 기록 함수는 reject 하지 않는다', async () => {
    const { store } = memoryStore({ [KEY_A]: usage(TODAY, 2) });
    store.write.mockRejectedValue(new Error('disk full'));

    await expect(
      recordAiGeneration('A', { store, now: NOW })
    ).resolves.toBeUndefined();
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  it('C10 기록할 때 읽기가 실패하면 쓰지 않는다(지금 횟수를 모르므로)', async () => {
    const { store } = memoryStore({ [KEY_A]: usage(TODAY, 2) });
    store.read.mockRejectedValue(new Error('keychain locked'));

    await expect(
      recordAiGeneration('A', { store, now: NOW })
    ).resolves.toBeUndefined();
    expect(store.read).toHaveBeenCalledWith(KEY_A);
    expect(store.write).not.toHaveBeenCalled();
  });
});

// TRIP-1268 재호출 1 (03b 차단-1) — 위 케이스들의 Map 저장소는 어떤 키든 받아 준다. 운영 SecureStore 는
// 영문·숫자·`.`·`-`·`_` 밖의 글자가 든 키를 읽기·쓰기 전에 거부한다(expo-secure-store 15.0.8
// `src/SecureStore.ts:237-238` `isValidKey`). 그 규칙을 그대로 옮긴 대역으로 "기록 → 판정" 왕복을 돈다.
describe('🔴 C11 · AC-22 — 키가 실제 저장소 규칙을 지킨다', () => {
  /** expo-secure-store `isValidKey` 와 같은 식. */
  const SECURE_STORE_KEY = /^[\w.-]+$/;
  /** 서버 accountId 는 UUID 다(01b 수정 1). */
  const ACCOUNT = '0b9f3c2e-1d4a-4c8e-9f7a-2b6d5e8c1a37';

  /** 키 규칙을 지키는 메모리 저장소 — 규칙 밖 키면 SecureStore 처럼 reject 한다. */
  function secureRuleStore() {
    const vault = new Map<string, string>();
    const guard = (key: string): void => {
      if (!SECURE_STORE_KEY.test(key)) {
        throw new Error('Invalid key provided to SecureStore.');
      }
    };
    const store: AiUsageStore = {
      read: async (key) => {
        guard(key);
        return vault.get(key) ?? null;
      },
      write: async (key, value) => {
        guard(key);
        vault.set(key, value);
      },
    };
    return { vault, store };
  }

  it('앵커 — 대역은 `:` 키를 거부하고 `.` 키는 받는다(대역이 다 받아 주면 아래 단언이 공허해진다)', async () => {
    const { store } = secureRuleStore();

    await expect(store.read(`aiGenUsage:${ACCOUNT}`)).rejects.toThrow(
      /Invalid key/
    );
    await expect(store.read(`aiGenUsage.${ACCOUNT}`)).resolves.toBeNull();
  });

  it('C11 규칙을 지키는 저장소에서 5번 기록하면 한도에 닿는다', async () => {
    // 준비 — 빈 저장소(키를 테스트가 정하지 않는다: 카운터가 고른 키를 그대로 쓴다)
    const { vault, store } = secureRuleStore();

    // 실행 — 성공 5번을 카운터로 기록한 뒤 판정
    for (let i = 0; i < AI_DAILY_LIMIT; i += 1) {
      await recordAiGeneration(ACCOUNT, { store, now: NOW });
    }
    const reached = await isAiDailyLimitReached(ACCOUNT, { store, now: NOW });

    // 단언 — 한도에 닿았고, 실제로 저장소에 오늘 5회가 남았다
    expect(reached).toBe(true);
    expect([...vault.values()].map((raw) => JSON.parse(raw))).toEqual([
      { d: TODAY, n: AI_DAILY_LIMIT },
    ]);
  });
});

describe('🔴 P1~P3 · 속성 — 경계·날짜·증가는 어떤 횟수에서도 성립한다', () => {
  /** 오늘(KST 10-07)에서 k일 떨어진 KST 날짜. 정오 기준이라 시각 반올림에 안 흔들린다. */
  function shiftedDay(k: number): string {
    return new Date(Date.UTC(2026, 9, 7 + k, 3)).toISOString().slice(0, 10);
  }

  it('P1 오늘 n회면 한도 도달 ⟺ n ≥ AI_DAILY_LIMIT (경계 4·5 는 반드시)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 30 }), async (n) => {
        const { store } = memoryStore({ [KEY_A]: usage(TODAY, n) });
        const reached = await isAiDailyLimitReached('A', { store, now: NOW });
        return reached === n >= AI_DAILY_LIMIT;
      }),
      { examples: [[4], [5]] }
    );
  });

  it('P2 날짜가 오늘이 아니면 몇 회였든 0으로 보고 허용한다', async () => {
    const offset = fc
      .integer({ min: 1, max: 400 })
      .chain((k) => fc.constantFrom(k, -k));
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 30 }),
        offset,
        async (n, k) => {
          const { store } = memoryStore({ [KEY_A]: usage(shiftedDay(k), n) });
          const reached = await isAiDailyLimitReached('A', {
            store,
            now: NOW,
          });
          const count = await readTodayAiCount('A', { store, now: NOW });
          return reached === false && count === 0;
        }
      ),
      {
        examples: [
          [5, -1],
          [5, 1],
        ],
      }
    );
  });

  it('P3 오늘 n회에서 기록하면 정확히 n+1 회가 된다', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 30 }), async (n) => {
        const { store, vault } = memoryStore({ [KEY_A]: usage(TODAY, n) });
        await recordAiGeneration('A', { store, now: NOW });
        const stored = parsed(vault.get(KEY_A)) as { d: string; n: number };
        return stored.d === TODAY && stored.n === n + 1;
      }),
      { examples: [[4]] }
    );
  });
});
