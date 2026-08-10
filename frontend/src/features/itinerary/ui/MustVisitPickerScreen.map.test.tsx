import { render, screen } from '@testing-library/react-native';

import type { MapPin } from '@/shared/map';

import type {
  MustVisitListItem,
  MustVisitListView,
} from '../model/mustVisitList';
import { MustVisitPickerScreen } from './MustVisitPickerScreen';

/**
 * 🔴 AC-6 — h05 지도를 **실물 `KakaoMapView` 로** 태우는 유일한 심판.
 *
 * 왜 파일을 따로 두나 (01b §3-②-나 · 문제로그 2026-08-02 · 미해결):
 * `jest.mock('@/shared/map')` 은 WebView 안 JS 뿐 아니라 **리액트 생애주기(마운트·언마운트·
 * 리렌더)까지 통짜로** 대체한다. 그래서 목 위에서는 "핀이 바뀌면 지도도 바뀐다" 가 **공짜로**
 * 통과한다 — 목은 prop 이 바뀌면 즉시 새 값을 노출하기 때문이다.
 *
 * 실물은 **정반대**다. `KakaoMapView` 의 `source.html` 은 `useState` 초기값 함수로 **마운트
 * 시점에 한 번만** 조립되고 이후 `center`·`pins` 가 바뀌어도 다시 조립되지 않는다(그 컴포넌트의
 * 동결 계약 — WebView 는 `source` 가 바뀌면 문서를 통째로 다시 로드해 진행 중이던 콜백을
 * 죽이므로 일부러 얼려 둔 것이다). 다른 핀 묶음을 그리는 **유일한 수단이 `key` remount** 이고,
 * 그것은 **부모(=이 화면)의 책임**이다.
 *
 * 따라서 아래 M2 는 목 위에서는 아무것도 증명하지 못하고 실물 위에서만 의미를 갖는다
 * (02a §5-4 에서 대조군까지 실측했다 — 같은 인스턴스에 다른 핀으로 rerender 하면 실물은
 * html 이 **그대로**이고, 부모가 remount 해야 바뀐다).
 *
 * ⚠️ **이 파일에 `jest.mock('@/shared/map')` 을 얹지 마라.** 얹는 순간 M1 의 SDK 앵커가 먼저
 * 죽는다 — 목은 카카오 SDK 대본을 만들지 않기 때문이다. 그 앵커가 이 파일의 자물쇠다.
 *
 * `react-native-webview` 는 네이티브 모듈이라 리포의 수동 목(`__mocks__/react-native-webview.tsx`)
 * 이 **모든 버킷에 자동 적용**된다 — props 를 그대로 통과시키는 `View` 라서 `source.html` 을
 * 밖에서 읽을 수 있다. 그것이 여기서 유일하게 가짜인 부분이다.
 *
 * 3동작 뼈대: 준비=핀을 만들어 렌더 → 실행=핀을 바꿔 다시 렌더 → 단언=지도 문서가 바뀌었나.
 */

// env 규율(`KakaoMapView.test.tsx` 선례) — 원본을 저장해 두고 afterEach 에서 되돌린다.
// `const X = process.env[KEY]` 형태(computed 접근이 선언과 한 문장)는 eslint-plugin-expo 의
// no-dynamic-env-var 에 걸리므로 선언과 대입을 분리한다.
const ENV_KEY = 'EXPO_PUBLIC_KAKAO_MAP_JS_KEY';
let ORIGINAL_ENV: string | undefined;
ORIGINAL_ENV = process.env[ENV_KEY];

beforeEach(() => {
  // 키가 없으면 실물은 무조건 `map-failure` 로 떨어져 핀이 어디로도 흐르지 않는다.
  process.env[ENV_KEY] = 'test-js-key';
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_ENV;
  }
});

function item(
  over: Partial<MustVisitListItem> & { sourcePoiId: string }
): MustVisitListItem {
  return {
    mustVisitId: `mv-${over.sourcePoiId}`,
    name: '감천문화마을',
    imageUrl: null,
    type: 'ANYTIME',
    ...over,
  };
}

