import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { StayItem } from '@/shared/api/generated/schemas';
import { stayKey } from '@/features/save-stay/model/stayKey';
import { StaySearchScreen } from './StaySearchScreen';
import type { StaySearchState } from '../model/staySearchState';
import { PRICE_BUCKETS, type PriceBucketId } from '../model/priceRangeFilter';

/**
 * e02 숙소 검색 — StaySearchScreen(props 만 받는 뷰) 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1148): 옛 `StaySearchScreen{,.back,.cardPress,.emptyCta,.fab,.filter,.nameSearch,
 * .registerEntry,.save,.states,.tabbar}.test.tsx` 11개를 각자의 바깥 describe 하나로 옮겼다. 옛 파일마다 값이 다른
 * 동명 픽스처(`ITEMS`·`KEY_A`·`getCardTestIds` 등)는 그 describe 안에 갇혀 서로 안 보인다 — 값을 하나로
 * 합치면 단언 숫자가 바뀌므로 합치지 않았다. 목은 없다.
 * INV-3 "분·시간·소요 0건" 렌더 it 은 지웠다 — 숙소 계약(`StayItem`)에 시간·거리 재료가 없다(README 판정 4 하위 규칙).
 */

// 옛 StaySearchScreen.test — AC-1~AC-10·V2·V3 (BR-U1-10/14/15)
describe('헤더·카드·목록 프레임 (옛 본 파일)', () => {
  /**
   * AC-1~AC-5 · AC-7 · AC-9 · AC-10 · V2 · V3(01b Seed) — 숙소 검색 결과 default 프레젠테이션 화면.
   *
   * 무엇을 보장하나: `StaySearchScreen`은 `region`·`items` 2개 prop만 받아(네트워크·라우팅 없음)
   * 헤더·카드 목록·필터 칩·저장 하트·탭바·FAB·상단 앱바를 그리는 순수 화면이다. 서버 순서를
   * 그대로 그리고(AC-4), 소요 시간 문자열을 어디에도 내지 않으며(AC-5 · INV-3), 필터 칩과 저장
   * 하트는 눌러도 아무것도 바뀌지 않는 정직한 스텁이다(AC-7). 소스 스캔 절반이던
   * `staySearchStructure`(INV-3 조건부 렌더·useState 금지 등 렌더로는 못 보는
   * 층)는 TRIP-1145 로 지웠다 — 이 파일은 렌더 결과만 본다.
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

  /**
   * TRIP-725 · 2톤 가격의 bold 노드 텍스트 — formatPrice 반환("30,000원~")에서 접미 "~"를 뗀 값.
   * 카드가 이 값(bold)과 "~"(muted) 두 형제 Text 로 쪼갠다(AC-2). 단일 결합 노드 "30,000원~"은
   * 더 이상 없어야 한다(PRICE_TEXT_BY_EXTERNAL_ID 는 그 부재 반증용으로만 남긴다).
   */
  const BOLD_PRICE_BY_EXTERNAL_ID: Record<string, string> = {
    s3: '30,000원',
    s1: '10,000원',
    s2: '20,000원',
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

  /** `SocialLoginScreen.test.tsx` `비주얼 구조`의 classTokens에서 그대로 가져온다(리포 관례 — 공용화하지 않고
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
      node.children.filter(
        (child): child is string => typeof child === 'string'
      ),
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
    ])(
      '$region 헤더가 "$expected"로 조립된다',
      ({ region, items, expected }) => {
        render(<StaySearchScreen region={region} items={items} />);

        // 헤더 서브트리 텍스트가 정확히 이 한 줄뿐이므로 완전 일치가 성립한다(F-1·F-13 실측).
        // region·N을 둘 다 바꾼 두 케이스라야 "부산 · 날짜 미정 · 3곳" 하드코딩을 잡는다.
        expect(screen.getByTestId('stay-search-header')).toHaveTextContent(
          expected
        );
      }
    );
  });

  describe('StaySearchScreen — 카드 구성 · 가격 2톤 (AC-2)', () => {
    it('카드마다 숙소명·지역·2톤 금액(bold+"~")·저장 하트·사진 자리가 있다', () => {
      render(<StaySearchScreen region="부산" items={ITEMS} />);

      ITEMS.forEach((item) => {
        const key = stayKey(item);
        const card = screen.getByTestId(`stay-card-${key}`);

        // 전부 within(card) 스코프 — 전역 getByText는 같은 문구가 여러 카드에 반복되면
        // 다중 매칭으로 throw한다(F-4 실측). 이번 픽스처는 지역이 전부 달라도 습관으로 둔다.
        expect(within(card).getByText(item.name)).toBeOnTheScreen();
        expect(within(card).getByText(item.region)).toBeOnTheScreen();

        // 2톤 — bold "{천단위}원" + muted "~" 두 형제 노드(AC-2). 단일 결합 노드는 없다.
        expect(
          within(card).getByText(BOLD_PRICE_BY_EXTERNAL_ID[item.externalId])
        ).toBeOnTheScreen();
        expect(within(card).getByText('~')).toBeOnTheScreen();
        expect(
          within(card).queryByText(PRICE_TEXT_BY_EXTERNAL_ID[item.externalId])
        ).toBeNull();

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
      // 결측 카드엔 2톤 접미 "~"가 없다(2톤 분기로 새지 않는다).
      expect(within(nullCard).queryByText('~')).toBeNull();

      // 나머지 두 카드는 2톤 금액(bold+"~")이 그대로 남는다 — null 처리가 옆 카드로 안 샌다.
      [ITEMS_WITH_NULL[0], ITEMS_WITH_NULL[2]].forEach((item) => {
        const card = screen.getByTestId(`stay-card-${stayKey(item)}`);
        expect(
          within(card).getByText(BOLD_PRICE_BY_EXTERNAL_ID[item.externalId])
        ).toBeOnTheScreen();
        expect(within(card).getByText('~')).toBeOnTheScreen();
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
      // 채워진 하트로 그리는 구현은 이 렌더 단언으로는 못 잡는다 — 그 각도를
      // 막던 소스 스캔(staySearchStructure it 4-3)은 TRIP-1145 로 지웠다(QA 몫).
      expect(cardFingerprint(firstCardId)).toBe(before);

      expect(screen.getByTestId('stay-search-filter-price')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-filter-region')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-filter-more')).toBeOnTheScreen();
      expect(screen.getByTestId(firstSaveId)).toBeOnTheScreen();
    });
  });

  describe('StaySearchScreen — 목록 프레임 · 탭바 · 2단 FAB (AC-7 · AC-9)', () => {
    it('FlatList 헤더 안에 헤더 문구·칩이 있고, 탐색 탭바와 원형 FAB 2개가 그려진다', () => {
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

      // 알약 "여행 만들기" FAB 소멸 → 원형 FAB 2개(담은 숙소·숙소 등록). 개명 아닌 교체라
      // 옛 단일 testID·라벨은 완전히 사라진다(★F-4: 두 원의 크기·간격·색은 픽셀이라 6-b 몫).
      expect(screen.getByTestId('stay-search-fab-saved')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-fab-register')).toBeOnTheScreen();
      expect(screen.queryByTestId('stay-search-fab')).toBeNull();
      expect(screen.queryByText(/여행 만들기/)).toBeNull();
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

  describe('StaySearchScreen — 필터 칩 3개 · 라운드 사각 (V3 · AC-6)', () => {
    it.each([
      { axis: 'price', label: '가격대' },
      { axis: 'region', label: '지역' },
      { axis: 'more', label: '필터' },
    ])(
      '$axis 칩이 라벨 "$label"과 rounded-[8px]·border-hairline-strong 토큰을 갖는다(pill 아님)',
      ({ axis, label }) => {
        render(<StaySearchScreen region="부산" items={ITEMS} />);

        const chip = screen.getByTestId(`stay-search-filter-${axis}`);

        expect(within(chip).getByText(label)).toBeOnTheScreen();
        // 라운드 사각(r8)으로 교체 — 현행 rounded-pill 이 사라진다(border 는 유지).
        // "필터" 슬라이더 벡터 재작도는 SVG 라 jest 사각(★F-4, 6-b).
        expect(classTokens(chip)).toEqual(
          expect.arrayContaining(['rounded-[8px]', 'border-hairline-strong'])
        );
        expect(classTokens(chip)).not.toContain('rounded-pill');
      }
    );
  });

  describe('StaySearchScreen — 검색창 placeholder (AC-1)', () => {
    it('onChangeNameQuery 를 줄 때 placeholder 가 "지역·숙소 이름 검색"이다(현행 문구 소멸)', () => {
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          nameQuery=""
          onChangeNameQuery={() => {}}
        />
      );

      // (개념) getByPlaceholderText 는 기본 완전일치 — TextInput 의 placeholder prop 을 잰다(§5 실검증).
      expect(
        screen.getByPlaceholderText('지역·숙소 이름 검색')
      ).toBeOnTheScreen();
      // 현행 placeholder 는 사라진다(교체 반증). 돋보기 아이콘(핀 아님)은 SVG 라 jest 사각(★F-4).
      expect(screen.queryByPlaceholderText('숙소 이름 · 지역 검색')).toBeNull();
    });
  });
});

// 옛 StaySearchScreen.back
describe('앱바 뒤로 (옛 .back)', () => {
  /**
   * e02 앱바 뒤로가기 — 시각 스텁(`onPress={undefined}`)이던 버튼이 콜백을 부른다.
   * 목적지(`router.back()`)는 `StaySearchPage`가 정한다(화면은 라우터를 모른다 — 구조 가드).
   */
  describe('e02 뒤로가기', () => {
    it('앱바 뒤로가기를 누르면 콜백이 불린다', () => {
      const onPressBack = jest.fn();
      render(
        <StaySearchScreen region="부산" items={[]} onPressBack={onPressBack} />
      );

      fireEvent.press(screen.getByTestId('stay-search-back'));
      expect(onPressBack).toHaveBeenCalledTimes(1);
    });

    it('콜백 미지정이면 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
      render(<StaySearchScreen region="부산" items={[]} />);

      expect(() =>
        fireEvent.press(screen.getByTestId('stay-search-back'))
      ).not.toThrow();
    });
  });
});

