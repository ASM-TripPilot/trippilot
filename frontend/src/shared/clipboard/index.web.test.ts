/**
 * @jest-environment node
 */

/**
 * TRIP-1799 — 클립보드 입구 웹 파일(`shared/clipboard/index.web.ts`): 복사 못 했는데 "했다" 고 하지 않는다.
 *
 * 왜 웹 파일이 따로 있나: `expo-clipboard` 웹 구현은 `navigator.clipboard.writeText` 가 실패하면 `document.execCommand('copy')` 로
 * 폴백하는데, 그 폴백이 **반환값을 안 보고 `true`** 를 돌려준다(복사가 막혀도 true — INV-4 위반, 02a §3). 그래서 웹은 패키지를
 * 불러오지 않고 `navigator.clipboard.writeText` 의 성공 여부만으로 답한다.
 *
 * 무엇을 보장하나: writeText 성공 → true(인자 그대로 1회) · reject(권한·제스처 없음) / 동기 throw / `navigator.clipboard` 없음(http) → false,
 *  reject 하지 않는다 · `expo-clipboard` 를 불러오지 않는다 · 네이티브 파일과 같은 이름만 내보낸다.
 *
 * (개념) node 환경엔 브라우저 `navigator` 가 없거나 읽기 전용이라 `Object.defineProperty` 로 가짜를 꽂고 afterEach 에서 되돌린다.
 * 3동작: 준비(가짜 clipboard) → 실행(copyText) → 단언(결과 · 호출 인자).
 */

import { copyText } from './index.web';

jest.mock('expo-clipboard', () => {
  throw new Error('expo-clipboard must not load on web');
});

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function setNavigator(value: unknown): void {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'navigator', original);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe('copyText (웹)', () => {
  it('WC1 writeText 가 성공하면 true — 글자 그대로 한 번', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });

    await expect(copyText('부산광역시 해운대구 APEC로 58')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('부산광역시 해운대구 APEC로 58');
  });

  it('WC2 writeText 가 거절돼도(권한·제스처 없음) false — execCommand 폴백이 true 를 우겨도 거짓 true 가 아니다', async () => {
    const execCommand = jest.fn().mockReturnValue(false);
    (globalThis as { document?: unknown }).document = { execCommand };
    setNavigator({
      clipboard: {
        writeText: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('x'), { name: 'NotAllowedError' })
          ),
      },
    });

    try {
      await expect(copyText('a')).resolves.toBe(false);
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it('WC3 navigator.clipboard 가 없으면(http 같은 비보안 컨텍스트) false', async () => {
    setNavigator({});

    await expect(copyText('a')).resolves.toBe(false);
  });

  it('WC4 writeText 가 동기로 던져도 reject 하지 않고 false', async () => {
    setNavigator({
      clipboard: {
        writeText: () => {
          throw new Error('sync');
        },
      },
    });

    await expect(copyText('a')).resolves.toBe(false);
  });

  it('WC5 네이티브·웹 파일은 같은 이름만 내보낸다 (expo-clipboard 는 위 목이 던지게 해 둬서 불러오면 여기서 터진다)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('./index') as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('./index.web') as Record<string, unknown>;

    expect(Object.keys(web).sort()).toEqual(Object.keys(native).sort());
  });
});
