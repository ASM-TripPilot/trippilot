/**
 * 카카오 지도 JS SDK 브리지 — HTML 조립 + 도메인 단일 출처(TRIP-197 D5·D6·A-9).
 *
 * 도메인 문자열은 이 파일 안 REGISTERED_DOMAIN 상수 한 곳에만 리터럴로 존재한다.
 * `KakaoMapView`의 WebView `baseUrl`과 아래 HTML의 `<base>` 태그가 이 상수 하나를
 * 참조한다 — 두 곳에 각자 적으면 카카오 콘솔 등록값과 갈라져도 사람이 못 본다.
 * R1 폴백(Metro 개발서버로 서빙 + `source={{ uri }}`)으로 갈아탈 때도 이 상수만 바꾸면 된다.
 */

export interface MapCenter {
  lat: number;
  lng: number;
}

export const REGISTERED_DOMAIN = 'https://localhost';

/**
 * WebView 안 페이지가 SDK 로드 실패를 밖으로 알릴 때 붙이는 표식(W4). `source={{html}}`이라
 * 메인 프레임 로드는 항상 성공하므로 RN의 `onError`/`onHttpError`는 절대 안 불린다 — 여기서
 * `window.ReactNativeWebView.postMessage(...)`로 보낸 문자열을 `KakaoMapView`의 `onMessage`가
 * 받아 같은 실패 표면으로 잇는다. 값 자체는 임의 문자열이라 두 파일이 상수 하나를 같이
 * 참조하기만 하면 되고(D6과 달리 콘솔 등록과 무관해 단일 출처 가드(A-9) 대상은 아니다).
 */
export const MAP_LOAD_FAILED_MESSAGE = 'kakao-sdk-load-failed';

/**
 * `<base href>`가 REGISTERED_DOMAIN을 다시 선언하는 이유 — WebView의 `baseUrl` prop이
 * iOS WKWebView에서 실제로 origin을 세우는지 실측 근거가 없어(R1), 문서 자체에도 같은
 * 도메인을 명시해 origin 판단을 이중으로 뒷받침한다.
 */
export function buildMapHtml(center: MapCenter, jsKey: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    />
    <base href="${REGISTERED_DOMAIN}/" />
    <style>
      html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script
      src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false"
      onerror="window.ReactNativeWebView.postMessage('${MAP_LOAD_FAILED_MESSAGE}')"
    ></script>
    <script>
      try {
        kakao.maps.load(function () {
          new kakao.maps.Map(document.getElementById('map'), {
            center: new kakao.maps.LatLng(${center.lat}, ${center.lng}),
            level: 3,
          });
        });
      } catch (e) {
        window.ReactNativeWebView.postMessage('${MAP_LOAD_FAILED_MESSAGE}');
      }
    </script>
  </body>
</html>`;
}
