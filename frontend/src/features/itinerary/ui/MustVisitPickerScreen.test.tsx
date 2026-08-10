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
 * h05 필수 방문지 목록 화면의 **렌더 계약**. 화면은 완성된 `view` 만 받는다 — 조회도 조인도
 * 하지 않는다(`features` 간 직접 import 는 ESLint 가 막고, 조합은 `pages` 층 몫이다).
 *
 * 무엇을 보장하나:
 *  - 항목마다 `itinerary-mustvisit-{sourcePoiId}` testID 가 붙고 **`trip-wizard-` 계열을
 *    재사용하지 않는다**(G-U3-4 — 화면이 달라 셀렉터가 충돌한다).
 *  - 이름을 못 얻은 항목을 **숨기지 않고** 명시적 플레이스홀더로 드러낸다(AC-3 · 사용자 동결).
 *  - `FIXED` 는 칩 2개(`고정`+`시각 고정`) · `ANYTIME` 은 1개(`필수`) — 고정/필수와 AI 추천을
 *    시각적으로 구분한다(US-TRIP-09 · AC-V2).
 *  - **이미 도착한 목록이 실패 표시와 함께 산다**(AC-M1 · 문제로그 2026-08-04 · 이 계열 화면
 *    세 번째).
 *  - 소요시간 문자열이 한 개도 안 보인다(AC-9 · INV-3).
 *
 * *(개념)* **testID** — 화면 요소에 붙이는 테스트 전용 이름표. 사용자에게는 안 보이고, 테스트가
 * "그 요소"를 정확히 집어 오는 손잡이다.
 *
 * 3동작 뼈대: 준비=`view` 를 만들어 렌더 → 실행=사용자가 누른다 → 단언=보이는 것·불린 콜백.
 *
 * ── TRIP-326 추가분 (지도 카드 · timeMode 셀렉터 · CTA/건너뛰기) ──────────────
 *  - 받은 핀을 **그대로** 지도에 넘긴다(AC-1). 좌표를 못 얻은 항목은 카드에 남되 그 사실을
 *    글자로 말한다(AC-2) — 핀 수와 목록 수가 다른 이유가 화면에 드러나야 한다.
 *  - `시각 고정` 단일 칩이 사라지고 `아무 때나 / 시간 정해두기` 두 칩이 그 자리를 대신한다
 *    (AC-11 · AC-7). **자물쇠 `고정` 칩은 남는다** — 개수만 줄지 보장이 사라지지 않는다.
 *  - FIXED → ANYTIME 강등은 **확인 시트를 거쳐야** 나간다(AC-9 · 01b D1) — 사용자가 입력한
 *    날짜·시각을 잃는 방향이라 무엇을 잃는지 말할 자리가 필요하다.
 *  - CTA·건너뛰기는 비활성이되 **사유를 함께** 낸다(AC-14). 그리고 비활성일 때 **색 토큰이
 *    활성과 다르다**(AC-15) — 접근성 상태만으로는 "빨간 활성 버튼처럼 보이는데 안 눌리는"
 *    상태를 아무도 못 본다(문제로그 2026-08-08 · 미해결).
 */

// 지도를 관찰 마커로 바꾼다(`DraftScreen.test.tsx` 와 같은 형태). 실물 `KakaoMapView` 는 JS 키가
// 없는 jest 환경에서 무조건 `map-failure` 로 떨어져 `pins` 가 어디로도 흐르지 않는다.
// ⚠️ **실물 지도를 태우는 심판은 이 파일이 아니라 `MustVisitPickerScreen.map.test.tsx` 다**
//    (AC-6) — 목은 마운트·리렌더까지 통짜로 대체해서 `source.html` 동결 계약을 **반대로**
//    흉내 낸다(02a ★3 · 문제로그 2026-08-02).
// ⚠️ 구현이 `@/shared/map/KakaoMapView` 로 딥 임포트하면 이 목이 안 붙는다 —
//    `itineraryMustVisitStructure.test.ts` C39 가 배럴 경유를 따로 잠근다(02a ★11).
// 인라인 팩토리로 두면 NativeWind babel 의 `_ReactNativeCSSInterop` 참조가 jest 호이스트 규칙을
// 위반한다 — 그래서 모듈 스코프 파일을 require 한다(리포 선례와 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

/**
 * 카드 루트만 세는 셀렉터. 카드 testID 가 `itinerary-mustvisit-{sourcePoiId}` 로 동결돼
 * 있어(D11) 썸네일·칩·버튼·화면 크롬이 **같은 접두를 공유한다** — 제외하지 않으면 카드 3장이
 * 11장으로 잡힌다. 리포 선례(`stay-card-(?!save-|photo-)`)와 같은 형태이고, 이 제외기가 실제로
 * 카드만 세는지는 아래 C16 이 먼저 잠근다.
 *
 * ⚠️ `queryAllByTestId` 를 쓴다 — `getAllByTestId` 는 무매칭 시 **throw** 라 "0장"을 잴 수 없다.
 */
