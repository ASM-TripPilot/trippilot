import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { stayKey } from '../model/stayKey';
import { StaySearchScreen } from './StaySearchScreen';

/**
 * AC-1~AC-5 · AC-7 · AC-9 · AC-10 · V2 · V3(01b Seed) — 숙소 검색 결과 default 프레젠테이션 화면.
 *
 * 무엇을 보장하나: `StaySearchScreen`은 `region`·`items` 2개 prop만 받아(네트워크·라우팅 없음)
 * 헤더·카드 목록·필터 칩·저장 하트·탭바·FAB·상단 앱바를 그리는 순수 화면이다. 서버 순서를
 * 그대로 그리고(AC-4), 소요 시간 문자열을 어디에도 내지 않으며(AC-5 · INV-3), 필터 칩과 저장
 * 하트는 눌러도 아무것도 바뀌지 않는 정직한 스텁이다(AC-7). 소스 스캔 절반은
 * `staySearchStructure.test.ts`가 맡는다(INV-3 조건부 렌더·useState 금지 등 렌더로는 못 보는
 * 층) — 이 파일은 렌더 결과만 본다.
 *
 * 픽스처 `ITEMS`의 배열 순서(30,000 → 10,000 → 20,000)는 우연이 아니다 — 가격 오름차순·이름
 * 코드포인트순·externalId순 셋 모두와 다르게 골라, AC-4가 "정렬해도 우연히 통과"하지 않게 한다
 * (02a §1-4).
 */

const ITEMS: StayItem[] = [
  {
    externalSource: 'NAVER',
    externalId: 's3',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 30000, currency: 'KRW' },
  },
  {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '서면 시티 호텔',
    lat: 35.1577,
    lng: 129.0594,
    region: '서면',
    amenities: ['wifi'],
    stayType: 'HOTEL',
    price: { amount: 10000, currency: 'KRW' },
  },
  {
    externalSource: 'NAVER',
    externalId: 's2',
    name: '광안리 오션뷰',
    lat: 35.1531,
    lng: 129.1186,
    region: '광안리',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 20000, currency: 'KRW' },
  },
];

/**
 * ITEMS 각 항목의 `formatPrice` 기대 문자열 — 리터럴로 고정한다(계산식으로 쓰면 화면이
 * formatPrice를 안 쓰고 제 방식으로 만들어도 통과할 수 있다, 02a §4 it 2-2).
 */
const PRICE_TEXT_BY_EXTERNAL_ID: Record<string, string> = {
  s3: '30,000원~',
  s1: '10,000원~',
  s2: '20,000원~',
};

/** ITEMS의 1번(서면, 10000)만 price: null로 바꾼 3건 — AC-3 전용(02a §1-4, 가운데를 비운다). */
const ITEMS_WITH_NULL: StayItem[] = ITEMS.map((item, index) =>
  index === 1 ? { ...item, price: null } : item
);

/**
 * 카드 testID 수집 — `/^stay-card-/`만 쓰면 `stay-card-save-*`·`stay-card-photo-*`까지 잡혀
 * 카드 3건이 9건으로 부풀어 오른다(F-15 실측). 두 접미사를 lookahead로 제외해야 카드만 남는다.
 */
function getCardTestIds(): string[] {
  return screen
    .getAllByTestId(/^stay-card-(?!save-|photo-)/)
    .map((node) => String(node.props.testID));
}

/** `SocialLoginScreen.visual.test.tsx:46`에서 그대로 가져온다(리포 관례 — 공용화하지 않고
 * 파일마다 복사). 문자열 `includes`는 `'border-hairline-strong'.includes('border-hairline')`가
 * true인 부분포함 오탐을 낸다 — 토큰 배열 원소 일치만 오탐을 구조적으로 막는다. */
function classTokens(node: { props: { className?: string } }): string[] {
  return (node.props.className ?? '').trim().split(/\s+/);
}

/**
 * 카드 지문 — 자기 포함 모든 자손의 [testID, className, 직계 문자열 children]을 JSON으로 굳힌다.
 * `JSON.stringify(screen.toJSON())`은 `FlatList`+`ListHeaderComponent` 조합에서 순환 참조로
 * TypeError를 던져 쓸 수 없다(F-10 실측) — 그 대체품이다. className 변경·자식 글리프 교체를
 * 둘 다 검출한다(F-11 실측), "존재만 확인"은 둘 다 놓친다.
 */
function cardFingerprint(cardTestID: string): string {
  const card = screen.getByTestId(cardTestID);
  const nodes = card.findAll(() => true);
  const snapshot = nodes.map((node) => [
    node.props.testID ?? null,
    node.props.className ?? null,
    node.children.filter((child): child is string => typeof child === 'string'),
  ]);
  return JSON.stringify(snapshot);
}

