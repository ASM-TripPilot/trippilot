import type { ReactTestInstance } from 'react-test-renderer';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { MapPin } from '@/shared/map';

// 색 계열 목록을 손으로 적으면 늙는다 — 디자인 토큰 정본에서 파생한다(`design-tokens.test.ts`
// 가 같은 방식으로 읽는 선례). 여기 새 `primary-*` 색이 생기면 아래 계열 판정이 자동으로 넓어진다.
import tailwindConfig from '../../../../tailwind.config.js';
import {
  MUST_VISIT_NAME_PLACEHOLDER,
  type MustVisitListItem,
  type MustVisitListView,
} from '../model/mustVisitList';
import { MustVisitPickerScreen } from './MustVisitPickerScreen';

/**
 * h02 필수 방문지(꼭 갈 곳) 화면의 **렌더 계약**(TRIP-785 재작성 — 옛 h05 프로즌 계약 개봉).
 * 화면은 완성된 `view` 만 받는다 — 조회도 조인도 하지 않는다(`features` 간 직접 import 는
 * ESLint 가 막고, 조합은 `pages` 층 몫이다).
 *
 * ── 이 티켓이 갈아엎는 것(삭제도 계약) ──────────────────────────────────────
 *  - **FIXED→ANYTIME 강등 확인 시트 제거**(Q2). `onDemote`/`demoteErrorText`/`onRetryDemote`
 *    prop 과 시트 렌더(`-demote`/`-cancel`/`-confirm`)가 사라진다. 옛 C28-④·C29 가 심판하던
 *    표면이라 부재 단언으로 남긴다.
 *  - **staleFailed AlertRow 렌더 제거**(Q3). `staleFailed` 는 model 유지(h03 소비 예정)이나
 *    이 화면은 `-stale-failed` 를 안 그린다. 옛 C23(AC-M1)이 지키던 그물 — 부재 단언으로 남긴다.
 *
 * ── 이 티켓이 새로 잠그는 것 ─────────────────────────────────────────────────
 *  - default(listed): 헤드라인 제목 숨김·건너뛰기 숨김·CTA 활성.
 *  - loading: 제목+서브카피 둘 다·지도 회색 스켈레톤·카드 스켈레톤 3장(원+사각+바2)·CTA 비활성.
 *  - error(failed): 제목+서브카피·건너뛰기 노출·카피 교정·빨강 아웃라인 다시 시도·상단 배지 없음.
 *  - 무회귀: 카드/칩/지도/no-coords/INV-3·INV-2 는 그대로 산다.
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에게는 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다.
 *
 * *(개념)* **판별 유니온(discriminated union)** — `view.kind` 하나로 "지금 어느 상태인가"를
 * 타입으로 못박은 값. 화면은 `view.kind` 를 보고 얼굴을 고른다.
 *
 * 3동작 뼈대: 준비=`view` 를 만들어 렌더 → 실행=사용자가 누른다 → 단언=보이는 것·불린 콜백.
 */

// 지도를 관찰 마커로 바꾼다. 실물 `MapView`(네이버 네이티브, TRIP-861)는 JS 키가 없는 jest
// 환경에서 무조건 `map-failure` 로 떨어져 `pins` 가 어디로도 흐르지 않는다 — 그래서 prop-기록형
// 목(`map-root` 에 좌표·핀을 노출)으로 대체해 "핀이 손대지 않은 채 지도에 도달한다"를 관찰한다.
// ⚠️ 구현이 `@/shared/map/MapView` 로 딥 임포트하면 이 목이 안 붙는다 —
//    `itineraryMustVisitStructure.test.ts` C39 가 배럴(`@/shared/map`) 경유를 따로 잠근다.
// (구 주석의 `KakaoMapView`·`MustVisitPickerScreen.map.test.tsx` 는 낡았다 — 카카오는 네이버로
//  전환됐고 그 별 지도 심판 파일은 리포에 실존한 적이 없다, repo-traps 참고.)
// 인라인 팩토리로 두면 NativeWind babel 의 `_ReactNativeCSSInterop` 참조가 jest 호이스트 규칙을
// 위반한다 — 그래서 모듈 스코프 파일을 require 한다(리포 선례와 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

/**
 * 카드 루트만 세는 셀렉터. 카드 testID 가 `itinerary-mustvisit-{sourcePoiId}` 로 동결돼
 * 있어 썸네일·칩·버튼·화면 크롬이 **같은 접두를 공유한다** — 제외하지 않으면 카드 3장이
 * 여러 장으로 잡힌다. 리포 선례(`stay-card-(?!save-|photo-)`)와 같은 형태이고, 이 제외기가
 * 실제로 카드만 세는지는 아래 D1 이 먼저 잠근다.
 *
 * 반환은 **testID 문자열 배열**이라 `toEqual([...])`·`toHaveLength(n)` 에 그대로 써도 안전하다
 * (원시값 직렬화 — 아래 `countTestId` 독주석의 노드 직렬화 함정과 무관).
 */
const CARD_SUB_PREFIXES = [
  'image-',
  'name-',
  'remove-',
  'edit-',
  'chip-',
  // `screen-` 은 화면 크롬 전부(앱바·지도·CTA·로딩 스켈레톤·에러 블록)를 가린다 —
  // 로딩 스켈레톤 leaf(`screen-card-skeleton`·`screen-skeleton-*`)도 이 접두라 카드로 안 세어진다.
  'screen-',
  // timeMode 칩(`itinerary-mustvisit-timemode-anytime-{id}`)의 꼬리는 위 어느 접두에도 안 걸린다.
  // 안 넣으면 카드 3장이 9장으로 잡혀 개수 단언이 전부 깨진다.
  'timemode-',
];

function cardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^itinerary-mustvisit-/)
    .map((node) => String(node.props.testID))
    .filter((testID) => {
      const tail = testID.slice('itinerary-mustvisit-'.length);
      return !CARD_SUB_PREFIXES.some((prefix) => tail.startsWith(prefix));
    });
}

/**
 * 노드 배열의 개수만 **숫자로** 뽑는다. `queryAllBy*` 결과(ReactTestInstance 배열)를 matcher 에
 * 그대로 넘기면(`expect(queryAll…).toEqual([])`·`.toHaveLength(n)`) 단언이 **실패할 때** jest 가
 * 실패 메시지를 만들며 노드를 pretty-format 으로 직렬화하는데, 노드의 부모/자식 순환 참조가
 * 스택을 터뜨린다(RNTL 13.3.3 실측 — red 부재/개수 단언이 SIGABRT 로 죽는다). test-designer 의
 * 단언은 애초에 red 로 시작하므로, 노드의 부재·개수는 **항상 `.length` 를 먼저 뽑아 숫자만
 * 비교한다**. 문자열 배열(`cardTestIds`·`brandTokensIn`)은 원시값이라 이 함정과 무관하다.
 */
function countTestId(matcher: string | RegExp): number {
  return screen.queryAllByTestId(matcher).length;
}
function countText(matcher: string | RegExp): number {
  return screen.queryAllByText(matcher).length;
}

/** 렌더된 텍스트 전부. 부정 스캔(INV-3)의 모집단이다 — 소스가 아니라 **보이는 글자**를 훑는다. */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

/** 소요시간 표기 탐지기. 시각(`13:00`)·날짜(`6.11`)를 오탐하지 않고, `시간 정해두기`(숫자 없음)도
 * 안 걸린다(`\d+\s*시간` 은 숫자를 요구 — 아래 자가검사가 실측한다). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 끝 시각 쌍(`13:00–14:30`류) 탐지기(INV-2). `–`·`~`·`-` 어느 구분자든 잡는다. */
const TIME_RANGE = /\d{1,2}:\d{2}\s*[–~-]\s*\d{1,2}:\d{2}/;

const INTRO_TITLE = '꼭 가고 싶은 곳을 먼저 담아요';
const INTRO_NOTE = 'AI가 시간·동선을 맞춰 배치해요';
const NO_COORDS_NOTE = '위치를 확인할 수 없어요';
const PROCEED_LABEL = '이 구성으로 일정 짜기';
const SKIP_LABEL = '건너뛰기';
// 카피 교정(값만) — 조회 실패 부제는 0곳 얼굴과 반드시 구분(정본 frontend-components L132).
const FAILED_TITLE = '담은 곳을 불러오지 못했어요';
const FAILED_NOTE = '네트워크를 확인하고 다시 시도해 주세요';
const RETRY_LABEL = '다시 시도';

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

const FIXED_A = item({
  sourcePoiId: 'poi-a',
  name: '부산시립미술관',
  imageUrl: 'https://img.example.com/a.jpg',
  type: 'FIXED',
  fixedDate: '2026-06-11',
  fixedStart: '13:00',
});
const ANYTIME_B = item({ sourcePoiId: 'poi-b', name: '해운대 블루라인파크' });
/** 담기를 푼 항목 — 조인으로 이름을 못 얻는다(BR-U1-04 · INV-U1-04 양방향 독립). */
const UNJOINED_Z = item({ sourcePoiId: 'poi-z', name: null });

function listed(
  items: MustVisitListItem[],
  staleFailed = false
): Extract<MustVisitListView, { kind: 'listed' }> {
  return { kind: 'listed', items, staleFailed };
}

/** 좌표가 다른 핀 3개. 번호는 **카드 번호** 이고 화면이 다시 매기지 않는다(BR-U1-51). */
const PIN_1: MapPin = { number: 1, lat: 35.1, lng: 129.1 };
const PIN_2: MapPin = { number: 2, lat: 35.2, lng: 129.2 };
const PIN_3: MapPin = { number: 3, lat: 35.3, lng: 129.3 };

/**
 * className 안에 그 토큰이 **정확히** 있는가. 토큰 경계(앞은 문자열 시작이거나 공백, 뒤는
 * 단어문자·하이픈이 아님)를 정규식으로 잡으므로 `bg-primary-pale` 은 `bg-primary` 로 안 센다.
 *
 * ⚠️ **긍정형 단언에만 써라.** "그 토큰이 있다"(`toBe(true)`)를 잴 때는 경계 정규식이 심판을
 * **조인다**. 그런데 **부정형(`toBe(false)`)에서는 정확히 반대로 심판을 푼다** — `bg-primary-pale`
 * 을 먹였을 때 순진한 `includes` 는 `true`(→ 부정 단언이 죽어 우회를 잡는다)인데 이 함수는
 * `false`(→ 통과)다. "브랜드색이 안 남았다" 류 부정 단언에는 아래 `brandTokensIn` 을 쓴다
 * (옛 TRIP-326 03b §1 실측 — 비활성 CTA 를 브랜드 빨강으로 칠해도 150건이 전부 초록이었다).
 *
 * *(개념)* **className** — NativeWind 가 쓰는 스타일 이름표. 이 환경에서는 렌더된 요소의 props
 * 에 문자열 그대로 남아 있어 **jest 가 색을 볼 수 있는 유일한 통로**다(`toHaveStyle` 은 못 쓴다).
 */