const CARD_SUB_PREFIXES = [
  'image-',
  'name-',
  'remove-',
  'edit-',
  'chip-',
  'screen-',
  // 🔴 TRIP-326 — timeMode 칩(`itinerary-mustvisit-timemode-anytime-{id}`)의 꼬리는 위 어느
  // 접두에도 안 걸린다. 안 넣으면 카드 3장이 **9장**으로 잡혀 C16·C17·C22·C23 이 전부 깨진다
  // (02a §5-6 실측). D10 이 `-chip-` 접두를 피한 것과 **다른 함정**이다 — 그쪽은 C19 의 개수
  // 단언, 이쪽은 카드 세기다.
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

/** 소요시간 표기 탐지기. 시각(`13:00`)·날짜(`6.11 (목)`)를 오탐하지 않는 것을 실측했다(02a §5-1). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

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

describe('C16 · 탐지기 자가검사 — 이게 통과해야 아래 개수 단언이 의미를 갖는다', () => {
  it('카드 세는 셀렉터가 썸네일·칩·크롬을 삼키지 않는다', () => {
    render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])} />
    );

    // 카드만 정확히 셋. 완전 일치라 하나라도 섞이면 여기서 먼저 죽는다.
    expect(cardTestIds()).toEqual([
      'itinerary-mustvisit-poi-a',
      'itinerary-mustvisit-poi-b',
      'itinerary-mustvisit-poi-z',
    ]);

    // 짝 — 제외 대상이 화면에 **실재하는데도** 위 목록에 안 섞였다. 실재하지 않으면 제외기가
    // 옳은지 아무것도 증명하지 못한다.
    expect(
      screen.getByTestId('itinerary-mustvisit-image-poi-a')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-b')
    ).toBeOnTheScreen();
    // 🔴 TRIP-326 — timeMode 칩도 **실재하는데** 카드로 안 세어진다. 이 두 줄이 없으면
    // `timemode-` 제외기가 옳은지 아무것도 증명하지 못한다(02a ★1).
    expect(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('itinerary-mustvisit-timemode-fixed-poi-b')
    ).toBeOnTheScreen();
  });
});

describe('C17 · AC-1 · AC-2 · AC-V5 — 목록이 뜨고 이름·사진이 채워진다', () => {
  it('카드 3장에 장소명·썸네일이 붙고, trip-wizard 계열 testID 는 0건이다', () => {
    render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])} />
    );

    expect(cardTestIds()).toHaveLength(3);
    // `toHaveTextContent(문자열)` 은 **완전 일치**다(02a ★5 실측) — 이 한 줄이 문구 전체를 잠근다.
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-a')
    ).toHaveTextContent('부산시립미술관');
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-b')
    ).toHaveTextContent('해운대 블루라인파크');
    expect(
      screen.getByTestId('itinerary-mustvisit-image-poi-a')
    ).toBeOnTheScreen();

    // 🔴 G-U3-4 — U1 위저드의 셀렉터를 재사용하면 위반이다. 화면이 다르므로 충돌한다.
    expect(screen.queryAllByTestId(/^trip-wizard-/)).toEqual([]);
  });
});

describe('C18 · AC-3 — 조인 실패 항목을 숨기지 않는다 (사용자 동결 · INV-4 · BR-U1-55)', () => {
  it('이름을 못 얻은 항목이 목록에 남고 이름 자리에 명시적 플레이스홀더가 보인다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, UNJOINED_Z])} />);

    // 긍정 앵커 — 항목이 **여전히 목록에 있다**. 제외는 기각된 선택지다.
    expect(screen.getByTestId('itinerary-mustvisit-poi-z')).toBeOnTheScreen();

    const name = screen.getByTestId('itinerary-mustvisit-name-poi-z');
    expect(name).toHaveTextContent(MUST_VISIT_NAME_PLACEHOLDER);
    // 빈칸이 아니다 — 빈칸은 침묵 실패와 구별되지 않는다.
    expect(name).not.toHaveTextContent('');
    // 원시 id 를 그대로 노출하는 것도 설명이 아니다.
    expect(name).not.toHaveTextContent(/poi-z/);
  });
});

describe('C19 · AC-11 · AC-V2 · US-TRIP-09 · BR-U3-07 — 칩 개수가 type 을 드러낸다', () => {
  /**
   * ⚠️ **TRIP-326 개정 — 승인·동결분을 여는 계약 변경이다(구현 실패가 아니다).**
   * 원본은 "FIXED 카드에 `^itinerary-mustvisit-chip-` 칩이 **2개**(`고정` + `시각 고정`)" 를
   * 개수로 못 박고 `itinerary-mustvisit-chip-time-poi-a` 의 텍스트까지 봤다. AC-11 이
   * `시각 고정` 단일 칩을 없애므로(Figma 정본에서 timeMode 셀렉터가 그 자리를 대신한다) 그
   * 단언은 **어떤 구현으로도 성립할 수 없다.**
   *
   * 무엇을 놓아주고 무엇을 지키나:
   *  - 놓아준다: `chip-time-{id}` 라는 testID 하나와 그 칩의 개수.
   *  - **지킨다**: FIXED 카드에 자물쇠 `고정` 칩이 **여전히 있다**. 개수만 줄이고 보장을
   *    통째로 버리지 않는다 — 고정/필수와 AI 추천을 시각적으로 구분하는 것이 US-TRIP-09 다.
   *  - 새로 잠근다: 사라진 값이 **되살아나지 않는다**(아래 🔴 부재 단언 두 줄). 삭제도 계약이라
   *    "없어야 한다" 를 심판에 남기지 않으면 다음 사람이 조용히 되돌린다.
   *
   * 신규 timeMode 칩은 `-chip-` 접두를 **안 쓴다**(01b D10) — 쓰면 아래 개수 단언이 1→3 으로
   * 한 번 더 깨진다.
   */
  it('FIXED 는 고정 칩 하나와 시작 시각, ANYTIME 은 필수 칩 하나뿐이고 `시각 고정` 은 사라졌다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    const fixedCard = screen.getByTestId('itinerary-mustvisit-poi-a');
    const anytimeCard = screen.getByTestId('itinerary-mustvisit-poi-b');

    expect(
      within(fixedCard).queryAllByTestId(/^itinerary-mustvisit-chip-/)
    ).toHaveLength(1);
    // 유지 — 자물쇠 칩은 남는다.
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toHaveTextContent('고정');

    // 🔴 AC-11 — 사라진 것이 되살아나지 않는다. `queryAll` 을 쓴다: `getAllBy*` 는 무매칭 시
    //    throw 라 "0건" 을 아예 잴 수 없다(02a §5-2 실측).
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-chip-time-poi-a')
    ).toEqual([]);
    // 텍스트로도 확인 — testID 만 바꾸고 같은 칩을 그대로 두는 우회를 막는다. `getByText` 의
    // 문자열 인자는 **완전 일치**다(02a §5-1 실측).
    expect(within(fixedCard).queryAllByText('시각 고정')).toEqual([]);

    expect(
      within(anytimeCard).queryAllByTestId(/^itinerary-mustvisit-chip-/)
    ).toHaveLength(1);
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-must-poi-b')
    ).toHaveTextContent('필수');

    // 고정 블록은 초안 단계에서도 시각을 보여준다(BR-U3-07 예외) — `fixedStart` 는 솔버 산출값이
    // 아니라 **사용자가 못 박은 입력값**이라서 INV-2 와 충돌하지 않는다.
    expect(fixedCard).toHaveTextContent(/13:00/);
    // 짝 — 시각이 없는 항목에는 시각이 안 보인다(모든 카드에 시각을 그리는 구현을 죽인다).
    expect(anytimeCard).not.toHaveTextContent(/\d{1,2}:\d{2}/);
  });

  it('🔴 C19-c 끝 시각을 그리지 않는다 — 시작 시각 하나만 낸다 (INV-3 · INV-2)', () => {
    /**
     * ⚠️ **Figma 목업과 의도적으로 다르다.** 목업 h05 는 `13:00–14:30` 이라는 **시간 범위**를
     * 그리는데, 끝 시각은 `fixedStart + dwellMin` 에서만 나온다:
     *  - `dwellMin` 은 솔버 입력이지 **표시값이 아니다**(INV-3). 범위는 뺄셈으로 소요시간을 읽을
     *    수 있는 형태라 소요시간 표시의 다른 이름이다.
     *  - 그 끝 시각은 **솔버가 검증한 값도 아니다**(INV-2). 시작 시각만 사용자가 못 박은 입력이라
     *    BR-U3-07 의 노출 예외가 성립한다.
     * 목업끼리도 안 맞는다 — `13:00–14:30` 은 90분인데 01b D4 의 `보통` 은 60분이다.
     * 오케스트레이터 판정(2026-08-08) · 정본 반영 후보.
     */
    render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])} />
    );

    const fixedCard = screen.getByTestId('itinerary-mustvisit-poi-a');

    // 긍정 앵커 — 시작 시각은 **보인다**(BR-U3-07). 없으면 "시각을 아예 안 그리는" 화면이
    // 아래 부정 단언을 공짜로 통과한다.
    expect(fixedCard).toHaveTextContent(/13:00/);

    // 부정 — `–`·`~`·`-` 어느 것으로 이었든 시각 쌍이 0건이다. `toHaveTextContent` 는 자손
    // 텍스트를 **구분자 없이 이어 붙여** 비교하므로(node_modules `getTextContent` 확인),
    // `<Text>13:00</Text><Text>–</Text><Text>14:30</Text>` 로 쪼개 그려도 잡힌다(02a §5-6 실측).
    const TIME_RANGE = /\d{1,2}:\d{2}\s*[–~-]\s*\d{1,2}:\d{2}/;
    expect(fixedCard).not.toHaveTextContent(TIME_RANGE);
    expect(
      screen.getByTestId('itinerary-mustvisit-poi-b')
    ).not.toHaveTextContent(TIME_RANGE);
    expect(
      screen.getByTestId('itinerary-mustvisit-poi-z')
    ).not.toHaveTextContent(TIME_RANGE);
  });
});

