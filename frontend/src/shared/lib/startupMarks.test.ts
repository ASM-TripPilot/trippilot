import { File, Paths } from 'expo-file-system';

import {
  documentFileCount,
  resetFakeFs,
} from '@/test-support/fakeExpoFileSystem';

/**
 * TRIP-1717 · 콜드스타트 시작 마크(`startupMarks`) — 기록·무출력·파일 한 번 쓰기.
 *
 * 무엇을 보장하나:
 *  - 같은 이름은 첫 기록만 남는다(HomePage 재마운트 같은 되풀이가 값을 덮지 못한다).
 *  - 측정 플래그(`EXPO_PUBLIC_STARTUP_MARKS === '1'`)가 꺼져 있으면 — `__DEV__` 가 true 여도 — console·fetch·파일 쓰기가 0 이다.
 *  - 켜져 있으면 `flushMarks()` 가 문서 폴더의 `startup-marks.json` 을 **딱 한 번** 쓴다. 내용은 buildKind·marks·rnStartupTiming 세 키.
 * 구간 계산·집계는 `scripts/startupBench.test.ts`, SplashGate 가 언제 부르는지는 `SplashGate.test.tsx` 가 본다.
 *
 * (개념) `jest.isolateModules` = 그 안에서 require 한 모듈을 캐시 없이 새로 읽는다. 플래그를 모듈 상수로 읽는 구현이라
 *   env 를 바꾼 뒤 새로 읽어야 하고, 앞 케이스가 쌓은 기록도 새지 않는다(`apiBaseUrl.test.ts` 와 같은 방식).
 * 3동작: 준비(env·`__DEV__`·시계·스파이) → 실행(mark·flushMarks) → 단언(파일 내용·호출 횟수).
 */

jest.mock(
  'expo-file-system',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/test-support/fakeExpoFileSystem').fakeExpoFileSystemModule
);

type Lib = typeof import('./startupMarks');

const FILE_NAME = 'startup-marks.json';
const devGlobal = globalThis as unknown as { __DEV__: boolean };
const perfGlobal = performance as unknown as {
  now: () => number;
  rnStartupTiming?: unknown;
};

const ORIGINAL_DEV = devGlobal.__DEV__;
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_STARTUP_MARKS;
const ORIGINAL_PERF_NOW = perfGlobal.now;
const ORIGINAL_DATE_NOW = Date.now;
const ORIGINAL_FETCH = globalThis.fetch;

// 두 시계는 원점이 다르다(실기도 그렇다) — perf 는 작은 수, epoch 는 1.7e12 대. 서로 바꿔 쓰면 값이 달라 드러난다.
let perf = 0;
let epoch = 0;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
let consoleSpies: jest.SpyInstance[] = [];
let fetchSpy: jest.Mock;
let writeSpy: jest.SpyInstance;

beforeEach(() => {
  perf = 0;
  epoch = 0;
  perfGlobal.now = () => perf;
  Date.now = () => epoch;
  consoleSpies = CONSOLE_METHODS.map((method) =>
    jest.spyOn(console, method).mockImplementation(() => undefined)
  );
  fetchSpy = jest.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  writeSpy = jest.spyOn(File.prototype, 'write');
});

// 모듈 싱글턴(fake 파일 시스템·가짜 시계)은 describe 안이 아니라 파일 최상위에서 되돌린다.
afterEach(() => {
  devGlobal.__DEV__ = ORIGINAL_DEV;
  if (ORIGINAL_ENV === undefined) delete process.env.EXPO_PUBLIC_STARTUP_MARKS;
  else process.env.EXPO_PUBLIC_STARTUP_MARKS = ORIGINAL_ENV;
  perfGlobal.now = ORIGINAL_PERF_NOW;
  delete perfGlobal.rnStartupTiming;
  Date.now = ORIGINAL_DATE_NOW;
  globalThis.fetch = ORIGINAL_FETCH;
  writeSpy.mockRestore();
  consoleSpies.forEach((spy) => spy.mockRestore());
  resetFakeFs();
});

/** env 와 `__DEV__` 를 정한 뒤 모듈을 새로 읽는다. flag 가 undefined 면 env 를 아예 지운다. */
function load({
  flag,
  dev = false,
}: {
  flag: string | undefined;
  dev?: boolean;
}): Lib {
  devGlobal.__DEV__ = dev;
  if (flag === undefined) delete process.env.EXPO_PUBLIC_STARTUP_MARKS;
  else process.env.EXPO_PUBLIC_STARTUP_MARKS = flag;
  let lib: Lib | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require('./startupMarks') as Lib;
  });
  if (!lib) throw new Error('startupMarks 를 못 읽었다');
  return lib;
}

function at(nextPerf: number, nextEpoch: number): void {
  perf = nextPerf;
  epoch = nextEpoch;
}

const outFile = () => new File(Paths.document, FILE_NAME);
const readOut = () => JSON.parse(outFile().textSync()) as Record<string, any>;

