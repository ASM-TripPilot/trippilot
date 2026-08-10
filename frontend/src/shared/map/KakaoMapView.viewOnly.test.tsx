import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import { KakaoMapView, type KakaoMapViewProps } from './KakaoMapView';
import { buildMapHtml, type MapCenter, type MapPin } from './mapHtml';

/**
 * V1·V2 (TRIP-339 · AC-12 · AC-13 · AC-16) — 새 `viewOnly` 프롭이 **컴포넌트를 통과해 대본까지
 * 흐르는가**. 대본 안에서 그 옵션이 옳은 모양인지는 `mapHtml.script.test.ts`(X5·X6)가 잰다.
 *
 * ⚠️ 이 파일에 `jest.mock('@/shared/map')` 을 얹지 마라. 리포의 얇은 목
 * (`src/test-support/kakaoMapViewMock.tsx`)은 `center`만 텍스트로 노출하고 나머지 props를 그냥
 * 통과시키므로, 그 위에서는 프롭이 대본에 실렸는지를 **되비추지 않는다** — 무엇을 넘겨도 초록이다
 * (미상환 이해부채 `2026-08-10 지도 목이 remount 열쇠를 못 되비춘다`). 실물을 태워야 한다.
 *
 * ⚠️ **rerender가 아니라 새 마운트로 비교한다.** `KakaoMapView`의 `source.html`은 `useState`
 * 초기값 함수로 **마운트 시점에 한 번만** 조립되고 이후 props가 바뀌어도 다시 조립되지 않는다
 * (그 컴포넌트의 동결 계약 — WebView는 `source`가 바뀌면 문서를 통째로 다시 로드해 진행 중이던
 * 콜백을 죽인다). rerender로 비교하면 어떤 구현에서도 "안 바뀐다"가 나온다.
 *
 * `react-native-webview`는 네이티브 모듈이라 리포의 수동 목이 props를 그대로 통과시키는 `View`로
 * 대체한다 — 그 덕에 `source.html`을 밖에서 읽을 수 있다. 여기서 가짜인 부분은 그것뿐이다.
 */

jest.mock('react-native-webview');

// env 규율(`KakaoMapView.test.tsx` 선례) — 선언과 대입을 분리한다(computed 접근이 선언과 한
// 문장이면 eslint-plugin-expo 의 no-dynamic-env-var 에 걸린다).
const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

beforeEach(() => {
  // 키가 없으면 실물은 무조건 map-failure 로 떨어져 대본이 아예 조립되지 않는다.
  process.env[ENV_KEY] = 'test-js-key';
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

/** `viewOnly`는 이 칸에서 새로 생기는 프롭이라 아직 타입에 없다. 함수 타입의 파라미터는
 * 반공변이라 좁은 props를 받는 컴포넌트를 넓은 props 타입에 **캐스트 없이** 대입할 수 있다 —
 * 구현 전에도 후에도 컴파일된다(02a ★8). */
const MapView: (
  props: KakaoMapViewProps & { viewOnly?: boolean }
) => ReactElement = KakaoMapView;

const CENTER: MapCenter = { lat: 33.4996, lng: 126.5312 };
const PINS: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52 },
  { number: 2, lat: 33.515, lng: 126.526 },
];

/** 지도 조작을 가리키는 이름 어휘 — 이 층은 "차단 지시가 문서에 실렸나"까지만 본다.
 * 어떤 옵션 이름으로 실렸는지는 구현 자유이고, 그 모양의 심판은 X5·X6이다. */
const GESTURE_WORD = /drag|zoom|doubleclick|double_click|wheel|scroll/i;

function mapDocument(): string {
  const source = screen.getByTestId('map-webview').props.source as
    { html?: string } | undefined;
  return String(source?.html ?? '');
}

describe('🔴 V1 · AC-12 — viewOnly 를 켜면 조작 차단이 대본까지 내려간다', () => {
  it('같은 center·pins라도 viewOnly를 켠 새 마운트는 다른 문서를 만들고, 그 문서에만 조작 어휘가 있다', () => {
    const open = render(<MapView center={CENTER} pins={PINS} />);
    const openHtml = mapDocument();

    // 도달 앵커 — 진짜 지도 문서를 읽었다(실패 표면으로 떨어지지 않았다).
    expect(openHtml).toContain('dapi.kakao.com');
    expect(screen.queryAllByTestId('map-failure')).toEqual([]);

    // 마운트 시점 값으로 얼어붙는 계약이라 rerender 로는 절대 안 바뀐다 — 새로 마운트한다.
    open.unmount();
    render(<MapView center={CENTER} pins={PINS} viewOnly />);
    const lockedHtml = mapDocument();

    // ① 문서가 달라졌다 = 프롭이 조립에 실제로 참여했다.
    expect(lockedHtml).not.toBe(openHtml);
    // ② 달라진 방향이 옳다 — 조작 차단 어휘가 켠 쪽에만 있다.
    expect(GESTURE_WORD.test(lockedHtml)).toBe(true);
    expect(GESTURE_WORD.test(openHtml)).toBe(false);
    // ③ 짝 — 고정하면서 핀을 잃지 않았다(핀 번호가 문서에 그대로 있다).
    expect(lockedHtml).toContain('CustomOverlay');
  });
});

