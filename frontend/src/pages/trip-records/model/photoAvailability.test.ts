import { photoAvailability } from './photoAvailability';

/**
 * TRIP-566 · AC-3·AC-4 판정 · BR-U5-14/15 · INV-U5-05 · INV-4 — 자산 실패·타 기기 사진 판별 유니온.
 *
 * 무엇을 보장하나:
 *  - `deviceId` 가 현재 기기와 **다르면** 'other-device'(자산 접근 성공/실패 무관 — 애초에 이 기기에
 *    자산이 없다, BR-U5-15). deviceId 우선.
 *  - 같은 기기일 때만 자산 접근 결과로 갈린다: 성공 'available' · 실패 'unavailable'(BR-U5-14/INV-4 —
 *    깨진 썸네일 대신 정직한 사유).
 *
 * (개념) 판별 유니온 = 반환이 정해진 문자열 셋 중 하나. 진리표(it.each)로 2축(deviceId 일치×assetOk)
 *   네 모서리를 전수 — 특히 diff+ok 행이 "deviceId 가 assetOk 를 이긴다"를 증명(우선순위 뒤바뀜 검출).
 */

describe('AC-3·AC-4 · photoAvailability — deviceId × assetOk 진리표', () => {
  const CURRENT = 'this-device';
  const cases: Array<{
    name: string;
    deviceId: string;
    assetOk: boolean;
    expected: 'available' | 'other-device' | 'unavailable';
  }> = [
    {
      name: '같은 기기 + 자산 OK → available',
      deviceId: CURRENT,
      assetOk: true,
      expected: 'available',
    },
    {
      name: '같은 기기 + 자산 실패 → unavailable',
      deviceId: CURRENT,
      assetOk: false,
      expected: 'unavailable',
    },
    {
      name: '다른 기기 + 자산 OK → other-device (deviceId 우선)',
      deviceId: 'other-device-id',
      assetOk: true,
      expected: 'other-device',
    },
    {
      name: '다른 기기 + 자산 실패 → other-device',
      deviceId: 'other-device-id',
      assetOk: false,
      expected: 'other-device',
    },
  ];

  it.each(cases)('$name', ({ deviceId, assetOk, expected }) => {
    expect(photoAvailability({ deviceId }, CURRENT, assetOk)).toBe(expected);
  });
});