describe('C20 · AC-9 · INV-3 — 소요시간 문자열이 한 개도 안 보인다', () => {
  it('이름과 시각은 보이는데 분·시간·소요 표기는 0건이다', () => {
    render(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])} />
    );

    // 긍정 앵커 먼저 — 없으면 아무것도 안 그리는 화면이 아래 부정 단언을 공짜로 통과한다.
    const texts = renderedTexts();
    expect(texts).toContain('부산시립미술관');
    expect(texts.some((text) => text.includes('13:00'))).toBe(true);

    // 부정 — `dwellMin` 은 솔버 입력이지 표시값이 아니다. 소스가 아니라 **렌더 결과**를 훑는다
    // (소스 전수 스캔은 수호 주석 자체가 걸려 통과 불가능한 심판이 된다 — 02a ★1).
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);
  });
});

describe('C21 · D3 · AC-8 — 카드 본문은 시각 지정으로, ✕는 해제로 간다', () => {
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

    // D3 — Figma 가 그린 우측 아이콘을 그대로 두고, 진입은 카드 본문 누름으로 연다.
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-poi-b'));
    expect(onPressItem).toHaveBeenCalledWith('poi-b');
    expect(onPressItem).toHaveBeenCalledTimes(1);

    // 해제에는 `mustVisitId` 가 필요하다(DELETE 경로가 그것을 쓴다) — 두 id 를 함께 넘긴다.
    fireEvent.press(screen.getByTestId('itinerary-mustvisit-remove-poi-b'));
    expect(onRemove).toHaveBeenCalledWith({
      mustVisitId: 'mv-poi-b',
      sourcePoiId: 'poi-b',
    });
  });

  it('C21-b 우측 아이콘이 항목 종류에 따라 다르다 (Figma 실측)', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    // FIXED 카드는 연필(편집), ANYTIME 카드는 ✕(해제).
    expect(
      screen.getByTestId('itinerary-mustvisit-edit-poi-a')
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId('itinerary-mustvisit-remove-poi-a')).toEqual(
      []
    );
    expect(
      screen.getByTestId('itinerary-mustvisit-remove-poi-b')
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId('itinerary-mustvisit-edit-poi-b')).toEqual(
      []
    );
  });
});

describe('C22 · D7 — 로딩 · 빈 목록 · 조회 실패는 서로 다른 얼굴이다', () => {
  it('세 얼굴 각각에서 카드가 0장이고, 실패에만 재시도가 붙는다', () => {
    const { rerender } = render(
      <MustVisitPickerScreen view={{ kind: 'loading' }} />
    );
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-loading')
    ).toBeOnTheScreen();
    expect(cardTestIds()).toEqual([]);

    rerender(<MustVisitPickerScreen view={{ kind: 'empty' }} />);
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-empty')
    ).toBeOnTheScreen();
    expect(cardTestIds()).toEqual([]);
    // 정말 없는 것에는 다시 시도할 것이 없다.
    expect(screen.queryAllByTestId('itinerary-mustvisit-screen-retry')).toEqual(
      []
    );

    rerender(<MustVisitPickerScreen view={{ kind: 'failed' }} />);
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-failed')
    ).toBeOnTheScreen();
    expect(cardTestIds()).toEqual([]);
    // 못 불러온 것은 다시 시도할 수 있어야 한다(INV-4 — 침묵 실패 금지).
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-retry')
    ).toBeOnTheScreen();
    // 빈 목록 얼굴과 섞이지 않는다 — 못 불러온 것과 정말 없는 것은 다른 사실이다.
    expect(screen.queryAllByTestId('itinerary-mustvisit-screen-empty')).toEqual(
      []
    );
  });
});

describe('🔴 C23 · AC-M1 — 도착한 목록이 실패 표시와 함께 산다', () => {
  /**
   * ⚠️ 문제로그 `2026-08-04 화면 얼굴 전환이 잔존 목록을 지운다`. TRIP-222·223 에서 서로 반대
   * 방향으로 두 번 재발했다 — 한 번은 목록이 사라졌고, 한 번은 실패가 삼켜졌다. 이 케이스는
   * **양쪽을 동시에** 잰다.
   */
  it('카드 3장이 그대로 있고, 실패 알림이 곁에 붙고, 전면 실패 얼굴로 갈아 끼우지 않는다', () => {
    const onRetry = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z], true)}
        onRetry={onRetry}
      />
    );

    // ① 목록이 지워지지 않았다.
    expect(cardTestIds()).toHaveLength(3);
    expect(
      screen.getByTestId('itinerary-mustvisit-name-poi-a')
    ).toHaveTextContent('부산시립미술관');

    // ② 실패가 삼켜지지도 않았다 — 목록 곁에 알림이 **덧붙는다**.
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-stale-failed')
    ).toBeOnTheScreen();
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-stale-retry')
    );
    expect(onRetry).toHaveBeenCalledTimes(1);

    // ③ 전면 실패·로딩 얼굴로 **갈아 끼우지 않는다**. 이 두 줄이 재발한 버그의 급소다.
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-failed')
    ).toEqual([]);
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-loading')
    ).toEqual([]);
  });
});

