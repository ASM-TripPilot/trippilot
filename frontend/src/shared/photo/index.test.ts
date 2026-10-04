/**
 * @jest-environment node
 */
import { pickPhotoAsset, resolvePhotoUri } from './index';

/**
 * TRIP-1070 · AC-2·AC-6·AC-9·AC-10 — 사진 앨범 어댑터(`shared/photo`) 실장.
 *
 * 무엇을 보장하나:
 *  - `pickPhotoAsset()` 결과는 다섯 갈래다: 고름(picked) · 취소(canceled) · 권한 거부(denied) ·
 *    자산 번호 없음(no-asset-id, "선택한 사진만 허용" 상태) · 피커 자체 실패(failed). reject 하지 않는다.
 *  - 고른 사진에서 서버로 보낼 메타만 뽑는다 — 자산 번호·설치 식별자·촬영 시각·좌표(있을 때만).
 *    사진 파일 자체(base64)는 요청하지 않는다(INV-U5-03).
 *  - 권한이 없으면 피커를 열지 않는다.
 *  - `resolvePhotoUri(자산 번호)` 는 이 기기 앨범의 파일 주소를 찾는다. 못 찾으면(삭제·권한 없음) null.
 *    보기만 하는 화면에서 권한 팝업을 띄우지 않는다.
 *
 * (개념) 네이티브 모듈은 jest(node)에서 못 돌아서 `jest.mock(모듈, 팩토리)` 로 가짜를 끼운다.
 *   가짜 함수는 바깥 `mock*` 변수에 위임해 케이스마다 반환값을 바꾼다.
 * 3동작: 준비(권한·피커·앨범 응답) → 실행(pickPhotoAsset / resolvePhotoUri) → 단언(결과 완전 일치·호출 횟수).
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

describe('🔴 pickPhotoAsset · 고른 사진의 메타만 뽑는다 (AC-2 · BR-U5-11)', () => {
  it('P1 한 장을 고르면 자산 번호·설치 식별자·촬영 시각(ISO)·좌표를 담은 picked 를 돌려준다', async () => {
    // 실행
    const result = await pickPhotoAsset();

    // 단언 — 완전 일치(여분 필드가 붙으면 red).
    expect(result).toEqual({
      kind: 'picked',
      asset: {
        localAssetId: 'asset-1',
        deviceId: 'dev-A',
        takenAt: CREATION_ISO,
        exifLat: 35.1532,
        exifLng: 129.1186,
      },
    });
    // 앨범 조회는 피커가 준 자산 번호로 한다.
    expect(mockAssetInfo.mock.calls[0]?.[0]).toBe('asset-1');
  });

  it('P2 좌표가 없는 사진이면 exifLat·exifLng 키 자체가 없다', async () => {
    mockAssetInfo.mockResolvedValue(assetInfo({ location: undefined }));

    const result = await pickPhotoAsset();

    expect(result.kind).toBe('picked');
    const asset = result.kind === 'picked' ? result.asset : {};
    expect(asset).not.toHaveProperty('exifLat');
    expect(asset).not.toHaveProperty('exifLng');
    expect(asset).toMatchObject({ localAssetId: 'asset-1', deviceId: 'dev-A' });
  });

  it('P7 피커는 사진 1장만, 파일 본문(base64) 없이 연다 · 쓰기 전용 권한은 요청하지 않는다', async () => {
    await pickPhotoAsset();

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
    expect(options.allowsMultipleSelection).not.toBe(true);

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

describe('🔴 pickPhotoAsset · 실패 갈래 (AC-9 · AC-10 · INV-4)', () => {
  it('P3 사용자가 취소하면 canceled 이고 앨범 조회도 하지 않는다', async () => {
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });

    const result = await pickPhotoAsset();

    expect(result).toEqual({ kind: 'canceled' });
    expect(mockAssetInfo).not.toHaveBeenCalled();
  });

  it('P4 사진 권한이 거부되면 denied 이고 피커를 열지 않는다', async () => {
    grantAll(DENIED);

    const result = await pickPhotoAsset();

    expect(result).toEqual({ kind: 'denied' });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('P5 고른 사진에 자산 번호가 없으면(선택한 사진만 허용) no-asset-id 다', async () => {
    mockLaunch.mockResolvedValue(picked(null));

    const result = await pickPhotoAsset();

    expect(result).toEqual({ kind: 'no-asset-id' });
  });

  it('P8 사진 접근이 "선택한 사진만"(limited)이면 limited 이고 피커를 열지 않는다 (TRIP-1216 a)', async () => {
    // 제한 접근에서 고른 자산 번호는 나중에(재시작 뒤) 앨범이 다시 못 찾을 수 있다 — 붙이기 전에 막는다.
    grantAll({ ...GRANTED, accessPrivileges: 'limited' });

    const result = await pickPhotoAsset();

    expect(result).toEqual({ kind: 'limited' });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockAssetInfo).not.toHaveBeenCalled();
  });

  it('P6 피커가 예외를 던져도(재빌드 전 앱) reject 하지 않고 failed 를 돌려준다', async () => {
    mockLaunch.mockRejectedValue(new Error('native module missing'));

    await expect(pickPhotoAsset()).resolves.toEqual({ kind: 'failed' });
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