function hasToken(className: string, token: string): boolean {
  return new RegExp(`(^|\\s)${token}(?![\\w-])`).test(className);
}

/**
 * 브랜드 주색 **계열** 이름들. `tailwind.config.js`(= Figma 변수 컬렉션의 미러)에서 파생하므로
 * 색이 늘면 저절로 따라온다 — 손으로 적은 목록은 늙는다. 긴 이름을 앞에 둔다(가독성).
 */
const BRAND_COLORS = Object.keys(
  (
    tailwindConfig as unknown as {
      theme: { extend: { colors: Record<string, string> } };
    }
  ).theme.extend.colors
)
  .filter((name) => name === 'on-primary' || /^primary(-|$)/.test(name))
  .sort((a, b) => b.length - a.length);

/** `bg-primary-pale` · `text-on-primary` 처럼 **유틸리티 접두 + 브랜드 색 이름** 한 덩어리. */
const BRAND_TOKEN = new RegExp(`^[a-z]+-(?:${BRAND_COLORS.join('|')})$`);

/**
 * className 에 들어 있는 브랜드 주색 계열 토큰을 **전부** 돌려준다(문자열 배열). 부정 단언은
 * `toEqual([])` 로 쓴다 — "이 토큰 하나가 없다" 가 아니라 **"계열 전체가 없다"** 를 재므로
 * `bg-primary-pale`·`text-primary-text` 로 갈아타는 우회가 막힌다.
 */
function brandTokensIn(className: string): string[] {
  return className.split(/\s+/).filter((token) => BRAND_TOKEN.test(token));
}

/** 렌더된 요소의 className 문자열. 없으면 빈 문자열 — 부정 단언을 공짜로 통과시키는 것은 같은
 * it 안의 긍정 짝이 먼저 막는다. */
function classNameOf(node: ReactTestInstance): string {
  return String(node.props.className ?? '');
}

/** 조상을 거슬러 올라가 스크롤 영역 안에 있는가. React 의 위치 정보는 props 에 안 실리므로
 * 렌더 트리의 **조상 host 타입**으로만 잴 수 있다(`RCTScrollView`). */
const SCROLL_HOST_TYPE = 'RCTScrollView';

function isInsideScroll(node: ReactTestInstance): boolean {
  let cursor: ReactTestInstance | null = node.parent;
  while (cursor !== null) {
    if (String(cursor.type) === SCROLL_HOST_TYPE) return true;
    cursor = cursor.parent;
  }
  return false;
}

/** 한 노드 서브트리 안의 className 문자열(문자열 배열이라 matcher 에 안전). "배지가 없다" 류
 * 렌더층 부재 단언에 쓴다. */
function classNamesUnder(root: ReactTestInstance): string[] {
  return root
    .findAll(() => true)
    .map((node) => String(node.props?.className ?? ''))
    .filter((className) => className.length > 0);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 탐지기 자가검사 — 이게 통과해야 아래 개수·부재·위치 단언이 의미를 갖는다.
 * ──────────────────────────────────────────────────────────────────────────── */

describe('D1 · 탐지기 자가검사 — 카드 세는 셀렉터가 썸네일·칩·크롬을 삼키지 않는다', () => {
  it('카드만 정확히 셋이고, 제외 대상은 실재하는데 안 섞인다', () => {
    render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])} />
    );

    // 카드만 정확히 셋. 완전 일치라 하나라도 섞이면 여기서 먼저 죽는다.
    expect(cardTestIds()).toEqual([
      'itinerary-mustvisit-poi-a',
      'itinerary-mustvisit-poi-b',
      'itinerary-mustvisit-poi-z',
    ]);

    // 짝 — 제외 대상이 화면에 **실재하는데도** 위 목록에 안 섞였다.
    expect(
      screen.getByTestId('itinerary-mustvisit-image-poi-a')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    ).toBeOnTheScreen();
  });
});

describe('D2 · 탐지기 자가검사 — 브랜드 계열 판정이 무엇을 잡고 무엇을 안 잡는가', () => {
  it('계열은 정본 5개, 우회 두 개를 잡고 이웃은 안 삼킨다', () => {
    // ① 계열은 토큰 정본에서 파생한 정확히 다섯이다. 색이 늘면 이 기대값도 함께 고친다.
    expect([...BRAND_COLORS].sort()).toEqual([
      'on-primary',
      'primary',
      'primary-active',
      'primary-pale',
      'primary-text',
    ]);

    // ② 옛 TRIP-326 03b 가 실제로 심었던 우회 두 개를 잡는다(1차 부정형 `hasToken` 은 놓쳤다).
    expect(
      brandTokensIn('w-full rounded-button py-lg bg-primary-pale')
    ).toEqual(['bg-primary-pale']);
    expect(
      brandTokensIn('font-noto-bold text-[16px] font-bold text-primary-text')
    ).toEqual(['text-primary-text']);

    // ③ 현행 비활성 색은 계열 밖이다(= 지금 구현이 옳다는 짝).
    expect(brandTokensIn('rounded-button py-lg bg-hairline-strong')).toEqual(
      []
    );
    // ④ 이름이 겹치는 이웃까지 삼키지 않는다 — `^…$` 로 조각 전체를 대조하기 때문이다.
    expect(brandTokensIn('bg-primaryish text-primary-textual')).toEqual([]);
    // ⑤ className 이 아예 없는 노드(빈 문자열)도 `[]` 다 → 부정 단언만으로는 공허하다는 근거.
    expect(brandTokensIn('')).toEqual([]);
    // ⑥ hasToken 은 긍정형에서 경계를 조인다(부정형에는 쓰지 마라 — 독주석).
    expect(hasToken('rounded-pill bg-primary-pale', 'bg-primary')).toBe(false);
    expect(hasToken('rounded-button bg-primary py-lg', 'bg-primary')).toBe(
      true
    );
  });
});

