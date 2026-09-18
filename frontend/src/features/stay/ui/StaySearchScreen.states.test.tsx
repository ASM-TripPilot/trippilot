import { render, screen, within } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import type { StaySearchState } from '../model/staySearchState';
import { stayKey } from '../model/stayKey';
import { StaySearchScreen } from './StaySearchScreen';

/**
 * AC-1~AC-7 · AC-9 · AC-10 · V2(01b Seed · 02a §4 F3) — 5가지 상태 변형(loading·empty·
 * filter-zero·partial-failure·error) + default 회귀의 렌더 계약.
 *
 * 무엇을 보장하나: `state` prop(판별 유니온)에 따라 화면이 상태별 문구·버튼·배지·스켈레톤을
 * 그리고(AC-1~7), 배너와 안내가 동시에 뜨는 겹침(AC-10)이 구조적으로 성립하며, `state`를
 * 생략한 2-prop 호출은 TRIP-181 default 화면을 한 글자도 바꾸지 않는다(AC-9). 렌더로 못 보는
 * 소스 층(FORBIDDEN 문자열 등)은 `staySearchStructure.test.ts`가 맡는다 — 이 파일은 렌더
 * 결과만 본다.
 */

// 픽스처는 StaySearchScreen.test.tsx(동결)에서 그대로 복사한다 — 공용 모듈로 빼지 않는 것이
// 리포 관례다(동결 파일을 건드리지 않기 위해서다, §5 ★14).
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

const PRICE_TEXT_BY_EXTERNAL_ID: Record<string, string> = {
  s3: '30,000원~',
  s1: '10,000원~',
  s2: '20,000원~',
};

/** ITEMS의 1번(서면, 10000)만 price: null로 바꾼 3건 — AC-6 전용. */
const ITEMS_WITH_NULL: StayItem[] = ITEMS.map((item, index) =>
  index === 1 ? { ...item, price: null } : item
);

/** 카드가 실제로 있는 케이스(F3-5·F3-6·F3-9) 전용 — 저장·사진 testID는 lookahead로 제외한다. */
function getCardTestIds(): string[] {
  return screen
    .getAllByTestId(/^stay-card-(?!save-|photo-)/)
    .map((node) => String(node.props.testID));
}

/** 카드가 0장이어야 하는 케이스(F3-1·F3-7) 전용 — getAllByTestId는 무매칭 시 throw하므로
 * "0장"을 잴 수 없다(getAllByText와 같은 계열, M7). queryAllByTestId는 무매칭 시 빈 배열을
 * 돌려준다(M8). */
function queryCardTestIds(): string[] {
  return screen
    .queryAllByTestId(/^stay-card-(?!save-|photo-)/)
    .map((node) => String(node.props.testID));
}

/** `SocialLoginScreen.visual.test.tsx:46`·동결 파일에서 그대로 가져온다(리포 관례). 문자열
 * includes는 부분포함 오탐을 낸다 — 배열 원소 일치만 오탐을 막는다. */
function classTokens(node: { props: { className?: string } }): string[] {
  return (node.props.className ?? '').trim().split(/\s+/);
}

/** 서브트리 어딘가에 토큰이 있는지 — 원형 배지처럼 자체 testID가 없는 자손까지 훑는다. */
function hasTokenInSubtree(
  root: ReturnType<typeof screen.getByTestId>,
  token: string
): boolean {
  return root
    .findAll(() => true)
    .some((node) => classTokens(node).includes(token));
}

// 곡선 따옴표 U+2018(‘) / U+2019(’) — 직선 '(U+0027)로 적으면 매칭이 조용히 어긋난다.
const CURLY_TITLE = (name: string) => `‘${name}’ 필터가 0건을 만들었어요`;
const CURLY_CLEAR = (name: string) => `‘${name}’ 필터 해제`;

