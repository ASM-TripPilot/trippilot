import fc from 'fast-check';

import { photoAttach, type PhotoAssetMeta } from './photoAttach';

/**
 * TRIP-566 · AC-2 · PBT-U5-F3 · INV-U5-04 · BR-U5-12 — 위치 동의 없으면 EXIF 좌표를 안 싣는다.
 *
 * 무엇을 보장하나:
 *  - `gpsConsent=false` 면 임의 assetMeta(exif 유무 무관)에도 조립된 AddPhotoRequest 에 exifLat/exifLng
 *    **키 자체가 없다**(omit — undefined 로 실어 보내지도 않는다).
 *  - `gpsConsent=true && exif 존재` 면 그대로 실린다(긍정 짝).
 *  - `photoAttach` 는 순수 함수 — 동의를 직접 안 읽고 **plain boolean 을 인자로** 받는다(DI). expo
 *    타입/모듈 import 0(그 잠금은 recordPhotoBinaryGuard G2 가 소스로 담당).
 *
 * (개념) fast-check = 임의 입력 수백 개로 속성이 항상 성립하는지 확인(PBT). `not.toHaveProperty(k)` =
 *   키가 **존재하지 않아야** 통과 — {exifLat:undefined} 는 키가 있으므로 실패한다(02a §5-A 실측). 그래서
 *   이 단언은 "키를 진짜 뺐다"만 통과시킨다.
 */

/** null·undefined·값 셋 다 내는 nullable arbitrary(AddPhotoRequest 필드가 `?` 옵셔널이라 undefined 포함). */
const isoArb = fc
  .date({
    min: new Date('2020-01-01'),
    max: new Date('2030-01-01'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

const assetMetaArb: fc.Arbitrary<PhotoAssetMeta> = fc.record({
  localAssetId: fc.string({ minLength: 1 }),
  deviceId: fc.string({ minLength: 1 }),
  takenAt: fc.option(isoArb, { nil: undefined }),
  exifLat: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), {
    nil: undefined,
  }),
  exifLng: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), {
    nil: undefined,
  }),
  sortOrder: fc.option(fc.integer(), { nil: undefined }),
});

describe('🔴 AC-2 · PBT — gpsConsent=false 면 EXIF 좌표 omit', () => {
  it('임의 assetMeta(exif 유무 무관)에도 결과에 exifLat/exifLng 키가 없다 + 식별자 보존', () => {
    fc.assert(
      fc.property(assetMetaArb, (asset) => {
        const req = photoAttach(asset, false);

        // 핵심 — 동의 없으면 좌표 키 자체가 부재(undefined 도 아님).
        expect(req).not.toHaveProperty('exifLat');
        expect(req).not.toHaveProperty('exifLng');
        // no-op {} 반환 차단 — 필수 식별자는 그대로 실린다.
        expect(req.localAssetId).toBe(asset.localAssetId);
        expect(req.deviceId).toBe(asset.deviceId);
      })
    );
  });
});

describe('🔴 AC-2 · 긍정 짝 — gpsConsent=true 면 EXIF 를 싣는다', () => {
  it('동의 있고 exif 존재 → exifLat/exifLng 가 입력값 그대로 실린다', () => {
    const asset: PhotoAssetMeta = {
      localAssetId: 'asset-1',
      deviceId: 'dev-1',
      takenAt: '2026-08-31T14:20:00Z',
      exifLat: 35.1531,
      exifLng: 129.1187,
    };

    const req = photoAttach(asset, true);

    expect(req.exifLat).toBe(35.1531);
    expect(req.exifLng).toBe(129.1187);
    expect(req.localAssetId).toBe('asset-1');
  });

  it('동의 있어도 exif 부재(undefined)면 키를 만들지 않는다(undefined 미전송)', () => {
    const asset: PhotoAssetMeta = {
      localAssetId: 'asset-2',
      deviceId: 'dev-1',
    };

    const req = photoAttach(asset, true);

    expect(req).not.toHaveProperty('exifLat');
    expect(req).not.toHaveProperty('exifLng');
  });
});