describe('StaySearchScreen — 헤더 조립 (AC-1 · BR-U1-10)', () => {
  it.each([
    {
      region: '제주',
      items: ITEMS.slice(0, 2),
      expected: '제주 · 날짜 미정 · 2곳',
    },
    { region: '부산', items: ITEMS, expected: '부산 · 날짜 미정 · 3곳' },
  ])('$region 헤더가 "$expected"로 조립된다', ({ region, items, expected }) => {
    render(<StaySearchScreen region={region} items={items} />);

    // 헤더 서브트리 텍스트가 정확히 이 한 줄뿐이므로 완전 일치가 성립한다(F-1·F-13 실측).
    // region·N을 둘 다 바꾼 두 케이스라야 "부산 · 날짜 미정 · 3곳" 하드코딩을 잡는다.
    expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
      expected
    );
  });
});

describe('StaySearchScreen — 카드 구성 (AC-2)', () => {
  it('카드마다 숙소명·지역·금액·저장 하트·사진 자리가 있다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    ITEMS.forEach((item) => {
      const key = stayKey(item);
      const card = screen.getByTestId(`stay-card-${key}`);

      // 전부 within(card) 스코프 — 전역 getByText는 같은 문구가 여러 카드에 반복되면
      // 다중 매칭으로 throw한다(F-4 실측). 이번 픽스처는 지역이 전부 달라도 습관으로 둔다.
      expect(within(card).getByText(item.name)).toBeOnTheScreen();
      expect(within(card).getByText(item.region)).toBeOnTheScreen();
      expect(
        within(card).getByText(PRICE_TEXT_BY_EXTERNAL_ID[item.externalId])
      ).toBeOnTheScreen();
      expect(
        within(card).getByTestId(`stay-card-save-${key}`)
      ).toBeOnTheScreen();

      const photo = within(card).getByTestId(`stay-card-photo-${key}`);
      expect(classTokens(photo)).toEqual(
        expect.arrayContaining(['bg-surface-strong'])
      );
    });
  });
});

describe('StaySearchScreen — 가격 미확인 (AC-3 · BR-U1-14)', () => {
  it('price:null 카드가 "가격 미확인"으로 남고 목록에서 빠지지 않는다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS_WITH_NULL} />);

    // 개수(=items.length)·정체성·순서를 단언 하나로 잠근다.
    expect(getCardTestIds()).toEqual(
      ITEMS_WITH_NULL.map((item) => `stay-card-${stayKey(item)}`)
    );

    const nullItem = ITEMS_WITH_NULL[1];
    const nullCard = screen.getByTestId(`stay-card-${stayKey(nullItem)}`);
    expect(within(nullCard).getByText('가격 미확인')).toBeOnTheScreen();

    // 나머지 두 카드는 금액 문자열이 그대로 남아 있다 — null 처리가 다른 카드로 새지 않는다.
    [ITEMS_WITH_NULL[0], ITEMS_WITH_NULL[2]].forEach((item) => {
      const card = screen.getByTestId(`stay-card-${stayKey(item)}`);
      expect(
        within(card).getByText(PRICE_TEXT_BY_EXTERNAL_ID[item.externalId])
      ).toBeOnTheScreen();
    });
  });
});

describe('StaySearchScreen — 서버 순서 보존 (AC-4 · BR-U1-15)', () => {
  it('카드 순서가 응답 배열 순서와 정확히 같다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    // 기대 배열은 ITEMS.map(...) 계산식이 아니라 리터럴 3줄로 적는다 — "이 순서가 정렬
    // 결과와 다른가"가 게이트①에서 사람 눈에 바로 보여야 심판 노릇을 한다(02a §4 it 2-4).
    expect(getCardTestIds()).toEqual([
      'stay-card-NAVER:s3',
      'stay-card-NAVER:s1',
      'stay-card-NAVER:s2',
    ]);
  });
});

describe('StaySearchScreen — 소요 시간 금지 (AC-5 · INV-3 · BR-U1-54)', () => {
  it('화면 어디에도 분·시간·소요 문자열이 없다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    // getAllByText는 무매칭 시 throw라 "없음"을 잴 수 없다 — query 접두사를 쓴다(F-9).
    expect(screen.queryAllByText(/분|시간|소요/)).toHaveLength(0);

    // 가짜통과 방지 짝 — 렌더가 통째로 실패해 화면이 비어도 "0건"이 초록이 되는 것을 막는다.
    expect(screen.getByTestId('stay-search-root')).toBeOnTheScreen();
    const firstCard = screen.getByTestId(`stay-card-${stayKey(ITEMS[0])}`);
    expect(within(firstCard).getByText('해운대')).toBeOnTheScreen();
  });
});

