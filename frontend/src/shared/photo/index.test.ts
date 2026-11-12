/**
 * @jest-environment node
 */
import {
  canResolveDevicePhotos,
  deletePhotoCopies,
  pickPhotoAssets,
  readPhotoAccess,
  resolvePhotoUri,
} from './index';
import {
  cacheFilesIn,
  documentFileCount,
  fakeExpoFileSystemModule,
  resetFakeFs,
  seedCacheFile,
} from '@/test-support/fakeExpoFileSystem';

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
jest.mock(
  'expo-file-system',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/test-support/fakeExpoFileSystem').fakeExpoFileSystemModule
);

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
// 가짜 파일은 모듈 싱글턴이다 — 사본이 다음 테스트로 새지 않게 파일 최상위에서 비운다.
afterEach(() => resetFakeFs());

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

// TRIP-1798 · 여행 앨범 — 앱(네이티브)은 이 기기 앨범에서 주소를 풀 수 있다. 웹은 `index.web.ts` 가 false.
describe('🔴 canResolveDevicePhotos · 앨범 화면이 성립하는 빌드인가 (TRIP-1798 Q3)', () => {
  it('C1 네이티브는 true 이고, 묻기만 할 뿐 앨범·피커·기기 id 를 건드리지 않는다', () => {
    expect(canResolveDevicePhotos()).toBe(true);

    expect(mockAssetInfo).not.toHaveBeenCalled();
    expect(mockMlRequest).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockGetInstallId).not.toHaveBeenCalled();
  });
});

/**
 * TRIP-1803 · "선택한 사진만"(limited) — 고른 사진이 허용 목록 밖이면 앨범이 nil 을 준다. 앱이 허용 목록에 넣을 API 가 없어
 * 고를 때 피커 파일을 앱 문서 폴더로 옮겨 둔다(D1). 사본은 limited 일 때만 쓴다(D2 — 원본 삭제·권한 해제 사진은 INV-U5-05 그대로).
 *
 * 무엇을 보장하나: 고른 사진이 사본으로 풀린다 · 번호마다 자기 파일을 찾는다(`/` 포함) · 실패해도 첨부는 막지 않는다 ·
 *   전체 허용·앨범에서 풀리는 사진은 사본을 안 만든다 · 서버로 나갈 메타에 경로가 안 섞인다.
 * (개념) 사본 만들기를 경로로 흉내 내지 않고 **limited 로 한 번 고른 뒤** 권한을 바꾼다 — 폴더·파일 이름은 구현 재량이다.
 * 실제 nil·실제 파일 이동은 jest 사각 → 기능 지도(02).
 */