describe('StaySearchScreen — loading (AC-1)', () => {
  it('안내 라벨·스켈레톤 2장이 뜨고, 서브헤더에 개수가 없으며, 카드는 0장이다', () => {
    const state: StaySearchState = { kind: 'loading' };
    render(<StaySearchScreen region="부산" items={[]} state={state} />);

    expect(
      within(screen.getByTestId('stay-search-loading')).getByText(
        '숙소를 모으는 중'
      )
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^stay-search-skeleton-/)).toHaveLength(2);
    // toHaveTextContent(문자열)은 완전 일치다(§5 ★3) — 이 한 줄이 "곳이 없다"까지 겸한다.
    expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
      '부산 · 날짜 미정'
    );
    expect(queryCardTestIds()).toEqual([]);

    expect(classTokens(screen.getByText('숙소를 모으는 중'))).toEqual(
      expect.arrayContaining(['text-muted-soft'])
    );
    expect(
      hasTokenInSubtree(
        screen.getByTestId('stay-search-skeleton-0'),
        'bg-surface-strong'
      )
    ).toBe(true);
  });
});

describe('StaySearchScreen — empty (AC-2)', () => {
  it('점선 안내 박스에 제목·부제·완화 버튼 2개가 뜨고, 배너는 없으며 서브헤더가 0곳이다', () => {
    const state: StaySearchState = { kind: 'empty', degraded: false };
    render(<StaySearchScreen region="부산" items={[]} state={state} />);

    const empty = screen.getByTestId('stay-search-empty');
    expect(
      within(empty).getByText('조건에 맞는 숙소가 없어요')
    ).toBeOnTheScreen();
    expect(
      within(empty).getByText('지역이나 필터를 바꿔 다시 찾아보세요')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-search-empty-region')).getByText(
        '지역 바꾸기'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-search-empty-filter')).getByText(
        '필터 완화'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
      '부산 · 날짜 미정 · 0곳'
    );
    expect(screen.queryAllByTestId('stay-search-partialfailure')).toHaveLength(
      0
    );

    expect(classTokens(empty)).toEqual(
      expect.arrayContaining(['border-dashed'])
    );
    expect(hasTokenInSubtree(empty, 'bg-primary-pale')).toBe(true);

    const regionBtn = screen.getByTestId('stay-search-empty-region');
    const filterBtn = screen.getByTestId('stay-search-empty-filter');
    [regionBtn, filterBtn].forEach((btn) => {
      expect(classTokens(btn)).toEqual(
        expect.arrayContaining(['border-hairline-strong'])
      );
      expect(classTokens(btn)).not.toContain('bg-primary');
    });
  });
});

describe('StaySearchScreen — empty 수동 등록 유도 (AC-3)', () => {
  it('점선 박스 밖에 등록 유도 카드가 별도로 있다', () => {
    const state: StaySearchState = { kind: 'empty', degraded: false };
    render(<StaySearchScreen region="부산" items={[]} state={state} />);

    const reg = screen.getByTestId('stay-search-register');
    expect(
      within(reg).getByText('이미 예약한 숙소가 있나요?')
    ).toBeOnTheScreen();
    expect(
      within(reg).getByText('OTA에 없어도 위치 · 이름으로 직접 등록')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-search-empty')).queryByTestId(
        'stay-search-register'
      )
    ).toBeNull();
  });
});

