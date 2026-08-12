import type { ComponentType } from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { MAP_LOAD_FAILED_MESSAGE } from './mapHtml';
import { KakaoMapView, type KakaoMapViewProps } from './KakaoMapView';

/**
 * TRIP-301 · shared/map **additive 확장**의 RN 반응 층(AC-3 브리지 · AC-7 콜백).
 * TRIP-199 `KakaoMapView.messages.test.tsx` 와 같은 두께다 — 실제 `KakaoMapView` 를 돌리되
 * WebView 는 통과 목이라, "WebView 가 보냈다고 치는" 메시지에 RN 이 어떻게 반응하는지 본다.
 *
 * 무엇을 보장하나:
 *  - 🔴 핀 탭(`PIN_TAP`)을 `index` 째 위로 올린다(AC-3). 좌표가 유한한 수가 아니면 안 올린다.
 *  - 🔴 로드 실패를 `onLoadFailed` 콜백으로 부모에 알린다(AC-7). 지금은 실패가 내부 state 에
 *    갇혀 부모가 폴백을 그릴 신호를 못 받는다.
 *
 * 무엇을 보장하지 **못**하나: WebView 가 실제로 그 메시지를 보내는지(핀 클릭이 발화하는지)는
 * jest 사정거리 밖이라 6-b 실기 몫이다(02a ★2).
 *
 * *(개념)* **동결 파일을 안 건드린다** — `KakaoMapView.test.tsx`·`.messages.test.tsx` 는 이전
 * 사이클 승인 해시가 박힌 파일이라, 확장은 별도 파일로 뺀다(messages.test 가 test.tsx 를 피해
 * 분리된 것과 같은 형태).
 *
 * *(개념)* **국소 타입 확장** — `onLoadFailed` 는 아직 `KakaoMapViewProps` 에 없다(구현 몫).
 * 프로덕션 타입은 못 고치므로 테스트에서 `as` 로 넓힌다 — 구현 전에도 후에도 컴파일되고,
 * 구현 후 이 별칭이 곧 실제 시그니처가 된다(`mapHtml.script.test` 의 `build6` 선례 · 02a ★8).
 */
jest.mock('react-native-webview');

const MapView = KakaoMapView as ComponentType<
  KakaoMapViewProps & { onLoadFailed?: () => void }
>;

const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
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

/** WebView 가 문자열 하나를 보낸 상황을 만든다(messages.test 선례 — props 직접 호출 + act). */
function sendFromWebView(data: unknown): void {
  const webview = screen.getByTestId('map-webview');
  act(() => {
    webview.props.onMessage({ nativeEvent: { data } });
  });
}

describe('🔴 KE1 · AC-3 브리지 — PIN_TAP 이 index 째 위로 올라간다', () => {
  it('눌린 핀의 index 가 onMapMessage 로 그대로 전달된다', () => {
    const onMapMessage = jest.fn();
    render(<KakaoMapView center={CENTER} onMapMessage={onMapMessage} />);

    // 도달 앵커 — 발화 전에는 아무것도 올라가지 않았다.
    expect(onMapMessage).not.toHaveBeenCalled();

    sendFromWebView(JSON.stringify({ type: 'PIN_TAP', index: 2 }));

    // 정확히 1회, index 까지. 현재 handleWebViewMessage 는 PIN_DROP/GEOCODE_* 만 알아 이게 흘러
    // 떨어진다(RED).
    expect(onMapMessage).toHaveBeenCalledTimes(1);
    expect(onMapMessage).toHaveBeenCalledWith({ type: 'PIN_TAP', index: 2 });
  });
});

describe('🔴 KE2 · AC-3 브리지 — index 가 유한한 수가 아니면 올려보내지 않는다', () => {
  const BAD_PAYLOADS: [string, unknown][] = [
    ['index 가 NaN', { type: 'PIN_TAP', index: NaN }],
    ['index 가 문자열', { type: 'PIN_TAP', index: '1' }],
    ['index 가 Infinity', { type: 'PIN_TAP', index: Infinity }],
    ['index 필드 누락', { type: 'PIN_TAP' }],
    ['index 가 null', { type: 'PIN_TAP', index: null }],
  ];

  it.each(BAD_PAYLOADS)('%s 이면 전달하지 않는다', (_name, payload) => {
    const onMapMessage = jest.fn();
    render(<KakaoMapView center={CENTER} onMapMessage={onMapMessage} />);

    sendFromWebView(JSON.stringify(payload));
    expect(onMapMessage).not.toHaveBeenCalled();

    // 같은 케이스에 통과 앵커 — 정상 index 를 이어 보내 **거르는 것과 아예 안 하는 것**을 가른다.
    // index 0 도 유효한 첫 핀이다(`if (!index)` falsy 검사로 거르면 여기서 걸린다).
    sendFromWebView(JSON.stringify({ type: 'PIN_TAP', index: 0 }));
    expect(onMapMessage).toHaveBeenCalledTimes(1);
    expect(onMapMessage).toHaveBeenCalledWith({ type: 'PIN_TAP', index: 0 });
  });
});

describe('🔴 KE3 · AC-7 콜백 — 로드 실패를 부모에 알린다', () => {
  it('onError 와 SDK 로드 실패 표식이 onLoadFailed 를 부르고, 내부 실패 표면도 무회귀다', () => {
    const onLoadFailed = jest.fn();
    render(<MapView center={CENTER} onLoadFailed={onLoadFailed} />);

    // 건강할 때는 안 불린다(도달 앵커).
    expect(onLoadFailed).not.toHaveBeenCalled();

    // 메인 프레임 로드 오류 → 부모에 알린다.
    act(() => {
      screen.getByTestId('map-webview').props.onError();
    });
    expect(onLoadFailed).toHaveBeenCalled();

    // 무회귀 짝 — SDK 로드 실패 평문 표식은 여전히 내부 map-failure 표면을 띄우고,
    //   부모 통로(onLoadFailed)도 함께 열린다(둘이 배타적이지 않다).
    sendFromWebView(MAP_LOAD_FAILED_MESSAGE);
    expect(screen.getByTestId('map-failure')).toBeOnTheScreen();
    expect(onLoadFailed.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