const LISTED: MustVisitListView = {
  kind: 'listed',
  staleFailed: false,
  items: [
    item({ sourcePoiId: 'poi-a', name: '부산시립미술관' }),
    item({ sourcePoiId: 'poi-b', name: '해운대 블루라인파크' }),
  ],
};

/**
 * 🔴 세 묶음이 **첫 핀을 공유**한다. 이것이 이 픽스처의 전부다.
 *
 * 1차 게이트①의 픽스처는 두 묶음의 **첫 핀이 서로 달랐다**. 그래서 "핀 묶음 전체로 remount 한다"
 * 와 "첫 핀만 보고 remount 한다" 를 구별하지 못했고, `key` 를 `mapPins[0]` 로 바꿔도 150건이
 * 전부 초록이었다(03b §5 실측). 화면은 첫 핀을 지도 **중심**으로도 쓰므로(`center={mapPins[0]}`)
 * 첫 핀이 다른 묶음은 "중심이 바뀌었으니 당연히 다른 문서" 로도 통과해 버린다.
 *
 * 실사용에서 흔한 변화는 오히려 첫 핀이 그대로인 쪽이다 — 2·3번 항목 해제, 중간 항목이 담기
 * 해제로 좌표를 잃음, 첫 항목이 아닌 카드를 강등해 목록 재정렬.
 */
const PIN_1: MapPin = { number: 1, lat: 35.1, lng: 129.1 };
const PIN_2: MapPin = { number: 2, lat: 35.2, lng: 129.2 };

const PINS_A: MapPin[] = [PIN_1, PIN_2];
/** 첫 핀은 그대로고 **꼬리가 사라졌다** → "첫 핀만 보는 열쇠" 를 죽인다. */
const PINS_TAIL_DROPPED: MapPin[] = [PIN_1];
/** 첫 핀도 **개수도** 그대로고 2번 핀 좌표만 다르다 → "첫 핀만" 과 "개수만" 둘 다 죽인다. */
const PINS_TAIL_MOVED: MapPin[] = [PIN_1, { number: 2, lat: 36.9, lng: 127.9 }];

/** WebView 로 넘어간 지도 문서. **내용을 파싱하지 않는다** — 좌표 직렬화 형식(String·toFixed·
 * JSON)은 구현 자유로 남기고, "같다/다르다" 만 본다(`KakaoMapView.test.tsx` 가 세운 규약). */
function mapHtml(): string {
  const source = screen.getByTestId('map-webview').props.source as
    { html?: string } | undefined;
  return String(source?.html ?? '');
}

describe('🔴 M1 · AC-6 — 실물 지도가 마운트되고 핀이 문서까지 간다', () => {
  it('map-webview 가 서고 실패 표면이 없으며, 문서에 카카오 SDK 대본이 들어 있다', () => {
    render(<MustVisitPickerScreen view={LISTED} pins={PINS_A} />);

    // ① 지도 카드가 실물 지도를 감싸고 있다.
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-map')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('map-webview')).toBeOnTheScreen();

    // ② 실패 표면이 없다 — 키가 없거나 로드가 실패하면 실물은 여기로 떨어진다.
    expect(screen.queryAllByTestId('map-failure')).toEqual([]);

    // ③ 🔴 **이 파일이 실물을 태우고 있다는 증거.** 목(`kakaoMapViewMock`)은 SDK 대본을 만들지
    //    않으므로, 나중에 누가 이 파일에 `jest.mock('@/shared/map')` 을 얹으면 여기서 먼저 죽는다.
    expect(mapHtml()).toContain('dapi.kakao.com');
  });
});