describe('StaySearchScreen — 스텁의 정직성 (AC-7)', () => {
  it('필터 칩·저장 하트를 눌러도 카드가 한 글자도 바뀌지 않는다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    const firstCardId = `stay-card-${stayKey(ITEMS[0])}`;
    const firstSaveId = `stay-card-save-${stayKey(ITEMS[0])}`;
    const before = cardFingerprint(firstCardId);

    fireEvent.press(screen.getByTestId('stay-search-filter-price'));
    fireEvent.press(screen.getByTestId('stay-search-filter-region'));
    fireEvent.press(screen.getByTestId('stay-search-filter-more'));
    fireEvent.press(screen.getByTestId(firstSaveId));

    // 지문 비교 — className 변경·자식 글리프 교체 둘 다 검출한다(F-11 실측). "존재만
    // 확인"으로는 나중에 누가 useState 토글을 붙여도 못 잡는다. 사정거리 한계: 처음부터
    // 채워진 하트로 그리는 구현은 이 렌더 단언으로는 못 잡는다 — 소스 절반
    // (staySearchStructure.test.ts it 4-3의 useState 금지)이 다른 각도에서 막는다.
    expect(cardFingerprint(firstCardId)).toBe(before);

    expect(screen.getByTestId('stay-search-filter-price')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-search-filter-region')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-search-filter-more')).toBeOnTheScreen();
    expect(screen.getByTestId(firstSaveId)).toBeOnTheScreen();
  });
});

describe('StaySearchScreen — 목록 프레임 · 탭바 · FAB (AC-9)', () => {
  it('FlatList 헤더 안에 헤더 문구·칩이 있고, 탐색 탭바와 FAB가 그려진다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    const list = screen.getByTestId('stay-search-list');
    expect(list).toBeOnTheScreen();
    expect(within(list).getByTestId('stay-search-header')).toBeOnTheScreen();
    expect(
      within(list).getByTestId('stay-search-filter-price')
    ).toBeOnTheScreen();

    // BottomTabBar가 activeKey='explore'로 그려졌다는 유일한 관찰 수단 — 화면이 탭바를
    // 직접 렌더해 prop을 밖에서 볼 수 없다(Seed Q7). F-7 프로브로 활성 시에만 뜨는 testID임을 확인.
    expect(
      screen.getByTestId('shell-tabbar-icon-explore-active')
    ).toBeOnTheScreen();

    // FAB의 '＋'는 전각 플러스(U+FF0B)라 완전일치로 잡으면 반각 구현·아이콘 글리프 구현
    // 모두에서 깨진다(F-14 실측) — 정규식 부분 포함으로 잡는다.
    expect(screen.getByTestId('stay-search-fab')).toHaveTextContent(
      /여행 만들기/
    );
  });
});

describe('StaySearchScreen — 상단 앱바 (AC-10 · 4-a 이후 신설)', () => {
  it('타이틀 "숙소 검색 결과"와 뒤로가기 어포던스가 존재한다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    const appbar = screen.getByTestId('stay-search-appbar');
    expect(within(appbar).getByText('숙소 검색 결과')).toBeOnTheScreen();
    expect(within(appbar).getByTestId('stay-search-back')).toBeOnTheScreen();

    // 의도적으로 잠그지 않는 것(02a §4 it 2-8) — 높이·아이콘 path·간격은 스크린샷 대조
    // ([검증] 6-b) 몫이고, onPress 배선은 FAB·탭바와 같은 등급의 정적 어포던스라 범위 밖이다.
  });
});

describe('StaySearchScreen — 카드 골격 토큰 (V2)', () => {
  it('카드·사진·하트가 Figma 토큰 클래스를 입는다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    const key = stayKey(ITEMS[0]);
    const card = screen.getByTestId(`stay-card-${key}`);
    const photo = within(card).getByTestId(`stay-card-photo-${key}`);
    // within(card)로 잡히는 것 자체가 "하트가 카드의 자손이다"라는 완화된 단언이다
    // (게이트① 전 판정 ③ — 사진 노드 자손으로 위치를 고정하면 시각적으로 동일한 구현에도
    // red가 나는 구현 지시가 된다).
    const heart = within(card).getByTestId(`stay-card-save-${key}`);

    // border-hairline-strong도 'border-hairline'을 부분 문자열로 포함하므로(T-10, 칩이 바로
    // 그 토큰을 쓴다) 배열 원소 일치로만 비교한다.
    expect(classTokens(card)).toEqual(
      expect.arrayContaining(['rounded-card', 'border-hairline'])
    );
    expect(classTokens(photo)).toEqual(
      expect.arrayContaining(['bg-surface-strong', 'h-[178px]'])
    );
    // '오버레이'의 실질은 중첩 위치가 아니라 absolute이므로 이 토큰이 그 실질을 잠그고,
    // 나머지 좌표(우 32 / 상 14)는 스크린샷 대조가 본다.
    expect(classTokens(heart)).toEqual(expect.arrayContaining(['absolute']));
  });
});

describe('StaySearchScreen — 필터 칩 3개 (V3)', () => {
  it.each([
    { axis: 'price', label: '가격대' },
    { axis: 'region', label: '지역' },
    { axis: 'more', label: '필터' },
  ])(
    '$axis 칩이 라벨 "$label"과 rounded-pill·border-hairline-strong 토큰을 갖는다',
    ({ axis, label }) => {
      render(<StaySearchScreen region="부산" items={ITEMS} />);

      const chip = screen.getByTestId(`stay-search-filter-${axis}`);

      expect(within(chip).getByText(label)).toBeOnTheScreen();
      expect(classTokens(chip)).toEqual(
        expect.arrayContaining(['rounded-pill', 'border-hairline-strong'])
      );
    }
  );
});
