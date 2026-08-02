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

    // 지도에 이벤트를 건다. **어떤 이벤트인지도, 어떤 API로 거는지도 잠그지 않는다**(02a ★13-a).
    //
    // TRIP-210 6-b 실측으로 완화한 단언 — 원래는 `kakao.maps.event.addListener`를 문자열로
    // 못박았는데, 그 경로로는 실기에서 이벤트가 **오지 않았다**(예외도 안 났다. 안쪽
    // try/catch가 잡았으면 실패 표면이 떴을 것이다). 그래서 지도 컨테이너에 DOM 이벤트를
    // 직접 거는 두 번째 시도로 갈아탔다. 등록 API 이름을 못박으면 그 전환이 "어떤 구현으로도
    // 통과 불가"가 된다 — ★13-a가 이벤트 **이름**에 대해 경계했던 것과 같은 함정이다.
    expect(html).toMatch(/addListener|addEventListener/);

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

describe('M-6 · ★ 롱프레스가 iOS 텍스트 선택에 가로채이지 않는다 (TRIP-199 6-b 실측 결함)', () => {
  /**
   * 6-b 실기에서 잡힌 결함: 지도를 길게 누르면 핀이 찍히는 대신 iOS의 텍스트 선택
   * 핸들과 콜아웃 메뉴(Copy·Translate·Convert Meters)가 떴다. WKWebView는 길게 누르기를
   * 기본적으로 선택 제스처로 해석하는데, 그것이 카카오 지도의 `mousedown` 리스너보다
   * 먼저 잡아채 600ms 타이머가 아예 시작되지 않는다.
   *
   * 이 층은 jest가 **볼 수 있었다** — 대본이 그 CSS를 싣는지는 문자열 검사다(02a §2의
   * 층 ⑴). TRIP-199의 승인 계약에 그 단언이 없었을 뿐이라, N-9("심판이 못 보는 층")가
   * 아니라 **심판을 안 세운 층**이다.
   */
  const SUPPRESSION = [
    /-webkit-user-select:\s*none/,
    /(?<!-webkit-)user-select:\s*none/,
    /-webkit-touch-callout:\s*none/,
  ];

  it('핀을 받는 지도의 대본이 선택·콜아웃을 전부 끈다', () => {
    const html = buildMapHtml(CENTER, JS_KEY);

    // 도달 앵커 — 스타일 블록 자체가 있다(없으면 아래가 "없는 것을 검사"하며 헛돈다).
    expect(html).toContain('<style>');

    SUPPRESSION.forEach((re) => expect(html).toMatch(re));
  });

  it('짝: 핀을 안 받는 지도(검색 미리보기·확정 시트)도 마찬가지다', () => {
    // 그 지도들은 롱프레스로 핀을 만들지 않지만, 눌렀을 때 Copy/Translate 메뉴가 뜨는
    // 것은 마찬가지로 오작동이다 — 억제는 `enablePin`과 무관해야 한다.
    const html = buildMapHtml(CENTER, JS_KEY, false);

    expect(html).toContain('<style>');
    SUPPRESSION.forEach((re) => expect(html).toMatch(re));
  });

  it('탐지기 자가검사 — 접두사 붙은 속성만 있으면 표준 속성 단언이 잡아낸다', () => {
    // (M-6 자가검사 — 아래 M-7과 무관)
    // `-webkit-user-select`는 문자열 `user-select`를 품는다. 순진하게
    // `toContain('user-select: none')`만 쓰면 표준 속성이 빠져도 통과한다.
    const webkitOnly = '-webkit-user-select: none;';
    const standardOnly = 'user-select: none;';

    expect(SUPPRESSION[1].test(webkitOnly)).toBe(false);
    expect(SUPPRESSION[1].test(standardOnly)).toBe(true);
    expect(SUPPRESSION[0].test(webkitOnly)).toBe(true);
  });
});

