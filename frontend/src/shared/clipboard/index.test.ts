/**
 * @jest-environment node
 */

/**
 * TRIP-1799 — 클립보드 입구(`shared/clipboard`, 네이티브): 주소 복사의 "복사했다" 를 거짓 없이 정하는 한 점.
 *
 * 무엇을 보장하나:
 *  - `copyText(text)` 는 `expo-clipboard` 의 `setStringAsync` 에 **글자 그대로** 한 번 넘긴다(trim·가공 없음 — 무엇을 복사할지는 호출부 몫).
 *  - 결과는 true/false 뿐이고 **reject 하지 않는다**: 네이티브가 true 가 아니라고 답함 · reject · 모듈 로드 throw
 *    (재빌드 전 dev build — `requireNativeModule` 이 로드 순간 던진다) · 함수가 없음 → 전부 false(INV-4, 호출부가 에러 토스트).
 *  - 패키지는 **호출 시점에** 불러온다 — 입구를 import 하는 것만으로는 안 불러온다(정적 import 면 모듈 없는 빌드가 부팅부터 죽는다).
 *
 * (개념) `jest.mock(모듈, 팩토리)` = 그 모듈을 가짜로 통째 치환. 팩토리가 던지면 "모듈이 로드 중에 터지는 빌드" 를 흉내 낼 수 있다.
 *   `jest.resetModules()` 는 이미 불러온 모듈 캐시를 비워 다음 `require` 가 팩토리를 다시 태운다(안 비우면 로드 throw 를 못 본다).
 * 3동작: 준비(가짜 네이티브 응답) → 실행(copyText) → 단언(결과 완전 일치 · 가짜가 받은 인자·횟수).
 */

const mockLoad = jest.fn();
const mockSetString = jest.fn();
let mockLoadThrows = false;
let mockSetStringMissing = false;

jest.mock('expo-clipboard', () => {
  mockLoad();
  if (mockLoadThrows)
    throw new Error('Cannot find native module ExpoClipboard');
  return mockSetStringMissing
    ? {}
    : { setStringAsync: (...args: unknown[]) => mockSetString(...args) };
});

type Entry = typeof import('./index');
function loadEntry(): Entry {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./index') as Entry;
}

beforeEach(() => {
  mockLoad.mockClear();
  mockSetString.mockReset();
  mockLoadThrows = false;
  mockSetStringMissing = false;
});

describe('copyText (네이티브)', () => {
  it('C1 입구를 불러오는 것만으로는 expo-clipboard 를 안 부르고, 처음 복사할 때 부른다', async () => {
    mockSetString.mockResolvedValue(true);

    const { copyText } = loadEntry();

    expect(mockLoad).toHaveBeenCalledTimes(0);
    await copyText('a');
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('C2 네이티브가 true 면 true — 글자 그대로(앞뒤 공백 포함) 한 번만 넘긴다', async () => {
    mockSetString.mockResolvedValue(true);
    const { copyText } = loadEntry();

    const result = await copyText(' 부산광역시 해운대구 APEC로 58 ');

    expect(result).toBe(true);
    expect(mockSetString).toHaveBeenCalledTimes(1);
    expect(mockSetString.mock.calls[0][0]).toBe(
      ' 부산광역시 해운대구 APEC로 58 '
    );
  });

  it('C3 네이티브가 true 가 아니라고 답하면 false', async () => {
    mockSetString.mockResolvedValue(false);
    const { copyText } = loadEntry();

    await expect(copyText('a')).resolves.toBe(false);
  });

  it('C4 setStringAsync 가 reject 해도 reject 하지 않고 false', async () => {
    mockSetString.mockRejectedValue(new Error('denied'));
    const { copyText } = loadEntry();

    await expect(copyText('a')).resolves.toBe(false);
  });

  it('C5 모듈이 로드 중에 터져도(재빌드 전 빌드) reject 하지 않고 false', async () => {
    mockLoadThrows = true;
    const { copyText } = loadEntry();

    await expect(copyText('a')).resolves.toBe(false);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('C6 모듈은 있는데 setStringAsync 가 함수가 아니면 false', async () => {
    mockSetStringMissing = true;
    const { copyText } = loadEntry();

    await expect(copyText('a')).resolves.toBe(false);
  });
});