describe('startupMarks · 켜짐(EXPO_PUBLIC_STARTUP_MARKS=1)', () => {
  it('A1 같은 이름을 두 번 기록하면 첫 값만 남는다', () => {
    // 준비
    const { mark, flushMarks } = load({ flag: '1' });
    at(10, 1000);
    mark('jsEntry');
    at(99, 2000);
    mark('jsEntry', { x: 1 });
    expect(documentFileCount()).toBe(0); // 앵커: flush 전엔 아무 파일도 없다

    // 실행
    flushMarks();

    // 단언
    expect(readOut().marks.jsEntry).toEqual({ perfNow: 10, epoch: 1000 });
  });

  it('A2 파일은 문서 폴더의 startup-marks.json 이고 buildKind·marks·rnStartupTiming 세 키다 — 네트워크 전송은 없다', () => {
    // 준비
    const { mark, flushMarks } = load({ flag: '1' });
    at(5, 1_700_000_000_000);
    mark('jsEntry');
    at(7.5, 1_700_000_000_002);
    mark('bootstrapResolved', { destination: 'HOME', isProvisional: false });

    // 실행
    flushMarks();

    // 단언 — jest 기본 performance 에는 rnStartupTiming 이 없어 null
    expect(outFile().exists).toBe(true);
    expect(readOut()).toEqual({
      buildKind: 'release',
      marks: {
        jsEntry: { perfNow: 5, epoch: 1_700_000_000_000 },
        bootstrapResolved: {
          perfNow: 7.5,
          epoch: 1_700_000_000_002,
          detail: { destination: 'HOME', isProvisional: false },
        },
      },
      rnStartupTiming: null,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [true, 'dev'],
    [false, 'release'],
  ])('A2b __DEV__=%s 이면 buildKind 는 %s 다', (dev, expected) => {
    // 준비
    const { mark, flushMarks } = load({ flag: '1', dev });
    mark('jsEntry');

    // 실행
    flushMarks();

    // 단언
    expect(readOut().buildKind).toBe(expected);
  });

  it('A3 rnStartupTiming 은 getter 클래스라 필드를 하나씩 골라 적고, 값이 없으면 null 이다', () => {
    // 준비 — RN 의 ReactNativeStartupTiming 처럼 private 필드 + getter. 그대로 stringify 하면 {} 다(함정 실증).
    class FakeStartupTiming {
      #values = { startTime: 12.5, endTime: null, jsStart: 300 };
      get startTime() {
        return this.#values.startTime;
      }
      get endTime() {
        return this.#values.endTime;
      }
      get initializeRuntimeStart() {
        return 100;
      }
      get initializeRuntimeEnd() {
        return undefined; // 값이 없는 필드
      }
      get executeJavaScriptBundleEntryPointStart() {
        return this.#values.jsStart;
      }
      get executeJavaScriptBundleEntryPointEnd() {
        return 400;
      }
    }
    perfGlobal.rnStartupTiming = new FakeStartupTiming();
    expect(JSON.stringify(perfGlobal.rnStartupTiming)).toBe('{}');
    const { mark, flushMarks } = load({ flag: '1' });
    mark('jsEntry');

    // 실행
    flushMarks();

    // 단언 — 여섯 키가 전부 있다(없는 값은 null)
    expect(readOut().rnStartupTiming).toEqual({
      startTime: 12.5,
      endTime: null,
      initializeRuntimeStart: 100,
      initializeRuntimeEnd: null,
      executeJavaScriptBundleEntryPointStart: 300,
      executeJavaScriptBundleEntryPointEnd: 400,
    });
  });

  it('A4 flush 는 한 번만 쓴다 — 두 번째 호출과 그 사이에 늘어난 마크는 파일에 반영되지 않는다', () => {
    // 준비
    const { mark, flushMarks } = load({ flag: '1' });
    mark('a');
    flushMarks();
    mark('b');

    // 실행
    flushMarks();

    // 단언
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(readOut().marks)).toEqual(['a']);
  });

  it('A5 앞 실행이 남긴 파일이 있어도 던지지 않고 새 내용으로 덮어쓴다', () => {
    // 준비 — 이미 있는 파일(File.create 는 이미 있으면 던진다)
    const old = outFile();
    old.create();
    old.write('{"old":1}');
    const { mark, flushMarks } = load({ flag: '1' });
    mark('a');

    // 실행 + 단언
    expect(() => flushMarks()).not.toThrow();
    expect(readOut()).toHaveProperty('marks.a');
    expect(readOut()).not.toHaveProperty('old');
  });
});

describe('startupMarks · 꺼짐 — 무출력(console·fetch·파일 쓰기 0)', () => {
  /** mark 여러 번 + flush 를 부른 뒤 "아무 일도 없었다"를 단언한다. */
  function expectSilent(lib: Lib): void {
    expect(() => {
      lib.mark('jsEntry');
      lib.mark('rootLayout', { x: 1 });
      lib.mark('firstFrame');
      lib.flushMarks();
    }).not.toThrow();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(documentFileCount()).toBe(0);
  }

  it('B1 env 가 없으면 __DEV__ 가 true 여도(jest 기본) 꺼져 있다', () => {
    expectSilent(load({ flag: undefined, dev: true }));
  });

  it.each(['', '0', 'true'])(
    'B2 env 가 %p 처럼 정확히 "1" 이 아니면 꺼져 있다',
    (flag) => {
      expectSilent(load({ flag, dev: true }));
    }
  );

  it('B3 운영 모양(__DEV__ false·env 없음)에서도 꺼져 있다', () => {
    expectSilent(load({ flag: undefined, dev: false }));
  });
});