describe('StaySearchScreen — filter-zero (AC-4)', () => {
  const CASES: { reasons: string[]; label: string }[] = [
    { reasons: ['amenity:조식'], label: '조식' },
    { reasons: ['stayType'], label: '숙소 유형' },
    { reasons: ['weirdAxis'], label: 'weirdAxis' },
  ];

  it.each(CASES)(
    'reasons=$reasons → 필터명 "$label"이 제목·버튼에 실제로 나타난다(empty와 갈린다)',
    ({ reasons, label }) => {
      // 에디터의 스마트 따옴표 자동 변환이 뒤집히면 여기서 먼저 죽는다(§5 ★5).
      expect(CURLY_TITLE('x').codePointAt(0)).toBe(0x2018);

      const state: StaySearchState = {
        kind: 'filter-zero',
        reasons,
        degraded: false,
      };
      render(<StaySearchScreen region="부산" items={[]} state={state} />);

      const fz = screen.getByTestId('stay-search-filterzero');
      expect(within(fz).getByText(CURLY_TITLE(label))).toBeOnTheScreen();
      expect(
        within(fz).getByText('필터를 해제하면 더 많은 숙소를 볼 수 있어요')
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('stay-search-filterzero-clear')).getByText(
          CURLY_CLEAR(label)
        )
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('stay-search-filterzero-reset')).getByText(
          '필터 초기화'
        )
      ).toBeOnTheScreen();
      // empty와 갈린다는 반대증명 — filter-zero 제목이 뜬 것과 짝이다(위 두 번째 단언).
      expect(screen.queryByText('조건에 맞는 숙소가 없어요')).toBeNull();
      expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
        '부산 · 날짜 미정 · 0곳'
      );

      const clearBtn = screen.getByTestId('stay-search-filterzero-clear');
      const resetBtn = screen.getByTestId('stay-search-filterzero-reset');
      expect(classTokens(clearBtn)).toEqual(
        expect.arrayContaining(['border-hairline-strong'])
      );
      expect(classTokens(resetBtn)).not.toContain('border-hairline-strong');
      expect(classTokens(within(resetBtn).getByText('필터 초기화'))).toEqual(
        expect.arrayContaining(['text-primary'])
      );
    }
  );
});

describe('StaySearchScreen — partial-failure (AC-5, 가장 어기기 쉬운 AC)', () => {
  it('배너가 뜨고, 동시에 결과 카드 3장이 전부 그려진다', () => {
    const state: StaySearchState = { kind: 'results', degraded: true };
    render(<StaySearchScreen region="부산" items={ITEMS} state={state} />);

    const banner = screen.getByTestId('stay-search-partialfailure');
    // toHaveTextContent를 배너(컨테이너)에 걸면 자손 텍스트가 구분자 없이 이어붙는다
    // (§5 ★2) — within(...).getByText로 잡는다.
    expect(
      within(banner).getByText('일부 숙소 정보를 불러오지 못했어요')
    ).toBeOnTheScreen();
    expect(
      within(banner).getByTestId('stay-search-partialfailure-retry')
    ).toBeOnTheScreen();

    // 기대 배열은 리터럴 3줄로 적는다(계산식이면 순서를 사람이 눈으로 못 본다).
    expect(getCardTestIds()).toEqual([
      'stay-card-NAVER:s3',
      'stay-card-NAVER:s1',
      'stay-card-NAVER:s2',
    ]);
    expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
      '부산 · 날짜 미정 · 3곳'
    );

    expect(classTokens(banner)).toEqual(
      expect.arrayContaining(['bg-surface-soft', 'rounded-button'])
    );
    expect(hasTokenInSubtree(banner, 'text-primary')).toBe(true);
  });
});

describe('StaySearchScreen — partial에서도 가격 규칙 유지 (AC-6 · BR-U1-14)', () => {
  it('price:null 카드가 "가격 미확인"으로 남고 목록에서 빠지지 않으며, 배너도 함께 뜬다', () => {
    const state: StaySearchState = { kind: 'results', degraded: true };
    render(
      <StaySearchScreen region="부산" items={ITEMS_WITH_NULL} state={state} />
    );

    expect(getCardTestIds()).toEqual(
      ITEMS_WITH_NULL.map((item) => `stay-card-${stayKey(item)}`)
    );

    const nullItem = ITEMS_WITH_NULL[1];
    const nullCard = screen.getByTestId(`stay-card-${stayKey(nullItem)}`);
    expect(within(nullCard).getByText('가격 미확인')).toBeOnTheScreen();

    // 나머지 두 카드는 금액 문자열이 그대로 남아 있다 — null 처리가 옆 카드로 새지 않는다.
    [ITEMS_WITH_NULL[0], ITEMS_WITH_NULL[2]].forEach((item) => {
      const card = screen.getByTestId(`stay-card-${stayKey(item)}`);
      expect(
        within(card).getByText(PRICE_TEXT_BY_EXTERNAL_ID[item.externalId])
      ).toBeOnTheScreen();
    });

    expect(screen.getByTestId('stay-search-partialfailure')).toBeOnTheScreen();
  });
});

