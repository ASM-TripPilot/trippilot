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
  | { type: 'GEOCODE_FAIL' }
  // TRIP-301 — 번호 핀을 탭하면 그 핀의 배열 위치(0-기반)를 올려보낸다. 호출부는 그 index로
  // 슬롯을 역참조해 상세 시트를 연다(라우트 이동 아님). 좌표 결번이 있어도 index는 pins 배열
  // 기준이라 엉뚱한 슬롯을 열지 않는다.
  | { type: 'PIN_TAP'; index: number };

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
 *
 * TRIP-339 — `viewOnly`는 **보여주기 전용 지도**를 켜는 옵트인 인자다(기본 `false` = 현행).
 * 막는 것은 사용자 제스처(드래그·핀치줌·더블탭줌)뿐이고 프로그램 카메라 이동(`setBounds`)은
 * 그대로 통과한다 — 완전히 얼리면 핀 묶음이 화면에 안 맞춰져 지도가 쓸모없어진다. 기본값이
 * 현행이어야 하는 이유는 나머지 호출부 다섯 자리(숙소 등록 3 · 거점 확정 1 · 프리뷰 브리지
 * 데모 1)가 **지도를 움직여 좌표를 확정하는 것 자체가 기능**이라서다.
 *
 * TRIP-339 — `connectPins`는 반대로 **옵트아웃**이다(기본 `true` = 핀을 순서대로 잇는다).
 * 끄는 쪽이 명시하는 이유는 핀 번호가 뜻하는 바가 화면마다 다르기 때문이다 — 일정 초안(h11)의
 * 번호는 솔버가 확정한 **돌아볼 순서**라 선이 사실이고, 필수 방문지(h05)의 번호는 사용자가
 * **담은 순서**일 뿐이라 선을 그으면 아직 정해지지 않은 동선을 정해진 것처럼 말하게 된다.
 */
