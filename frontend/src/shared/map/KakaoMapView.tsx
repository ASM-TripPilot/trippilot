import type { ReactElement } from 'react';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import {
  buildMapHtml,
  MAP_LOAD_FAILED_MESSAGE,
  REGISTERED_DOMAIN,
  type MapCenter,
} from './mapHtml';

/**
 * 카카오 지도 JS SDK를 WebView 위에 올리는 최소 브리지(TRIP-197 D1·D2 — 타일 렌더
 * 증명까지만, e05가 요구할 후보 N핀·coordConfirmed 등은 소비처가 없어 만들지 않는다).
 *
 * env 키가 없거나(undefined·빈 문자열) WebView 로드 콜백(onError·onHttpError)이 발화하면
 * 회색 빈 화면 대신 map-failure로 전이한다(BR-U1-23·INV-4). 정상일 때는 실패 표면이 없다.
 *
 * R1 — iOS WKWebView가 baseUrl을 실제 origin으로 세우는지 실측 근거가 없다. 안 되면
 * source를 {html, baseUrl}에서 Metro 폴백 {uri}로 갈아끼워야 하는데, 그 조립 지점을
 * 이 컴포넌트 하나로 모아 뒀다(도메인 상수 자체는 mapHtml.ts 하나뿐 — D6).
 */
export interface KakaoMapViewProps {
  center: MapCenter;
}

export function KakaoMapView({ center }: KakaoMapViewProps): ReactElement {
  const [loadFailed, setLoadFailed] = useState(false);
  const jsKey = process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY;

  // onError·onHttpError 둘 다 이 페이로드 없이 트리거만 본다 — 실패 사실 자체가 신호다.
  const handleLoadError = (): void => setLoadFailed(true);

  // onError·onHttpError는 메인 프레임(= HTML 문자열 자체)의 로드에만 반응한다 — source가
  // {html, baseUrl}이라 메인 프레임은 네트워크를 안 타 항상 성공하고, mapHtml.ts 안
  // <script src="...">가 401로 실패하는 서브리소스 실패는 이 두 콜백을 부르지 않는다(W4).
  // 그 실패를 postMessage로 받아 같은 실패 표면으로 잇는다.
  const handleWebViewMessage = (event: WebViewMessageEvent): void => {
    if (event.nativeEvent.data === MAP_LOAD_FAILED_MESSAGE) {
      setLoadFailed(true);
    }
  };

  return (
    <View testID="map-root" className="flex-1">
      {!jsKey || loadFailed ? (
        <View
          testID="map-failure"
          className="flex-1 items-center justify-center bg-canvas px-2xl"
        >
          <Text
            testID="map-failure-message"
            className="font-noto text-body text-muted text-center"
          >
            지도를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
          </Text>
        </View>
      ) : (
        <WebView
          testID="map-webview"
          style={{ flex: 1 }}
          source={{
            html: buildMapHtml(center, jsKey),
            baseUrl: REGISTERED_DOMAIN,
          }}
          onError={handleLoadError}
          onHttpError={handleLoadError}
          onMessage={handleWebViewMessage}
        />
      )}
    </View>
  );
}