/**
 * ⚠️ **409 안내(`이미 추가된 곳이에요`)는 이 화면의 심판이 아니다 — 01b D5 개정(오케 판정
 * 2026-08-08).** D6 이 h05 의 검색 필·추가 타일을 범위 밖으로 빼면서 **h05 에 POST 를 쏘는
 * 경로가 하나도 남지 않았다.** 남은 유일한 POST 는 h07 의 승격 요청이므로, 409 를 만드는 쪽도
 * 알리는 쪽도 h07 이다. 여기에 안내 prop 을 두면 **생산자가 0인 prop** 이 되고, 그것은 이
 * 리포에서 이미 지적받은 형태다(소비자 0인 API 를 먼저 만든 `canSaveStayFix` 선례).
 * → 심판은 `MustVisitTimePage.integration.test.tsx > I11` 에 있다.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * TRIP-326 추가분 — 지도 카드 · timeMode 셀렉터 · 강등 확인 시트 · CTA/건너뛰기.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 좌표가 다른 핀 3개. 번호는 **카드 번호** 이고 화면이 다시 매기지 않는다(01b AC-1·AC-2). */
const PIN_1: MapPin = { number: 1, lat: 35.1, lng: 129.1 };
const PIN_2: MapPin = { number: 2, lat: 35.2, lng: 129.2 };
const PIN_3: MapPin = { number: 3, lat: 35.3, lng: 129.3 };

const NO_COORDS_NOTE = '위치를 확인할 수 없어요';
const PROCEED_LABEL = '이 구성으로 일정 짜기';
const SKIP_LABEL = '건너뛰기';
const BLOCKED_REASON = '다음 단계는 아직 준비 중이에요';
const DEMOTE_TITLE = '아무 때나로 바꿀까요?';
const DEMOTE_NOTE = '정해둔 날짜와 시각이 지워져요';

/**
 * className 안에 그 토큰이 **정확히** 있는가. 토큰 경계(앞은 문자열 시작이거나 공백, 뒤는
 * 단어문자·하이픈이 아님)를 정규식으로 잡으므로 `bg-primary-pale` 은 `bg-primary` 로 안 센다.
 *
 * ⚠️ **긍정형 단언에만 써라.** `expect(hasToken(x,'bg-primary-pale')).toBe(true)` 처럼 "그 토큰이
 * 있다" 를 잴 때는 경계 정규식이 심판을 **조인다**(순진한 `includes` 였다면 이웃 토큰까지 통과).
 * 그런데 **부정형(`.toBe(false)`)에서는 정확히 반대로 심판을 푼다** — `bg-primary-pale` 을
 * 먹였을 때 `includes` 는 `true`(→ 부정 단언이 죽어 우회를 잡는다)인데 이 함수는 `false`(→ 통과)
 * 다. 02a ★2·§5-3 이 이 방향을 거꾸로 적었고, 그래서 비활성 CTA 를 브랜드 빨강으로 칠해도
 * 150건이 전부 초록이었다(03b §1 실측). **"활성 색이 안 남았다" 류 부정 단언에는 아래
 * `brandTokensIn` 을 쓴다.**
 *
 * *(개념)* **className** — NativeWind 가 쓰는 스타일 이름표. 이 환경에서는 렌더된 요소의
 * props 에 문자열 그대로 남아 있어(02a §5-3) **jest 가 색을 볼 수 있는 유일한 통로**다
 * (`toHaveStyle` 은 못 쓴다 — `style` 이 undefined 다).
 */
function hasToken(className: string, token: string): boolean {
  return new RegExp(`(^|\\s)${token}(?![\\w-])`).test(className);
}

/**
 * 브랜드 주색 **계열** 이름들. `tailwind.config.js`(= Figma 변수 컬렉션의 미러)에서 파생하므로
 * 색이 늘면 저절로 따라온다 — 손으로 적은 목록은 늙는다.
 *
 * 긴 이름을 앞에 둔다: 정규식 대안(`|`)은 역추적을 하므로 순서가 없어도 결과는 같지만, 읽는
 * 사람이 그 사실까지 알아야 하는 코드를 남기지 않는다(02a2 §4-3).
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
 * className 에 들어 있는 브랜드 주색 계열 토큰을 **전부** 돌려준다.
 *
 * 부정 단언은 `toEqual([])` 로 쓴다 — "이 토큰 하나가 없다" 가 아니라 **"계열 전체가 없다"** 를
 * 재므로 `bg-primary-pale`·`text-primary-text` 로 갈아타는 우회가 막힌다. 실패했을 때 jest 가
 * 남은 토큰 이름을 그대로 보여 주는 것도 이 모양의 값이다.
 *
 * *(개념)* `^…$` — 조각 하나가 **처음부터 끝까지** 통째로 맞아야 참이다. className 을 공백으로
 * 잘라 조각마다 대조하므로, `includes` 가 겪던 "부분문자열이 우연히 걸린다" 가 아예 안 생긴다.
 */
function brandTokensIn(className: string): string[] {
  return className.split(/\s+/).filter((token) => BRAND_TOKEN.test(token));
}

/** 렌더된 요소의 className 문자열. 없으면 빈 문자열 — 부정 단언을 공짜로 통과시키는 것은
 * 같은 it 안의 긍정 짝이 먼저 막는다. */
function classNameOf(node: ReactTestInstance): string {
  return String(node.props.className ?? '');
}

/** 조상을 거슬러 올라가 스크롤 영역 안에 있는가. React 의 위치 정보는 props 에 안 실리므로
 * 렌더 트리의 **조상 host 타입**으로만 잴 수 있다(02a §5-9 실측 — `RCTScrollView`). */
const SCROLL_HOST_TYPE = 'RCTScrollView';

function isInsideScroll(node: ReactTestInstance): boolean {
  let cursor: ReactTestInstance | null = node.parent;
  while (cursor !== null) {
    // 합성 컴포넌트의 `type` 은 함수·클래스라 문자열이 아니다. `String()` 으로 감싸 비교하면
    // 두 경우를 한 줄로 다루면서 tsc 의 리터럴 좁히기(`ElementType` 과 문자열 리터럴이 안 겹친다)
    // 도 피한다 — 함수를 문자열로 만들면 소스 코드가 나오므로 이 이름과 겹칠 일이 없다.
    if (String(cursor.type) === SCROLL_HOST_TYPE) return true;
    cursor = cursor.parent;
  }
  return false;
}

