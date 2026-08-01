import { act, render, screen } from '@testing-library/react-native';

import type { KakaoMapMessage } from './mapHtml';
import { MAP_LOAD_FAILED_MESSAGE } from './mapHtml';
import { KakaoMapView } from './KakaoMapView';

/**
 * W-1~W-5 (AC-3 · AC-4 · AC-5 · TRIP-197 이월 N5 · 02a §4-B) — RN 쪽 onMessage 반응 층.
 *
 * 무엇을 보장하나: WebView가 **보냈다고 치는** 메시지에 RN이 어떻게 반응하는가 —
 * 좌표를 실은 `PIN_DROP`을 위로 올리고, 좌표가 유한한 수가 아니면 올리지 않으며,
 * 쓰레기 입력에 죽지 않는다.
 *
 * 무엇을 보장하지 **못**하나: WebView가 실제로 그 메시지를 보내는지는 안 본다. 그건
 * 층 ⑴(`mapHtml.test.ts`, 대본이 옳은가)과 6-b 실기 스모크(대본이 실제로 연기되는가)로
 * 나뉜다(02a §2).
 *
 * 동결 `KakaoMapView.test.tsx`(A-2·A-6~A-9)를 건드리지 않으려고 별도 파일로 뺐다 —
 * 리포 선례 `StaySearchScreen.states.test.tsx` / `.registerEntry.test.tsx` 분할과 같은 형태.
 *
 * env 규율(`KakaoMapView.test.tsx:36-49` 선례): 키가 없으면 WebView 자체가 렌더되지 않아
 * 관찰할 onMessage가 없다. 각 테스트가 키를 세우고 afterEach에서 되돌린다.
 */

jest.mock('react-native-webview');

const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
// computed 접근이 선언과 한 문장이면 eslint-plugin-expo의 no-dynamic-env-var에 걸린다 —
// 선언과 대입을 분리한다(KakaoMapView.test.tsx:38-40 선례).
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

