import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

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
 */

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

describe('C19 · AC-V2 · US-TRIP-09 · BR-U3-07 — 칩 개수가 type 을 드러낸다', () => {
  it('FIXED 는 고정·시각 고정 두 칩과 시작 시각, ANYTIME 은 필수 칩 하나뿐이다', () => {
    render(<MustVisitPickerScreen view={listed([FIXED_A, ANYTIME_B])} />);

    const fixedCard = screen.getByTestId('itinerary-mustvisit-poi-a');
    const anytimeCard = screen.getByTestId('itinerary-mustvisit-poi-b');

    expect(
      within(fixedCard).queryAllByTestId(/^itinerary-mustvisit-chip-/)
    ).toHaveLength(2);
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-fixed-poi-a')
    ).toHaveTextContent('고정');
    expect(
      screen.getByTestId('itinerary-mustvisit-chip-time-poi-a')
    ).toHaveTextContent('시각 고정');

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