describe('C24 · AC-1 — 받은 핀을 그대로 지도에 넘긴다', () => {
  it('지도 카드가 서고, 핀 배열이 손대지 않은 채 지도에 도달한다', () => {
    // 준비 — 항목 3건 + 핀 3개. 준비/실행/단언 중 "준비" 는 **화면 밖에서 이미 계산된 값** 이다
    // (조인·번호 매기기는 model 몫 — C7·C8).
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
    // 🔴 **완전 일치**다. 화면이 번호를 다시 매기거나 좌표를 걸러내면 여기서 죽는다 —
    //    지도 ② 와 카드 ② 가 다른 장소를 가리키는 것이 US-TRIP-09 가 막는 사고다.
    expect(screen.getByTestId('map-root').props.pins).toEqual(pins);
    // 짝 — 지도가 떴다고 목록이 줄지 않는다.
    expect(cardTestIds()).toHaveLength(3);
  });
});

describe('C25 · AC-2 — 핀이 없는 항목이 그 사실을 글자로 말한다', () => {
  it('카드는 3장 그대로고, 핀 없는 그 카드에만 위치 안내가 붙는다', () => {
    // 준비 — 가운데 항목(`poi-z`)만 담은 목록에서 빠져 좌표를 못 얻었다. 핀 번호가 ①③ 으로
    // 뛰는 것이 정상이다(번호를 당기지 않는다).
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, UNJOINED_Z, ANYTIME_B])}
        pins={[PIN_1, PIN_3]}
      />
    );

    // ① 숨기지 않는다 — 카드는 3장 그대로다(사용자 동결 결정).
    expect(cardTestIds()).toHaveLength(3);
    expect(screen.getByTestId('map-root').props.pins).toEqual([PIN_1, PIN_3]);

    // ② 🔴 핀 수(2)와 목록 수(3)가 다른 **이유가 화면에 드러난다**(BR-U1-55 · 침묵 금지).
    expect(
      within(screen.getByTestId('itinerary-mustvisit-poi-z')).getByText(
        NO_COORDS_NOTE
      )
    ).toBeOnTheScreen();

    // ③ 짝 — 핀이 있는 카드에는 안 붙는다. 모든 카드에 붙이는 구현을 죽인다.
    expect(
      within(screen.getByTestId('itinerary-mustvisit-poi-a')).queryAllByText(
        NO_COORDS_NOTE
      )
    ).toEqual([]);
    expect(
      within(screen.getByTestId('itinerary-mustvisit-poi-b')).queryAllByText(
        NO_COORDS_NOTE
      )
    ).toEqual([]);
  });
});

describe('C26 · AC-3 · AC-4 · D4 · D8 — 지도 카드를 안 그리는 세 자리', () => {
  it('핀이 있으면 그리고, 핀 0개·empty·failed 에서는 안 그린다', () => {
    // ① 긍정 앵커 — 없으면 아래 세 부재 단언을 "지도를 아예 못 그리는 화면" 이 공짜로
    //    통과한다(02a ★12).
    const { rerender } = render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        pins={[PIN_1, PIN_2]}
      />
    );
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-map')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();

    // ⑤ D4·D8 — **안 그리기로 한 것들**(01b). 심판이 없으면 다음 사람이 "친절하게" 그려도
    //    아무 테스트도 안 죽는다. `지도에서 지정` 은 부를 API 자체가 없고(계약 공백),
    //    `© Kakao`·축척 바는 카카오 SDK 가 자체 렌더한다(우리가 그리면 두 번 나온다).
    expect(screen.queryAllByText('지도에서 지정')).toEqual([]);
    expect(screen.queryAllByText('© Kakao')).toEqual([]);
    expect(screen.queryAllByText('1 km')).toEqual([]);

    // ② 항목은 있는데 좌표를 가진 것이 하나도 없다 — 지도 카드를 통째로 안 그린다(D9).
    rerender(
      <MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} pins={[]} />
    );
    expect(screen.queryAllByTestId('itinerary-mustvisit-screen-map')).toEqual(
      []
    );
    expect(screen.queryAllByTestId('map-root')).toEqual([]);

    // ③ ④ 빈 목록·조회 실패 얼굴에는 **핀을 넘겨도** 지도가 없다(Figma `empty`·`error` 프레임).
    //    얼굴이 핀보다 세다.
    rerender(
      <MustVisitPickerScreen view={{ kind: 'empty' }} pins={[PIN_1, PIN_2]} />
    );
    expect(screen.queryAllByTestId('itinerary-mustvisit-screen-map')).toEqual(
      []
    );
    expect(screen.queryAllByTestId('map-root')).toEqual([]);

    rerender(
      <MustVisitPickerScreen view={{ kind: 'failed' }} pins={[PIN_1, PIN_2]} />
    );
    expect(screen.queryAllByTestId('itinerary-mustvisit-screen-map')).toEqual(
      []
    );
    expect(screen.queryAllByTestId('map-root')).toEqual([]);
  });
});

describe('C27 · AC-7 · AC-V2 — 칩 두 개가 현재 type 을 드러낸다', () => {
  it('선택 상태가 접근성 상태로 갈리고, 색 토큰도 함께 갈린다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    const fixedOn = screen.getByTestId(
      'itinerary-mustvisit-timemode-fixed-poi-a'
    );
    const fixedOff = screen.getByTestId(
      'itinerary-mustvisit-timemode-anytime-poi-a'
    );
    const anytimeOn = screen.getByTestId(
      'itinerary-mustvisit-timemode-anytime-poi-b'
    );
    const anytimeOff = screen.getByTestId(
      'itinerary-mustvisit-timemode-fixed-poi-b'
    );

    // ① 접근성 상태 — **색만으로 구분하면 jest 가 못 본다.** 상태를 값으로도 남긴다
    //    (`SegmentItem` 선례). 속성 직접 읽기다: RN 이 다른 키를 함께 채워도 흔들리지 않는다.
    expect(fixedOn.props.accessibilityState?.selected).toBe(true);
    expect(fixedOff.props.accessibilityState?.selected).toBe(false);
    expect(anytimeOn.props.accessibilityState?.selected).toBe(true);
    expect(anytimeOff.props.accessibilityState?.selected).toBe(false);

    // ② 색 축(Figma `timeMode`: on = `primary-pale`/`primary-text`, off = `surface-strong`/`muted`).
    //    여기는 전부 **긍정형·부정형이 짝을 이룬 토큰 지정**이라 경계 정규식이 옳게 조인다
    //    (선택 칩에 `bg-primary-pale` 이 **있다** / 비선택에는 **없다**). 부정형 하나만 세우는
    //    자리에서는 이 함수를 쓰면 안 된다 — 그 이유는 `hasToken` 독주석에 있다.
    expect(hasToken(classNameOf(fixedOn), 'bg-primary-pale')).toBe(true);
    expect(hasToken(classNameOf(fixedOn), 'bg-surface-strong')).toBe(false);
    expect(hasToken(classNameOf(fixedOff), 'bg-surface-strong')).toBe(true);
    expect(hasToken(classNameOf(fixedOff), 'bg-primary-pale')).toBe(false);

    // ③ 라벨은 스토리 어휘 그대로다(US-TRIP-08 — "'시간 정해두기'(시각 고정형) 토글로").
    expect(within(fixedOn).getByText('시간 정해두기')).toBeOnTheScreen();
    expect(within(fixedOff).getByText('아무 때나')).toBeOnTheScreen();
  });

  it('C27-b 탐지기 자가검사 — 토큰 경계 정규식이 접두 겹침을 안 삼킨다', () => {
    // 이 자가검사가 없으면 위 ② 가 무엇을 재는지 아무도 모른다(02a §5-3 실측을 코드로 고정).
    // 재는 것은 **두 토큰을 구별한다**는 사실 하나뿐이다. 그 구별이 심판을 조이는지 푸는지는
    // 단언의 방향에 달렸다 — 🔴 부정형에서는 오히려 **푼다**(03b §1 실측 · `hasToken` 독주석).
    const pale = 'rounded-pill bg-primary-pale py-[3px]';
    const solid = 'rounded-button bg-primary py-lg';
    expect(pale.includes('bg-primary')).toBe(true); // 함정 자체를 눈에 보이게 남긴다
    expect(hasToken(pale, 'bg-primary')).toBe(false);
    expect(hasToken(solid, 'bg-primary')).toBe(true);
    expect(hasToken(pale, 'bg-primary-pale')).toBe(true);
  });
});