describe('StaySearchScreen — error (AC-7)', () => {
  it('안내·재시도·직접등록이 뜨고, 서브헤더에 개수가 없으며 카드는 0장이다', () => {
    const state: StaySearchState = { kind: 'error' };
    render(<StaySearchScreen region="부산" items={[]} state={state} />);

    const err = screen.getByTestId('stay-search-error');
    expect(
      within(err).getByText('지금 숙소 정보를 불러올 수 없어요')
    ).toBeOnTheScreen();
    expect(
      within(err).getByText('잠시 후 다시 시도해 주세요')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-search-error-retry')).getByText(
        '다시 시도'
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-search-error-register')).getByText(
        '숙소 직접 등록'
      )
    ).toBeOnTheScreen();
    expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
      '부산 · 날짜 미정'
    );
    expect(queryCardTestIds()).toEqual([]);

    const retryBtn = screen.getByTestId('stay-search-error-retry');
    const registerBtn = screen.getByTestId('stay-search-error-register');
    // 이 화면만 채움 버튼이다 — 나머지 상태의 1차 버튼은 전부 아웃라인.
    expect(classTokens(retryBtn)).toEqual(
      expect.arrayContaining(['bg-primary'])
    );
    expect(classTokens(within(retryBtn).getByText('다시 시도'))).toEqual(
      expect.arrayContaining(['text-on-primary'])
    );
    expect(classTokens(registerBtn)).not.toContain('bg-primary');
    expect(classTokens(registerBtn)).toEqual(
      expect.arrayContaining(['border-hairline-strong'])
    );

    expect(hasTokenInSubtree(err, 'bg-primary-pale')).toBe(true);
  });
});

describe('StaySearchScreen — 배너 겹침 (AC-10)', () => {
  const CASES: { state: StaySearchState; noticeTestId: string }[] = [
    {
      state: { kind: 'empty', degraded: true },
      noticeTestId: 'stay-search-empty',
    },
    {
      state: {
        kind: 'filter-zero',
        reasons: ['amenity:조식'],
        degraded: true,
      },
      noticeTestId: 'stay-search-filterzero',
    },
  ];

  it.each(CASES)(
    '$state.kind에서 배너와 안내가 동시에 뜬다',
    ({ state, noticeTestId }) => {
      render(<StaySearchScreen region="부산" items={[]} state={state} />);

      const banner = screen.getByTestId('stay-search-partialfailure');
      expect(banner).toBeOnTheScreen();
      expect(screen.getByTestId(noticeTestId)).toBeOnTheScreen();
      expect(
        within(banner).getByText('일부 숙소 정보를 불러오지 못했어요')
      ).toBeOnTheScreen();
    }
  );
});

describe('StaySearchScreen — default 회귀 (AC-9, 선제 green이 정상)', () => {
  it('state·onRetry 없이 2-prop으로 렌더하면 새 상태 UI가 하나도 새지 않는다', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);

    expect(getCardTestIds()).toEqual([
      'stay-card-NAVER:s3',
      'stay-card-NAVER:s1',
      'stay-card-NAVER:s2',
    ]);
    expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
      '부산 · 날짜 미정 · 3곳'
    );
    expect(screen.getByTestId('stay-search-fab')).toBeOnTheScreen();

    // 새 상태 UI가 default로 새지 않는다(부정 4개) — 동결 파일은 이 testID들이 그때
    // 없었으므로 이 단언을 가질 수 없었다. 이 it이 "기본값이 정말 default 얼굴인가"를
    // 양쪽에서 잠근다.
    expect(screen.queryAllByTestId('stay-search-partialfailure')).toHaveLength(
      0
    );
    expect(screen.queryAllByTestId('stay-search-loading')).toHaveLength(0);
    expect(screen.queryAllByTestId('stay-search-empty')).toHaveLength(0);
    expect(screen.queryAllByTestId('stay-search-error')).toHaveLength(0);
  });
});
