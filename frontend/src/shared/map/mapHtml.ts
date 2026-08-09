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
 * 번호가 붙은 지도 핀(TRIP-297). `number`는 지도가 정하지 않는다 — 호출부가 만든 값을
 * 그대로 그린다(일정 초안에서는 좌표 없는 슬롯을 건너뛴 뒤에도 카드 번호를 유지해야 해
 * 핀 번호가 ①③④처럼 뛴다).
 */
export interface MapPin {
  number: number;
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
 * TRIP-210 경량 사이클 — `<style>`이 선택·콜아웃을 끄는 이유. WKWebView는 길게 누르기를
 * 기본적으로 **텍스트 선택 제스처**로 해석해, 그것이 지도의 `mousedown`보다 먼저 잡아채면
 * 600ms 타이머가 아예 시작되지 않는다(TRIP-199 6-b 실측 — 지도를 길게 누르면 핀 대신
 * 선택 핸들과 Copy·Translate 메뉴가 떴다). 지도는 문서가 아니라 조작 표면이라 선택 대상이
 * 될 이유가 없고, 억제는 `enablePin`과 무관하게 모든 지도에 건다 — 핀을 안 받는 지도에서도
 * 그 메뉴가 뜨는 것은 마찬가지로 오작동이다.
 *
 * TRIP-210 경량 사이클 — `kakao.maps.load` **콜백 안에도** try/catch가 있는 이유. 바깥
 * try는 `load()` **호출**만 감싸고 콜백은 나중에 비동기로 불리므로, 지도 생성이나 핀 대본이
 * 터져도 바깥 catch에는 **절대 안 온다**. 그러면 실패 사실이 어디로도 안 나가고 화면에는
 * 멀쩡한 지도만 남는다(INV-4·BR-U1-55가 금지한 침묵 실패). TRIP-199 6-b에서 롱프레스가
 * 안 먹었을 때 원인을 좁히지 못한 이유가 정확히 이 구멍이었다 — 실패했다는 사실 자체가
 * 밖으로 나올 통로가 없었다.
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
  enablePin: boolean = true,
  pins: MapPin[] = []
): string {
  // TRIP-297 — 번호 핀은 `CustomOverlay`로 그린다(기본 `Marker`는 숫자를 못 싣는다).
  // 핀이 둘 이상일 때만 `setBounds`로 전부 담는다 — 한 개짜리 bounds는 넓이가 0이라
  // 최대 배율까지 확대되어 지도가 무엇을 보여주는지 알 수 없게 된다.
  const numberedPinScript =
    pins.length === 0
      ? ''
      : `
          var numberedPins = ${JSON.stringify(pins)};
          var pinBounds = new kakao.maps.LatLngBounds();
          numberedPins.forEach(function (pin) {
            var position = new kakao.maps.LatLng(pin.lat, pin.lng);
            pinBounds.extend(position);
            new kakao.maps.CustomOverlay({
              map: map,
              position: position,
              yAnchor: 0.5,
              content:
                '<div style="width:26px;height:26px;border-radius:13px;background:#FF385C;color:#FFFFFF;font:700 13px sans-serif;display:flex;align-items:center;justify-content:center;">' +
                pin.number +
                '</div>',
            });
          });
          if (numberedPins.length > 1) {
            map.setBounds(pinBounds);
          }
`;

  const pinScript = enablePin
    ? `
          var geocoder = new kakao.maps.services.Geocoder();
          var pressTimer = null;
          var pressOrigin = null;
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
            pressOrigin = null;
          }

          // 화면 픽셀 → 지도 좌표. 컨테이너 기준 좌표라야 해서 뷰포트 좌표에서
          // 지도 엘리먼트의 위치를 뺀다.
          function coordsAt(clientX, clientY) {
            var rect = mapEl.getBoundingClientRect();
            return map
              .getProjection()
              .coordsFromContainerPoint(
                new kakao.maps.Point(clientX - rect.left, clientY - rect.top)
              );
          }

          function startPress(clientX, clientY) {
            cancelPress();
            pressOrigin = { x: clientX, y: clientY };
            pressTimer = setTimeout(function () {
              pressTimer = null;
              dropPin(coordsAt(clientX, clientY));
            }, 600);
          }

          // 손가락은 가만히 있어도 미세하게 흔들린다 — 아무 움직임에나 취소하면
          // 실기에서 롱프레스가 거의 성립하지 않는다. 문턱을 둔다.
          function movedFar(clientX, clientY) {
            if (pressOrigin === null) return false;
            return (
              Math.abs(clientX - pressOrigin.x) > 10 ||
              Math.abs(clientY - pressOrigin.y) > 10
            );
          }

          // 카카오의 합성 마우스 이벤트(kakao.maps.event.addListener(map,'mousedown'))는
          // 실기에서 우리 리스너까지 오지 않았다(TRIP-210 6-b 실측 — 예외도 안 났다).
          // 그래서 지도 컨테이너의 DOM 이벤트를 직접 듣는다. capture 단계로 등록해
          // SDK가 중간에서 전파를 멈춰도 우리가 먼저 받는다.
          mapEl.addEventListener('touchstart', function (e) {
            if (e.touches.length !== 1) { cancelPress(); return; }
            startPress(e.touches[0].clientX, e.touches[0].clientY);
          }, true);
          mapEl.addEventListener('touchmove', function (e) {
            if (e.touches.length !== 1 || movedFar(e.touches[0].clientX, e.touches[0].clientY)) cancelPress();
          }, true);
          mapEl.addEventListener('touchend', cancelPress, true);
          mapEl.addEventListener('touchcancel', cancelPress, true);

          // 시뮬레이터·데스크톱 마우스 대비(터치로 변환되지 않는 환경).
          mapEl.addEventListener('mousedown', function (e) {
            startPress(e.clientX, e.clientY);
          }, true);
          mapEl.addEventListener('mousemove', function (e) {
            if (movedFar(e.clientX, e.clientY)) cancelPress();
          }, true);
          mapEl.addEventListener('mouseup', cancelPress, true);
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
      html, body, #map {
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }
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
          try {
            var mapEl = document.getElementById('map');
            var map = new kakao.maps.Map(mapEl, {
              center: new kakao.maps.LatLng(${center.lat}, ${center.lng}),
              level: 3,
            });
            ${numberedPinScript}
            ${pinScript}
          } catch (e) {
            window.ReactNativeWebView.postMessage('${MAP_LOAD_FAILED_MESSAGE}');
          }
        });
      } catch (e) {
        window.ReactNativeWebView.postMessage('${MAP_LOAD_FAILED_MESSAGE}');
      }
    </script>
  </body>
</html>`;
}