describe('🔴 M2 · AC-6 · 02a ★3 — 핀 **묶음**이 바뀌면 지도 문서도 바뀐다', () => {
  /**
   * 이 케이스가 재는 것은 화면의 **remount 책임**이다. 실물 지도는 마운트 시점 값으로 얼어붙어
   * 있으므로, 아래 "다르다" 는 화면이 `key` 로 지도를 다시 마운트할 때만 참이 된다.
   * 목 위에서는 이 단언이 아무것도 요구하지 않는다 — 그래서 이 파일이 따로 있다.
   *
   * 🔴 **묶음 전체가 열쇠에 들어가는지** 를 재려고 세 묶음이 첫 핀을 공유한다(위 픽스처 주석).
   * 첫 핀만·개수만 보는 열쇠는 여기서 죽는다.
   *
   * 한계: "핀이 바뀌면 문서가 바뀐다" 까지이고, 바뀐 문서가 **옳은 핀을 그리는가**는 여기서
   * 안 본다(그것은 `mapHtml.test.ts` 의 대본 심판과 [검증] 실기 몫이다).
   */
  it('같은 핀이면 그대로, 꼬리만 달라도 새 문서, 되돌리면 원래 문서다', () => {
    const { rerender } = render(
      <MustVisitPickerScreen view={LISTED} pins={PINS_A} />
    );
    const htmlA = mapHtml();

    // ① 긍정 앵커 — 문서가 비어 있지 않다. 빈 문자열이면 아래 비교가 전부 공허해진다.
    expect(htmlA.length).toBeGreaterThan(0);

    // ② 같은 핀으로 다시 렌더 — 문서가 **그대로**다. 매 렌더 remount 하면 지도가 깜빡이고
    //    진행 중이던 SDK 콜백이 죽는다(불필요한 remount 금지).
    rerender(<MustVisitPickerScreen view={LISTED} pins={PINS_A} />);
    expect(mapHtml()).toBe(htmlA);

    // ③ 🔴 **첫 핀은 그대로인데 꼬리가 사라졌다** — 2번 항목의 담기를 풀었을 때의 모양이다.
    //    지도 중심도 안 바뀌므로, 문서가 바뀌려면 열쇠가 **묶음 전체**여야 한다.
    rerender(<MustVisitPickerScreen view={LISTED} pins={PINS_TAIL_DROPPED} />);
    const htmlDropped = mapHtml();
    expect(htmlDropped).not.toBe(htmlA);

    // ④ 🔴 **첫 핀도 개수도 같고 2번 핀 좌표만 다르다** — 중간 항목이 좌표를 잃거나 카드가
    //    재정렬됐을 때의 모양이다. ③ 의 문서와도 달라야 한다(꼬리 값이 문서에 반영된다는 짝).
    rerender(<MustVisitPickerScreen view={LISTED} pins={PINS_TAIL_MOVED} />);
    const htmlMoved = mapHtml();
    expect(htmlMoved).not.toBe(htmlA);
    expect(htmlMoved).not.toBe(htmlDropped);

    // ⑤ 짝 — 되돌리면 원래 문서로 돌아온다. 문서의 차이가 **핀에서 나온다**는 증거다
    //    (렌더할 때마다 무조건 새 문서를 만드는 구현이면 ② 에서 이미 죽는다).
    //    🔴 `mapPins.length` 만으로 만든 열쇠는 **여기서** 죽는다(02a2 §5-1 실측): 개수만 보면
    //    A(2)→DROPPED(1)→MOVED(2) 까지는 매번 열쇠가 바뀌어 ③④ 를 통과하지만, 마지막에
    //    `PINS_A`(2개)로 돌아올 때 직전 열쇠와 같아 remount 가 안 일어나고 문서가 MOVED 로 남는다.
    rerender(<MustVisitPickerScreen view={LISTED} pins={PINS_A} />);
    expect(mapHtml()).toBe(htmlA);

    // ⑥ 지도는 언제나 한 벌이다 — 두 벌을 그려 놓고 통과하는 길을 막는다.
    expect(screen.getAllByTestId('map-webview')).toHaveLength(1);
  });
});
