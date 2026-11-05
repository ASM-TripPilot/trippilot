/**
 * @jest-environment node
 */
import { pickPhotoAssets, resolvePhotoUri } from './index';

/**
 * TRIP-1070 · AC-2·AC-6·AC-9·AC-10 — 사진 앨범 어댑터(`shared/photo`) 실장.
 * TRIP-1797 — 한 번에 여러 장: `pickPhotoAssets({limit})` 가 고른 순서대로 `assets` 배열을 준다.
 *
 * 무엇을 보장하나:
 *  - `pickPhotoAssets()` 결과는 다섯 갈래다: 고름(picked) · 취소(canceled) · 권한 거부(denied) ·
 *    자산 번호 없음(no-asset-id, "선택한 사진만 허용" 상태) · 피커 자체 실패(failed). reject 하지 않는다.
 *  - 고른 사진에서 서버로 보낼 메타만 뽑는다 — 자산 번호·설치 식별자·촬영 시각·좌표(있을 때만).
 *    사진 파일 자체(base64)는 요청하지 않는다(INV-U5-03).
 *  - 여러 장: 피커 옵션은 다중 선택·`selectionLimit=limit`·선택 순서 보존. 자산 번호 없는 선택은 `skipped` 로 세고
 *    나머지만 `assets` 에 순서대로 담는다. 전부 없으면 no-asset-id.
 *  - 권한이 없으면 피커를 열지 않는다.
 *  - `resolvePhotoUri(자산 번호)` 는 이 기기 앨범의 파일 주소를 찾는다. 못 찾으면(삭제·권한 없음) null.
 *    보기만 하는 화면에서 권한 팝업을 띄우지 않는다.
 *
 * (개념) 네이티브 모듈은 jest(node)에서 못 돌아서 `jest.mock(모듈, 팩토리)` 로 가짜를 끼운다.
 *   가짜 함수는 바깥 `mock*` 변수에 위임해 케이스마다 반환값을 바꾼다.
 * 3동작: 준비(권한·피커·앨범 응답) → 실행(pickPhotoAssets / resolvePhotoUri) → 단언(결과 완전 일치·호출 횟수).
 */

const mockIpRequest = jest.fn();
const mockIpGet = jest.fn();
const mockLaunch = jest.fn();
const mockMlRequest = jest.fn();
const mockMlGet = jest.fn();
const mockAssetInfo = jest.fn();
const mockGetInstallId = jest.fn();

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockIpRequest(...args),
  getMediaLibraryPermissionsAsync: (...args: unknown[]) => mockIpGet(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunch(...args),
}));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockMlRequest(...args),
  getPermissionsAsync: (...args: unknown[]) => mockMlGet(...args),
  getAssetInfoAsync: (...args: unknown[]) => mockAssetInfo(...args),
}));
jest.mock('@/shared/storage/installId', () => ({
  getInstallId: () => mockGetInstallId(),
}));

const GRANTED = {
  granted: true,
  status: 'granted',
  accessPrivileges: 'all',
  canAskAgain: true,
  expires: 'never',
};
const DENIED = {
  granted: false,
  status: 'denied',
  accessPrivileges: 'none',
  canAskAgain: false,
  expires: 'never',
};

/** 2026-08-20 13:30 서울 = 04:30Z. 앨범은 촬영 시각을 epoch 밀리초로 준다. */
const CREATION_MS = Date.UTC(2026, 7, 20, 4, 30);
const CREATION_ISO = '2026-08-20T04:30:00.000Z';

const picked = (assetId: string | null) => ({
  canceled: false,
  assets: [
    { assetId, uri: 'file:///cache/picked.jpg', width: 1200, height: 900 },
  ],
});

const assetInfo = (over: Record<string, unknown> = {}) => ({
  id: 'asset-1',
  creationTime: CREATION_MS,
  localUri: 'file:///photos/asset-1.jpg',
  location: { latitude: 35.1532, longitude: 129.1186 },
  ...over,
});

function grantAll(permission: typeof GRANTED | typeof DENIED) {
  mockIpRequest.mockResolvedValue(permission);
  mockIpGet.mockResolvedValue(permission);
  mockMlRequest.mockResolvedValue(permission);
  mockMlGet.mockResolvedValue(permission);
}

beforeEach(() => {
  for (const fn of [
    mockIpRequest,
    mockIpGet,
    mockLaunch,
    mockMlRequest,
    mockMlGet,
    mockAssetInfo,
    mockGetInstallId,
  ]) {
    fn.mockReset();
  }
  grantAll(GRANTED);
  mockLaunch.mockResolvedValue(picked('asset-1'));
  mockAssetInfo.mockResolvedValue(assetInfo());
  mockGetInstallId.mockResolvedValue('dev-A');
});