describe('C28 · AC-8 · AC-9 — 칩 네 조합이 각각 옳은 일을 한다', () => {
  it('시간 정해두기는 h07 로만 가고, 아무 때나는 확인 시트를 먼저 띄운다', () => {
    const onPressItem = jest.fn();
    const onDemote = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        onPressItem={onPressItem}
        onDemote={onDemote}
      />
    );

    // ① ANYTIME 의 `시간 정해두기` → h07 로 간다. **여기서 바로 FIXED 로 바꾸지 않는다** —
    //    날짜·시각 없는 FIXED 는 INV-U1-17 위반이라 성립하지 않는다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-fixed-poi-b')
    );
    expect(onPressItem).toHaveBeenCalledWith('poi-b');
    // 🔴 정확히 1회 — 칩이 카드 `Pressable` **안**에 있어 press 가 바깥으로 번지면 2회가 된다
    //    (02a ★7 · §5-7 에서 안 번지는 것을 실측했다). 번지면 시트를 띄우면서 동시에 화면을
    //    떠나는 사고가 난다.
    expect(onPressItem).toHaveBeenCalledTimes(1);
    expect(onDemote).not.toHaveBeenCalled();

    // ② FIXED 의 `시간 정해두기`(이미 켜짐) → 시각을 고치러 h07 로. 연필과 같은 자리다.
    onPressItem.mockClear();
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-fixed-poi-a')
    );
    expect(onPressItem).toHaveBeenCalledWith('poi-a');
    expect(onPressItem).toHaveBeenCalledTimes(1);

    // ③ ANYTIME 의 `아무 때나`(이미 켜짐) → 아무 일도 없다. 이미 그 상태다.
    onPressItem.mockClear();
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-b')
    );
    expect(onDemote).not.toHaveBeenCalled();
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-demote')
    ).toEqual([]);

    // ④ 🔴 FIXED 의 `아무 때나` → 확인 시트가 **뜨고**, 강등은 **아직 안 나간다**(01b D1).
    //    계약에 PATCH 가 없어 강등은 DELETE→POST 2단이고 원자성이 없다 — 확인 없이 바로
    //    보내면 사용자가 입력한 날짜·시각을 되돌릴 수 없이 잃는다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    );
    expect(
      screen.getByTestId('itinerary-mustvisit-screen-demote')
    ).toBeOnTheScreen();
    expect(onDemote).not.toHaveBeenCalled();
  });
});

describe('🔴 C29 · AC-9 · AC-10 — 확인 시트가 무엇을 잃는지 말하고, 실패는 곁에 붙는다', () => {
  it('취소는 아무것도 안 보내고 확인만 강등을 낸다', () => {
    const onDemote = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        onDemote={onDemote}
      />
    );

    // ① 짝 — 처음에는 시트가 없다.
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-demote')
    ).toEqual([]);

    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    );

    // ② 🔴 **무엇을 잃는지 말한다.** 확인 시트가 붙는 유일한 이유가 이 한 줄이다(01b D1) —
    //    강등은 사용자가 입력한 날짜·시각을 지우는 방향이고 되돌리려면 h07 에서 다시 입력해야
    //    한다. 문구가 없으면 확인 시트는 그냥 한 번 더 누르게 하는 장애물이다.
    expect(screen.getByText(DEMOTE_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(DEMOTE_NOTE)).toBeOnTheScreen();

    // ③ 취소 — 시트가 닫히고 아무것도 안 나간다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-demote-cancel')
    );
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-demote')
    ).toEqual([]);
    expect(onDemote).not.toHaveBeenCalled();

    // ④ 확인 — 두 id 를 함께 넘긴다. DELETE 경로는 `mustVisitId`, 재-POST 는 `sourcePoiId`(=poiId)
    //    를 쓰므로 하나만 넘기면 반드시 한쪽이 막힌다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    );
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-demote-confirm')
    );
    expect(onDemote).toHaveBeenCalledWith({
      mustVisitId: 'mv-poi-a',
      sourcePoiId: 'poi-a',
    });
    expect(onDemote).toHaveBeenCalledTimes(1);
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-demote')
    ).toEqual([]);
  });

  it('C29-b 강등 실패는 목록 곁에 붙고 얼굴을 갈아 끼우지 않는다 (INV-4 · 문제로그 2026-08-04)', () => {
    const onRetryDemote = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z])}
        demoteErrorText="바꾸지 못해 목록에서 빠졌어요. 다시 시도해 주세요"
        onRetryDemote={onRetryDemote}
      />
    );

    // ① 사실을 말한다(침묵 금지 · BR-U1-55).
    expect(
      screen.getByText('바꾸지 못해 목록에서 빠졌어요. 다시 시도해 주세요')
    ).toBeOnTheScreen();

    // ② 되돌릴 수단이 있다.
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-screen-demote-retry')
    );
    expect(onRetryDemote).toHaveBeenCalledTimes(1);

    // ③ 🔴 목록도 살고 실패도 산다 — 전면 실패·로딩 얼굴로 **갈아 끼우지 않는다**. 이 계열
    //    화면에서 세 번 재발한 자리다.
    expect(cardTestIds()).toHaveLength(3);
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-failed')
    ).toEqual([]);
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-loading')
    ).toEqual([]);
  });

  it('C29-c 복구 수단이 없으면 헛된 재시도 버튼을 세우지 않는다 (짝)', () => {
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A])}
        demoteErrorText="바꾸지 못했어요. 다시 시도해 주세요"
      />
    );
    expect(
      screen.getByText('바꾸지 못했어요. 다시 시도해 주세요')
    ).toBeOnTheScreen();
    // `onRetryDemote` 를 안 넘긴 경우 = DELETE 자체가 실패해 서버 상태가 그대로인 자리다.
    // 다시 할 일은 "칩을 다시 누르는 것" 이지 같은 요청 재전송이 아니다(h07 선례와 같은 규칙).
    expect(
      screen.queryAllByTestId('itinerary-mustvisit-screen-demote-retry')
    ).toEqual([]);
    // 짝 — 칩은 살아 있다. 재시도 수단이 아예 없는 것과 다르다.
    expect(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    ).toBeOnTheScreen();
  });
});