describe('D3 · 탐지기 자가검사 — 스크롤 판정·소요시간 탐지기가 옳게 가른다', () => {
  it('뒤로 버튼은 스크롤 밖, 카드는 스크롤 안이다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);
    // RN 내부 host 이름이 바뀌면 이 두 줄이 함께 죽어 "AC 위반" 이 아니라 "탐지기 노후" 임이 보인다.
    expect(
      isInsideScroll(screen.getByTestId('itinerary-mustvisit-screen-back'))
    ).toBe(false);
    expect(
      isInsideScroll(screen.getByTestId('itinerary-mustvisit-poi-a'))
    ).toBe(true);
  });

  it('DURATION_TEXT 는 시각·`시간 정해두기` 를 오탐하지 않는다', () => {
    // 이 자가검사가 없으면 AC-16 의 부정 단언이 무엇을 재는지 모른다(옛 C32-b 실측을 코드로 고정).
    expect(DURATION_TEXT.test('13:00')).toBe(false);
    expect(DURATION_TEXT.test('시간 정해두기')).toBe(false);
    expect(DURATION_TEXT.test('90분')).toBe(true);
    expect(DURATION_TEXT.test('1시간 30분')).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * default (view.kind === 'listed')
 * ──────────────────────────────────────────────────────────────────────────── */

describe('C17 · 무회귀 — 목록이 뜨고 이름·사진이 채워진다', () => {
  it('카드 3장에 장소명·썸네일이 붙고, trip-wizard 계열 testID 는 0건이다', () => {
    render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])} />
    );

    expect(cardTestIds()).toHaveLength(3);
    // `toHaveTextContent(문자열)` 은 **완전 일치**다(02a §5 실검증) — 이 한 줄이 문구 전체를 잠근다.
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-a')
    ).toHaveTextContent('부산시립미술관');
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-b')
    ).toHaveTextContent('해운대 블루라인파크');
    expect(
      screen.getByTestId('itinerary-mustvisit-image-poi-a')
    ).toBeOnTheScreen();

    // G-U3-4 — U1 위저드의 셀렉터를 재사용하면 위반이다(화면이 달라 충돌한다).
    expect(countTestId(/^trip-wizard-/)).toBe(0);
  });
});

describe('C18 · 무회귀 — 조인 실패 항목을 숨기지 않는다 (INV-4 · BR-U1-55)', () => {
  it('이름을 못 얻은 항목이 목록에 남고 명시적 플레이스홀더가 보인다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, UNJOINED_Z])} />);

    expect(screen.getByTestId('itinerary-mustvisit-poi-z')).toBeOnTheScreen();
    const name = screen.getByTestId('itinerary-mustvisit-name-poi-z');
    expect(name).toHaveTextContent(MUST_VISIT_NAME_PLACEHOLDER);
    expect(name).not.toHaveTextContent(/poi-z/);
  });
});

describe('C19 · 무회귀 — 칩 개수가 type 을 드러내고 끝 시각은 안 그린다 (US-TRIP-09 · INV-2·INV-3)', () => {
  it('FIXED 는 고정 칩 하나+시작 시각, ANYTIME 은 필수 칩 하나뿐', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    const fixedCard = screen.getByTestId('itinerary-mustvisit-poi-a');
    const anytimeCard = screen.getByTestId('itinerary-mustvisit-poi-b');

    expect(
      within(fixedCard).queryAllByTestId(/^itinerary-mustvisit-chip-/)
    ).toHaveLength(1);
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toHaveTextContent('고정');
    expect(
      within(anytimeCard).queryAllByTestId(/^itinerary-mustvisit-chip-/)
    ).toHaveLength(1);
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-must-poi-b')
    ).toHaveTextContent('필수');

    // 고정 블록은 시작 시각을 보여준다(BR-U3-07 예외 — `fixedStart` 는 사용자 입력이라 INV-2 와 무충돌).
    expect(fixedCard).toHaveTextContent(/13:00/);
    expect(anytimeCard).not.toHaveTextContent(/\d{1,2}:\d{2}/);
  });

  it('C19-c 끝 시각을 그리지 않는다 — 시작 시각 하나만 낸다 (INV-3 · INV-2)', () => {
    render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])} />
    );

    const fixedCard = screen.getByTestId('itinerary-mustvisit-poi-a');
    // 긍정 앵커 — 시작 시각은 보인다(없으면 "시각을 아예 안 그리는" 화면이 공짜 통과).
    expect(fixedCard).toHaveTextContent(/13:00/);
    // 부정 — `toHaveTextContent` 는 자손 텍스트를 구분자 없이 이어 붙여 비교하므로 쪼개 그려도 잡힌다.
    ['poi-a', 'poi-b', 'poi-z'].forEach((id) =>
      expect(
        screen.getByTestId(`itinerary-mustvisit-${id}`)
      ).not.toHaveTextContent(TIME_RANGE)
    );
  });
});

