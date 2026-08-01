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

/**
 * RN↔WebView 메시지 프로토콜(TRIP-199). `postMessage`는 문자열 하나만 보낼 수 있어 종류를
 * 구분할 꼬리표(`type`)가 필요하다 — 이 판별 유니온이 그 꼬리표를 정의한다.
 */
export type KakaoMapMessage =
  | { type: 'PIN_DROP'; lat: number; lng: number }
  | { type: 'GEOCODE_OK'; address: string; buildingName?: string }
  | { type: 'GEOCODE_FAIL' };

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
 *
 * TRIP-199 — `libraries=services`로 역지오코딩 모듈을 함께 싣고, 지도를 길게 누르면 좌표를
 * `PIN_DROP`으로 올린 뒤 `coord2Address`(카카오 API — 인자 순서가 `x`=경도·`y`=위도라
 * 리포의 `{lat,lng}` 순서와 반대다)로 주소를 되물어 `GEOCODE_OK`/`GEOCODE_FAIL`로 알린다.
 * 롱프레스 자체는 카카오 SDK에 내장 이벤트가 없어 `mousedown`+타이머로 흉내 낸다(짧게
 * 떼거나 지도를 끌면 취소) — 이 이벤트 판단은 jest 사정거리 밖이라 6-b 실기로만 확인된다.
 *
 * TRIP-199 5-a(N-1·N-2·W-3) — 찍힌 지점은 `kakao.maps.Marker` 하나로 표시하고(재핀은
 * 위치만 옮긴다), 역지오코딩 요청마다 일련번호(`pinSeq`)를 매겨 **가장 최근 핀의 응답만**
 * 반영한다(늦게 온 이전 핀의 응답은 버린다). 주소 문자열이 빈 값이면(카카오가 지번 주소를
 * 못 준 지점) 성공이 아니라 `GEOCODE_FAIL`로 보낸다 — 빈 주소를 성공으로 처리하면 화면에
 * 내용 없는 회색 박스만 남는다.
 *
 * TRIP-199 5-a 수정 루프(W-6) — 이 대본을 쓰는 지도가 검색 미리보기·좌표 확정 시트에도
 * 있다(둘 다 이 함수 하나를 공유한다, G-5). N-1로 마커가 생기면서 그 지도들에서도 롱프레스가
 * **눈에 보이게** 됐는데, 그 지도가 확정하는 좌표는 마커가 아니라 원래 후보 좌표라 눌러도
 * 저장에는 반영되지 않는다 — 핀을 받을 지도(핀 지정 탭)에만 이 대본을 싣는다. `enablePin`
 * 기본값은 `true`다 — `mapHtml.test.ts`가 여전히 2인자(`buildMapHtml(center, jsKey)`)로만
 * 불러 이 대본이 실려 있기를 요구하므로, 끄는 쪽(`KakaoMapView`가 `onMapMessage` 없이
 * 불릴 때)이 명시적으로 `false`를 넘긴다.
 */
export function buildMapHtml(
  center: MapCenter,
  jsKey: string,
  enablePin: boolean = true
): string {
  const pinScript = enablePin
    ? `
          var geocoder = new kakao.maps.services.Geocoder();
          var pressTimer = null;
          var pinMarker = null;
          var pinSeq = 0;

          function dropPin(latlng) {
            var seq = ++pinSeq;

            if (pinMarker === null) {
              pinMarker = new kakao.maps.Marker({ position: latlng });
              pinMarker.setMap(map);
            } else {
              pinMarker.setPosition(latlng);
            }

            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'PIN_DROP',
              lat: latlng.getLat(),
              lng: latlng.getLng(),
            }));
            geocoder.coord2Address(latlng.getLng(), latlng.getLat(), function (result, status) {
              // 이 핀보다 나중에 찍힌 핀이 있으면 버린다 — 안 그러면 늦게 온 응답이 새
              // 핀의 좌표에 옛 주소·건물명을 붙인다.
              if (seq !== pinSeq) return;

              var addressInfo =
                status === kakao.maps.services.Status.OK && result[0]
                  ? result[0].address
                  : null;
              var addressName = addressInfo ? addressInfo.address_name : '';

              if (addressName) {
                var roadInfo = result[0].road_address;
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'GEOCODE_OK',
                  address: addressName,
                  buildingName: roadInfo ? roadInfo.building_name : undefined,
                }));
              } else {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'GEOCODE_FAIL' }));
              }
            });
          }

          function cancelPress() {
            if (pressTimer !== null) {
              clearTimeout(pressTimer);
              pressTimer = null;
            }
          }

          kakao.maps.event.addListener(map, 'mousedown', function (mouseEvent) {
            cancelPress();
            pressTimer = setTimeout(function () {
              dropPin(mouseEvent.latLng);
            }, 600);
          });
          kakao.maps.event.addListener(map, 'mouseup', cancelPress);
          kakao.maps.event.addListener(map, 'dragstart', cancelPress);
`
    : '';

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
      src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${jsKey}&autoload=false&libraries=services"
      onerror="window.ReactNativeWebView.postMessage('${MAP_LOAD_FAILED_MESSAGE}')"
    ></script>
    <script>
      try {
        kakao.maps.load(function () {
          var map = new kakao.maps.Map(document.getElementById('map'), {
            center: new kakao.maps.LatLng(${center.lat}, ${center.lng}),
            level: 3,
          });
          ${pinScript}
        });
      } catch (e) {
        window.ReactNativeWebView.postMessage('${MAP_LOAD_FAILED_MESSAGE}');
      }
    </script>
  </body>
</html>`;
}