// 옛 StaySearchScreen.cardPress — TRIP-457 AC-5·AC-7
describe('카드 탭 → 상세 콜백 (옛 .cardPress)', () => {
  /**
   * TRIP-457 AC-5(화면 절반) · AC-7 — e02 카드 탭 → 상세 이동 콜백 + 하트/카드 press 분리.
   *
   * 무엇을 보장하나: e02 `StaySearchScreen` 카드 루트가 press 되면(현재는 비-Pressable `View`라
   * 탭 계약 자체가 없다) `onPressCard?(item)` 를 올린다. 하트(내부 Pressable)를 누르면 저장 토글만
   * 되고 **카드 push 를 삼키지 않는다**(이벤트 분리) — 반대로 카드 루트를 누르면 저장 콜백은 안
   * 온다. 실제 push(어느 라우트로)는 페이지 몫(cardNav.integration).
   *
   * *(개념·★F-4)* RNTL `findEventHandler` 는 press 대상에서 **부모로만 올라가며 첫 onPress 에서
   * 멈춘다**(자식으로 하강 없음, fire-event.js 실측 §5). 하트·카드가 각자 onPress 를 가지면 서로의
   * 핸들러를 발화하지 않는다 — 그래서 아래 두 방향 단언이 성립한다. `onPressCard` 를 안 주면 카드
   * press 는 무동작(정직한 스텁).
   */

  const ITEMS: StayItem[] = [
    {
      externalSource: 'NAVER',
      externalId: 's1',
      name: '해운대 그랜드 호텔',
      lat: 35.1587,
      lng: 129.1604,
      region: '해운대',
      amenities: ['ocean'],
      stayType: 'HOTEL',
      price: { amount: 145000, currency: 'KRW' },
    },
    {
      externalSource: 'NAVER',
      externalId: 's2',
      name: '서면 시티 호텔',
      lat: 35.1577,
      lng: 129.0594,
      region: '서면',
      amenities: ['wifi'],
      stayType: 'HOTEL',
      price: { amount: 90000, currency: 'KRW' },
    },
  ];

  const KEY_A = stayKey(ITEMS[0]);

  describe('C1 · 카드 press = 상세 이동만 (AC-5 화면 절반)', () => {
    it('카드 루트 press → onPressCard(item), 저장 콜백은 안 온다', () => {
      const onPressCard = jest.fn();
      const onToggleSave = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          onPressCard={onPressCard}
          onToggleSave={onToggleSave}
        />
      );

      fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`));

      expect(onPressCard).toHaveBeenCalledWith(ITEMS[0]);
      expect(onToggleSave).not.toHaveBeenCalled();
    });
  });

  describe('C2 · 하트 press = 저장만, 카드 push 삼키지 않음 (AC-7)', () => {
    it('하트 press → onToggleSave(item), onPressCard 는 안 온다', () => {
      const onPressCard = jest.fn();
      const onToggleSave = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          onPressCard={onPressCard}
          onToggleSave={onToggleSave}
        />
      );

      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));

      expect(onToggleSave).toHaveBeenCalledWith(ITEMS[0]);
      expect(onPressCard).not.toHaveBeenCalled();
    });
  });

  describe('C3 · onPressCard 미지정 무회귀', () => {
    it('onPressCard 를 안 주면 카드 press 가 throw 하지 않는다', () => {
      render(<StaySearchScreen region="부산" items={ITEMS} />);

      expect(() =>
        fireEvent.press(screen.getByTestId(`stay-card-${KEY_A}`))
      ).not.toThrow();
    });
  });
});

// 옛 StaySearchScreen.emptyCta — TRIP-416
describe('빈 상태 카드 CTA (옛 .emptyCta)', () => {
  /**
   * TRIP-416 AC-3·5·6·8(화면 절반) — e02 빈 상태 카드 CTA 실동작의 화면 층 계약.
   *
   * 무엇을 보장하나: (1) empty 카드의 "필터 완화"는 `activeFilterCount` 로 **활성/비활성**이 갈린다
   * (TRIP-726 F-9 역전) — 적용필터 0이면 숨기지 않고 **비활성(disabled)** 으로 보여주고(죽은 버튼
   * 대신 정직한 비활성), 있으면 활성, **미지정이면 활성 유지**한다(기존 2-prop 무회귀 · 구현을
   * `=== 0`으로 강제, `?? 0` 아님). (2) filter-zero 의 "원인 필터 해제"는
   * `onClearCulpritFilter` 를 `reasons[0]` **문자열**로 부른다(눌림 이벤트가 인자로 새면 안 된다).
   * (3) 신규 콜백은 전부 옵셔널이라 2-prop 호출과 results 얼굴이 안 깨진다. (4) 4버튼 role=button.
   *
   * 왜 화면 층인가 — 조건부 렌더·콜백 인자 위생은 prop → 출력 관계라 화면 단위 렌더가 가장 좁게
   * 잡는다. 실제 라우팅(push/setParams)은 페이지 몫이라 `StaySearchPage.emptyCta.integration.test.tsx`
   * 가 별도로 잰다. params → activeFilterCount 배관은 기존 배지 통합테스트가 이미 잠갔다.
   *
   * 신규 prop(`onPressChangeRegion`·`onRelaxFilters`·`onClearCulpritFilter`)은 타입 어노테이션 없이
   * 값으로만 넘긴다 — jest 는 babel 이라 타입을 안 보고, 미존재 prop 은 컴포넌트가 무시한다(실행됨).
   * tsc 통과는 [구현]에서 implementer 가 prop 을 추가한 뒤 성립한다(게이트①은 jest red 만 요구).
   */

  const RESULT_ITEM: StayItem = {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 30000, currency: 'KRW' },
  };

  const EMPTY_STATE: StaySearchState = { kind: 'empty', degraded: false };
  const FILTER_ZERO_STATE: StaySearchState = {
    kind: 'filter-zero',
    reasons: ['amenity:오션뷰'],
    degraded: false,
  };

  describe('empty 필터완화 disabled 역전 (TRIP-726 F-9 · AC-6 무회귀)', () => {
    it('적용필터 0 → "필터 완화" present + disabled, "지역 바꾸기"는 유지(활성)', () => {
      // 준비: 적용필터가 0인 빈 상태.
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          state={EMPTY_STATE}
          activeFilterCount={0}
        />
      );

      // 단언(TRIP-726 AC-E3 역전) — 완화할 필터가 없어도 버튼을 숨기지 않고 **비활성**으로 보여준다
      // (F-9). toBeDisabled()는 accessibilityState.disabled 를 읽고, RN Pressable 은 `disabled` prop 을
      // 그 필드로 옮긴다(§5 실검증). "always-render + enabled" 오구현이면 이 disabled 단언이 red.
      expect(screen.getByTestId('stay-search-empty-filter')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-empty-filter')).toBeDisabled();
      // 지역 바꾸기는 언제나 활성 형제(공허 통과 방지 — empty 블록이 통째로 비어서 참이 아님).
      expect(screen.getByTestId('stay-search-empty-region')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-empty-region')).not.toBeDisabled();
    });

    it('적용필터 있음(2) → 두 버튼 모두 present + 활성', () => {
      // 준비: 적용필터가 있는 빈 상태.
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          state={EMPTY_STATE}
          activeFilterCount={2}
        />
      );

      // 단언(positive pair) — 조건이 "무조건 disabled"로 굳는 가짜통과를 막는다.
      expect(screen.getByTestId('stay-search-empty-filter')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-empty-filter')).not.toBeDisabled();
      expect(screen.getByTestId('stay-search-empty-region')).toBeOnTheScreen();
    });

    it('activeFilterCount 미지정 → "필터 완화" present + 활성(기존 2-prop 무회귀 · === 0 강제)', () => {
      // 준비: activeFilterCount·콜백 전부 미전달(기존 호출 형태).
      render(<StaySearchScreen region="부산" items={[]} state={EMPTY_STATE} />);

      // 단언: 미지정(undefined)은 "0"이 아니다 — 활성으로 유지해야 TRIP-182 동결 테스트가 안 깨진다.
      // 구현이 `?? 0`을 쓰면 disabled 가 되어 이 단언이 red(구현을 `=== 0`으로 못박는 가드).
      expect(screen.getByTestId('stay-search-empty-filter')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-empty-filter')).not.toBeDisabled();
    });
  });

  describe('filter-zero 원인 해제 콜백 위생 (AC-5 화면 절반 · AC-8 콜백 위생)', () => {
    it('clear 를 누르면 onClearCulpritFilter 가 reasons[0] 문자열로 불린다(눌림 이벤트 아님)', () => {
      // 준비: 원인이 걸린 filter-zero + 콜백 스파이.
      const onClearCulpritFilter = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          state={FILTER_ZERO_STATE}
          onClearCulpritFilter={onClearCulpritFilter}
        />
      );

      // 실행
      fireEvent.press(screen.getByTestId('stay-search-filterzero-clear'));

      // 단언: 인자는 원인 코드 문자열이어야 한다. 화면이 onPress={onClearCulpritFilter}로 직결하면
      // RN 이 GestureResponderEvent 를 넘겨 이 exact-string 단언이 실패한다(화살표 감싸기 강제).
      expect(onClearCulpritFilter).toHaveBeenCalledWith('amenity:오션뷰');
    });
  });

  describe('2-prop · results 무회귀 (AC-6)', () => {
    it('region·items 2개 prop 만으로 결과 카드가 뜨고 안내 카드는 없다', () => {
      // 준비: state·신규 콜백 전부 생략(TRIP-181 default 얼굴).
      render(<StaySearchScreen region="부산" items={[RESULT_ITEM]} />);

      // 단언: 결과 카드는 있고, 빈 상태 안내는 없다.
      expect(
        screen.getByTestId(`stay-card-${stayKey(RESULT_ITEM)}`)
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('stay-search-empty')).toBeNull();
    });
  });

  describe('접근성 role 회귀 (AC-8)', () => {
    it('empty 두 버튼이 role="button"', () => {
      // 준비: 두 버튼이 모두 보이도록 적용필터 있음.
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          state={EMPTY_STATE}
          activeFilterCount={2}
        />
      );

      // 단언: 스크린리더가 버튼으로 읽는다(StateNotice 가 이미 부여 — 회귀만 확인).
      expect(
        screen.getByTestId('stay-search-empty-region').props.accessibilityRole
      ).toBe('button');
      expect(
        screen.getByTestId('stay-search-empty-filter').props.accessibilityRole
      ).toBe('button');
    });

    it('filter-zero 두 버튼이 role="button"', () => {
      // 준비
      render(
        <StaySearchScreen region="부산" items={[]} state={FILTER_ZERO_STATE} />
      );

      // 단언
      expect(
        screen.getByTestId('stay-search-filterzero-clear').props
          .accessibilityRole
      ).toBe('button');
      expect(
        screen.getByTestId('stay-search-filterzero-reset').props
          .accessibilityRole
      ).toBe('button');
    });
  });
});

// 옛 StaySearchScreen.fab — TRIP-725·TRIP-1103
describe('원형 FAB 2개 (옛 .fab)', () => {
  /**
   * TRIP-725 — e02 우하단 FAB 을 알약 "여행 만들기" 1개에서 **원형 FAB 2개**(위 흰 원 하트 →
   * 담은 숙소 · 아래 분홍 원 ＋ → 숙소 등록)로 바꾼다. 목적지(`/stays/saved`·`/stays/register`)는
   * `StaySearchPage`가 정한다(화면은 라우터를 모른다 — 구조 가드). 이 파일은 화면이 각 FAB press 를
   * 자기 콜백으로 잇는지, 옛 알약 FAB 이 사라졌는지, 목록 끝 여백이 2단 FAB 높이를 덮는지까지만 본다.
   *
   * 무엇을 보장하나:
   *  - 흰 하트 FAB press → onPressSaved 1회 · + FAB press → onPressRegister 1회.
   *  - 스크린리더 이름이 "담은 숙소"/"숙소 등록"으로 갈린다(글리프가 이름에 안 샌다).
   *  - 옛 알약 FAB(`stay-search-fab`·"여행 만들기")이 완전히 소멸한다(개명 아닌 교체).
   *  - 목록 끝 여백(footer)이 2단 FAB 최상단(흰 FAB bottom152+size56=208)을 덮어 마지막 카드를
   *    가리지 않는다 — 픽셀 겹침·두 원 좌표·간격·색은 6-b 실기 몫이고, 여기선 footer 값만 잠근다.
   *  - 콜백 미지정이어도 눌러서 크래시하지 않는다(기존 2-prop 호출 회귀 보호).
   */
  describe('e02 2단 원형 FAB 배선 (TRIP-725 · AC-7 · AC-9)', () => {
    it('흰 하트 FAB 을 누르면 onPressSaved 가 불린다', () => {
      const onPressSaved = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          onPressSaved={onPressSaved}
        />
      );

      fireEvent.press(screen.getByTestId('stay-search-fab-saved'));
      expect(onPressSaved).toHaveBeenCalledTimes(1);
    });

    it('분홍 ＋ FAB 을 누르면 onPressRegister 가 불린다', () => {
      const onPressRegister = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          onPressRegister={onPressRegister}
        />
      );

      fireEvent.press(screen.getByTestId('stay-search-fab-register'));
      expect(onPressRegister).toHaveBeenCalledTimes(1);
    });

    it('스크린리더가 두 FAB 이름을 "담은 숙소"/"숙소 등록"으로 읽는다', () => {
      render(<StaySearchScreen region="부산" items={[]} />);

      // accessibilityLabel 이 붙어 분홍하트·흰＋ 글리프가 이름에 안 샌다.
      expect(screen.getByLabelText('담은 숙소')).toBe(
        screen.getByTestId('stay-search-fab-saved')
      );
      expect(screen.getByLabelText('숙소 등록')).toBe(
        screen.getByTestId('stay-search-fab-register')
      );
    });

    it('옛 알약 FAB(stay-search-fab·"여행 만들기")이 완전히 사라진다', () => {
      render(<StaySearchScreen region="부산" items={[]} />);

      // 완전일치라 접두 `stay-search-fab-saved` 와 충돌하지 않는다(§5 실검증).
      expect(screen.queryByTestId('stay-search-fab')).toBeNull();
      expect(screen.queryByText(/여행 만들기/)).toBeNull();
    });

    it('목록 끝 여백이 2단 FAB 최상단(208)을 덮어 마지막 카드를 안 가린다', () => {
      render(<StaySearchScreen region="부산" items={[]} />);

      const footer = screen.getByTestId('stay-search-list-footer');
      const cls = String(footer.props.className ?? '');
      expect(cls).toContain('h-[208px]');
    });

    it('콜백 미지정이면 두 FAB 을 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
      render(<StaySearchScreen region="부산" items={[]} />);

      expect(() =>
        fireEvent.press(screen.getByTestId('stay-search-fab-saved'))
      ).not.toThrow();
      expect(() =>
        fireEvent.press(screen.getByTestId('stay-search-fab-register'))
      ).not.toThrow();
    });
  });

  // TRIP-1103 AC-2 — NativeWind 의 rem 기준이 14px 이라 `h-14`(3.5rem)는 49px 로 렌더된다
  // (HomeScreen.tsx CreateTripFab 주석 실측). Figma 56px 는 브래킷 `h-[56px]` 로만 옮겨진다.
  describe('TRIP-1103 AC-2 · e02 두 FAB 지름 56px (h-14 rem 함정 제거)', () => {
    it.each(['stay-search-fab-saved', 'stay-search-fab-register'])(
      '%s 가 h-[56px] w-[56px] 이고 h-14·w-14 는 없다',
      (testID) => {
        render(<StaySearchScreen region="부산" items={[]} />);

        const tokens = String(
          screen.getByTestId(testID).props.className ?? ''
        ).split(/\s+/);
        expect(tokens).toEqual(
          expect.arrayContaining(['h-[56px]', 'w-[56px]'])
        );
        expect(tokens).not.toContain('h-14');
        expect(tokens).not.toContain('w-14');
      }
    );
  });
});

// 옛 StaySearchScreen.filter — TRIP-415·TRIP-457
describe('지역·필터·가격대 칩 (옛 .filter)', () => {
  /**
   * e02 지역·필터 칩 실동작(TRIP-415) — `onPress={undefined}`이던 필터 칩을 콜백으로 잇는다.
   * 화면은 라우터·시트를 모른다(순수 프레젠테이션) — 누른 칩의 axis 를 `onPressFilter`로 넘기고,
   * 지역 재조회·필터 시트 열기는 `StaySearchPage`가 진다.
   *
   * 무엇을 보장하나:
   *  - 지역 칩·필터 칩을 누르면 `onPressFilter`가 그 axis 로 불린다(undefined 스텁이면 red).
   *  - 필터가 걸리면(activeFilterCount>0) '필터' 칩에 개수가 드러난다(AC: 선택됨이 칩에 보임).
   *  - 콜백 미지정(기존 2-prop 호출)이어도 눌러서 크래시하지 않는다(회귀 보호).
   */
  describe('e02 필터 칩 배선 (TRIP-415)', () => {
    it('지역 칩·필터 칩을 누르면 onPressFilter 가 그 axis 로 불린다', () => {
      const onPressFilter = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          onPressFilter={onPressFilter}
        />
      );

      fireEvent.press(screen.getByTestId('stay-search-filter-region'));
      fireEvent.press(screen.getByTestId('stay-search-filter-more'));

      expect(onPressFilter).toHaveBeenNthCalledWith(1, 'region');
      expect(onPressFilter).toHaveBeenNthCalledWith(2, 'more');
    });

    it('필터가 걸리면 "필터" 칩에 선택 개수가 드러난다', () => {
      render(
        <StaySearchScreen region="부산" items={[]} activeFilterCount={2} />
      );

      // '필터' 칩(more)에 개수 2가 보인다 — 선택됐음이 칩에 드러난다(AC).
      expect(screen.getByTestId('stay-search-filter-more')).toHaveTextContent(
        /2/
      );
    });

    it('필터가 0이면 개수 배지가 없다(선택 안 됨과 짝)', () => {
      render(
        <StaySearchScreen region="부산" items={[]} activeFilterCount={0} />
      );

      expect(
        screen.getByTestId('stay-search-filter-more')
      ).not.toHaveTextContent(/\d/);
    });

    it('콜백 미지정이면 칩을 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
      render(<StaySearchScreen region="부산" items={[]} />);

      expect(() => {
        fireEvent.press(screen.getByTestId('stay-search-filter-region'));
        fireEvent.press(screen.getByTestId('stay-search-filter-more'));
      }).not.toThrow();
    });
  });

  /** 칩 라벨은 가격대 시트와 같은 출처(PRICE_BUCKETS)에서 온다 — 시트에서 고른 이름이 칩에 그대로 뜬다. */
  function bucketLabel(id: PriceBucketId): string {
    const label = PRICE_BUCKETS.find((bucket) => bucket.id === id)?.label;
    if (!label) throw new Error(`PRICE_BUCKETS 에 ${id} 가 없다`);
    return label;
  }

  /**
   * TRIP-989 E-1 — 가격대를 골라도 칩이 그대로라 "적용됐는지" 알 수 없었다(Figma e02 에도 이 얼굴이
   * 없다 — 01b Q2 로 새로 정함). 적용되면 라벨이 고른 가격대 이름으로 바뀌고, 선택 신호
   * (`accessibilityState.selected`)와 기존 활성 색(`primary-pale`, d04 정렬 칩과 같은 토큰)을 갖는다.
   */
  describe('e02 가격대 칩 활성 얼굴 (TRIP-989 E-1 · US-STAY-02)', () => {
    it('가격대가 적용되면 칩이 그 가격대 이름을 보이고 선택됨·연핑크가 된다', () => {
      render(
        <StaySearchScreen region="부산" items={[]} priceBucket="under-100k" />
      );

      const chip = screen.getByTestId('stay-search-filter-price');
      expect(chip).toBeSelected();
      expect(
        within(chip).getByText(bucketLabel('under-100k'))
      ).toBeOnTheScreen();
      expect(within(chip).queryByText('가격대')).toBeNull();
      expect(String(chip.props.className)).toContain('primary-pale');
    });

    it.each([['all' as const], [undefined]])(
      '짝: 가격대가 %s 이면 칩은 "가격대" 그대로이고 선택되지 않았다',
      (priceBucket) => {
        render(
          <StaySearchScreen
            region="부산"
            items={[]}
            priceBucket={priceBucket}
          />
        );

        const chip = screen.getByTestId('stay-search-filter-price');
        expect(chip).not.toBeSelected();
        expect(within(chip).getByText('가격대')).toBeOnTheScreen();
        expect(String(chip.props.className)).not.toContain('primary-pale');
      }
    );
  });
});

// 옛 StaySearchScreen.nameSearch — TRIP-469
describe('이름·지역 검색 (옛 .nameSearch — 통합 심판 0, 단위 전용)', () => {
  /**
   * TRIP-469 — e02 숙소 검색 결과에 이름·지역 검색창을 넣는다(예전엔 TextInput 자체가 없었다).
   *
   * 무엇을 보장하나:
   *  · onChangeNameQuery 를 줄 때만 검색창(stay-search-name-input)이 뜬다(미지정=무회귀).
   *  · nameQuery 로 이름/지역을 클라 부분일치로 좁힌다(카드·개수 둘 다).
   *  · results 인데 검색어가 0건을 만들면 빈 body 대신 "검색 결과가 없어요"를 낸다.
   */

  const ITEMS: StayItem[] = [
    {
      externalSource: 'NAVER',
      externalId: 's1',
      name: '해운대 그랜드 호텔',
      lat: 35.1587,
      lng: 129.1604,
      region: '해운대',
      amenities: ['ocean'],
      stayType: 'HOTEL',
      price: { amount: 145000, currency: 'KRW' },
    },
    {
      externalSource: 'NAVER',
      externalId: 's2',
      name: '서면 시티 호텔',
      lat: 35.1577,
      lng: 129.0594,
      region: '서면',
      amenities: ['wifi'],
      stayType: 'HOTEL',
      price: { amount: 90000, currency: 'KRW' },
    },
  ];
  const KEY_A = stayKey(ITEMS[0]);
  const KEY_B = stayKey(ITEMS[1]);

  describe('StaySearchScreen — 이름·지역 검색창(TRIP-469)', () => {
    it('onChangeNameQuery 미지정이면 검색창이 안 뜬다(무회귀)', () => {
      render(<StaySearchScreen region="부산" items={ITEMS} />);
      expect(screen.queryByTestId('stay-search-name-input')).toBeNull();
      // 두 카드 그대로.
      expect(screen.getByTestId(`stay-card-${KEY_A}`)).toBeOnTheScreen();
      expect(screen.getByTestId(`stay-card-${KEY_B}`)).toBeOnTheScreen();
    });

    it('onChangeNameQuery 를 주면 검색창이 뜨고 입력이 콜백으로 간다', () => {
      const onChange = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          nameQuery=""
          onChangeNameQuery={onChange}
        />
      );
      fireEvent.changeText(
        screen.getByTestId('stay-search-name-input'),
        '서면'
      );
      expect(onChange).toHaveBeenCalledWith('서면');
    });

    it('이름으로 좁힌다 — 매칭 카드만 남는다', () => {
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          nameQuery="그랜드"
          onChangeNameQuery={() => {}}
        />
      );
      expect(screen.getByTestId(`stay-card-${KEY_A}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`stay-card-${KEY_B}`)).toBeNull();
    });

    it('지역으로도 좁힌다', () => {
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          nameQuery="서면"
          onChangeNameQuery={() => {}}
        />
      );
      expect(screen.getByTestId(`stay-card-${KEY_B}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`stay-card-${KEY_A}`)).toBeNull();
    });

    it('results 인데 검색어가 0건을 만들면 "검색 결과가 없어요"를 낸다', () => {
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          nameQuery="없는숙소"
          onChangeNameQuery={() => {}}
        />
      );
      expect(screen.getByTestId('stay-search-name-empty')).toBeOnTheScreen();
      expect(screen.queryByTestId(`stay-card-${KEY_A}`)).toBeNull();
    });

    it('빈 검색어는 전체를 그대로 둔다(no-match 아님)', () => {
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          nameQuery=""
          onChangeNameQuery={() => {}}
        />
      );
      expect(screen.queryByTestId('stay-search-name-empty')).toBeNull();
      expect(screen.getByTestId(`stay-card-${KEY_A}`)).toBeOnTheScreen();
      expect(screen.getByTestId(`stay-card-${KEY_B}`)).toBeOnTheScreen();
    });
  });
});

// 옛 StaySearchScreen.registerEntry — R-16
describe('숙소 직접 등록 입구 (옛 .registerEntry)', () => {
  /**
   * R-16 (01b Seed §3-6) — e02의 "숙소 직접 등록" 버튼이 e05로 가는 문이 된다.
   *
   * 무엇을 보장하나: 지금 시각 스텁(눌러도 아무 일 없음)인 등록 유도 버튼들이 실제로
   * 콜백을 부른다. 목적지 라우트로 보내는 일은 `StaySearchPage`가 하고(화면은 `expo-router`를
   * 못 만진다 — 구조 가드), 이 파일은 "버튼이 눌리면 위로 올라간다"까지만 잰다.
   *
   * 소스 전수 grep 결과 e02의 등록 버튼은 **2개**다(`stay-search-register`(empty 상태) ·
   * `stay-search-error-register`(error 상태)). 브리프 §10-③이 "3개"라 적었으나 소스가 정본이다.
   *
   * 기존 `StaySearchScreen.test.tsx`·`.states.test.tsx`는 동결이라 건드리지 않는다 —
   * 새 prop은 옵셔널이어야 하고, 그 회귀는 아래 마지막 it이 잠근다.
   */

  describe('R-16 · e02 등록 버튼 → 등록 화면 (§3-6)', () => {
    it('empty 상태의 등록 유도 카드를 누르면 콜백이 불린다', () => {
      const onPressRegister = jest.fn();
      const state: StaySearchState = { kind: 'empty', degraded: false };
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          state={state}
          onPressRegister={onPressRegister}
        />
      );

      fireEvent.press(screen.getByTestId('stay-search-register'));
      expect(onPressRegister).toHaveBeenCalledTimes(1);
    });

    it('error 상태의 "숙소 직접 등록" 버튼을 누르면 같은 콜백이 불린다', () => {
      const onPressRegister = jest.fn();
      const state: StaySearchState = { kind: 'error' };
      render(
        <StaySearchScreen
          region="부산"
          items={[]}
          state={state}
          onPressRegister={onPressRegister}
        />
      );

      fireEvent.press(screen.getByTestId('stay-search-error-register'));
      expect(onPressRegister).toHaveBeenCalledTimes(1);
    });

    it('짝(회귀): onPressRegister 없이 렌더해도 버튼은 그대로 있고 눌러도 죽지 않는다', () => {
      const state: StaySearchState = { kind: 'empty', degraded: false };
      render(<StaySearchScreen region="부산" items={[]} state={state} />);

      const button = screen.getByTestId('stay-search-register');
      expect(button).toBeOnTheScreen();
      // 동결 테스트들이 이 3-prop 호출 형태를 그대로 쓴다 — 새 prop이 필수가 되면 그쪽이 깨진다.
      expect(() => fireEvent.press(button)).not.toThrow();
    });
  });
});

// 옛 StaySearchScreen.save — TRIP-417
describe('저장 하트 렌더 계약 (옛 .save)', () => {
  /**
   * TRIP-417 AC-1·AC-2·AC-3·AC-8·AC-10 — 숙소 검색 카드의 저장 하트 **렌더 계약**.
   *
   * 무엇을 보장하나: `StaySearchScreen`은 옵셔널 prop 3개(`savedKeys`·`onToggleSave`·`pendingKeys`)만
   * 더 받아, 각 카드 하트를 **채움/빈으로 그리고**(AC-3) 누름을 **item 그대로 콜백으로 올린다**(AC-1·2).
   * 저장/해제 판정·네트워크는 여전히 페이지 몫이다(화면은 라우터·훅을 모른다 — 구조 가드가 잠금).
   *
   * *(개념)* 빈/찬 하트는 **색(SVG fill)으로 안 잰다** — repo-trap: `*Glyphs.tsx`의 fill 변화는 jest
   * 렌더 트리에 안 남아 "저장됐다는 거짓말"이 통과한다. 대신 두 신호로 잰다:
   *   ① **컴포넌트 정체성** — 빈=`HeartOutlineGlyph`, 찬=`HeartFilledGlyph`로 **서로 다른 컴포넌트**다.
   *      각자 다른 testID(`stay-card-save-{key}-outline` / `-filled`)를 달아 어느 쪽이 그려졌나를 잰다.
   *      testID를 `save-` 하위에 둔 이유: 동결 `StaySearchScreen.test.tsx`의 카드 카운트 정규식
   *      `/^stay-card-(?!save-|photo-)/`에 안 걸리게(그 짝을 안 지키면 동결 테스트가 red — 02a §4 F-1).
   *   ② **accessibilityState.selected** — `toBeSelected()`가 읽는 접근성 상태(담김=선택됨, AC-10).
   * 하나만 맞고 하나만 틀린 구현(selected=false인데 찬 하트)도 잡으려 둘 다 건다(d02 T-15 동형).
   *
   * 왜 화면 단위인가: "props를 받았을 때 무엇을 그리는가"를 잰다. 실제로 나간 요청·저장/해제 판정·
   * 라우팅은 `pages/stay-search/ui/StaySearchPage.save.integration.test.tsx` 몫이다.
   */

  const ITEMS: StayItem[] = [
    {
      externalSource: 'NAVER',
      externalId: 's1',
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
      externalId: 's2',
      name: '서면 시티 호텔',
      lat: 35.1577,
      lng: 129.0594,
      region: '서면',
      amenities: ['wifi'],
      stayType: 'HOTEL',
      price: { amount: 10000, currency: 'KRW' },
    },
    {
      externalSource: 'AGODA',
      externalId: 's3',
      name: '광안리 오션뷰',
      lat: 35.1531,
      lng: 129.1186,
      region: '광안리',
      amenities: ['ocean'],
      stayType: 'PENSION',
      price: { amount: 20000, currency: 'KRW' },
    },
  ];

  const KEY_A = stayKey(ITEMS[0]);
  const KEY_B = stayKey(ITEMS[1]);

  describe('S1 · 채움/빈 하트 정체성 + selected (AC-3 · AC-10)', () => {
    it('savedKeys에 든 카드만 찬 하트(+selected)이고 나머지는 빈 하트(+not selected)다', () => {
      // 준비 — A만 담김.
      render(
        <StaySearchScreen region="부산" items={ITEMS} savedKeys={[KEY_A]} />
      );

      // 단언 ① 담김 카드 A: 찬 하트 컴포넌트가 있고 빈 하트는 없다 + selected=true.
      expect(
        screen.getByTestId(`stay-card-save-${KEY_A}-filled`)
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId(`stay-card-save-${KEY_A}-outline`)
      ).toBeNull();
      expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeSelected();

      // 단언 ② 미담김 카드 B: 빈 하트가 있고 찬 하트는 없다 + selected=false.
      expect(
        screen.getByTestId(`stay-card-save-${KEY_B}-outline`)
      ).toBeOnTheScreen();
      expect(screen.queryByTestId(`stay-card-save-${KEY_B}-filled`)).toBeNull();
      expect(screen.getByTestId(`stay-card-save-${KEY_B}`)).not.toBeSelected();
    });
  });

  describe('S2 · 하트 누름은 item을 그대로 올린다 (AC-1 · AC-2)', () => {
    it('찬 하트든 빈 하트든 press → onToggleSave(item) 한 번 (저장/해제 판정은 페이지 몫)', () => {
      // 준비 — A는 찬 하트, B는 빈 하트.
      const onToggleSave = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          savedKeys={[KEY_A]}
          onToggleSave={onToggleSave}
        />
      );

      // 실행 — 찬 하트(A) 누르고, 빈 하트(B) 누른다.
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_B}`));

      // 단언 — 화면은 저장/해제를 구분하지 않고 눌린 item만 순서대로 올린다.
      expect(onToggleSave.mock.calls).toEqual([[ITEMS[0]], [ITEMS[1]]]);
    });
  });

  describe('S3 · 연타 가드 — 대기 중 하트는 disabled (AC-8)', () => {
    it('pendingKeys에 든 하트는 눌러도 콜백이 안 오고, 나머지는 정상 동작한다', () => {
      // 준비 — A만 응답 대기 중.
      const onToggleSave = jest.fn();
      render(
        <StaySearchScreen
          region="부산"
          items={ITEMS}
          savedKeys={[]}
          onToggleSave={onToggleSave}
          pendingKeys={[KEY_A]}
        />
      );

      // 단언 ① — 대기 중 하트는 비활성 상태다(accessibilityState.disabled).
      expect(screen.getByTestId(`stay-card-save-${KEY_A}`)).toBeDisabled();
      expect(screen.getByTestId(`stay-card-save-${KEY_B}`)).not.toBeDisabled();

      // 실행 — 대기 중 A를 눌러도(비활성이라 press가 onPress를 안 부른다, 02a §5-3 실측), B는 부른다.
      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`));
      expect(onToggleSave).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_B}`));
      expect(onToggleSave.mock.calls).toEqual([[ITEMS[1]]]);
    });
  });

  describe('S4 · 신 prop 미지정 무회귀 (2-prop)', () => {
    it('savedKeys·onToggleSave를 안 주면 전 카드가 빈 하트·not selected이고 눌러도 안 죽는다', () => {
      // 준비 — 기존 2-prop 호출 형태 그대로.
      render(<StaySearchScreen region="부산" items={ITEMS} />);

      // 단언 — 미지정이면 전부 빈 하트(찬 하트 0건)·not selected(무회귀 — 저장 API 없을 때 채워진
      // 하트를 그리면 거짓말이다).
      ITEMS.forEach((item) => {
        const key = stayKey(item);
        expect(
          screen.getByTestId(`stay-card-save-${key}-outline`)
        ).toBeOnTheScreen();
        expect(screen.queryByTestId(`stay-card-save-${key}-filled`)).toBeNull();
        expect(screen.getByTestId(`stay-card-save-${key}`)).not.toBeSelected();
      });

      // 콜백이 없어도 press가 throw하지 않는다(정직한 스텁 — onPress 부재).
      expect(() =>
        fireEvent.press(screen.getByTestId(`stay-card-save-${KEY_A}`))
      ).not.toThrow();
    });
  });
});