describe('C21 · 무회귀 — 카드 본문은 시각 지정으로, ✕는 해제로 간다', () => {
  it('카드를 누르면 sourcePoiId 가, ✕를 누르면 두 id 가 함께 넘어간다', () => {
    const onPressItem = jest.fn();
    const onRemove = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        onPressItem={onPressItem}
        onRemove={onRemove}
      />
    );

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-poi-b'));
    expect(onPressItem).toHaveBeenCalledWith('poi-b');
    expect(onPressItem).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('itinerary-mustvisit-remove-poi-b'));
    expect(onRemove).toHaveBeenCalledWith({
      mustVisitId: 'mv-poi-b',
      sourcePoiId: 'poi-b',
    });
  });

  it('C21-b 우측 아이콘이 항목 종류에 따라 다르다 (FIXED=연필, ANYTIME=✕)', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);
    expect(
      screen.getByTestId('itinerary-mustvisit-edit-poi-a')
    ).toBeOnTheScreen();
    expect(countTestId('itinerary-mustvisit-remove-poi-a')).toBe(0);
    expect(
      screen.getByTestId('itinerary-mustvisit-remove-poi-b')
    ).toBeOnTheScreen();
    expect(countTestId('itinerary-mustvisit-edit-poi-b')).toBe(0);
  });
});

describe('C24 · 무회귀 — 받은 핀을 그대로 지도에 넘긴다', () => {
  it('지도 카드가 서고, 핀 배열이 손대지 않은 채 지도에 도달한다', () => {
    const pins = [PIN_1, PIN_2, PIN_3];
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])}
        pins={pins}
      />
    );

    expect(
      screen.getByTestId('itinerary-mustvisit-screen-map')
    ).toBeOnTheScreen();
    // 완전 일치 — 화면이 번호를 다시 매기거나 좌표를 걸러내면 여기서 죽는다.
    // (`pins` 는 plain 객체 배열이라 노드 직렬화 함정과 무관 — `toEqual` 안전.)
    expect(screen.getByTestId('map-root').props.pins).toEqual(pins);
    expect(cardTestIds()).toHaveLength(3);
  });
});

describe('C25 · 무회귀 — 핀이 없는 항목이 그 사실을 글자로 말한다 (BR-U1-55)', () => {
  it('카드는 3장 그대로고, 핀 없는 그 카드에만 위치 안내가 붙는다', () => {
    // 가운데 항목(poi-z)만 좌표를 못 얻어 핀 번호가 ①③ 으로 뛴다(번호를 당기지 않는다).
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, UNJOINED_Z, ANYTIME_B])}
        pins={[PIN_1, PIN_3]}
      />
    );

    expect(cardTestIds()).toHaveLength(3);
    expect(screen.getByTestId('map-root').props.pins).toEqual([PIN_1, PIN_3]);

    expect(
      within(screen.getByTestId('itinerary-mustvisit-poi-z')).getByText(
        NO_COORDS_NOTE
      )
    ).toBeOnTheScreen();
    // 짝 — 핀이 있는 카드에는 안 붙는다(모든 카드에 붙이는 구현을 죽인다).
    expect(
      within(screen.getByTestId('itinerary-mustvisit-poi-a')).queryAllByText(
        NO_COORDS_NOTE
      )
    ).toHaveLength(0);
  });
});

describe('C26 · 무회귀 — 지도 카드를 안 그리는 세 자리', () => {
  it('핀이 있으면 그리고, 핀 0개·empty·failed 에서는 안 그린다', () => {
    const { rerender } = render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        pins={[PIN_1, PIN_2]}
      />
    );
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();

    // 항목은 있는데 좌표를 가진 것이 하나도 없다 — 지도 카드를 통째로 안 그린다.
    rerender(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} pins={[]} />
    );
    expect(countTestId('itinerary-mustvisit-screen-map')).toBe(0);
    expect(countTestId('map-root')).toBe(0);

    // 빈 목록·조회 실패 얼굴에는 핀을 넘겨도 지도가 없다(얼굴이 핀보다 세다).
    rerender(
      <MustVisitPickerScreen view={{ kind: 'empty' }} pins={[PIN_1, PIN_2]} />
    );
    expect(countTestId('map-root')).toBe(0);
    rerender(
      <MustVisitPickerScreen view={{ kind: 'failed' }} pins={[PIN_1, PIN_2]} />
    );
    expect(countTestId('map-root')).toBe(0);
  });
});

describe('C27 · 무회귀 — timeMode 칩 두 개가 현재 type 을 드러낸다 (Q1 칩 렌더 유지)', () => {
  it('선택 상태가 접근성 상태로 갈리고, 색 토큰도 함께 갈린다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    const fixedOn = screen.getByTestId(
      'itinerary-mustvisit-timemode-fixed-poi-a'
    );
    const fixedOff = screen.getByTestId(
      'itinerary-mustvisit-timemode-anytime-poi-a'
    );

    // ① 접근성 상태 — 색만으로 구분하면 jest 가 못 본다. 상태를 값으로도 남긴다.
    expect(fixedOn.props.accessibilityState?.selected).toBe(true);
    expect(fixedOff.props.accessibilityState?.selected).toBe(false);

    // ② 색 축(on=`primary-pale`, off=`surface-strong`) — 긍정·부정이 짝을 이룬 토큰 지정이라
    //    경계 정규식이 옳게 조인다(부정형 하나만 세우는 자리에는 hasToken 을 쓰면 안 된다).
    expect(hasToken(classNameOf(fixedOn), 'bg-primary-pale')).toBe(true);
    expect(hasToken(classNameOf(fixedOn), 'bg-surface-strong')).toBe(false);
    expect(hasToken(classNameOf(fixedOff), 'bg-surface-strong')).toBe(true);
    expect(hasToken(classNameOf(fixedOff), 'bg-primary-pale')).toBe(false);

    // ③ 라벨은 스토리 어휘 그대로다(US-TRIP-08).
    expect(within(fixedOn).getByText('시간 정해두기')).toBeOnTheScreen();
    expect(within(fixedOff).getByText('아무 때나')).toBeOnTheScreen();
  });
});

