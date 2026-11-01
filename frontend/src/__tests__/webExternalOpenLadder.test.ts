/**
 * @jest-environment node
 */

/**
 * TRIP-1684 · AC2-b·AC2-c·AC1-c — 호출부 사다리(네이버 장소·길찾기·제휴 이동)를 **웹 헬퍼 위에 얹어** 본다.
 *
 * 왜 따로 두나: 웹 헬퍼 단독 테스트(`shared/external-link/openExternal.web.test.ts`)는 "nmap:// 를 거절한다"까지만 안다. 버그(웹 QA
 * A-03·C-02)는 그 거절을 받은 **사다리가 웹 URL 로 내려가는가**에 있다. shared 는 features 를 import 할 수 없어 층 밖인 이 폴더에 둔다.
 *
 * 무엇을 보장하나 (웹이 골라진 세계에서):
 *  - `nmap://` 단계를 건너뛰고 웹 URL 을 새 탭으로 **1번만** 연다. 반환은 'web'. 앱 스킴으로는 `window.open` 0, `expo-linking` 0.
 *  - 그 `window.open` 은 클릭과 같은 이벤트 루프 턴 안(타이머보다 먼저)에서 일어난다 — 팝업 차단 방어.
 *  - 팝업 차단(null)은 사다리 끝까지 침묵하지 않는다: 'failed'/'distance' + fallback 호출(INV-4 · BR-U1-55).
 *  - 이름 없이 좌표만 있는 장소는 웹에서 'failed'(웹엔 좌표 전용 형식이 없고 지어내지 않는다).
 *
 * (개념) `jest.mock('@/shared/external-link', () => requireActual(웹 파일))` = Metro 가 웹 빌드에서 `.web.ts` 를 골라 주는 것을
 *   손으로 흉내 낸다. 실제로 골라지는지는 jest 가 못 본다 → [검증]의 웹 export 소스맵 몫.
 * 3동작 뼈대: 준비(가짜 window·사다리 입력) → 실행(사다리 호출) → 단언(open 인자·반환값·fallback).
 */

import * as Linking from 'expo-linking';

import {
  buildWebNavUrl,
  openNextNav,
  type NavDest,
} from '@/features/execution/model/nextNav';
import {
  openStayOutbound,
  stayOutboundUrl,
} from '@/features/stay-outbound/model/stayOutbound';
import { openNaverPlace } from '@/shared/map/naverPlaceLink';
import {
  installFakeBrowser,
  removeFakeBrowser,
} from '@/test-support/fakeBrowserWindow';

jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
  openSettings: jest.fn(),
}));
jest.mock('@/shared/external-link', () =>
  jest.requireActual('@/shared/external-link/openExternal.web')
);
jest.mock('@/shared/ui/Toast', () => ({ showToast: jest.fn() }));

const mockOpenURL = Linking.openURL as jest.Mock;

afterEach(removeFakeBrowser);
beforeEach(() => {
  jest.clearAllMocks();
});

describe('웹에서 호출부 사다리 (AC2-b · AC1-c · INV-4)', () => {
  const NAVER_WEB = `https://map.naver.com/p/search/${encodeURIComponent('광안리')}`;
  const place = { nameKo: '광안리', lat: 35.153, lng: 129.118 };

  it('openNaverPlace — nmap:// 는 거절돼 건너뛰고 웹 URL 을 새 탭으로 1번 열어 "web" · nmap 으로는 open 0', async () => {
    const browser = installFakeBrowser();

    const result = await openNaverPlace(place);

    expect(result).toBe('web');
    expect(browser.open).toHaveBeenCalledTimes(1);
    expect(browser.open).toHaveBeenCalledWith(NAVER_WEB, '_blank');
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('openNaverPlace — window.open 이 다른 작업(타이머) 보다 먼저 — 클릭과 같은 이벤트 루프 턴 안', async () => {
    const order: string[] = [];
    const browser = installFakeBrowser();
    browser.open.mockImplementation(() => {
      order.push('open');
      return browser.tab;
    });
    setTimeout(() => order.push('timer'), 0);

    await openNaverPlace(place);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(['open', 'timer']);
  });

  it('openNaverPlace — 이름 없이 좌표만이면 웹 URL 이 없어 "failed"(지어내지 않는다) · window.open 0', async () => {
    const browser = installFakeBrowser();

    const result = await openNaverPlace({ lat: 35.1, lng: 129.1 });

    expect(result).toBe('failed');
    expect(browser.open).not.toHaveBeenCalled();
  });

  it('openNaverPlace — 팝업 차단(null)이면 "failed" 로 알린다', async () => {
    installFakeBrowser('blocked');

    await expect(openNaverPlace(place)).resolves.toBe('failed');
  });

  const dest: NavDest = {
    lat: 35.153,
    lng: 129.118,
    nameKo: '광안리',
    distanceRange: '약 1.2km',
    webOrigin: { lat: 35.1, lng: 129.0, nameKo: '출발' },
  };

  it('openNextNav — nmap:// 건너뛰고 웹 길찾기 URL 새 탭 1번, "web" · fallback 미호출', async () => {
    const browser = installFakeBrowser();
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('web');
    expect(browser.open).toHaveBeenCalledTimes(1);
    expect(browser.open).toHaveBeenCalledWith(buildWebNavUrl(dest), '_blank');
    expect(fallback).not.toHaveBeenCalled();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it('openNextNav — 팝업 차단(null)이면 거리 안내로 강등: "distance" + fallback(distanceRange) 1번', async () => {
    installFakeBrowser('blocked');
    const fallback = jest.fn();

    const result = await openNextNav(dest, fallback);

    expect(result).toBe('distance');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith('약 1.2km');
  });

  it('openStayOutbound — 서버 아웃바운드 URL 을 새 탭으로 1번, "web" · fallback 미호출', async () => {
    const browser = installFakeBrowser();
    const fallback = jest.fn();

    const result = await openStayOutbound('s1', fallback);

    expect(result).toBe('web');
    expect(browser.open).toHaveBeenCalledWith(stayOutboundUrl('s1'), '_blank');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('openStayOutbound — 팝업 차단(null)이면 "failed" + fallback 1번(시트 error 얼굴의 신호, BR-U1-55)', async () => {
    installFakeBrowser('blocked');
    const fallback = jest.fn();

    const result = await openStayOutbound('s1', fallback);

    expect(result).toBe('failed');
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
