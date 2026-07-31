import { act, render, screen } from '@testing-library/react-native';

import { REGISTERED_DOMAIN } from '@/shared/map';

import { KakaoMapView } from './KakaoMapView';

/**
 * KakaoMapView — 렌더 층 (A-2 렌더 절반 · A-6~A-9 렌더 절반, 01b Seed).
 *
 * 무엇을 보장하나: env 키가 있으면 카카오 지도 JS SDK를 담은 HTML을 WebView에 넘기고
 * (center가 바뀌면 그 HTML도 달라진다), 키가 없거나(빈 문자열/undefined) WebView 로드
 * 콜백(onError/onHttpError)이 발화하면 회색 빈 화면 대신 명시적 실패 표면(map-failure)을
 * 렌더한다(BR-U1-23 · INV-4). 해피패스에서는 실패 표면이 렌더되지 않는다(A-8 반대 앵커).
 *
 * 이 스위트가 보장하지 **못**하는 것 — 목은 우리가 쓴 가짜다. 실제 WKWebView가 도메인
 * 미등록 401에서 onError를 부르는지, onHttpError를 부르는지, 아무 콜백도 안 부르는지는
 * 실측 근거가 없다(R1). 즉 아래 A-7이 green이어도 "401이 화면에 보인다"는 증명되지 않는다
 * — 그 증명은 층 C의 실기 스크린샷 몫이다.
 *
 * `react-native-webview`는 네이티브 모듈이라 수동 목(`__mocks__/react-native-webview.tsx`)이
 * props를 그대로 넘기는 통과 컴포넌트로 대체한다. 아래 jest.mock 호출은 목이 자동 적용되어
 * 없어도 동작하지만, 이 파일이 WebView를 가짜로 쓴다는 것을 읽는 사람에게 알리려고 리포
 * 관례대로 명시한다.
 *
 * env 규율(oauthConfig.test.ts 선례) — 대상 키의 원본을 저장해두고 afterEach에서 되돌린다.
 * `.env.local`이 셸 env를 덮는 함정은 jest 프로세스에는 미적용이라(oauthConfig.test.ts
 * 실측) 여기서 방어하지 않는다 — 층 C(R2)만의 관심사다.
 *
 * 도메인·좌표 값은 테스트에 못박지 않는다. 도메인은 `@/shared/map`의 단일 출처 상수를
 * import해 비교해 R1 폴백이 와도 이 값 자체는 바뀌지 않고, 좌표는 "다른 입력 → 다른 html"
 * 형태로만 확인해 직렬화 형식(String/toFixed/JSON) 선택을 구현 자유로 남긴다.
 */

jest.mock('react-native-webview');

const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
// `const ORIGINAL_ENV = process.env[ENV_KEY];` 형태(computed 접근이 선언과 한 문장)는
// eslint-plugin-expo의 no-dynamic-env-var에 걸린다 — 선언과 대입을 분리한다.
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

const CENTER_A = { lat: 37.5665, lng: 126.978 };
const CENTER_B = { lat: 35.1796, lng: 129.0756 };

describe('해피패스 — 키가 있으면 지도 HTML을 WebView에 넘긴다 (A-2 렌더 절반 · A-9 렌더 절반)', () => {
  it('map-root·map-webview가 렌더되고, HTML에 SDK 스크립트·env 키가 도달하며, baseUrl·SDK script가 같은 도메인 상수를 쓴다', () => {
    process.env[ENV_KEY] = 'test-js-key';

    render(<KakaoMapView center={CENTER_A} />);
    const webview = screen.getByTestId('map-webview');

    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(webview).toBeOnTheScreen();

    // ★★ 생 객체를 넘기지 않는다 — toHaveProp은 this.equals로 깊은 완전일치를 한다
    // (02a M3 실측). 생 객체를 넘기면 HTML 문자열 전문이 승인 테스트에 굳는다.
    expect(webview).toHaveProp(
      'source',
      expect.objectContaining({
        html: expect.stringContaining('dapi.kakao.com/v2/maps/sdk.js'),
      })
    );
    // env에서 읽은 키가 실제로 HTML에 도달한다 — 소스 스캔(1-2)은 "참조한다"까지만 본다.
    expect(webview).toHaveProp(
      'source',
      expect.objectContaining({
        html: expect.stringContaining('test-js-key'),
      })
    );
    // baseUrl이 단일 출처 상수다.
    expect(webview).toHaveProp(
      'source',
      expect.objectContaining({ baseUrl: REGISTERED_DOMAIN })
    );
    // HTML 안 SDK 스크립트가 같은 하나를 쓴다.
    expect(webview).toHaveProp(
      'source',
      expect.objectContaining({
        html: expect.stringContaining(REGISTERED_DOMAIN),
      })
    );
    // 해피패스에 실패 표면이 없다(부재는 queryBy로 — getAllBy는 무매칭 시 throw한다).
    expect(screen.queryByTestId('map-failure')).toBeNull();
  });
});

