import { createNaverMapsLoader } from './naverMapsLoader';
import type {
  LoaderDoc,
  LoaderScript,
  LoaderWin,
  NaverMapsApi,
} from './naverMapsLoader';

/**
 * TRIP-1651 (W5) — 네이버 지도 JS 스크립트 로더의 상태기계(AC-1·AC-2·AC-3 로더 단위, INV-4).
 *
 * 초심자용 — 이 로더는 브라우저의 `document`(페이지)·`window`(전역)를 **인자로 받는다**(의존성 주입).
 * jest 에는 브라우저가 없어서, 테스트가 아래 `makeEnv()` 의 가짜 페이지를 꽂고 스크립트 태그의
 * `onload`/`onerror` 를 **직접 호출**해 "로드 성공/실패"를 흉내 낸다. (준비 → 실행 → 단언 3동작)
 */

interface FakeScript extends LoaderScript {
  remove: jest.Mock;
}

function makeEnv() {
  const scripts: FakeScript[] = [];
  const head = {
    appendChild: jest.fn((node: LoaderScript) => node),
    removeChild: jest.fn((node: LoaderScript) => node),
  };
  const doc: LoaderDoc = {
    createElement: jest.fn(() => {
      const script: FakeScript = {
        src: '',
        async: false,
        onload: null,
        onerror: null,
        remove: jest.fn(),
      };
      scripts.push(script);
      return script;
    }),
    head,
  };
  const win: LoaderWin = {};
  const fakeNaver = { maps: {} } as unknown as NaverMapsApi;
  return { doc, win, head, scripts, fakeNaver };
}

describe('AC-1 — 클라이언트 ID 가 비면 스크립트 태그를 만들지 않고 거부한다', () => {
  it.each([[''], [undefined]])(
    'load(%p) → 거부, createElement·appendChild 0회',
    async (clientId) => {
      const { doc, win, head } = makeEnv();
      const loader = createNaverMapsLoader({ doc, win });

      await expect(loader.load(clientId)).rejects.toBeInstanceOf(Error);

      expect(doc.createElement).not.toHaveBeenCalled();
      expect(head.appendChild).not.toHaveBeenCalled();
    }
  );
});

describe('정상 로드', () => {
  it('태그 1개를 붙이고, onload 에 win.naver 로 풀린다', async () => {
    const { doc, win, head, scripts, fakeNaver } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });

    const loading = loader.load('MY-KEY-123');

    // 앵커 — onload 전엔 태그만 있고 아직 안 풀렸다.
    expect(scripts).toHaveLength(1);
    expect(head.appendChild).toHaveBeenCalledWith(scripts[0]);
    expect(
      scripts[0].src.startsWith('https://oapi.map.naver.com/openapi/v3/maps.js')
    ).toBe(true);
    expect(scripts[0].src).toContain('MY-KEY-123');

    win.naver = fakeNaver;
    scripts[0].onload?.();
    await expect(loading).resolves.toBe(fakeNaver);
  });

  it('동시에 두 번 불러도 태그는 1개이고 둘 다 같은 결과로 풀린다', async () => {
    const { doc, win, scripts, fakeNaver } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });

    const first = loader.load('KEY');
    const second = loader.load('KEY');
    expect(doc.createElement).toHaveBeenCalledTimes(1);

    win.naver = fakeNaver;
    scripts[0].onload?.();
    await expect(first).resolves.toBe(fakeNaver);
    await expect(second).resolves.toBe(fakeNaver);
  });

  it('풀린 뒤 다시 불러도 새 태그를 만들지 않는다', async () => {
    const { doc, win, scripts, fakeNaver } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    const first = loader.load('KEY');
    win.naver = fakeNaver;
    scripts[0].onload?.();
    await first;

    await expect(loader.load('KEY')).resolves.toBe(fakeNaver);

    expect(doc.createElement).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2 — 스크립트 로드 실패는 거부하고, 다시 시도할 수 있다', () => {
  it('script.onerror → 거부, 실패한 태그를 지운다', async () => {
    const { doc, win, head, scripts } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    const loading = loader.load('KEY');

    scripts[0].onerror?.();

    await expect(loading).rejects.toBeInstanceOf(Error);
    // 지우는 방법은 두 가지(script.remove / head.removeChild) 중 무엇이든 된다.
    expect(
      scripts[0].remove.mock.calls.length + head.removeChild.mock.calls.length
    ).toBeGreaterThanOrEqual(1);
  });

  it('실패한 뒤 다시 load 하면 새 태그로 다시 시도하고 성공할 수 있다(실패를 캐시하지 않는다)', async () => {
    const { doc, win, scripts, fakeNaver } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    const failing = loader.load('KEY');
    scripts[0].onerror?.();
    await expect(failing).rejects.toBeInstanceOf(Error);

    const retry = loader.load('KEY');

    expect(doc.createElement).toHaveBeenCalledTimes(2);
    win.naver = fakeNaver;
    scripts[1].onload?.();
    await expect(retry).resolves.toBe(fakeNaver);
  });

  it('스크립트는 떴는데 win.naver 가 없으면 거부한다(회색 빈 지도 금지, INV-4)', async () => {
    const { doc, win, scripts } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    const loading = loader.load('KEY');

    scripts[0].onload?.();

    await expect(loading).rejects.toBeInstanceOf(Error);
  });
});

describe('AC-3 — navermap_authFailure(네이버가 인증 실패 때 부르는 전역 콜백)', () => {
  it('load 직후(스크립트가 뜨기 전)에 전역 콜백이 함수로 설치돼 있다', () => {
    const { doc, win } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    // 앵커 — 호출 전엔 없다.
    expect(win.navermap_authFailure).toBeUndefined();

    void loader.load('KEY');

    expect(typeof win.navermap_authFailure).toBe('function');
  });

  it('인증 실패 콜백이 불리면 구독자 전원에게 1번씩 통지한다', () => {
    const { doc, win } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    void loader.load('KEY');
    const a = jest.fn();
    const b = jest.fn();
    loader.onAuthFailure(a);
    loader.onAuthFailure(b);
    expect(a).not.toHaveBeenCalled();

    win.navermap_authFailure?.();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('인증 실패가 이미 있었던 뒤에 구독해도 곧바로 통지한다(새로 마운트한 MapView)', () => {
    const { doc, win } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    void loader.load('KEY');
    win.navermap_authFailure?.();
    const late = jest.fn();

    loader.onAuthFailure(late);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it('구독 해제 함수를 부르면 더는 통지받지 않는다', () => {
    const { doc, win } = makeEnv();
    const loader = createNaverMapsLoader({ doc, win });
    void loader.load('KEY');
    const listener = jest.fn();
    const unsubscribe = loader.onAuthFailure(listener);

    unsubscribe();
    win.navermap_authFailure?.();

    expect(listener).not.toHaveBeenCalled();
  });
});