describe('V2 · AC-13 · AC-16 — 안 넘기면 아무것도 달라지지 않는다 (선제 green · 옵트인 무회귀)', () => {
  it('viewOnly 없이 두 번 마운트하면 문서가 같고 조작 어휘가 없다', () => {
    const first = render(<MapView center={CENTER} pins={PINS} />);
    const firstHtml = mapDocument();
    first.unmount();

    render(<MapView center={CENTER} pins={PINS} />);
    const secondHtml = mapDocument();

    // 도달 앵커 — 두 번 다 진짜 문서다.
    expect(firstHtml).toContain('dapi.kakao.com');
    // 같은 입력이면 같은 문서다(비교 자체가 의미를 가지려면 결정론이어야 한다).
    expect(secondHtml).toBe(firstHtml);
    // 기본값은 현행 — 숙소 등록 3곳·거점 확정 1곳이 여기에 얹혀 있다.
    expect(GESTURE_WORD.test(firstHtml)).toBe(false);
  });
});

// ── 게이트①-2 추가분 (2026-08-10) ─────────────────────────────────────────────

describe('V3 · h05 무선 — connectPins 가 컴포넌트를 통과해 대본까지 흐른다 (게이트①-2 추가분)', () => {
  /** 왜 이 층이 따로 필요한가 — 소스 층(S8)은 **h05 태그에 뭐라고 적혔나**까지, 대본 실행 층
   * (X7)은 **그 값을 받은 대본이 무엇을 만드나**까지만 본다. 그 사이의 `KakaoMapView`가 값을
   * 흘려도 두 층은 **둘 다 초록이다.** 실측으로 확인한 구멍이다(게이트①-2 뮤테이션 M8):
   * 이 컴포넌트의 구조분해에 `connectPins = false` 기본값 한 글자를 심으면 아무 말도 하지 않은
   * 호출부 — **h11 일정 초안 포함** — 가 전부 선을 잃는데, 태그에는 여전히 아무 문제가 없고
   * 대본 조립 함수도 여전히 옳다. 이 티켓의 주 AC가 화면 밖에서 조용히 죽는 자리다.
   *
   * **문자열 대조로는 방향을 못 가른다** — 대본에는 `new kakao.maps.Polyline` 코드가 켠 쪽에도
   * 끈 쪽에도 그대로 실려 있고 갈리는 것은 실행 조건뿐이다(`var linkPins = multiplePins && …`).
   * 그래서 "두 문서가 다르다"가 아니라 **같은 인자를 넣은 대본과 통째로 같다**를 잰다. 양변이
   * 같은 조립 함수에서 나오므로 대본 모양이 바뀌면 양변이 함께 움직인다 — 이 단언이 못박는 것은
   * 오직 **컴포넌트가 무엇을 넘겼나**다.
   *
   * 무엇을 보장하지 **못**하나: 브라우저에서 선이 실제로 안 보이는지는 6-b 실기(R9) 몫이다. */
  it('안 넘긴 마운트는 잇는 대본을, connectPins={false} 마운트는 끊은 대본을 만든다', () => {
    const linked = render(<MapView center={CENTER} pins={PINS} />);
    const linkedHtml = mapDocument();

    // V1과 같은 이유로 rerender 가 아니라 새 마운트다 — 문서는 마운트 시점에 한 번만 조립된다.
    linked.unmount();
    render(<MapView center={CENTER} pins={PINS} connectPins={false} />);
    const unlinkedHtml = mapDocument();

    // ① 도달 앵커 — 둘 다 진짜 지도 문서다(실패 표면으로 떨어지지 않았다).
    expect(linkedHtml).toContain('dapi.kakao.com');
    expect(unlinkedHtml).toContain('dapi.kakao.com');

    // ② 프롭이 조립에 실제로 참여했다.
    expect(unlinkedHtml).not.toBe(linkedHtml);

    // ③ 달라진 방향까지 못박는다 — 아무 말도 안 한 마운트(= h11)는 **잇는** 대본을 받는다.
    expect(linkedHtml).toBe(
      buildMapHtml(CENTER, 'test-js-key', false, PINS, undefined, true)
    );
    // ④ 끄겠다고 말한 마운트(= h05)는 **끊은** 대본을 받는다.
    expect(unlinkedHtml).toBe(
      buildMapHtml(CENTER, 'test-js-key', false, PINS, undefined, false)
    );
  });
});
