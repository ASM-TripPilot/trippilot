import {
  buildMapHtml,
  MAP_LOAD_FAILED_MESSAGE,
  REGISTERED_DOMAIN,
} from './mapHtml';

/**
 * M-1~M-5 (AC-3 · AC-4 · AC-5 · 02a §4-A) — WebView에 넘길 HTML 문자열 층.
 *
 * 무엇을 보장하나: `buildMapHtml`이 조립한 **대본**이 옳다 — 카카오 SDK를 부를 때
 * `services` 라이브러리를 함께 싣고, 찍힌 지점을 `PIN_DROP` 메시지로 RN에 올려보내며,
 * 역지오코딩을 **(경도, 위도) 순서로** 부른다.
 *
 * 무엇을 보장하지 **못**하나: 이 대본이 실제로 연기되는지는 안 본다. jest는 WebView 안
 * 자바스크립트를 한 줄도 실행하지 않는다(`__mocks__/react-native-webview.tsx`는 props를
 * 그대로 넘기는 통과 `<View>`다). "실제로 롱프레스가 먹는가"·"services가 실제로 로드되는가"·
 * "카카오 콘솔 도메인 명부를 통과하는가"는 전부 6-b 실기 스모크 몫이다(02a §2).
 *
 * `buildMapHtml`은 순수 함수(입력만으로 출력이 정해지고 바깥을 건드리지 않는 함수)라
 * 렌더 없이 문자열만 본다.
 */

const CENTER = { lat: 37.5665, lng: 126.978 };
const OTHER_CENTER = { lat: 35.1796, lng: 129.0756 };
const JS_KEY = 'test-js-key';

/**
 * SDK를 불러오는 `<script src="...">` 한 줄만 떼어낸다. URL "안에" 파라미터가 있는지를
 * 보려면 문서 전체가 아니라 그 URL을 봐야 한다 — 문서 아무 데나 `libraries=services`가
 * 적혀 있어도 통과하는 헐거운 단언을 피한다.
 */