describe('C30 · AC-12 · AC-13 — CTA 는 스크롤 흐름 안, 건너뛰기는 앱바', () => {
  it('자리 판정기가 앱바와 본문을 실제로 가르고, 두 표면이 각자 옳은 쪽에 있다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    // ① 🔴 탐지기 자가검사 — 이게 통과해야 아래 두 줄이 의미를 갖는다. 앱바의 뒤로 버튼은
    //    스크롤 **밖**, 카드는 스크롤 **안** 이다. RN 내부 host 이름이 바뀌면 이 두 줄이 함께
    //    죽어 "AC 위반" 이 아니라 "탐지기 노후" 임이 즉시 보인다(02a ★9).
    expect(
      isInsideScroll(screen.getByTestId('itinerary-mustvisit-screen-back'))
    ).toBe(false);
    expect(
      isInsideScroll(screen.getByTestId('itinerary-mustvisit-poi-a'))
    ).toBe(true);

    // ② AC-12 — CTA 는 `body` 의 마지막 자식이다. **하단 고정 바가 아니다**(Figma `default`
    //    프레임 실측 — `ctaPrimary` 가 스크롤 흐름 안에 있다). 리포의 `CtaBar` 형태를 쓰면
    //    스크롤 밖으로 나가 여기서 죽는다.
    const proceed = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    expect(isInsideScroll(proceed)).toBe(true);
    expect(within(proceed).getByText(PROCEED_LABEL)).toBeOnTheScreen();

    // ③ AC-13 — 건너뛰기는 앱바다(우상단). 본문으로 내려가면 여기서 죽는다.
    const skip = screen.getByTestId('itinerary-mustvisit-screen-skip');
    expect(isInsideScroll(skip)).toBe(false);
    expect(within(skip).getByText(SKIP_LABEL)).toBeOnTheScreen();
  });
});

describe('🔴 C31 · AC-14 — 비활성 + 사유, 눌러도 아무 일이 없다', () => {
  it('사유가 있으면 둘 다 잠기고 사유가 글자로 보이며 핸들러가 0회다', () => {
    const onProceed = jest.fn();
    const onSkip = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        proceedBlockedReason={BLOCKED_REASON}
        onProceed={onProceed}
        onSkip={onSkip}
      />
    );

    const proceed = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    const skip = screen.getByTestId('itinerary-mustvisit-screen-skip');

    expect(proceed).toBeDisabled();
    expect(skip).toBeDisabled();

    fireEvent.press(proceed);
    fireEvent.press(skip);
    expect(onProceed).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();

    // 🔴 **왜 못 누르는지가 화면에 글자로 있다.** "눌러도 아무 일이 없다" 는 그 자체로 위반이다
    //    (INV-4 · 침묵 실패 금지). 이 값은 어느 정본에도 없는 발명값이라(01b D7) 심판이 없으면
    //    조용히 드리프트한다.
    expect(screen.getByText(BLOCKED_REASON)).toBeOnTheScreen();
  });

  it('C31-b 사유가 없으면 둘 다 눌린다 (짝 — 비활성이 상수로 박히는 구현을 죽인다)', () => {
    const onProceed = jest.fn();
    const onSkip = jest.fn();
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        proceedBlockedReason={null}
        onProceed={onProceed}
        onSkip={onSkip}
      />
    );

    const proceed = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    const skip = screen.getByTestId('itinerary-mustvisit-screen-skip');
    expect(proceed).not.toBeDisabled();
    expect(skip).not.toBeDisabled();

    fireEvent.press(proceed);
    fireEvent.press(skip);
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);

    // 사유가 없으면 사유 문구도 없다.
    expect(screen.queryAllByText(BLOCKED_REASON)).toEqual([]);
  });
});