describe('🔴 C-AC1 · AC-1 — listed 에서 헤드라인 제목을 숨기고 서브카피만 남긴다', () => {
  it('제목은 안 보이고 서브카피는 보인다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);
    // 🔴 현재는 제목이 항상 표시된다 — 이 줄이 red 를 만든다.
    expect(countText(INTRO_TITLE)).toBe(0);
    // 짝 — 서브카피는 남는다(제목만 지우고 서브카피까지 지우는 구현을 죽인다).
    expect(screen.getByText(INTRO_NOTE)).toBeOnTheScreen();
  });
});

describe('🔴 C-AC2 · AC-2 — listed 에서 건너뛰기를 숨긴다', () => {
  it('앱바 건너뛰기가 렌더되지 않는다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);
    // 🔴 현재는 skip 이 항상 렌더된다.
    expect(countTestId('itinerary-mustvisit-screen-skip')).toBe(0);
  });
});

describe('C-AC3 · AC-3 — listed CTA 가 활성이고 press 시 onProceed 1회', () => {
  it('CTA 가 브랜드 배경으로 활성이고 스크롤 흐름 안에 있으며 눌리면 onProceed 1회', () => {
    const onProceed = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        onProceed={onProceed}
      />
    );

    const proceed = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    expect(proceed).not.toBeDisabled();
    // 활성은 Figma `ctaPrimary` 그대로 배경 `primary`(하단 고정 바가 아니라 스크롤 흐름 안).
    expect(hasToken(classNameOf(proceed), 'bg-primary')).toBe(true);
    expect(isInsideScroll(proceed)).toBe(true);
    expect(within(proceed).getByText(PROCEED_LABEL)).toBeOnTheScreen();

    fireEvent.press(proceed);
    expect(onProceed).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 C-AC4 · AC-4 — 강등 확인 시트가 어떤 조작으로도 뜨지 않는다', () => {
  it('처음에도 없고, FIXED 카드의 `아무 때나` 를 눌러도 안 뜬다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    // ① 처음부터 시트가 없다(삭제도 계약 — 옛 C28·C29 가 심판하던 표면).
    expect(countTestId('itinerary-mustvisit-screen-demote')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-demote-confirm')).toBe(0);

    // ② 🔴 FIXED 의 `아무 때나` 를 눌러도 강등 확인 시트가 뜨지 않는다(Q1 표시 전용).
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    );
    expect(countTestId('itinerary-mustvisit-screen-demote')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-demote-cancel')).toBe(0);
  });
});

describe('🔴 C-AC5 · AC-5 — staleFailed 여도 AlertRow 를 안 그린다 (Q3 · 카드는 그대로)', () => {
  it('staleFailed=true 인 listed 에서 stale AlertRow 가 없고 카드 3장은 살아 있다', () => {
    const onRetry = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z], true)}
        onRetry={onRetry}
      />
    );

    // 🔴 model 은 staleFailed 를 유지하지만(h03 소비 예정) 이 화면은 AlertRow 를 안 그린다.
    expect(countTestId('itinerary-mustvisit-screen-stale-failed')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-stale-retry')).toBe(0);

    // 짝 — 목록은 지워지지 않는다(전면 실패·로딩 얼굴로 갈아 끼우지도 않는다).
    expect(cardTestIds()).toHaveLength(3);
    expect(countTestId('itinerary-mustvisit-screen-failed')).toBe(0);
    expect(countTestId('itinerary-mustvisit-screen-loading')).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * loading (view.kind === 'loading')
 * ──────────────────────────────────────────────────────────────────────────── */

describe('C-AC6 · AC-6 — loading 에서 제목+서브카피가 둘 다 보인다', () => {
  it('헤드라인 제목과 서브카피가 함께 뜬다 (default 와 반대)', () => {
    render(<MustVisitPickerScreen view={{ kind: 'loading' }} />);
    expect(screen.getByText(INTRO_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(INTRO_NOTE)).toBeOnTheScreen();
  });
});

describe('🔴 C-AC7 · AC-7 — loading 에서 지도 자리 회색 스켈레톤이 보인다', () => {
  it('전용 스켈레톤 testID 가 뜨고, 실지도는 안 뜬다 (재마운트 아님)', () => {
    render(<MustVisitPickerScreen view={{ kind: 'loading' }} />);
    // 🔴 신규 testID — 현재는 부재라 red.
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-map-skeleton')
    ).toBeOnTheScreen();
    // 짝 — loading 은 `mapPins=[]` 라 실지도(`map-root`)가 없다. 실지도를 회색으로 위장하는 우회 차단.
    expect(countTestId('map-root')).toBe(0);
  });
});

describe('🔴 C-AC8 · AC-8 — loading 카드 스켈레톤 3장, 각 내부 = 원+사각+바2', () => {
  it('스켈레톤 개수와 카드별 내부 구조를 개수로 잠근다 (단일 회색 사각 거짓통과 차단)', () => {
    render(<MustVisitPickerScreen view={{ kind: 'loading' }} />);

    // 🔴 전역 개수 — 같은 testID 다중 반환은 완전일치 매칭이다(02a §5 실검증). 숫자로만 비교한다.
    const cards = screen.queryAllByTestId(
      'itinerary-mustvisit-screen-card-skeleton'
    );
    expect(cards.length).toBe(3);
    expect(countTestId('itinerary-mustvisit-screen-skeleton-thumb')).toBe(3);
    expect(countTestId('itinerary-mustvisit-screen-skeleton-box')).toBe(3);
    expect(countTestId('itinerary-mustvisit-screen-skeleton-bar')).toBe(6);

    // 🔴 카드별 내부 구조 — 첫 카드 안에 원 1·사각 1·바 2. 개수만으로는 "바 6개가 한 카드에
    //    몰려도" 통과하므로 within 으로 카드 단위 구조를 못박는다(진행점 fill 함정 계열).
    //    위 `cards.length===3` 이 먼저 통과해야 여기 닿는다(red 면 그 줄에서 멈춘다).
    const first = cards[0];
    expect(
      within(first).queryAllByTestId(
        'itinerary-mustvisit-screen-skeleton-thumb'
      )
    ).toHaveLength(1);
    expect(
      within(first).queryAllByTestId('itinerary-mustvisit-screen-skeleton-box')
    ).toHaveLength(1);
    expect(
      within(first).queryAllByTestId('itinerary-mustvisit-screen-skeleton-bar')
    ).toHaveLength(2);

    // 짝 — 스켈레톤은 카드로 세어지지 않는다(실제 카드 0장).
    expect(cardTestIds()).toEqual([]);
  });
});

describe('🔴 C-AC9 · AC-9 — loading CTA 가 view.kind 기반으로 비활성이다', () => {
  it('proceedBlockedReason 없이도 loading 이면 CTA 가 비활성이다', () => {
    // 🔴 proceedBlockedReason 을 넘기지 않는다 — 현재 구현은 그 prop 만 봐서 활성 → red.
    render(<MustVisitPickerScreen view={{ kind: 'loading' }} />);
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-proceed')
    ).toBeDisabled();
  });
});

describe('🔴 C-AC10 · AC-10 — loading 에서 건너뛰기를 숨긴다', () => {
  it('앱바 건너뛰기가 렌더되지 않는다', () => {
    render(<MustVisitPickerScreen view={{ kind: 'loading' }} />);
    expect(countTestId('itinerary-mustvisit-screen-skip')).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * error (view.kind === 'failed')
 * ──────────────────────────────────────────────────────────────────────────── */

describe('C-AC11 · AC-11 — failed 에서 제목+서브카피가 둘 다 보인다', () => {
  it('헤드라인 제목과 서브카피가 함께 뜬다', () => {
    render(<MustVisitPickerScreen view={{ kind: 'failed' }} />);
    expect(screen.getByText(INTRO_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(INTRO_NOTE)).toBeOnTheScreen();
  });
});

describe('C-AC12 · AC-12 — failed 에서만 건너뛰기가 앱바에 노출된다', () => {
  it('건너뛰기가 보이고 스크롤 밖(앱바)에 있다', () => {
    render(<MustVisitPickerScreen view={{ kind: 'failed' }} />);
    const skip = screen.getByTestId('itinerary-mustvisit-screen-skip');
    expect(skip).toBeOnTheScreen();
    expect(isInsideScroll(skip)).toBe(false);
    expect(within(skip).getByText(SKIP_LABEL)).toBeOnTheScreen();
  });
});

describe('🔴 C-AC13 · AC-13 — 에러 카피가 정본대로 정확히 보인다 (띄어쓰기 포함)', () => {
  it('제목·부제가 완전일치로 뜬다', () => {
    render(<MustVisitPickerScreen view={{ kind: 'failed' }} />);
    // 🔴 `getByText(문자열)` 은 완전일치다(02a §5). 현재 값은 `목록을…`/`…시도해주세요` → red.
    //    leaf 에 걸어야 정확일치가 성립한다(부모는 title+subtitle 이 이어붙어 어느 것도 불일치).
    expect(screen.getByText(FAILED_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(FAILED_NOTE)).toBeOnTheScreen();
  });
});

describe('🔴 C-AC14 · AC-14 — 다시 시도는 빨강 아웃라인이고 상단 배지 아이콘이 없다', () => {
  it('press 시 onRetry 1회, 버튼에 빨강 토큰, 실패 블록에 원형 배지가 없다', () => {
    const onRetry = jest.fn();
    render(
      <MustVisitPickerScreen view={{ kind: 'failed' }} onRetry={onRetry} />
    );

    const retry = screen.getByTestId('itinerary-mustvisit-screen-retry');
    fireEvent.press(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // 🔴 빨강 테두리·빨강 글자 pill(현재는 StateNotice outline = 회색 테두리·ink 글자 → red).
    expect(hasToken(classNameOf(retry), 'border-primary')).toBe(true);
    expect(
      hasToken(
        classNameOf(within(retry).getByText(RETRY_LABEL)),
        'text-primary'
      )
    ).toBe(true);

    // 🔴 상단 원형 배지(StateNotice 의 `bg-primary-pale` 72px 원)가 없다 — 로컬 블록이라 배지 없음.
    //    글리프(AlertCircleGlyph) 자체의 부재는 itineraryMustVisitStructure C41(소스)이 잠근다
    //    (SVG 는 className/testID sink 라 렌더가 못 본다). 여기 배열은 문자열이라 toEqual 안전.
    const failed = screen.getByTestId('itinerary-mustvisit-screen-failed');
    expect(
      classNamesUnder(failed).filter((cls) => hasToken(cls, 'bg-primary-pale'))
    ).toEqual([]);
  });
});

describe('🔴 C-AC15 · AC-15 — failed 에서 카드 0장, CTA 비활성', () => {
  it('본문 카드가 없고 CTA 가 비활성이다', () => {
    render(<MustVisitPickerScreen view={{ kind: 'failed' }} />);
    expect(cardTestIds()).toEqual([]);
    // 짝 — 실패 블록은 뜬다(공허 통과 방지).
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-failed')
    ).toBeOnTheScreen();
    // 🔴 view.kind 기반 비활성.
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-proceed')
    ).toBeDisabled();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * empty (Q4 무변경 — 최소 무회귀)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('C-empty · 무회귀 — empty 얼굴은 손대지 않는다 (Q4)', () => {
  it('empty StateNotice 가 뜨고 카드 0장·재시도 없음·지도 없음', () => {
    render(<MustVisitPickerScreen view={{ kind: 'empty' }} />);
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-empty')
    ).toBeOnTheScreen();
    expect(cardTestIds()).toEqual([]);
    // 정말 없는 것에는 다시 시도할 것이 없다(못 불러온 것과 다른 사실).
    expect(countTestId('itinerary-mustvisit-screen-retry')).toBe(0);
    expect(countTestId('map-root')).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * 무회귀 (INV) — AC-16 · AC-17
 * ──────────────────────────────────────────────────────────────────────────── */

describe('C-AC16 · AC-16 — 세 얼굴 전부에서 소요시간·끝 시각이 0건이다 (INV-3 · INV-2)', () => {
  it('신규 표면(로딩 스켈레톤·에러 블록)까지 켠 채로도 0건', () => {
    // listed 최대 표면 — 지도·CTA·staleFailed·핀이 한 번에 보이는 화면.
    const { rerender } = render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z], true)}
        pins={[PIN_1, PIN_3]}
      />
    );
    // 긍정 앵커 — 문구가 실제로 있다(없으면 아래 부정 단언이 공허하다).
    let texts = renderedTexts();
    expect(texts).toContain(PROCEED_LABEL);
    expect(texts.some((text) => text.includes('13:00'))).toBe(true);
    // INV-3 — 소요시간 표기 0건.
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);
    // INV-2 — 각 카드 끝 시각 쌍 0건.
    ['poi-a', 'poi-b', 'poi-z'].forEach((id) =>
      expect(
        screen.getByTestId(`itinerary-mustvisit-${id}`)
      ).not.toHaveTextContent(TIME_RANGE)
    );

    // loading — 신규 스켈레톤 표면.
    rerender(<MustVisitPickerScreen view={{ kind: 'loading' }} />);
    texts = renderedTexts();
    expect(texts).toContain(INTRO_TITLE); // 긍정 앵커
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);

    // failed — 신규 로컬 에러 블록 표면. 앵커는 카피 교정과 무관한 `다시 시도`(항상 present)로
    // 둔다 — FAILED_TITLE 로 두면 이 무회귀 넷이 AC-13(카피)에 커플링돼 선제green 이 안 된다.
    rerender(<MustVisitPickerScreen view={{ kind: 'failed' }} />);
    texts = renderedTexts();
    expect(texts).toContain(RETRY_LABEL); // 긍정 앵커
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);
  });
});

describe('🔴 C-AC17 · AC-17 — 비활성 CTA 가 브랜드 주색으로 칠해지지 않는다', () => {
  /**
   * ⚠️ jest 의 `toBeDisabled` 는 접근성 상태만 읽고 색은 안 본다. 옛 TRIP-225 에서 차단 CTA 가
   * 브랜드 빨강을 `disabled` 와 무관하게 걸어 "빨간 활성 버튼처럼 보이는데 안 눌리는" 상태가
   * 실기에서야 발견됐다. 그래서 **계열 전체가 0개**(`brandTokensIn`===[])로 잰다 — `bg-primary`
   * 를 `bg-primary-pale` 로 갈아타는 우회를 막는다. 눈에 보이는 대비는 [검증]의 스크린샷 몫이다.
   */
  it('활성 CTA 엔 브랜드색이 있고, loading·failed 비활성 CTA 엔 계열 전체가 0개다', () => {
    // ① 활성 앵커 — 탐지기가 실제로 무언가를 찾을 줄 안다는 증거(공허 통과 방지).
    const { rerender } = render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />
    );
    const activeCta = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    expect(brandTokensIn(classNameOf(activeCta))).toEqual(['bg-primary']);
    expect(
      brandTokensIn(classNameOf(within(activeCta).getByText(PROCEED_LABEL)))
    ).toEqual(['text-on-primary']);

    // ② 🔴 loading 비활성 CTA — 배경·라벨 모두 브랜드 계열 0개.
    rerender(<MustVisitPickerScreen view={{ kind: 'loading' }} />);
    let blocked = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    expect(brandTokensIn(classNameOf(blocked))).toEqual([]);
    expect(
      brandTokensIn(classNameOf(within(blocked).getByText(PROCEED_LABEL)))
    ).toEqual([]);

    // ③ 🔴 failed 비활성 CTA — 같은 계약. (retry 버튼은 별 testID 라 이 CTA 스캔에 안 섞인다.)
    rerender(<MustVisitPickerScreen view={{ kind: 'failed' }} />);
    blocked = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    expect(brandTokensIn(classNameOf(blocked))).toEqual([]);
    expect(
      brandTokensIn(classNameOf(within(blocked).getByText(PROCEED_LABEL)))
    ).toEqual([]);
  });
});