function sdkScriptUrl(html: string): string | null {
  const match = html.match(
    /https:\/\/dapi\.kakao\.com\/v2\/maps\/sdk\.js[^"'\s]*/
  );
  return match === null ? null : match[0];
}

describe('M-1 · SDK가 services 라이브러리를 함께 싣는다 (확정 1)', () => {
  it('SDK URL 안에 libraries=services가 있고, 기존 appkey·autoload는 그대로다', () => {
    const url = sdkScriptUrl(buildMapHtml(CENTER, JS_KEY));

    // 도달 앵커 — 진짜 SDK URL을 떼어냈다. null이면 아래가 전부 공허해진다.
    expect(url).not.toBeNull();

    // 본체 — 이게 없으면 kakao.maps.services가 undefined라 역지오코딩이 조용히 터진다.
    expect(url).toContain('libraries=services');

    // 무회귀 짝 — 라이브러리를 붙이면서 기존 파라미터를 잃지 않았다.
    expect(url).toContain(`appkey=${JS_KEY}`);
    expect(url).toContain('autoload=false');
  });
});

describe('M-2 · 찍은 지점을 PIN_DROP 메시지로 올려보낸다 (AC-3)', () => {
  it('지도 이벤트를 듣고 좌표를 postMessage로 RN에 넘기는 스크립트가 있다', () => {
    const html = buildMapHtml(CENTER, JS_KEY);

    // 지도에 이벤트를 건다. **어떤 이벤트인지는 잠그지 않는다**(02a ★13-a) — 카카오 Web API
    // 문서에서 'longpress'의 실재를 확인하지 못했고, 실기에서 무엇이 롱프레스로 매핑되는지는
    // jest가 판정할 수 없다. 이름을 못박으면 어떤 구현으로도 통과 불가가 될 수 있다.
    expect(html).toContain('kakao.maps.event.addListener');

    // 메시지 프로토콜만 잠근다 — 이것이 RN 쪽 onMessage와 맞물리는 유일한 계약이다.
    expect(html).toContain('PIN_DROP');
    expect(html).toContain('window.ReactNativeWebView.postMessage');
  });
});

describe('M-3 · ★ coord2Address는 (경도, 위도) 순서다', () => {
  /**
   * 카카오 `coord2Address(x, y)`의 x는 **경도**, y는 **위도**다. 그런데 리포 `MapCenter`는
   * `{lat, lng}` 순서이고 둘 다 `number`라 **타입스크립트가 뒤바뀜을 잡지 못한다** —
   * 그대로 넘기면 서울 좌표가 바다로 간다. 컴파일러가 못 잡으니 여기서 잡는다.
   *
   * 왜 "교차 부정"까지 하나: 순진하게 1인자에 `not.toMatch(/lat/i)`를 걸면
   * `latlng.getLng()`(정답)가 문자열 "lat"을 품고 있어 오답 판정된다. `\b` 경계를 쓰면
   * `latlng` 안의 `lat`은 뒤가 단어문자(`l`)라 경계가 서지 않아 매치되지 않는다.
   */
  const ARG_LNG = /getLng\(\)|\blng\b/;
  const ARG_LAT = /getLat\(\)|\blat\b/;

  /** 첫 두 인자를 떼어낸다. 못 찾으면 null. */
  function coordArgs(source: string): [string, string] | null {
    const match = source.match(/coord2Address\(([^,]*),([^,]*),/);
    return match === null ? null : [match[1].trim(), match[2].trim()];
  }

  /** 인자 순서가 (경도, 위도)인가. */
  function isLngLatOrder(source: string): boolean {
    const args = coordArgs(source);
    if (args === null) return false;
    return (
      ARG_LNG.test(args[0]) &&
      !ARG_LAT.test(args[0]) &&
      ARG_LAT.test(args[1]) &&
      !ARG_LNG.test(args[1])
    );
  }

  it('조립된 HTML의 coord2Address 호출이 경도를 먼저 넘긴다', () => {
    const html = buildMapHtml(CENTER, JS_KEY);

    // 도달 앵커 — 역지오코딩 호출 자체가 대본에 있다.
    expect(coordArgs(html)).not.toBeNull();

    // 본체 — 뒤바뀌면 여기서 걸린다.
    expect(isLngLatOrder(html)).toBe(true);
  });

  it('탐지기 자가검사 — 정답 3형태를 통과시키고 뒤바뀜 3형태를 잡는다', () => {
    // 정답 — 구현 자유를 뺏지 않는다(지역변수로 분해하든 접근자를 직접 넘기든 통과).
    expect(
      isLngLatOrder('geocoder.coord2Address(lng, lat, function (r, s) {})')
    ).toBe(true);
    expect(
      isLngLatOrder(
        'geocoder.coord2Address(latlng.getLng(), latlng.getLat(), cb)'
      )
    ).toBe(true);
    expect(
      isLngLatOrder(
        'geocoder.coord2Address(\n  latlng.getLng() ,\n  latlng.getLat() ,\n  cb)'
      )
    ).toBe(true);

    // 뒤바뀜 — 셋 다 잡아야 한다. 마지막이 이 함정의 실물이다(MapCenter를 그대로 넘긴 형태).
    expect(
      isLngLatOrder('geocoder.coord2Address(lat, lng, function (r, s) {})')
    ).toBe(false);
    expect(
      isLngLatOrder(
        'geocoder.coord2Address(latlng.getLat(), latlng.getLng(), cb)'
      )
    ).toBe(false);
    expect(
      isLngLatOrder('geocoder.coord2Address(center.lat, center.lng, cb)')
    ).toBe(false);

    // 호출 자체가 없으면 통과시키지 않는다(탐지기가 조용히 눈머는 방향).
    expect(isLngLatOrder('const x = 1;')).toBe(false);
  });
});

describe('M-4 · 역지오코딩 성공·실패가 서로 다른 메시지로 나간다 (AC-4 · AC-5 · INV-4)', () => {
  it('GEOCODE_OK는 주소를 싣고, 실패에는 GEOCODE_FAIL이 따로 있다', () => {
    const html = buildMapHtml(CENTER, JS_KEY);

    // 성공 — 주소를 실어 보낸다(저장 정본은 좌표, 주소는 표시용 사본).
    expect(html).toContain('GEOCODE_OK');
    expect(html).toContain('address');

    // 실패 — 침묵 실패 금지(INV-4 · BR-U1-55). 성공만 있고 실패 경로가 없으면
    // 조회가 실패했을 때 화면이 영원히 빈 주소로 남는다.
    expect(html).toContain('GEOCODE_FAIL');
  });
});

describe('M-5 · 기존 지도 계약 무회귀 (선제 green — 02a §6)', () => {
  it('SDK 로드 실패 표식·base 도메인·center 반영이 그대로다', () => {
    const html = buildMapHtml(CENTER, JS_KEY);

    // TRIP-197이 세운 실패 표식이 살아 있다.
    expect(html).toContain(MAP_LOAD_FAILED_MESSAGE);
    // 도메인 단일 출처(A-9)를 문서 안에서도 그대로 쓴다.
    expect(html).toContain(REGISTERED_DOMAIN);

    // center가 실제로 반영된다 — 좌표를 문자열로 어떻게 쓸지는 구현 자유라
    // "다른 입력 → 다른 출력"만 본다(KakaoMapView.test.tsx의 같은 판단).
    expect(html).not.toBe(buildMapHtml(OTHER_CENTER, JS_KEY));
  });
});