beforeEach(() => {
  process.env[ENV_KEY] = 'test-js-key';
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

const CENTER = { lat: 37.5665, lng: 126.978 };

/**
 * WebView가 문자열 하나를 보낸 상황을 만든다. fireEvent가 아니라 props 직접 호출 + act를
 * 정본으로 쓴다 — 'message' → onMessage 이름 변환이 검증되지 않았다(KakaoMapView.test.tsx의
 * 같은 판단, 02a M6 실측).
 */
function sendFromWebView(data: unknown): void {
  const webview = screen.getByTestId('map-webview');
  act(() => {
    webview.props.onMessage({ nativeEvent: { data } });
  });
}

describe('W-1 · PIN_DROP이 좌표째 위로 올라간다 (AC-3)', () => {
  it('찍힌 좌표가 onMapMessage로 그대로 전달된다', () => {
    const onMapMessage = jest.fn();
    render(<KakaoMapView center={CENTER} onMapMessage={onMapMessage} />);

    // 도달 앵커 — 발화 전에는 아무것도 올라가지 않았다.
    expect(onMapMessage).not.toHaveBeenCalled();

    sendFromWebView(
      JSON.stringify({ type: 'PIN_DROP', lat: 35.1587, lng: 129.1604 })
    );

    // 본체 — 정확히 1회, 좌표까지. 횟수를 보면 중복 전달도 잡힌다.
    expect(onMapMessage).toHaveBeenCalledTimes(1);
    expect(onMapMessage).toHaveBeenCalledWith({
      type: 'PIN_DROP',
      lat: 35.1587,
      lng: 129.1604,
    });
  });
});

describe('W-2 · 역지오코딩 결과도 그대로 올라간다 (AC-4 · AC-5)', () => {
  it('GEOCODE_OK는 주소·건물명을 보존하고, GEOCODE_FAIL도 전달된다', () => {
    const onMapMessage = jest.fn();
    render(<KakaoMapView center={CENTER} onMapMessage={onMapMessage} />);

    sendFromWebView(
      JSON.stringify({
        type: 'GEOCODE_OK',
        address: '부산 해운대구 우동 1407',
        buildingName: '해운대 그랜드 호텔',
      })
    );
    expect(onMapMessage).toHaveBeenCalledWith({
      type: 'GEOCODE_OK',
      address: '부산 해운대구 우동 1407',
      buildingName: '해운대 그랜드 호텔',
    });

    // 실패도 조용히 삼키지 않는다 — 화면이 실패 사실을 말하려면 이게 올라와야 한다(INV-4).
    sendFromWebView(JSON.stringify({ type: 'GEOCODE_FAIL' }));
    expect(onMapMessage).toHaveBeenLastCalledWith({ type: 'GEOCODE_FAIL' });
    expect(onMapMessage).toHaveBeenCalledTimes(2);
  });
});

describe('W-3 · ★ 좌표가 유한한 수가 아니면 올려보내지 않는다 (TRIP-197 이월 N5)', () => {
  /**
   * TRIP-197이 "e05 진입 전 재검토"로 미뤄 둔 값 검증이다. 핀은 사용자가 찍는 임의 좌표라
   * 여기서 처음 실질을 갖는다. 심판을 **파싱 경계에 둔다** — 핀 좌표가 앱으로 들어오는
   * 경로는 이제 이 JSON 문자열 하나뿐이라, 여기서 거르면 지도 center로 흘러갈 비정상 값이
   * 원천 차단된다(02a ★14).
   */
  const BAD_PAYLOADS: [string, unknown][] = [
    ['lat이 NaN', { type: 'PIN_DROP', lat: NaN, lng: 129.16 }],
    ['lng이 문자열', { type: 'PIN_DROP', lat: 35.15, lng: '129.16' }],
    ['lat이 Infinity', { type: 'PIN_DROP', lat: Infinity, lng: 129.16 }],
    ['lng 필드 누락', { type: 'PIN_DROP', lat: 35.15 }],
    ['둘 다 null', { type: 'PIN_DROP', lat: null, lng: null }],
  ];

  it.each(BAD_PAYLOADS)('%s이면 전달하지 않는다', (_name, payload) => {
    const onMapMessage = jest.fn();
    render(<KakaoMapView center={CENTER} onMapMessage={onMapMessage} />);

    // JSON.stringify는 NaN·Infinity를 null로 바꾼다 — 그래도 "숫자가 아니다"는 같으므로
    // 실기에서 도달 가능한 형태 그대로 보낸다.
    sendFromWebView(JSON.stringify(payload));

    expect(onMapMessage).not.toHaveBeenCalled();

    // 같은 케이스 안에 통과 앵커를 둔다 — 부정 단언만 있으면 "아무것도 전달하지 않는"
    // 구현(=지금 상태)이 그대로 통과해 케이스가 공허해진다. 뒤이어 정상 좌표를 보내
    // **거르는 것과 아예 안 하는 것**을 구분한다.
    sendFromWebView(
      JSON.stringify({ type: 'PIN_DROP', lat: 35.15, lng: 129.16 })
    );
    expect(onMapMessage).toHaveBeenCalledTimes(1);
  });

  it('짝: 같은 자리에 정상 좌표가 오면 전달된다 (항상 무시하는 구현 방지)', () => {
    const onMapMessage = jest.fn();
    render(<KakaoMapView center={CENTER} onMapMessage={onMapMessage} />);

    sendFromWebView(JSON.stringify({ type: 'PIN_DROP', lat: 0, lng: 0 }));

    // 0은 유효한 좌표다 — falsy 검사(`if (!lat)`)로 거르면 여기서 걸린다.
    expect(onMapMessage).toHaveBeenCalledTimes(1);
    expect(onMapMessage).toHaveBeenCalledWith({
      type: 'PIN_DROP',
      lat: 0,
      lng: 0,
    });
  });
});

describe('W-4 · 쓰레기 입력에 죽지 않는다 (WebView는 아무 문자열이나 보낼 수 있다)', () => {
  it('JSON이 아니거나 모르는 type이면 조용히 무시하고, 기존 로드 실패 표식은 그대로 동작한다', () => {
    const onMapMessage = jest.fn();
    render(<KakaoMapView center={CENTER} onMapMessage={onMapMessage} />);

    // JSON이 아닌 문자열 — JSON.parse가 던지는 자리다. 크래시하면 지도가 통째로 죽는다.
    expect(() => sendFromWebView('not json at all {{{')).not.toThrow();
    // 모르는 type — 나중에 프로토콜이 늘어도 옛 앱이 죽지 않는다.
    expect(() =>
      sendFromWebView(JSON.stringify({ type: 'SOMETHING_NEW' }))
    ).not.toThrow();
    expect(() => sendFromWebView(JSON.stringify(null))).not.toThrow();
    expect(onMapMessage).not.toHaveBeenCalled();

    // 무회귀 — TRIP-197이 세운 평문 표식은 여전히 실패 표면으로 간다.
    expect(screen.queryByTestId('map-failure')).toBeNull();
    sendFromWebView(MAP_LOAD_FAILED_MESSAGE);
    expect(screen.getByTestId('map-failure')).toBeOnTheScreen();
    // 그것은 onMapMessage로 새어 나가는 사건이 아니다(실패 표면이 이미 처리했다).
    expect(onMapMessage).not.toHaveBeenCalled();
  });
});

describe('W-5 · 콜백을 안 넘겨도 죽지 않는다 (미리보기 지도는 배선하지 않는다)', () => {
  it('onMapMessage 없이 렌더한 지도에 PIN_DROP이 와도 예외가 나지 않는다', () => {
    render(<KakaoMapView center={CENTER} />);

    const message: KakaoMapMessage = {
      type: 'PIN_DROP',
      lat: 35.15,
      lng: 129.16,
    };
    expect(() => sendFromWebView(JSON.stringify(message))).not.toThrow();

    // 지도는 멀쩡히 살아 있다 — 조용한 무시이지 고장이 아니다.
    expect(screen.getByTestId('map-webview')).toBeOnTheScreen();
    expect(screen.queryByTestId('map-failure')).toBeNull();
  });
});