// 옛 StaySearchScreen.states — AC-1~AC-7·AC-9·AC-10 (INV-4)
describe('5가지 상태 얼굴 (옛 .states)', () => {
  /**
   * AC-1~AC-7 · AC-9 · AC-10 · V2(01b Seed · 02a §4 F3) — 5가지 상태 변형(loading·empty·
   * filter-zero·partial-failure·error) + default 회귀의 렌더 계약.
   *
   * 무엇을 보장하나: `state` prop(판별 유니온)에 따라 화면이 상태별 문구·버튼·배지·스켈레톤을
   * 그리고(AC-1~7), 배너와 안내가 동시에 뜨는 겹침(AC-10)이 구조적으로 성립하며, `state`를
   * 생략한 2-prop 호출은 TRIP-181 default 화면을 한 글자도 바꾸지 않는다(AC-9). 렌더로 못 보는
   * 소스 층(FORBIDDEN 문자열 등)을 보던 `staySearchStructure`는 TRIP-1145 로 지웠다 — 이 파일은 렌더
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

  // TRIP-725 — 2톤 가격의 bold 노드(접미 "~" 제거). 카드가 bold+"~" 두 형제 Text 로 쪼갠다(AC-2).
  const BOLD_PRICE_BY_EXTERNAL_ID: Record<string, string> = {
    s3: '30,000원',
    s1: '10,000원',
    s2: '20,000원',
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

  /** `SocialLoginScreen.test.tsx` `비주얼 구조`의 classTokens·동결 파일에서 그대로 가져온다(리포 관례). 문자열
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

  describe('StaySearchScreen — loading (AC-1 · TRIP-726 AC-L1′·L3)', () => {
    it('안내 라벨·스켈레톤 4장(카드 틀)이 뜨고, 서브헤더에 개수가 없으며, 카드는 0장이다', () => {
      const state: StaySearchState = { kind: 'loading' };
      render(<StaySearchScreen region="부산" items={[]} state={state} />);

      expect(
        within(screen.getByTestId('stay-search-loading')).getByText(
          '숙소를 모으는 중'
        )
      ).toBeOnTheScreen();
      // AC-L3(동결 갱신) — 스켈레톤 2→4(01b 오버라이드: 세로형 유지 + 4장). 구 계약(2)이 살아 있으면
      // 4장 구현이 red 없이 통과하는 것을 막는 갱신이다(브리프 맹점⑤).
      expect(screen.queryAllByTestId(/^stay-search-skeleton-/)).toHaveLength(4);
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
      // AC-L1′(01b 오버라이드) — 각 스켈레톤을 카드 틀(border-hairline + rounded-card)로 감싼다.
      // soft shadow 는 style prop(#000000, raw-hex 스캔 밖)이라 룩은 6-b/831 몫 — 여기선 단언하지 않는다.
      expect(classTokens(screen.getByTestId('stay-search-skeleton-0'))).toEqual(
        expect.arrayContaining(['border-hairline', 'rounded-card'])
      );
      // AC-L1′ 세로형 잠금(5-b code-critic 참고-1) — 이 사이클의 핵심 결정은 "세로 유지"인데 방향을
      // 무는 심판이 없었다(카드 바깥 View 에 flex-row 만 넣으면 5스위트 전부 green). RN View 기본이
      // column 이라 세로의 표식은 flex-row 의 **부재**다. 위 arrayContaining 이 실토큰(border-hairline)
      // 존재로 "옳은 엘리먼트를 읽는다"를 보장하므로 이 부정 단언은 공허하지 않다(뮤테이션으로 실측).
      expect(
        classTokens(screen.getByTestId('stay-search-skeleton-0'))
      ).not.toContain('flex-row');
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
      expect(
        screen.queryAllByTestId('stay-search-partialfailure')
      ).toHaveLength(0);

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

      // AC-E1(TRIP-726) — 등록 유도 카드를 흰 카드 틀(border-hairline + rounded-card)로 감싼다.
      // 틀 클래스는 testID 엘리먼트(stay-search-register)에 얹힌다(StateNotice·EmptyBlock 선례 동형 —
      // 별도 래퍼 View 에 얹지 않는다, §5 실검증). 내용·testID·콜백은 위 단언들이 무회귀를 잠근다.
      expect(classTokens(reg)).toEqual(
        expect.arrayContaining(['border-hairline', 'rounded-card'])
      );
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
      expect(within(nullCard).queryByText('~')).toBeNull();

      // 나머지 두 카드는 2톤 금액(bold+"~")이 그대로 남는다 — null 처리가 옆 카드로 안 샌다.
      [ITEMS_WITH_NULL[0], ITEMS_WITH_NULL[2]].forEach((item) => {
        const card = screen.getByTestId(`stay-card-${stayKey(item)}`);
        expect(
          within(card).getByText(BOLD_PRICE_BY_EXTERNAL_ID[item.externalId])
        ).toBeOnTheScreen();
        expect(within(card).getByText('~')).toBeOnTheScreen();
      });

      expect(
        screen.getByTestId('stay-search-partialfailure')
      ).toBeOnTheScreen();
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
      // TRIP-725 — default 얼굴에도 2단 원형 FAB 2개가 그대로 뜨고, 옛 알약 FAB 은 없다.
      expect(screen.getByTestId('stay-search-fab-saved')).toBeOnTheScreen();
      expect(screen.getByTestId('stay-search-fab-register')).toBeOnTheScreen();
      expect(screen.queryByTestId('stay-search-fab')).toBeNull();

      // 새 상태 UI가 default로 새지 않는다(부정 4개) — 동결 파일은 이 testID들이 그때
      // 없었으므로 이 단언을 가질 수 없었다. 이 it이 "기본값이 정말 default 얼굴인가"를
      // 양쪽에서 잠근다.
      expect(
        screen.queryAllByTestId('stay-search-partialfailure')
      ).toHaveLength(0);
      expect(screen.queryAllByTestId('stay-search-loading')).toHaveLength(0);
      expect(screen.queryAllByTestId('stay-search-empty')).toHaveLength(0);
      expect(screen.queryAllByTestId('stay-search-error')).toHaveLength(0);
    });
  });
});

// 옛 StaySearchScreen.tabbar — TRIP-413
describe('하단 탭바 (옛 .tabbar)', () => {
  /**
   * e02 하단 탭바 복구(TRIP-413) — 화면이 그리던 복제 탭바가 `onPressTab={() => {}}`(빈 함수)라
   * 5탭 전부 무동작이던 것을 콜백으로 잇는다. 목적지(라우터)는 `StaySearchPage`가 정한다 —
   * 화면은 라우터를 모른다(구조 가드). 여기선 "누른 탭 key 가 콜백으로 그대로 온다"만 잰다.
   *
   * 무엇을 보장하나:
   *  - 탭을 누르면 `onPressTab`이 그 탭의 key 로 불린다(빈 함수 스텁이면 이 단언이 red).
   *  - 콜백 미지정(기존 2-prop 호출)이어도 눌러서 크래시하지 않는다(회귀 보호).
   */
  describe('e02 하단 탭바 배선 (TRIP-413)', () => {
    it('탭을 누르면 onPressTab 이 그 탭 key 로 불린다', () => {
      const onPressTab = jest.fn();
      render(
        <StaySearchScreen region="부산" items={[]} onPressTab={onPressTab} />
      );

      fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));
      fireEvent.press(screen.getByTestId('shell-tabbar-tab-itinerary'));

      expect(onPressTab).toHaveBeenNthCalledWith(1, 'home');
      expect(onPressTab).toHaveBeenNthCalledWith(2, 'itinerary');
    });

    it('콜백 미지정이면 탭을 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
      render(<StaySearchScreen region="부산" items={[]} />);

      expect(() =>
        fireEvent.press(screen.getByTestId('shell-tabbar-tab-explore'))
      ).not.toThrow();
    });
  });
});
