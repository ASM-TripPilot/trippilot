/**
 * @jest-environment node
 */

/**
 * TRIP-1070 · AC-15 — 설치 단위 기기 식별자(`getInstallId`).
 *
 * 무엇을 보장하나:
 *  - 기기에 저장된 값이 있으면 그 값을 쓴다(새로 만들지 않는다).
 *  - 없으면 한 번 만들어 같은 키로 저장하고 돌려준다. 길이는 서버 계약(`deviceId` ≤ 64) 안이다.
 *  - 화면 여러 곳이 동시에 처음 물어도 값은 하나다 — 각자 새 id 를 쓰면 한 설치에 id 가 둘이 되고,
 *    먼저 붙인 사진이 영영 "다른 기기에서 찍은 사진"이 된다.
 *
 * (개념) `jest.isolateModules` = 그 안에서 require 한 모듈을 캐시 없이 새로 읽는다. 식별자를 모듈 안에
 *   기억해 두는 구현이라, 케이스마다 새 모듈로 시작해야 앞 케이스의 기억이 새지 않는다.
 * 3동작: 준비(기기 저장소·UUID 목) → 실행(getInstallId 호출) → 단언(값·저장·호출 횟수).
 */

type GetInstallId = (typeof import('./installId'))['getInstallId'];

const mockVault = new Map<string, string>();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRandomUUID = jest.fn();

// 새 모듈로 다시 읽어도 같은 목 함수를 보도록 바깥 함수에 위임한다.
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItem(...args),
  setItemAsync: (...args: unknown[]) => mockSetItem(...args),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

const UUID = '0b6f4a3e-9c1d-4e2a-8f7b-5d3c2a1e0f9b';

beforeEach(() => {
  mockVault.clear();
  mockGetItem
    .mockReset()
    .mockImplementation(async (key: string) => mockVault.get(key) ?? null);
  mockSetItem
    .mockReset()
    .mockImplementation(async (key: string, value: string) => {
      mockVault.set(key, value);
    });
  mockRandomUUID.mockReset().mockReturnValue(UUID);
});

/** 캐시 없이 새 모듈을 읽어 getInstallId 를 꺼낸다(모듈 안 기억 초기화). */
function loadFresh(): GetInstallId {
  let fn: GetInstallId | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fn = require('./installId').getInstallId;
  });
  if (!fn) throw new Error('getInstallId 를 못 읽었다');
  return fn;
}

describe('🔴 AC-15 · 설치 단위 기기 식별자', () => {
  it('I1 기기에 저장된 값이 있으면 그 값을 돌려주고 새로 만들거나 쓰지 않는다', async () => {
    // 준비 — 저장소가 이미 값을 갖고 있다. 어떤 키로 읽든 그 값이 나오게 한다.
    mockGetItem.mockImplementation(async () => 'stored-install-id');
    const getInstallId = loadFresh();

    // 실행
    const id = await getInstallId();

    // 단언
    expect(id).toBe('stored-install-id');
    expect(mockRandomUUID).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('I2 저장된 값이 없으면 새로 만들어 읽은 키와 같은 키로 1회 저장하고, 길이는 64자 이하다', async () => {
    const getInstallId = loadFresh();

    const id = await getInstallId();

    expect(id).toBe(UUID);
    expect(id.length).toBeGreaterThan(0);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    // 왕복 — 쓴 키가 읽은 키와 같아야 다음 실행에서 찾는다.
    const readKey = mockGetItem.mock.calls[0]?.[0];
    expect(mockSetItem).toHaveBeenCalledWith(readKey, UUID);
  });

  it('I3 동시에 처음 세 번 물어도 값은 하나이고, 읽기·생성·쓰기는 각 1회다', async () => {
    // 준비 — UUID 가 부를 때마다 달라지게 해, 두 번 만들면 값이 갈리도록 한다.
    let n = 0;
    mockRandomUUID.mockImplementation(() => `uuid-${++n}`);
    const getInstallId = loadFresh();

    // 실행 — 앞 호출이 끝나기 전에 세 번.
    const ids = await Promise.all([
      getInstallId(),
      getInstallId(),
      getInstallId(),
    ]);

    // 단언
    expect(new Set(ids).size).toBe(1);
    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockRandomUUID).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it('I4 한 번 정해진 뒤 다시 물으면 저장소를 다시 읽지 않고 같은 값을 돌려준다', async () => {
    const getInstallId = loadFresh();
    const first = await getInstallId();

    const second = await getInstallId();

    expect(second).toBe(first);
    expect(mockGetItem).toHaveBeenCalledTimes(1);
  });
});
