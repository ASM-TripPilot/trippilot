/**
 * @jest-environment node
 */

/**
 * TRIP-1684 · AC1·AC2-a·AC3·AC5 — 웹 외부 열기 헬퍼(`openExternal.web.ts`). 호출부 사다리를 얹은 AC2-b 는 `src/__tests__/webExternalOpenLadder.test.ts`.
 *
 * 무엇을 보장하나 (웹 QA 2026-10-31 A-03·A-04·C-02·D-02·A-09 가 깨졌던 두 원인의 반대편):
 *  - http(s) 는 **새 탭**(`window.open(url, '_blank')`, 첫 `await` 전) 으로 열고 현재 탭 주소는 안 건드린다. 차단돼 `null` 이면
 *    **거절**한다(INV-4 · BR-U1-55 — 조용히 성공한 척 하지 않는다). 성공하면 새 탭의 `opener` 를 끊는다.
 *  - `tel:` 은 새 탭 대신 현재 탭 주소(`location.href`) 이동. 그 밖 스킴(`nmap:`·`javascript:` …)은 **window 를 한 번도 안 건드리고** 거절 —
 *    그 거절이 호출부 사다리를 "앱 스킴 시도 → 웹 URL" 로 내려보낸다.
 *  - `openAppSettings()` 는 웹에 설정 앱이 없으니 토스트로 안내하고 **resolve** 한다(`void` 호출부에 거절이 새지 않게). 설정 열기 호출 0.
 *
 * 커버하지 않는 것: Metro 가 웹 빌드에서 `.web.ts` 를 **실제로 고르는지**, 사파리 팝업 정책, 토스트가 화면에 그려지는지는 jest 가
 *  원리적으로 못 본다 → [검증]의 웹 export 소스맵 + 사람 Aside 확인 몫(02 참조).
 *
 * (개념) jest-expo 는 iOS 기준이라 `.web.ts` 를 자동으로 고르지 않는다 → 이 파일이 `./openExternal.web` 를 이름으로 직접 불러온다
 *   (`secureKv.web.test.ts` 선례).
 * (개념) `window` 가짜 = node 환경엔 `window` 가 없어 `globalThis.window` 에 읽기 횟수를 세는 대역을 끼웠다 뺀다.
 * 3동작 뼈대: 준비(가짜 window·토스트) → 실행(헬퍼 호출) → 단언(open 인자·href 쓰기·window 읽기 수·반환값).
 */

import * as Linking from 'expo-linking';

import { showToast } from '@/shared/ui/Toast';
import {
  installFakeBrowser,
  removeFakeBrowser,
} from '@/test-support/fakeBrowserWindow';

import { openAppSettings, openExternal } from './openExternal.web';
import * as webModule from './openExternal.web';

// 웹 경로가 expo-linking 에 닿으면(같은 탭 이동·UnavailabilityError 의 원인) 아래 단언이 잡는다.
jest.mock('expo-linking', () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
  openSettings: jest.fn(),
}));
jest.mock('@/shared/ui/Toast', () => ({ showToast: jest.fn() }));

// AC5 — 앱 파일과 export 이름·시그니처가 같다(tsc 가 `.web.ts` 를 import 그래프에 안 올려 이름이 어긋나도 못 잡는 틈을 메운다).
void (webModule satisfies typeof import('./openExternal'));

const mockOpenURL = Linking.openURL as jest.Mock;
const mockOpenSettings = Linking.openSettings as jest.Mock;
const mockShowToast = showToast as jest.Mock;

// 파일 최상위 — describe 안에 두면 앞 케이스의 가짜 window 가 새어 "접근 0" 케이스가 거짓 green 이 된다.
afterEach(removeFakeBrowser);
beforeEach(() => {
  jest.clearAllMocks();
});

describe('openExternal (웹) — http(s) 는 새 탭', () => {
  it.each(['https://map.naver.com/p/search/abc', 'http://localhost:8080/x'])(
    '%s → window.open(url, "_blank") 1번 · 현재 탭 주소 불변 · expo-linking 안 씀 · opener 끊김',
    async (url) => {
      const browser = installFakeBrowser();

      await openExternal(url);

      expect(browser.open).toHaveBeenCalledTimes(1);
      expect(browser.open).toHaveBeenCalledWith(url, '_blank');
      expect(browser.hrefWrites).toEqual([]);
      expect(mockOpenURL).not.toHaveBeenCalled();
      expect(browser.tab.opener).toBeNull();
    }
  );

  it('window.open 은 첫 await 전에(동기로) 부른다 — 팝업 차단 방어', async () => {
    const browser = installFakeBrowser();

    const pending = openExternal('https://example.com/a');

    expect(browser.open).toHaveBeenCalledTimes(1);
    await pending;
  });

  it('팝업이 차단돼 window.open 이 null 이면 거절한다(성공한 척 하지 않는다) · 주소 이동으로 대체하지 않는다', async () => {
    const browser = installFakeBrowser('blocked');

    await expect(openExternal('https://example.com/a')).rejects.toBeInstanceOf(
      Error
    );

    expect(browser.open).toHaveBeenCalledTimes(1);
    expect(browser.hrefWrites).toEqual([]);
  });
});

describe('openExternal (웹) — tel: 과 허용 안 되는 스킴', () => {
  it('tel: 은 새 탭 없이 현재 탭 주소(location.href)로 연다', async () => {
    const browser = installFakeBrowser();

    await openExternal('tel:+821012345678');

    expect(browser.hrefWrites).toEqual(['tel:+821012345678']);
    expect(browser.open).not.toHaveBeenCalled();
  });

  it.each([
    [
      'nmap 장소',
      'nmap://place?lat=35.1&lng=129.1&name=x&appname=com.trippilot.travel',
    ],
    ['nmap 길찾기', 'nmap://route/public?dlat=35.1&dlng=129.1&dname=x'],
    ['javascript', 'javascript:alert(1)'],
    ['javascript 대소문자', 'JaVaScRiPt:alert(1)'],
    ['javascript 앞 공백', ' javascript:alert(1)'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['file', 'file:///etc/passwd'],
    ['ftp', 'ftp://example.com/a'],
    ['http 로 시작하는 다른 스킴', 'httpfoo://example.com'],
    ['tel 로 시작하는 다른 스킴', 'telnet://example.com'],
    ['스킴 없음(상대 경로)', '/stays/1/outbound'],
    ['빈 문자열', ''],
  ])(
    '%s → window 를 한 번도 안 건드리고 거절한다 (동기 throw 아님)',
    async (_label, url) => {
      const browser = installFakeBrowser();

      const result = openExternal(url);

      await expect(result).rejects.toBeInstanceOf(Error);
      expect(browser.windowReads()).toBe(0);
      expect(browser.open).not.toHaveBeenCalled();
      expect(browser.hrefWrites).toEqual([]);
      expect(mockOpenURL).not.toHaveBeenCalled();
    }
  );
});

describe('openAppSettings (웹)', () => {
  it('거절·throw 없이 resolve · 안내 토스트 정확히 1번(문구·톤·testID) · 설정 열기 호출 0', async () => {
    installFakeBrowser();

    await expect(openAppSettings()).resolves.toBeUndefined();

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: '브라우저 설정에서 권한을 바꿔 주세요',
      tone: 'error',
      testID: 'external-link-settings-notice',
    });
    expect(mockOpenSettings).not.toHaveBeenCalled();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});
