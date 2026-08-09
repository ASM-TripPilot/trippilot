import type { ReactElement } from 'react';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import {
  buildMapHtml,
  MAP_LOAD_FAILED_MESSAGE,
  REGISTERED_DOMAIN,
  type KakaoMapMessage,
  type MapCenter,
  type MapPin,
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
 *
 * TRIP-199 5-a(B-1) — `source.html`은 마운트 시점의 `center`로 한 번만 조립되고 이후
 * `center`가 바뀌어도 다시 조립되지 않는다. WebView는 `source`가 바뀌면 문서를 통째로
 * 다시 로드하므로, 안 그러면 핀을 찍는 순간 진행 중이던 역지오코딩 콜백이 매번 죽는다.
 * 좌표를 바꿔 다시 그려야 하는 호출부는 이 컴포넌트에 `key`를 줘 remount시킨다.
 */
export interface KakaoMapViewProps {
  center: MapCenter;
  /** 핀 좌표·역지오코딩 결과 통로(TRIP-199). 옵셔널이라 기존 호출부(지도 시트·검색 미리보기)는
   * 안 넘겨도 그대로 동작한다 — 그 화면들은 아직 핀 메시지를 들을 이유가 없다. */
  onMapMessage?: (message: KakaoMapMessage) => void;
  /** 번호 핀(TRIP-297). 옵셔널이라 기존 호출부 3곳은 안 넘겨도 그대로 동작한다. `center`와
   * 같은 계약 아래 있다 — 마운트 시점 값으로 한 번 조립되고 이후 갱신되지 않으므로, 다른
   * 핀 묶음을 그려야 하는 호출부는 `key`로 remount한다. */
  pins?: MapPin[];
}

/** `unknown`이 유한한 수인가 — WebView가 보낸 값은 뭐든 올 수 있어 여기가 신뢰 경계다
 * (TRIP-197 이월 N5). `Number.isFinite`는 숫자가 아닌 타입에 자동으로 false를 돌려주므로
 * 별도 typeof 분기 없이 NaN·Infinity·문자열·null·undefined를 한 번에 거른다. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function KakaoMapView({
  center,
  onMapMessage,
  pins,
}: KakaoMapViewProps): ReactElement {
  const [loadFailed, setLoadFailed] = useState(false);
  const jsKey = process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY;

  // TRIP-199 5-a(B-1) — center가 이후 바뀌어도 문서를 다시 만들지 않는다. useState의
  // 초기값 함수는 최초 렌더에서 한 번만 실행되므로, 이 문자열은 마운트 이후 절대 안
  // 바뀐다(마운트 시점 값으로 고정). WebView는 source.html이 바뀌면 문서를 통째로
  // 다시 로드해 진행 중이던 좌표→주소 조회 콜백을 죽인다 — 그래서 아예 안 바뀌게 막는다.
  // 새 위치로 다시 그려야 하는 호출부(검색 미리보기·좌표 확정 시트)는 key로 이 컴포넌트
  // 자체를 remount해 새 문서를 받는다.
  //
  // TRIP-199 5-a 수정 루프(W-6) — 롱프레스·마커·역지오코딩 대본은 메시지를 들을 사람이
  // 있을 때만 싣는다. `onMapMessage`를 안 넘긴 호출부(검색 미리보기·좌표 확정 시트)는
  // 그 좌표를 확정에 쓰지 않으므로, 지도에서 롱프레스해도 마커만 찍히고 아무 데도 반영되지
  // 않는 상태가 됐었다 — 대본 자체를 안 실어 그 오해를 없앤다.
  const [html] = useState(() =>
    buildMapHtml(center, jsKey ?? '', onMapMessage !== undefined, pins)
  );

  // onError·onHttpError 둘 다 이 페이로드 없이 트리거만 본다 — 실패 사실 자체가 신호다.
  const handleLoadError = (): void => setLoadFailed(true);

  // onError·onHttpError는 메인 프레임(= HTML 문자열 자체)의 로드에만 반응한다 — source가
  // {html, baseUrl}이라 메인 프레임은 네트워크를 안 타 항상 성공하고, mapHtml.ts 안
  // <script src="...">가 401로 실패하는 서브리소스 실패는 이 두 콜백을 부르지 않는다(W4).
  // 그 실패를 postMessage로 받아 같은 실패 표면으로 잇는다.
  //
  // TRIP-199 — WebView는 그 실패 표식(평문 문자열) 외에 좌표·역지오코딩 결과를 JSON
  // 문자열로도 보낸다. WebView는 아무 문자열이나 보낼 수 있으므로(JSON.parse가 던질 수
  // 있고, 모르는 type이 올 수 있다) 여기서 조용히 무시한다 — 크래시가 지도를 통째로
  // 죽이는 것이 침묵 무시보다 더 나쁘다.
  const handleWebViewMessage = (event: WebViewMessageEvent): void => {
    const data = event.nativeEvent.data;
    if (data === MAP_LOAD_FAILED_MESSAGE) {
      setLoadFailed(true);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const message = parsed as Record<string, unknown>;

    if (
      message.type === 'PIN_DROP' &&
      isFiniteNumber(message.lat) &&
      isFiniteNumber(message.lng)
    ) {
      onMapMessage?.({ type: 'PIN_DROP', lat: message.lat, lng: message.lng });
      return;
    }
    if (message.type === 'GEOCODE_OK' && typeof message.address === 'string') {
      onMapMessage?.({
        type: 'GEOCODE_OK',
        address: message.address,
        ...(typeof message.buildingName === 'string'
          ? { buildingName: message.buildingName }
          : {}),
      });
      return;
    }
    if (message.type === 'GEOCODE_FAIL') {
      onMapMessage?.({ type: 'GEOCODE_FAIL' });
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
            html,
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