describe('🔴 pickPhotoAssets · 고른 사진의 메타만 뽑는다 (AC-2 · BR-U5-11)', () => {
  it('P1 한 장을 고르면 자산 번호·설치 식별자·촬영 시각(ISO)·좌표를 담은 picked 를 돌려준다', async () => {
    // 실행
    const result = await pickPhotoAssets({ limit: 10 });

    // 단언 — 완전 일치(여분 필드가 붙으면 red).
    expect(result).toEqual({
      kind: 'picked',
      assets: [
        {
          localAssetId: 'asset-1',
          deviceId: 'dev-A',
          takenAt: CREATION_ISO,
          exifLat: 35.1532,
          exifLng: 129.1186,
        },
      ],
      skipped: 0,
    });
    // 앨범 조회는 피커가 준 자산 번호로 한다.
    expect(mockAssetInfo.mock.calls[0]?.[0]).toBe('asset-1');
  });

  it('P2 좌표가 없는 사진이면 exifLat·exifLng 키 자체가 없다', async () => {
    mockAssetInfo.mockResolvedValue(assetInfo({ location: undefined }));

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result.kind).toBe('picked');
    const asset = result.kind === 'picked' ? (result.assets[0] ?? {}) : {};
    expect(asset).not.toHaveProperty('exifLat');
    expect(asset).not.toHaveProperty('exifLng');
    expect(asset).toMatchObject({ localAssetId: 'asset-1', deviceId: 'dev-A' });
  });

  it('P7 피커는 여러 장·한도 limit·선택 순서 보존으로, 파일 본문(base64) 없이 연다 · 쓰기 전용 권한은 요청하지 않는다', async () => {
    await pickPhotoAssets({ limit: 4 });

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    const options = (mockLaunch.mock.calls[0]?.[0] ?? {}) as Record<
      string,
      unknown
    >;
    const mediaTypes = options.mediaTypes;
    expect(
      mediaTypes === 'images' ||
        (Array.isArray(mediaTypes) &&
          mediaTypes.length === 1 &&
          mediaTypes[0] === 'images')
    ).toBe(true);
    expect(options.base64).not.toBe(true);
    expect(options.allowsMultipleSelection).toBe(true);
    expect(options.selectionLimit).toBe(4);
    expect(options.orderedSelection).toBe(true);

    // 권한 호출 어디에도 writeOnly=true 가 없다(사진 저장 문구는 설정에서 지웠다).
    const permissionCalls = [
      ...mockIpRequest.mock.calls,
      ...mockIpGet.mock.calls,
      ...mockMlRequest.mock.calls,
      ...mockMlGet.mock.calls,
    ];
    expect(permissionCalls.length).toBeGreaterThan(0);
    for (const call of permissionCalls) {
      expect(call[0]).not.toBe(true);
    }
  });
});

