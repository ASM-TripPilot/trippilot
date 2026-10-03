import * as Linking from 'expo-linking';

import { openStayOutbound, stayOutboundMode } from './stayOutbound';

/**
 * TRIP-1167 — 제휴 시트 [이동]은 서버 아웃바운드 `GET /stays/{stayId}/outbound` 를 브라우저로 연다.
 * 서버가 클릭을 기록하고 트립닷컴 딥링크로 302(리다이렉트 — "이 주소로 다시 가라"는 응답)하며, 브라우저가
 * 따라간다. 클라는 OTA·검색 URL 을 조립하지 않는다(목적지 결정은 서버 소유). 브라우저를 못 열면 침묵하지 않고
 * fallback 으로 알린다(BR-U1-55 · INV-4).
 *
 * *(개념, nextNav.test 계승)*
 *  - `jest.mock('expo-linking', factory)` = 그 모듈을 가짜로 통째 치환(파일 맨 위로 hoist).
 *  - `mockResolvedValue(x)` = async 가 x 로 성공, `mockRejectedValue(e)` = 거부(→ await 지점 throw).
 *  - `canOpenURL` 은 목만 세팅하고 단언하지 않는다 — 구현이 openURL 단일 사다리든
 *    canOpenURL→openURL 2단이든 통과시키기 위함(★F-5).
 *
 * 3동작 뼈대: 준비=목 분기 → 실행=유틸 호출 → 단언=반환값·openURL 인자·fallback 호출.
 */

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
}));

const mockCanOpenURL = Linking.canOpenURL as jest.Mock;
const mockOpenURL = Linking.openURL as jest.Mock;

// 기준 주소는 리터럴로 박는다 — `API_BASE_URL` 을 가져와 쓰면 `/api/v1` 이 빠지거나 겹쳐도 같이 따라가
// 못 잡는다. jest 는 env 가 없어 개발 기본값(localhost:8080)이다.
const API_BASE = 'http://localhost:8080/api/v1';
const STAY_ID = 'NAVER:s1';

beforeEach(() => {
  jest.clearAllMocks();
  mockCanOpenURL.mockResolvedValue(true);
});

describe('O2 · openStayOutbound 성공 (서버 아웃바운드로 열림)', () => {
  it('서버 아웃바운드 URL 로 openURL 하고 "web" 을 반환하며 fallback 을 안 부른다', async () => {
    mockOpenURL.mockResolvedValue(true);
    const fallback = jest.fn();

    const result = await openStayOutbound(STAY_ID, fallback);

    expect(result).toBe('web');
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith(
      `${API_BASE}/stays/NAVER%3As1/outbound`
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it('stayId 의 특수문자(: / 공백 ? #)는 경로 한 칸으로 인코딩된다 — 다른 경로·쿼리로 새지 않는다', async () => {
    mockOpenURL.mockResolvedValue(true);

    await openStayOutbound('LOCALDATA:3000000/201 a?b#c', () => {});

    expect(mockOpenURL).toHaveBeenCalledWith(
      `${API_BASE}/stays/LOCALDATA%3A3000000%2F201%20a%3Fb%23c/outbound`
    );
  });
});

describe('O3 · openStayOutbound 실패 (침묵 금지)', () => {
  it('openURL 이 reject 되면 fallback 을 부르고 "failed" 를 반환한다', async () => {
    mockOpenURL.mockRejectedValue(new Error('no browser'));
    const fallback = jest.fn();

    const result = await openStayOutbound(STAY_ID, fallback);

    expect(result).toBe('failed');
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

// [이동]이 제휴 딥링크인지 웹검색 폴백인지를 말해 주는 값 — 제휴 고지 시트가 이 값으로 얼굴을 고른다.
// 이동이 서버 아웃바운드(제휴 딥링크)가 됐으니 수수료 고지(BR-U1-30)가 떠야 한다(TRIP-1167).
describe('O4 · stayOutboundMode — 이동은 서버 아웃바운드 = 제휴 (TRIP-1167 · BR-U1-30)', () => {
  it("인자 없이 부르면 'affiliate' 를 돌려준다", () => {
    expect(stayOutboundMode()).toBe('affiliate');
  });
});