describe('🔴 C32 · AC-15 — 비활성 CTA·건너뛰기가 브랜드 주색으로 칠해지지 않는다', () => {
  /**
   * ⚠️ **jest 의 차단 심판 3종(`toBeDisabled` · 실제 press · 핸들러 0회)은 전부 접근성 상태만
   * 읽고 색은 어느 심판도 안 본다.** TRIP-225 에서 차단 카드 CTA 가 `text-primary-text`(브랜드
   * 빨강)를 `disabled` 와 무관하게 **항상** 걸어, "빨간 활성 버튼처럼 보이는데 안 눌리는" 상태가
   * 실기 스모크에서야 발견됐다(문제로그 2026-08-08 · **미해결**). C31 만으로 AC-15 를 덮었다고
   * 적으면 그것이 곧 심판 공백이다.
   *
   * 🔴 **1차 게이트①의 이 케이스는 그 함정을 정확히 통과시켰다**(03b §1). 단언이
   * `hasToken(비활성CTA,'bg-primary') === false` 라는 **부정형**이라, 비활성을 `bg-primary-pale`
   * + `text-primary-text` 로 칠하면 토큰이 달라져 **초록으로 통과했다**(실측 150건 전부 green).
   * 그래서 "특정 토큰 하나가 없다" 를 버리고 **"브랜드 주색 계열에 속하는 토큰이 하나도 없다"**
   * 로 방향을 바꿨다 — 계열은 `tailwind.config.js` 에서 파생하므로 색이 늘어도 안 늙는다.
   *
   * 한계: 이 케이스는 "코드가 그 토큰을 걸었다" 까지다. 눈에 대비가 보이는지는 [검증]의
   * 스크린샷 대조 몫이다.
   */
  it('활성엔 브랜드색이 있고 비활성엔 계열 전체가 0개이며, 건너뛰기 색도 갈린다', () => {
    const { rerender } = render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        proceedBlockedReason={null}
      />
    );
    const activeCta = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    const activeLabel = within(activeCta).getByText(PROCEED_LABEL);
    const activeSkipLabel = within(
      screen.getByTestId('itinerary-mustvisit-screen-skip')
    ).getByText(SKIP_LABEL);

    // ① 긍정 앵커(★12) — 활성은 Figma `ctaPrimary` 그대로 배경 `primary` · 글자 `on-primary` 다.
    //    **탐지기가 실제로 무언가를 찾을 줄 안다**는 증거이기도 하다. 이 줄이 없으면 아래 ②③④ 가
    //    "className 을 아예 안 다는 화면" 에서 공짜로 통과한다(빈 문자열도 결과가 `[]` 다).
    expect(brandTokensIn(classNameOf(activeCta))).toEqual(['bg-primary']);
    expect(brandTokensIn(classNameOf(activeLabel))).toEqual([
      'text-on-primary',
    ]);
    const activeSkipClass = classNameOf(activeSkipLabel);

    rerender(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B])}
        proceedBlockedReason={BLOCKED_REASON}
      />
    );
    const blockedCta = screen.getByTestId('itinerary-mustvisit-screen-proceed');
    const blockedLabel = within(blockedCta).getByText(PROCEED_LABEL);
    const blockedSkipLabel = within(
      screen.getByTestId('itinerary-mustvisit-screen-skip')
    ).getByText(SKIP_LABEL);

    // ② 🔴 비활성 배경에 브랜드 주색 **계열이 통째로** 없다. `bg-primary` 를 `bg-primary-pale`
    //    (연분홍)로 갈아타는 우회가 여기서 막힌다 — 계열 전체를 훑기 때문이다.
    expect(brandTokensIn(classNameOf(blockedCta))).toEqual([]);
    // ③ 🔴 라벨도 마찬가지다 — TRIP-225 가 정확히 여기서 샜다(배경만 바꾸고 글자색은 브랜드
    //    빨강 `text-primary-text` 로 남겨 둠). 그 토큰도 같은 계열이라 이 줄이 잡는다.
    expect(brandTokensIn(classNameOf(blockedLabel))).toEqual([]);
    // ④ 🔴 건너뛰기 라벨도 브랜드색이 아니다.
    expect(brandTokensIn(classNameOf(blockedSkipLabel))).toEqual([]);
    // ⑤ 건너뛰기는 두 상태 **어느 쪽도** 브랜드색이 아니라(`text-muted` / `text-muted-soft`)
    //    ④ 만으로는 "상태에 따라 갈린다" 를 못 잰다. AC-15 문장의 나머지 절반이 이 줄이다.
    expect(classNameOf(blockedSkipLabel)).not.toBe(activeSkipClass);
  });

  it('C32-c 탐지기 자가검사 — 브랜드 계열 판정이 무엇을 잡고 무엇을 안 잡는가', () => {
    // 위 케이스가 무엇을 재는지 코드로 고정한다. 탐지기가 노후하면(색 이름이 바뀌면) AC 위반이
    // 아니라 **탐지기 문제**임이 여기서 먼저 보인다.

    // ① 계열은 정확히 다섯이다 — 토큰 정본에서 파생했으므로 색이 늘면 이 기대값도 함께 고친다.
    expect([...BRAND_COLORS].sort()).toEqual([
      'on-primary',
      'primary',
      'primary-active',
      'primary-pale',
      'primary-text',
    ]);

    // ② 🔴 03b 가 실제로 심었던 우회 두 개를 잡는다. 1차 심판(`hasToken` 부정형)은 둘 다 놓쳤다.
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
    expect(brandTokensIn('font-noto text-body text-muted-soft')).toEqual([]);

    // ④ 이름이 겹치는 이웃까지 삼키지 않는다 — `^…$` 로 조각 전체를 대조하기 때문이다.
    expect(brandTokensIn('bg-primaryish text-primary-textual')).toEqual([]);

    // ⑤ className 이 아예 없는 노드(빈 문자열)도 `[]` 다 → 부정 단언만으로는 공허하다는 근거.
    //    그래서 위 케이스 ① 이 긍정 앵커로 같은 it 안에 있다(★12).
    expect(brandTokensIn('')).toEqual([]);
  });
});

describe('C32-b · AC-16 — 신규 표면을 전부 켠 채 INV-3 · INV-2 를 다시 잰다', () => {
  it('지도·CTA·사유·확인 시트·실패 문구가 모두 뜬 화면에서도 소요시간·끝 시각이 0건이다', () => {
    // 준비 — 이 칸이 더한 문구가 **한 번에 다 보이는** 최대 화면. C20 은 이 표면들이 없던
    // 시절의 모집단이라, 신규 문구가 탐지기에 걸리는지는 여기서 재야 한다(02a ★6).
    render(
      <MustVisitPickerScreen
        view={listed([FIXED_A, ANYTIME_B, UNJOINED_Z], true)}
        pins={[PIN_1, PIN_3]}
        proceedBlockedReason={BLOCKED_REASON}
        demoteErrorText="바꾸지 못했어요. 다시 시도해 주세요"
      />
    );
    fireEvent.press(
      screen.getByTestId('itinerary-mustvisit-timemode-anytime-poi-a')
    );

    // ① 긍정 앵커 — 신규 문구가 실제로 화면에 있다. 없으면 아래 부정 단언이 공허하다.
    const texts = renderedTexts();
    expect(texts).toContain(PROCEED_LABEL);
    expect(texts).toContain('아무 때나');
    expect(texts).toContain(BLOCKED_REASON);
    expect(texts).toContain(DEMOTE_NOTE);
    expect(texts.some((text) => text.includes('13:00'))).toBe(true);

    // ② INV-3 — 소요시간 표기 0건. `시간 정해두기` 가 `\d+\s*시간` 에 안 걸리는 것은 실측했다
    //    (02a §5-5) — 걸렸다면 이 화면은 **어떤 구현으로도 통과 불가능**했다.
    expect(texts.filter((text) => DURATION_TEXT.test(text))).toEqual([]);

    // ③ INV-2 — 끝 시각 쌍 0건(C19-c 와 같은 탐지기, 모집단만 신규 표면 포함).
    const TIME_RANGE = /\d{1,2}:\d{2}\s*[–~-]\s*\d{1,2}:\d{2}/;
    ['poi-a', 'poi-b', 'poi-z'].forEach((id) =>
      expect(
        screen.getByTestId(`itinerary-mustvisit-${id}`)
      ).not.toHaveTextContent(TIME_RANGE)
    );
  });
});