describe('🔴 TRIP-1803 · 고를 때 사본을 둔다', () => {
  const LIMITED = { ...GRANTED, accessPrivileges: 'limited' };
  const pickerFile = (id: string) => `${id.replace(/\//g, '-')}.jpg`;

  /** 피커가 넘겨준 캐시 파일(글자 = `bytes-<번호>`)을 깔고 그 주소로 응답한다. */
  function pickerGives(ids: string[], { missing = [] as string[] } = {}) {
    for (const id of ids) {
      if (!missing.includes(id)) {
        seedCacheFile('ImagePicker', pickerFile(id), `bytes-${id}`);
      }
    }
    mockLaunch.mockResolvedValue({
      canceled: false,
      assets: ids.map((assetId) => ({
        assetId,
        uri: `file:///cache/ImagePicker/${pickerFile(assetId)}`,
        width: 1200,
        height: 900,
      })),
    });
  }
  const textOf = (uri: string | null) =>
    new fakeExpoFileSystemModule.File(uri as string).textSync();

  beforeEach(() => {
    grantAll(LIMITED as typeof GRANTED);
    mockAssetInfo.mockResolvedValue(null); // 허용 목록 밖 = 앨범이 nil 을 준다.
  });

  it.each<[string, () => void]>([
    ['nil', () => mockAssetInfo.mockResolvedValue(null)],
    ['거절', () => mockAssetInfo.mockRejectedValue(new Error('not allowed'))],
    [
      '주소 없는 응답',
      () => mockAssetInfo.mockResolvedValue(assetInfo({ localUri: undefined })),
    ],
  ])(
    'C1 limited 에서 앨범 응답이 %s 면 고른 사진이 앱 문서 폴더 사본으로 풀리고 캐시 원본은 옮겨진다',
    async (_label, primeAlbum) => {
      primeAlbum();
      pickerGives(['id-1']);

      const result = await pickPhotoAssets({ limit: 10 });
      const uri = await resolvePhotoUri('id-1');

      expect(result.kind).toBe('picked');
      expect(uri).toMatch(/^file:\/\/\/document\//); // 캐시 폴더면 OS 가 비워 같은 결함이 돌아온다.
      expect(textOf(uri)).toBe('bytes-id-1');
      expect(cacheFilesIn('ImagePicker')).toEqual([]);
    }
  );

  it('C2 세 장을 고르면 번호마다 자기 파일을 찾는다', async () => {
    pickerGives(['a', 'b', 'c']);

    await pickPhotoAssets({ limit: 10 });

    expect(documentFileCount()).toBe(3);
    expect(textOf(await resolvePhotoUri('a'))).toBe('bytes-a');
    expect(textOf(await resolvePhotoUri('b'))).toBe('bytes-b');
    expect(textOf(await resolvePhotoUri('c'))).toBe('bytes-c');
  });

  it('C3 (E-10) 번호에 `/` 가 있어도 저장과 조회가 같은 파일을 찾고 서로 안 섞인다', async () => {
    pickerGives(['UUID-1/L0/001', 'UUID-1/L0/002']);

    await pickPhotoAssets({ limit: 10 });

    expect(textOf(await resolvePhotoUri('UUID-1/L0/001'))).toBe(
      'bytes-UUID-1/L0/001'
    );
    expect(textOf(await resolvePhotoUri('UUID-1/L0/002'))).toBe(
      'bytes-UUID-1/L0/002'
    );
  });

  it('C4 (E-1) 한 장의 사본이 실패해도 reject·failed 없이 셋 다 picked 이고, 나머지 두 장은 풀리고 그 장만 null 이다', async () => {
    pickerGives(['a', 'b', 'c'], { missing: ['b'] });

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result.kind).toBe('picked');
    const assets = result.kind === 'picked' ? result.assets : [];
    expect(assets.map((a) => a.localAssetId)).toEqual(['a', 'b', 'c']);
    expect(textOf(await resolvePhotoUri('a'))).toBe('bytes-a');
    expect(await resolvePhotoUri('b')).toBeNull();
    expect(textOf(await resolvePhotoUri('c'))).toBe('bytes-c');
  });

  it('C5 limited 라도 앨범에서 풀리는 사진(허용 목록 안)은 사본을 만들지 않는다', async () => {
    pickerGives(['id-1']);
    mockAssetInfo.mockResolvedValue(assetInfo());

    await pickPhotoAssets({ limit: 10 });

    expect(documentFileCount()).toBe(0);
    expect(cacheFilesIn('ImagePicker')).toHaveLength(1);
  });

  it('C6 (E-7) 전체 허용이면 앨범이 못 풀어도 사본을 만들지 않는다', async () => {
    grantAll(GRANTED);
    pickerGives(['id-1']);

    await pickPhotoAssets({ limit: 10 });

    expect(documentFileCount()).toBe(0);
    expect(cacheFilesIn('ImagePicker')).toHaveLength(1);
  });

  it('C7 같은 사진을 다시 골라도 reject 없이 처음 사본을 유지한다', async () => {
    pickerGives(['id-1']);
    await pickPhotoAssets({ limit: 10 });

    seedCacheFile('ImagePicker', pickerFile('id-1'), 'bytes-second');
    const second = await pickPhotoAssets({ limit: 10 });

    expect(second.kind).toBe('picked');
    expect(documentFileCount()).toBe(1);
    expect(textOf(await resolvePhotoUri('id-1'))).toBe('bytes-id-1');
  });

  it('C8 (E-9) 서버로 보낼 메타에는 번호·기기 id 만 있고 파일 경로가 안 섞인다 (BR-U5-11)', async () => {
    pickerGives(['id-1']);

    const result = await pickPhotoAssets({ limit: 10 });

    expect(result).toEqual({
      kind: 'picked',
      assets: [{ localAssetId: 'id-1', deviceId: 'dev-A' }],
      skipped: 0,
    });
    expect(documentFileCount()).toBe(1); // 사본이 실제로 만들어진 상태에서 잰다.
  });

  describe('resolvePhotoUri · 앨범 먼저, 사본은 limited 일 때만 (D2 · INV-U5-05)', () => {
    async function pickedOnce(id = 'id-1') {
      pickerGives([id]);
      await pickPhotoAssets({ limit: 10 });
      expect(documentFileCount()).toBe(1); // 긍정 앵커 — 사본이 있어야 아래 null 이 뜻이 있다.
    }

    it('R5 limited 에서 앨범이 풀리면 사본이 있어도 앨범 주소를 준다', async () => {
      await pickedOnce();
      mockAssetInfo.mockResolvedValue(assetInfo());

      await expect(resolvePhotoUri('id-1')).resolves.toBe(
        'file:///photos/asset-1.jpg'
      );
    });

    it('R6 (E-2) limited 인데 사본이 없는 옛 사진은 null 이다', async () => {
      await expect(resolvePhotoUri('old-photo')).resolves.toBeNull();
    });

    it('R7 (E-4) 전체 허용으로 넓힌 뒤 앨범이 못 풀면(원본 삭제) 사본이 있어도 null 이다', async () => {
      await pickedOnce();
      grantAll(GRANTED);

      await expect(resolvePhotoUri('id-1')).resolves.toBeNull();
    });

    it('R8 (E-5) 권한을 거부로 바꾸면 사본이 있어도 null 이고 권한 요청은 0회다', async () => {
      await pickedOnce();
      grantAll(DENIED);
      mockAssetInfo.mockRejectedValue(new Error('no permission'));
      mockMlRequest.mockClear();
      mockIpRequest.mockClear();

      await expect(resolvePhotoUri('id-1')).resolves.toBeNull();

      expect(mockMlRequest).not.toHaveBeenCalled();
      expect(mockIpRequest).not.toHaveBeenCalled();
    });

    it('R9 권한 조회가 실패하면 모르는 것으로 보고 사본을 쓰지 않는다', async () => {
      await pickedOnce();
      mockMlGet.mockRejectedValue(new Error('native'));

      await expect(resolvePhotoUri('id-1')).resolves.toBeNull();
    });
  });

  describe('deletePhotoCopies · 계정 삭제 때 사본을 비운다 (E-11)', () => {
    it('D1 사본은 지우고 문서 폴더의 다른 파일은 남기며, 지운 뒤 limited 조회는 null 이다', async () => {
      pickerGives(['a', 'b']);
      await pickPhotoAssets({ limit: 10 });
      const { File, Paths } = fakeExpoFileSystemModule;
      new File(Paths.document, 'install-flag-x').create();
      expect(documentFileCount()).toBe(3);

      deletePhotoCopies();

      expect(documentFileCount()).toBe(1);
      expect(new File(Paths.document, 'install-flag-x').exists).toBe(true);
      await expect(resolvePhotoUri('a')).resolves.toBeNull();
    });

    it('D2 지울 폴더가 없어도 던지지 않는다', () => {
      expect(() => deletePhotoCopies()).not.toThrow();
    });
  });
});

