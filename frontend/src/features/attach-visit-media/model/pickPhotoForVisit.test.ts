/**
 * @jest-environment node
 */

/**
 * TRIP-1648 · D2 — `pickPhotoForVisit` 의 새 갈래 `unsupported`(웹): "앱에서만 쓸 수 있어요" 한 줄.
 *
 * 무엇을 보장하나:
 *  - 사진 입구가 `unsupported` 를 돌려주면 `{ notice: '사진 붙이기는 앱에서만 쓸 수 있어요' }` 만 준다 — 부르는 쪽(허브 `[사진]`·
 *    j01 `+`)이 이미 notice 를 트리거 옆에 그리므로 화면 코드 변경 없이 "눌렀는데 아무 일도 없음"이 사라진다(INV-4).
 *    `settings` 키는 **아예 없어야** 한다 — 웹엔 설정 앱이 없어 `[설정 열기]` 가 무반응 버튼이 된다.
 *  - 위치 동의 조회는 하지 않는다(고르지 못했으므로).
 *  - 짝 대조: 기존 갈래(거부 → `settings:true` · 취소 → `notice:null`)는 그대로다.
 *
 * TRIP-1797 — 한 번에 여러 장: 고른 뒤 `{ assets, skipped, gpsConsent }`. 위치 동의는 장수와 무관하게 **1회**만 읽고(전 장 공통 적용),
 *   남은 칸에서 정한 `limit` 을 사진 입구에 그대로 넘긴다. 동의 조회 실패는 끈 것으로 보고 첨부는 막지 않는다.
 *
 * (개념) `toStrictEqual` = `undefined` 값을 가진 키까지 구분한다. `toEqual` 은 `{notice, settings: undefined}` 도 통과시켜
 *   "키 없음"을 못 잡는다(02a ★7).
 * 3동작: 준비(사진 입구 목의 반환) → 실행(`pickPhotoForVisit`) → 단언(결과 완전 일치·동의 조회 0회).
 */

import { getMeLocationConsent } from '@/shared/api/index.hooks';
import { pickPhotoAssets } from '@/shared/photo';

import { pickPhotoForVisit } from './pickPhotoForVisit';

jest.mock('@/shared/photo', () => ({ pickPhotoAssets: jest.fn() }));
jest.mock('@/shared/api/index.hooks', () => ({
  getMeLocationConsent: jest.fn(),
}));

const mockPick = pickPhotoAssets as jest.Mock;
const mockConsent = getMeLocationConsent as jest.Mock;

beforeEach(() => {
  mockPick.mockReset();
  mockConsent.mockReset();
});

describe('pickPhotoForVisit — 웹(unsupported)', () => {
  it('unsupported 이면 앱 지원 안내만 돌려준다 (settings 키 없음, 동의 조회 0회)', async () => {
    mockPick.mockResolvedValue({ kind: 'unsupported' });

    const outcome = await pickPhotoForVisit({ limit: 10 });

    expect(outcome).toStrictEqual({
      notice: '사진 붙이기는 앱에서만 쓸 수 있어요',
    });
    expect(mockConsent).not.toHaveBeenCalled();
  });

  it('(대조) 기존 갈래는 그대로다 — 거부는 설정 열기를 함께 주고, 취소는 조용한 null', async () => {
    mockPick.mockResolvedValueOnce({ kind: 'denied' });
    mockPick.mockResolvedValueOnce({ kind: 'canceled' });

    await expect(pickPhotoForVisit({ limit: 10 })).resolves.toStrictEqual({
      notice: '사진 접근 권한이 없어 사진을 불러올 수 없어요',
      settings: true,
    });
    await expect(pickPhotoForVisit({ limit: 10 })).resolves.toStrictEqual({
      notice: null,
    });
  });
});

describe('pickPhotoForVisit — 여러 장 (TRIP-1797)', () => {
  const meta = (id: string) => ({ localAssetId: id, deviceId: 'dev-A' });

  it('V1 세 장을 고르면 assets·skipped·gpsConsent 를 돌려주고 동의 조회는 정확히 1회다', async () => {
    mockPick.mockResolvedValue({
      kind: 'picked',
      assets: [meta('a'), meta('b'), meta('c')],
      skipped: 1,
    });
    mockConsent.mockResolvedValue({ gpsRecordingOptIn: true });

    const outcome = await pickPhotoForVisit({ limit: 10 });

    expect(outcome).toStrictEqual({
      assets: [meta('a'), meta('b'), meta('c')],
      skipped: 1,
      gpsConsent: true,
    });
    expect(mockConsent).toHaveBeenCalledTimes(1);
  });

  it('V2 남은 칸(limit)을 사진 입구에 그대로 넘긴다', async () => {
    mockPick.mockResolvedValue({ kind: 'canceled' });

    await pickPhotoForVisit({ limit: 4 });

    expect(mockPick).toHaveBeenCalledWith({ limit: 4 });
  });

  it('V3 동의 조회가 실패하면 끈 것으로 보고 assets 는 그대로 준다', async () => {
    mockPick.mockResolvedValue({
      kind: 'picked',
      assets: [meta('a')],
      skipped: 0,
    });
    mockConsent.mockRejectedValue(new Error('boom'));

    await expect(pickPhotoForVisit({ limit: 10 })).resolves.toStrictEqual({
      assets: [meta('a')],
      skipped: 0,
      gpsConsent: false,
    });
  });

  it('V4 자산 번호가 전부 없으면 설정 열기를 함께 주고 동의는 읽지 않는다', async () => {
    mockPick.mockResolvedValue({ kind: 'no-asset-id' });

    const outcome = await pickPhotoForVisit({ limit: 10 });

    expect(outcome).toMatchObject({ settings: true });
    expect('notice' in outcome).toBe(true);
    expect(mockConsent).not.toHaveBeenCalled();
  });
});