describe('center 반영 (렌더 층)', () => {
  it('center가 바뀌면 WebView에 넘기는 HTML도 달라진다', () => {
    process.env[ENV_KEY] = 'test-js-key';

    const first = render(<KakaoMapView center={CENTER_A} />);
    const htmlA = screen.getByTestId('map-webview').props.source.html as string;
    first.unmount();

    render(<KakaoMapView center={CENTER_B} />);
    const htmlB = screen.getByTestId('map-webview').props.source.html as string;

    // 도달 앵커 — 진짜 HTML을 읽었다.
    expect(htmlA).toContain('sdk.js');
    // 본체 — 좌표를 문자열로 어떻게 쓸지는 구현 자유다. "다른 입력 → 다른 출력"만 본다.
    expect(htmlA).not.toBe(htmlB);
  });
});

describe('A-6 — 키가 없으면 회색 화면이 아니라 명시적 실패 표면', () => {
  it.each([undefined, ''])(
    '키가 %p이면 map-failure가 렌더되고 map-webview는 렌더되지 않는다',
    (value) => {
      if (value === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = value;
      }

      render(<KakaoMapView center={CENTER_A} />);

      expect(screen.getByTestId('map-root')).toBeOnTheScreen();
      expect(screen.getByTestId('map-failure')).toBeOnTheScreen();
      expect(screen.queryByTestId('map-webview')).toBeNull();
      // 문구는 잠그지 않는다 — toHaveTextContent('문자열')은 완전일치라(02a M4 실측),
      // 카피가 한 글자만 바뀌어도 red가 된다. "비어 있지 않다"만 본다.
      expect(screen.getByTestId('map-failure-message')).toHaveTextContent(/\S/);
    }
  );
});

describe('A-7 — WebView 로드 실패 콜백이 같은 실패 표면으로 간다', () => {
  it.each(['onError', 'onHttpError'] as const)(
    '%s가 발화하면 map-failure가 렌더되고 map-webview는 사라진다',
    (handlerName) => {
      process.env[ENV_KEY] = 'test-js-key';

      render(<KakaoMapView center={CENTER_A} />);
      const webview = screen.getByTestId('map-webview');

      // 도달 앵커 — 발화 전에는 실패 표면이 없었다(전이가 실제로 일어났음을 증명).
      expect(screen.queryByTestId('map-failure')).toBeNull();

      // fireEvent가 아니라 props 직접 호출 + act를 정본으로 쓴다 — 'httpError' → onHttpError
      // 이름 변환은 검증되지 않았다(02a M6 실측: 'error' → onError만 실행 검증됨).
      act(() => {
        webview.props[handlerName]({
          nativeEvent: {
            description: 'net::ERR_NAME_NOT_RESOLVED',
            statusCode: 401,
          },
        });
      });

      expect(screen.getByTestId('map-failure')).toBeOnTheScreen();
      expect(screen.queryByTestId('map-webview')).toBeNull();
    }
  );
});

describe('A-8 — 반대 방향 앵커: 해피패스에서 실패 표면이 렌더되지 않는다', () => {
  it('키가 있고 어떤 콜백도 발화하지 않으면 map-failure·map-failure-message가 없다', () => {
    process.env[ENV_KEY] = 'test-js-key';

    render(<KakaoMapView center={CENTER_A} />);

    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.getByTestId('map-webview')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-failure')).toBeNull();
    expect(screen.queryByTestId('map-failure-message')).toBeNull();
  });
});