// TRIP-1803 — 보기만 하는 화면이 안내를 고를 때 쓴다. 요청이 아니라 조회다(팝업 0).
describe('🔴 TRIP-1803 · readPhotoAccess (D5)', () => {
  it.each<[string, Record<string, unknown>, string]>([
    ['선택한 사진만', { ...GRANTED, accessPrivileges: 'limited' }, 'limited'],
    ['거부', DENIED, 'denied'],
    ['전체 허용', GRANTED, 'all'],
    [
      '아직 안 물어봄',
      { ...DENIED, status: 'undetermined', canAskAgain: true },
      'all',
    ],
  ])('A1 %s → 권한 요청 없이 답한다', async (_label, permission, expected) => {
    mockMlGet.mockResolvedValue(permission);

    await expect(readPhotoAccess()).resolves.toBe(expected);

    expect(mockMlGet).toHaveBeenCalledTimes(1);
    expect(mockMlRequest).not.toHaveBeenCalled();
    expect(mockIpRequest).not.toHaveBeenCalled();
  });

  it('A1 조회가 실패하면 all 이다 — 모르면 버튼을 내밀지 않는다', async () => {
    mockMlGet.mockRejectedValue(new Error('native'));

    await expect(readPhotoAccess()).resolves.toBe('all');
  });
});
