import * as Linking from 'expo-linking';

import {
  buildNaverPlaceAppUrl,
  buildNaverPlaceWebUrl,
  canOpenNaverPlace,
  openNaverPlace,
} from './naverPlaceLink';

/**
 * "네이버 지도에서 보기" — URL 조립(순수)과 앱 → 웹 → 실패 사다리.
 * 3동작 뼈대: 준비(openURL 목 분기) → 실행(openNaverPlace) → 단언(반환값·openURL 인자).
 */

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
const mockOpenURL = Linking.openURL as jest.Mock;

const FULL = { nameKo: '광안리', lat: 35.1, lng: 129.1 };
const APP = `nmap://place?lat=35.1&lng=129.1&name=${encodeURIComponent('광안리')}&appname=com.trippilot.travel`;
const WEB = `https://map.naver.com/p/search/${encodeURIComponent('광안리')}`;

beforeEach(() => mockOpenURL.mockReset());

describe('URL 조립', () => {
  it('이름·좌표가 있으면 앱 URL 에 이름이 인코딩되어 실린다', () => {
    expect(buildNaverPlaceAppUrl(FULL)).toBe(APP);
  });

  it('특수문자(공백·&·#·괄호)는 인코딩되어 쿼리를 깨지 않는다', () => {
    const name = '카페 A&B #1 (본점)';
    expect(buildNaverPlaceAppUrl({ ...FULL, nameKo: name })).toContain(
      `name=${encodeURIComponent(name)}&appname=`
    );
    expect(buildNaverPlaceWebUrl({ nameKo: name })).toBe(
      `https://map.naver.com/p/search/${encodeURIComponent(name)}`
    );
  });

  it('좌표가 없거나 범위 밖이면 앱 URL 이 없다(웹만)', () => {
    expect(buildNaverPlaceAppUrl({ nameKo: '광안리' })).toBeNull();
    expect(buildNaverPlaceAppUrl({ ...FULL, lat: 99 })).toBeNull();
    expect(buildNaverPlaceAppUrl({ ...FULL, lng: NaN })).toBeNull();
    expect(buildNaverPlaceWebUrl(FULL)).toBe(WEB);
  });

  it('이름이 비면 웹 URL 이 없고, 앱 URL 은 일반 이름("장소")으로 좌표만 싣는다', () => {
    expect(buildNaverPlaceWebUrl({ lat: 35.1, lng: 129.1 })).toBeNull();
    expect(buildNaverPlaceWebUrl({ ...FULL, nameKo: '  ' })).toBeNull();
    expect(buildNaverPlaceAppUrl({ lat: 35.1, lng: 129.1 })).toContain(
      `name=${encodeURIComponent('장소')}`
    );
  });

  it('이름도 좌표도 없으면 열 수 없다', () => {
    expect(canOpenNaverPlace({})).toBe(false);
    expect(canOpenNaverPlace({ nameKo: null, lat: null, lng: null })).toBe(
      false
    );
    expect(canOpenNaverPlace({ nameKo: '광안리' })).toBe(true);
    expect(canOpenNaverPlace({ lat: 35.1, lng: 129.1 })).toBe(true);
  });
});

describe('openNaverPlace 사다리', () => {
  it('앱이 열리면 앱 URL 한 번만 연다', async () => {
    mockOpenURL.mockResolvedValue(undefined);
    await expect(openNaverPlace(FULL)).resolves.toBe('app');
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(APP);
  });

  it('앱 openURL 이 reject 되면 웹 URL 로 강등한다', async () => {
    mockOpenURL.mockRejectedValueOnce(new Error('no app'));
    mockOpenURL.mockResolvedValueOnce(undefined);
    await expect(openNaverPlace(FULL)).resolves.toBe('web');
    expect(mockOpenURL.mock.calls.map((c) => c[0])).toEqual([APP, WEB]);
  });

  it('좌표가 없으면 앱을 건너뛰고 웹만 연다', async () => {
    mockOpenURL.mockResolvedValue(undefined);
    await expect(openNaverPlace({ nameKo: '광안리' })).resolves.toBe('web');
    expect(mockOpenURL.mock.calls.map((c) => c[0])).toEqual([WEB]);
  });

  it('앱·웹 모두 실패하면 failed 를 돌려준다(침묵하지 않는다)', async () => {
    mockOpenURL.mockRejectedValue(new Error('x'));
    await expect(openNaverPlace(FULL)).resolves.toBe('failed');
    expect(mockOpenURL).toHaveBeenCalledTimes(2);
  });
});