describe('🔴 pickPhotoAssets · 여러 장 (TRIP-1797 · 순서 보존 · 일부 번호 없음)', () => {
  const pickedMany = (ids: (string | null)[]) => ({
    canceled: false,
    assets: ids.map((assetId) => ({
      assetId,
      uri: 'file:///cache/picked.jpg',
      width: 1200,
      height: 900,
    })),
  });

  it('P1b 고른 순서대로 assets 에 담고 앨범 조회는 장마다 1회, 피커는 1회', async () => {
    mockLaunch.mockResolvedValue(pickedMany(['a', 'b', 'c']));

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result.kind).toBe('picked');
    const assets = result.kind === 'picked' ? result.assets : [];
    expect(assets.map((a) => a.localAssetId)).toEqual(['a', 'b', 'c']);
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockAssetInfo).toHaveBeenCalledTimes(3);
  });

  it('P1c 한 장의 앨범 조회가 실패해도 그 장은 필수 메타(번호·기기)만으로 남는다', async () => {
    mockLaunch.mockResolvedValue(pickedMany(['a', 'b']));
    mockAssetInfo.mockImplementation(async (id: string) => {
      if (id === 'b') throw new Error('info failed');
      return assetInfo();
    });

    const result = await pickPhotoAssets({ limit: 10 });

    const assets = result.kind === 'picked' ? result.assets : [];
    expect(assets.map((a) => a.localAssetId)).toEqual(['a', 'b']);
    const b = assets[1] ?? {};
    expect(b).toMatchObject({ localAssetId: 'b', deviceId: 'dev-A' });
    expect(b).not.toHaveProperty('takenAt');
    expect(b).not.toHaveProperty('exifLat');
  });

  it('P5b 세 장 중 가운데만 자산 번호가 없으면 나머지 둘이 순서대로 담기고 skipped 는 1이다', async () => {
    mockLaunch.mockResolvedValue(pickedMany(['a', null, 'c']));

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result.kind).toBe('picked');
    const assets = result.kind === 'picked' ? result.assets : [];
    expect(assets.map((a) => a.localAssetId)).toEqual(['a', 'c']);
    expect(result.kind === 'picked' ? result.skipped : -1).toBe(1);
    expect(mockAssetInfo).toHaveBeenCalledTimes(2);
  });

  it('P5c 둘 다 자산 번호가 없으면 no-asset-id 다 (기존 안내 갈래 보존)', async () => {
    mockLaunch.mockResolvedValue(pickedMany([null, null]));

    await expect(pickPhotoAssets({ limit: 10 })).resolves.toEqual({
      kind: 'no-asset-id',
    });
  });

  it('P7b 피커가 limit 보다 많이 돌려줘도 앞 limit 장까지만 담는다 (초과분은 skipped 에 세지 않는다)', async () => {
    mockLaunch.mockResolvedValue(pickedMany(['a', 'b', 'c']));

    const result = await pickPhotoAssets({ limit: 2 });

    const assets = result.kind === 'picked' ? result.assets : [];
    expect(assets.map((a) => a.localAssetId)).toEqual(['a', 'b']);
    expect(result.kind === 'picked' ? result.skipped : -1).toBe(0);
  });
});

describe('🔴 pickPhotoAssets · 실패 갈래 (AC-9 · AC-10 · INV-4)', () => {
  it('P3 사용자가 취소하면 canceled 이고 앨범 조회도 하지 않는다', async () => {
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result).toEqual({ kind: 'canceled' });
    expect(mockAssetInfo).not.toHaveBeenCalled();
  });

  it('P4 사진 권한이 거부되면 denied 이고 피커를 열지 않는다', async () => {
    grantAll(DENIED);

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result).toEqual({ kind: 'denied' });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('P5 고른 사진에 자산 번호가 없으면(선택한 사진만 허용) no-asset-id 다', async () => {
    mockLaunch.mockResolvedValue(picked(null));

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result).toEqual({ kind: 'no-asset-id' });
  });

  it('P8 사진 접근이 "선택한 사진만"(limited)이어도 막지 않고 피커를 연다 (5.1.1(iii))', async () => {
    grantAll({ ...GRANTED, accessPrivileges: 'limited' });
    mockLaunch.mockResolvedValue(picked('asset-1'));

    const result = await pickPhotoAssets({ limit: 10 });

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('picked');
  });

  it('P6 피커가 예외를 던져도(재빌드 전 앱) reject 하지 않고 failed 를 돌려준다', async () => {
    mockLaunch.mockRejectedValue(new Error('native module missing'));

    await expect(pickPhotoAssets({ limit: 10 })).resolves.toEqual({
      kind: 'failed',
    });
  });
});

describe('🔴 resolvePhotoUri · 이 기기 앨범에서 사진 주소 찾기 (AC-5 · AC-6 · BR-U5-14)', () => {
  it('R1 자산 번호로 앨범 파일 주소를 돌려주고, 권한 팝업을 띄우지 않는다', async () => {
    const uri = await resolvePhotoUri('asset-1');

    expect(uri).toBe('file:///photos/asset-1.jpg');
    expect(mockAssetInfo.mock.calls[0]?.[0]).toBe('asset-1');
    expect(mockIpRequest).not.toHaveBeenCalled();
    expect(mockMlRequest).not.toHaveBeenCalled();
  });

  it('R2 앨범 조회가 실패하면(사진 삭제·권한 없음) null 이다', async () => {
    mockAssetInfo.mockRejectedValue(new Error('asset not found'));

    await expect(resolvePhotoUri('asset-gone')).resolves.toBeNull();
  });

  it.each([
    ['주소 필드가 없는 응답', { id: 'asset-1', creationTime: CREATION_MS }],
    ['응답 자체가 없음(undefined)', undefined],
  ])('R3 %s 이면 null 이다', async (_label, response) => {
    mockAssetInfo.mockResolvedValue(response);

    await expect(resolvePhotoUri('asset-1')).resolves.toBeNull();
  });
});