describe('M-7 · ★ 지도 셋업이 콜백 안에서 터져도 침묵하지 않는다 (INV-4 · TRIP-199 6-b 후속)', () => {
  /**
   * 기존 구조는 `try { kakao.maps.load(cb) } catch { … }`였다. `try`가 감싸는 것은
   * **`load()` 호출**이고 `cb`는 나중에 비동기로 불리므로, 콜백 안에서 난 예외는 그
   * catch로 **절대 안 온다**. 지도 생성·핀 대본이 터져도 아무 데도 안 알려지고 화면에는
   * 멀쩡한 지도만 남는다 — INV-4·BR-U1-55가 금지한 침묵 실패다.
   *
   * 6-b 실기에서 롱프레스가 안 먹었을 때 원인을 좁히지 못한 이유가 정확히 이것이다:
   * 실패했다는 사실 자체가 밖으로 나올 통로가 없었다.
   */

  /** `kakao.maps.load(` 이후 ~ 지도 생성 직전 구간. 콜백이 문을 열자마자 try를 여는지 본다. */
  function callbackPreamble(html: string): string | null {
    const start = html.indexOf('kakao.maps.load(');
    const end = html.indexOf('new kakao.maps.Map');
    return start === -1 || end === -1 || end < start
      ? null
      : html.slice(start, end);
  }

  it('콜백이 지도 생성 전에 try를 연다 (바깥 try는 이 자리를 못 지킨다)', () => {
    const html = buildMapHtml(CENTER, JS_KEY);

    // 도달 앵커 — 두 지점이 실재하고 순서도 맞다.
    expect(callbackPreamble(html)).not.toBeNull();

    expect(callbackPreamble(html)).toMatch(/try\s*\{/);
  });

  it('짝: 핀을 안 받는 지도도 같은 보호를 받는다', () => {
    // 지도 생성 자체가 터지는 경우는 enablePin과 무관하다.
    expect(callbackPreamble(buildMapHtml(CENTER, JS_KEY, false))).toMatch(
      /try\s*\{/
    );
  });

  it('실패를 알리는 통로가 늘었다 — 스크립트 onerror·바깥 catch·콜백 안 catch 셋', () => {
    const html = buildMapHtml(CENTER, JS_KEY);
    const posts = html.split(MAP_LOAD_FAILED_MESSAGE).length - 1;

    // onerror 속성 1 + 상수 선언 참조는 없음(문자열 보간이라) + 바깥 catch 1 + 안쪽 catch 1
    expect(posts).toBeGreaterThanOrEqual(3);
  });

  it('탐지기 자가검사 — 바깥에만 try가 있는 형태를 통과시키지 않는다', () => {
    // 수정 전 구조를 그대로 흉내 낸 문자열. 콜백 구간(load( ~ new Map)에 try가 없다.
    const before =
      'try { kakao.maps.load(function () { var map = new kakao.maps.Map(x); }); } catch (e) {}';
    expect(callbackPreamble(before)).not.toMatch(/try\s*\{/);

    // 수정 후 형태는 통과한다.
    const after =
      'try { kakao.maps.load(function () { try { var map = new kakao.maps.Map(x); } catch (e) {} }); } catch (e) {}';
    expect(callbackPreamble(after)).toMatch(/try\s*\{/);
  });
});

describe('M-8 · 조립된 대본이 문법적으로 유효한 자바스크립트다 (선제 green — 회귀 앵커)', () => {
  /**
   * 이 파일은 자바스크립트를 **문자열로** 만든다. 문자열 안 코드는 tsc도 eslint도 안 본다 —
   * 오타 하나로 문서 전체가 파싱 실패하면 지도가 통째로 죽는데, 그 실패는 WebView 안에서만
   * 일어나 밖으로 안 나온다(안쪽 try/catch도 파싱 실패는 못 잡는다. 스크립트가 아예
   * 실행되지 않기 때문이다).
   *
   * TRIP-210에서 대본이 8줄에서 50줄 넘게 커지면서 이 위험이 실질을 갖게 됐다.
   * `new Function(src)`는 **파싱만** 하고 실행하지 않으므로 브라우저 없이도 문법을 잰다.
   */
  function inlineScript(html: string): string {
    const open = html.lastIndexOf('<script>');
    const close = html.lastIndexOf('</script>');
    return html.slice(open + '<script>'.length, close);
  }

  it('핀 대본이 실린 문서도, 안 실린 문서도 파싱된다', () => {
    // 도달 앵커 — 스크립트를 실제로 떼어냈다(빈 문자열이면 무엇이든 파싱된다).
    expect(inlineScript(buildMapHtml(CENTER, JS_KEY)).length).toBeGreaterThan(
      200
    );

    expect(
      () => new Function(inlineScript(buildMapHtml(CENTER, JS_KEY)))
    ).not.toThrow();
    expect(
      () => new Function(inlineScript(buildMapHtml(CENTER, JS_KEY, false)))
    ).not.toThrow();
  });

  it('탐지기 자가검사 — 망가진 문법은 실제로 잡는다', () => {
    expect(() => new Function('function ( {')).toThrow();
  });
});
