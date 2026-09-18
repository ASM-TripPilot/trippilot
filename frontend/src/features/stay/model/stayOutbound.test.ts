import * as Linking from 'expo-linking';

import type { StayItem } from '@/shared/api/generated/schemas';

import { buildStaySearchUrl, openStayOutbound } from './stayOutbound';

/**
 * TRIP-457 AC-9 · 01b Q2 — 제휴 시트 [이동] 딥링크 사다리(nextNav.ts 패턴 미러).
 *
 * 실 OTA 딥링크 계약(`/stays/{id}/outbound`)이 없고 `StayItem` 엔 이동 URL 이 없다(O1 미결).
 * 그래서 이동은 **웹검색 폴백**(BR-U1-31 "장소 검색 우회" 가 명시 허용)으로만 성립하고, 실패하면
 * 침묵하지 않고 fallback 으로 정직한 안내를 낸다(BR-U1-55 · INV-4).
 *
 * *(개념, nextNav.test 계승)*
 *  - `jest.mock('expo-linking', factory)` = 그 모듈을 가짜로 통째 치환(파일 맨 위로 hoist).
 *  - `mockResolvedValue(x)` = async 가 x 로 성공, `mockRejectedValue(e)` = 거부(→ await 지점 throw).
 *  - `canOpenURL` 은 목만 세팅하고 단언하지 않는다 — 구현이 openURL 단일 사다리든
 *    canOpenURL→openURL 2단이든 통과시키기 위함(★F-5, 웹검색만이라 앱 스킴 단계 자체가 없다).
 *
 * 3동작 뼈대: 준비=목 분기 → 실행=유틸 호출 → 단언=반환값·openURL 인자·fallback 호출.
 */

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
}));

const mockCanOpenURL = Linking.canOpenURL as jest.Mock;
const mockOpenURL = Linking.openURL as jest.Mock;

const ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 그랜드 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
};

const SEARCH_URL =
  'https://www.google.com/search?q=' +
  encodeURIComponent('해운대 그랜드 호텔 예약');

beforeEach(() => {
  jest.clearAllMocks();
  mockCanOpenURL.mockResolvedValue(true);
});

describe('O1 · buildStaySearchUrl (순수 — 웹검색 폴백 URL)', () => {
  it('숙소명 + " 예약" 을 인코딩해 구글 검색 URL 로 만든다', () => {
    expect(buildStaySearchUrl({ name: '해운대 그랜드 호텔' })).toBe(SEARCH_URL);
  });
});

describe('O2 · openStayOutbound 성공 (웹으로 열림)', () => {
  it('검색 URL 로 openURL 하고 "web" 을 반환하며 fallback 을 안 부른다', async () => {
    mockOpenURL.mockResolvedValue(true);
    const fallback = jest.fn();

    const result = await openStayOutbound(ITEM, fallback);

    expect(result).toBe('web');
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(SEARCH_URL);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('O3 · openStayOutbound 실패 (침묵 금지)', () => {
  it('openURL 이 reject 되면 fallback 을 부르고 "failed" 를 반환한다', async () => {
    mockOpenURL.mockRejectedValue(new Error('no browser'));
    const fallback = jest.fn();

    const result = await openStayOutbound(ITEM, fallback);

    expect(result).toBe('failed');
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