export function buildMapHtml(
  center: MapCenter,
  jsKey: string,
  enablePin: boolean = true,
  pins: MapPin[] = [],
  viewOnly: boolean = false,
  connectPins: boolean = true,
  maxLevel?: number
): string {
  // TRIP-297 — 번호 핀은 `CustomOverlay`로 그린다(기본 `Marker`는 숫자를 못 싣는다).
  // 핀이 둘 이상일 때만 `setBounds`로 전부 담는다 — 한 개짜리 bounds는 넓이가 0이라
  // 최대 배율까지 확대되어 지도가 무엇을 보여주는지 알 수 없게 된다.
  //
  // TRIP-339 — 핀 그림은 Figma `1870:1117` 실측 물방울 SVG다. 원과 꼬리가 **한 도형의 한
  // path**라 흰 2px 테두리가 이음매에서 끊기지 않는다(CSS 회전 트릭으로는 끊긴다).
  // `yAnchor: 1`이라 조각의 아래끝(= 꼬리 끝)이 좌표에 놓인다. viewBox `3 2 28 36`은
  // path 범위(x 4~30 · y 3~37)에 테두리 1px씩을 더한 값이라 화면 크기 28×36과 1:1이다.
  //
  // 연결선은 **핀이 둘 이상이고 `connectPins`가 켜져 있으면** 인접 쌍을 순서대로 잇는다
  // (전결합 아님). 두 겹인 것은 케이싱(casing) 관용구다 — 색 하나로만 그으면 비슷한 색
  // 도로·물 위에서 선이 사라지므로 굵은 흰 선을 먼저 깔고 그 위에 얇은 분홍 선을 얹는다.
  // 좌표가 같은 인접 쌍도 건너뛰지 않는다 — 건너뛰려면 허용오차와 구간 번호 판정이 늘어나는데
  // 그 코드가 막는 실패가 없다.
  //
  // `setBounds`는 선과 갈라 둔다 — 선을 끈 지도(h05)도 핀 묶음은 화면에 맞아야 한다.
  const numberedPinScript =
    pins.length === 0
      ? ''
      : `
          var numberedPins = ${JSON.stringify(pins)};
          var pinBounds = new kakao.maps.LatLngBounds();
          var pinPath = numberedPins.map(function (pin) {
            var position = new kakao.maps.LatLng(pin.lat, pin.lng);
            pinBounds.extend(position);
            return position;
          });
          var multiplePins = numberedPins.length > 1;
          var linkPins = multiplePins && ${connectPins};

          if (linkPins) {
            // 흰 케이싱이 **먼저** — 카카오는 나중에 만든 선을 위에 그린다. strokeLineCap 은
            // 카카오 문서에 없는 이름이라 안 먹을 수 있다(양 끝 둥근 마감은 R2 실기 확인 몫).
            [
              { color: '#FFFFFF', weight: 6 },
              { color: '#FF385C', weight: 2.8 },
            ].forEach(function (layer) {
              new kakao.maps.Polyline({
                map: map,
                path: pinPath,
                strokeWeight: layer.weight,
                strokeColor: layer.color,
                strokeOpacity: 1,
                strokeStyle: 'solid',
                strokeLineCap: 'round',
              });
            });
          }

          // TRIP-301 — 핀을 탭하면 배열 위치(index)를 RN 으로 올려 상세 시트를 연다. 인라인
          // onclick 이 이 전역 함수를 부른다(오버레이 content 는 innerHTML 로 얹혀 인라인 핸들러가
          // 살아 있다). content 는 그대로 문자열이라 물방울 SVG 계약(핀 모양 심판)이 안 깨진다.
          // ponytail: 오버레이 클릭 발화·pointer-events 전달은 jest 사정거리 밖 — 6-b 실기로 확인/조정.
          window.__pinTapOverlay = function (i) {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'PIN_TAP', index: i })
            );
          };

          numberedPins.forEach(function (pin, index) {
            new kakao.maps.CustomOverlay({
              map: map,
              position: pinPath[index],
              yAnchor: 1,
              clickable: true,
              content:
                '<svg width="28" height="36" viewBox="3 2 28 36" onclick="window.__pinTapOverlay(' +
                index +
                ')" style="display:block;cursor:pointer;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.2));">' +
                '<path d="M17 3C9.8 3 4 8.5 4 15.5C4 24 17 37 17 37C17 37 30 24 30 15.5C30 8.5 24.2 3 17 3Z" fill="#FF385C" stroke="#FFFFFF" stroke-width="2"/>' +
                '<text x="17" y="20" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="13" font-weight="700">' +
                pin.number +
                '</text></svg>',
            });
          });

          if (multiplePins) {
            map.setBounds(pinBounds);
          }
`;

  // TRIP-339 — 제스처 차단. 드래그·더블탭은 지도 생성 옵션으로 걸고, 확대축소만
  // `setZoomable`이라는 **메서드**다(카카오 생성 옵션에 `zoomable`이 없다). 그 호출을
  // `setBounds` **뒤**에 두는 이유: 잠근 지도에서 프로그램 카메라 이동이 먹는지 리포에
  // 선례가 0건이라(R5), 이 순서면 실기에서 안 먹더라도 핀 묶음 맞추기가 이미 끝나 있다.
  const viewOnlyMapOptions = viewOnly
    ? `
              draggable: false,
              disableDoubleClickZoom: true,`
    : '';
  const viewOnlyLockScript = viewOnly ? 'map.setZoomable(false);' : '';

  // TRIP-301 D6 — 줌아웃 상한. 완성 일정 탐색 지도(h26)는 제스처를 허용(viewOnly=false)하되
  // 한없이 줌아웃해 "중국까지 이탈"하는 것만 막는다. `setMaxLevel(n)`은 확대 배율의 최댓값
  // (= 가장 멀리 본 상태)을 못 박는다. jest 잠금은 없다 — 실제 상한 효과는 6-b 실기 몫이다.
  const maxLevelScript =
    maxLevel === undefined ? '' : `map.setMaxLevel(${maxLevel});`;

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
              level: 3,${viewOnlyMapOptions}
            });
            ${numberedPinScript}
            ${viewOnlyLockScript}
            ${maxLevelScript}
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
