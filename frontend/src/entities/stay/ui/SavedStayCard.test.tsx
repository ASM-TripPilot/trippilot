import { Text } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { SavedStayCard } from './SavedStayCard';

/**
 * TRIP-807 · AC-4 — entities/stay/ui/SavedStayCard: 저장 숙소 degrade 카드(e04 세로·g02 시트 행 공용).
 *
 * 무엇을 보장하나(신규 개념 학습 1순위 — **degrade 카드 = 계약 공백을 정직하게 비운다**):
 *  - 🔴 이름 + `subtitle` 슬롯(있으면)만 그린다 — `SavedStay` 계약에 사진 URL·지역·거리·가격이 없어
 *    **가격·거리·₩ 문자열을 발명하지 않는다**(INV-1 · DC6). 사진은 회색 자리.
 *  - 🔴 담김 표식은 `accessibilityState.selected`(색 아님, ★4·★5) — e04 는 항상채움 표시용이라 카드에
 *    fill 토글 상태가 없다(하트는 소비처가 `trailing` 으로 주입 = 카드는 하트 불가지).
 *  - 🔴 `trailing` 슬롯(e04 항상채움 하트 · g02 선택 체크)과 `subtitle` 슬롯이 주입될 때만 렌더된다.
 *
 * `describe.each` 로 두 layout(vertical=e04 · row=g02)을 같은 계약으로 태운다 — 접두·트레일링만 다르고
 * 계약(이름·selected·subtitle·trailing·onPress)은 같다.
 *
 * *(개념)* ReactNode 슬롯 — 카드가 자식 요소를 통째로 받아 그대로 끼워 넣는 자리. 소비처가 무엇을
 *  그릴지 정하고 카드는 위치만 준다(하트든 체크든 카드는 모른다).
 *
 * 3동작 뼈대: 준비=layout·testID·slots → 실행=render/press → 단언=존재·selected·발명 0.
 */

type Layout = 'vertical' | 'row';
const LAYOUTS: Layout[] = ['vertical', 'row'];
const ROOT_ID: Record<Layout, string> = {
  vertical: 'saved-stay-card-ss-1',
  row: 'trip-base-staysheet-cand-ss-1',
};

describe.each(LAYOUTS)('SavedStayCard — layout=%s', (layout) => {
  const rootId = ROOT_ID[layout];

  it('🔴 DC1 · root testID + 이름 + 기본 selected 아님', () => {
    render(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );

    expect(screen.getByTestId(rootId)).toBeOnTheScreen();
    expect(screen.getByText('해운대 오션뷰')).toBeOnTheScreen();
    expect(screen.getByTestId(rootId)).not.toBeSelected();
  });

  it('🔴 DC2 · selected=true → accessibilityState.selected', () => {
    render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        selected
      />
    );

    expect(screen.getByTestId(rootId)).toBeSelected();
  });

  it('🔴 DC3 · subtitle 슬롯 — 주면 렌더, 미지정이면 부재', () => {
    const { rerender } = render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        subtitle={<Text testID="sub-slot">6.10~6.13</Text>}
      />
    );
    expect(screen.getByTestId('sub-slot')).toBeOnTheScreen();

    rerender(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );
    expect(screen.queryByTestId('sub-slot')).toBeNull();
  });

  it('🔴 DC4 · trailing 슬롯 — 주면 렌더, 미지정이면 부재', () => {
    const { rerender } = render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        trailing={<Text testID="trailing-slot">✓</Text>}
      />
    );
    expect(screen.getByTestId('trailing-slot')).toBeOnTheScreen();

    rerender(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );
    expect(screen.queryByTestId('trailing-slot')).toBeNull();
  });

  it('🔴 DC5 · onPress → root press 시 1회', () => {
    const onPress = jest.fn();
    render(
      <SavedStayCard
        testID={rootId}
        name="해운대 오션뷰"
        layout={layout}
        onPress={onPress}
      />
    );

    fireEvent.press(screen.getByTestId(rootId));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('🔴 DC6 · 발명 0 — 이름만 준 카드에 가격·거리·소요시간 문자열이 없다 (INV-1·INV-3)', () => {
    render(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout={layout} />
    );

    // 가격(₩·원~)·거리(km·m)·소요시간(분·시간·소요)을 카드가 지어내지 않는다.
    expect(screen.queryAllByText(/₩|원~|km/)).toHaveLength(0);
    expect(screen.queryAllByText(/분|시간|소요/)).toHaveLength(0);
    // 가짜통과 방지 짝 — 카드 자체는 떠 있다(빈 렌더로 "0건"이 초록 되는 것 차단).
    expect(screen.getByText('해운대 오션뷰')).toBeOnTheScreen();
  });
});

/**
 * TRIP-741 · AC-4·5·6·6b — g02 전용 row 브랜치 optional 슬롯(사진·동네·거리·가격) + 선택 테두리.
 *
 * 무엇을 보장하나(**계약 공백의 정직한 degrade**가 핵심):
 *  - 🔴 AC-6  imageUrl 지정 시 `<Image testID={id}-photo>`, 미지정 시 회색 placeholder(`{id}-photo-placeholder`).
 *  - 🔴 AC-6b region·distance·priceLabel 지정 시 그 값이 렌더, 미지정 시 미렌더(값이 있을 때만 렌더 = degrade).
 *  - 🔴 AC-5  optional 을 하나도 안 주면(=실데이터 경로, `SavedStay` 계약 공백) 가격·거리 문자열 0건(INV-1).
 *  - 🔴 AC-4  선택 카드 테두리 `border-[1.5px] border-primary`·미선택 `border-hairline-strong`·radius `rounded-[12px]`.
 *
 * 이 슬롯들은 **row 브랜치(g02) 전용**이다 — vertical(e04)은 무시한다(scope 잠금).
 *
 * *(개념 — className 심판 한계)* NativeWind className 은 jest 렌더 트리에 평문 prop 으로 남아(실측 P1)
 *  토큰 배열로 잰다. 실제 픽셀·색은 안 남으므로 두께·분홍 실색은 6-b 몫이고, 여기선 클래스 토큰까지만.
 *
 * *(개념 — 값은 표시용 문자열)* region·distance·priceLabel 은 카드가 포맷하지 않는 **완성 문자열**을 받는다
 *  (카드는 표시만, 포맷은 소비처/프리뷰). 그래서 카드가 거리를 계산해 duration 을 만들 여지가 없다(INV-3).
 */
function cls(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '').split(/\s+/);
}

describe('SavedStayCard — g02 row optional 슬롯 (TRIP-741)', () => {
  const rootId = 'trip-base-staysheet-cand-ss-1';

  it('🔴 AC-6 · imageUrl 지정 → 사진 렌더 + placeholder 부재', () => {
    render(
      <SavedStayCard
        testID={rootId}
        name="광안리 뷰 호텔"
        layout="row"
        imageUrl="https://cdn.example/gwangalli.jpg"
      />
    );

    expect(screen.getByTestId(`${rootId}-photo`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`${rootId}-photo-placeholder`)).toBeNull();
  });

  it('🔴 AC-6 · imageUrl 미지정 → 회색 placeholder + 사진 부재 (degrade)', () => {
    render(
      <SavedStayCard testID={rootId} name="광안리 뷰 호텔" layout="row" />
    );

    expect(screen.getByTestId(`${rootId}-photo-placeholder`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`${rootId}-photo`)).toBeNull();
  });

  it('🔴 AC-6b · region·priceLabel 지정 → 두 값 렌더 (거리 슬롯은 제거됨)', () => {
    // 이름은 지역어를 안 담는다("숙소 A") — region 단언이 이름과 겹쳐 오탐 나지 않게.
    render(
      <SavedStayCard
        testID={rootId}
        name="숙소 A"
        layout="row"
        region="광안리"
        priceLabel="165,000원~"
        subtitle={<Text>6/11–6/12 · 1박</Text>}
      />
    );

    const card = screen.getByTestId(rootId);
    // 카드가 여러 Text 를 이어붙이므로 RegExp(부분 포함)로 잰다(문자열이면 완전일치라 실패).
    expect(card).toHaveTextContent(/광안리/);
    expect(card).toHaveTextContent(/165,000원~/);
    // 거리 표시는 제거됨(기준점 미정·BE 미제공, 제품 결정) — region 을 줘도 거리 숫자는 안 뜬다.
    expect(card).not.toHaveTextContent(/\d+\s*m\b|km/);
  });

  it('🔴 AC-6b · region·priceLabel 미지정 → 미렌더 (degrade)', () => {
    render(
      <SavedStayCard
        testID={rootId}
        name="숙소 A"
        layout="row"
        subtitle={<Text>6/11–6/12 · 1박</Text>}
      />
    );

    const card = screen.getByTestId(rootId);
    expect(card).not.toHaveTextContent(/광안리/);
    expect(card).not.toHaveTextContent(/원~|₩/);
  });

  it('🔴 AC-5 · 실데이터 경로(optional 0개) — 가격·거리 문자열 0건 (INV-1)', () => {
    // 실앱은 SavedStay 계약에 사진·지역·거리·가격이 없어 이름 + 날짜만 뜬다(Figma 목업 복붙 금지).
    render(
      <SavedStayCard
        testID={rootId}
        name="광안리 뷰 호텔"
        layout="row"
        subtitle={<Text>6/11–6/12 · 1박</Text>}
      />
    );

    const card = screen.getByTestId(rootId);
    expect(card).not.toHaveTextContent(/원|₩/);
    expect(card).not.toHaveTextContent(/\d+\s*m\b|km/);
    // 가짜통과 방지 짝 — 카드·이름·날짜는 떠 있다.
    expect(card).toHaveTextContent(/광안리 뷰 호텔/);
    expect(card).toHaveTextContent(/6\/11–6\/12 · 1박/);
  });

  it('🔴 AC-4 · 선택 카드 테두리 border-[1.5px] border-primary + rounded-[12px]', () => {
    render(
      <SavedStayCard
        testID={rootId}
        name="광안리 뷰 호텔"
        layout="row"
        selected
      />
    );

    const tokens = cls(screen.getByTestId(rootId));
    expect(tokens).toContain('border-[1.5px]');
    expect(tokens).toContain('border-primary');
    expect(tokens).toContain('rounded-[12px]');
    // radius 는 rounded-card(16) 가 아니다(정합 대상 — Figma 12).
    expect(tokens).not.toContain('rounded-card');
  });

  it('🔴 AC-4 · 미선택 카드 테두리 border-hairline-strong (1.5px·분홍 아님) + rounded-[12px]', () => {
    render(
      <SavedStayCard testID={rootId} name="광안리 뷰 호텔" layout="row" />
    );

    const tokens = cls(screen.getByTestId(rootId));
    expect(tokens).toContain('border-hairline-strong');
    expect(tokens).toContain('rounded-[12px]');
    expect(tokens).not.toContain('border-[1.5px]');
    expect(tokens).not.toContain('border-primary');
  });

  it('🔴 슬롯은 row 전용 — vertical(e04)은 imageUrl 을 무시한다 (scope 잠금)', () => {
    render(
      <SavedStayCard
        testID="saved-stay-card-ss-1"
        name="해운대 오션뷰"
        layout="vertical"
        imageUrl="https://cdn.example/x.jpg"
      />
    );

    // vertical 은 자체 178px 회색 자리만 — row 사진 슬롯 testID 를 안 낸다.
    expect(screen.queryByTestId('saved-stay-card-ss-1-photo')).toBeNull();
  });
});

/**
 * TRIP-729 · AC-1·2·3·5 — e04 vertical 카드 Figma 정합(거점 배지·지역줄·2톤 가격·radius).
 *
 * 무엇을 보장하나(**degrade = 계약이 채우는 값만 정직하게 그린다**):
 *  - 🔴 AC-2 `isBase===true` 면 사진 좌상단 `거점` 배지(`{root}-base-badge` testID + "거점" 텍스트),
 *    false/미지정이면 미렌더. **배지 존재는 testID 로만 잰다** — 핀 SVG fill·모양·분홍 배지색은
 *    `*Glyphs.tsx` fill 무심판이라 어느 심판도 못 본다(★1, 6-b/TRIP-831). 이 배지는 **vertical 전용** —
 *    row(g02)는 isBase 를 무시한다(imageUrl scope 잠금 선례 동형).
 *  - 🔴 AC-3 `region` 지정 시 이름 아래 muted 지역줄(거리 미표시), `priceLabel` 지정 시 **2톤 가격줄**
 *    (금액 bold ink + "~" muted = **View 형제 두 Text**). 미지정이면 각각 미렌더(degrade).
 *  - 🔴 AC-1 vertical 카드 radius `rounded-[12px]`(Figma 12, 현행 `rounded-card`=16 에서).
 *  - 🔴 AC-5 이름만 준 vertical 은 거점·지역·가격 문자열 0(발명 0 · INV-1).
 *
 * *(개념 — 2톤 split · [[getByText 집계 경계]])* `getByText` 는 **완전일치·host Text 노드 단위**다.
 *  중첩 Text 는 합쳐 재지만 **View 형제는 각 노드로 갈린다**. 그래서 2톤을 `<View><Text>145,000원</Text>
 *  <Text>~</Text></View>` 로 그리면 `getByText('145,000원')`·`getByText('~')` 가 **각각** 매치된다 —
 *  단일 `'145,000원~'` 나 중첩이면 `getByText('145,000원')` 이 탈락(부분 아님·완전일치). 이 두 단언이
 *  곧 "2톤으로 갈렸다"를 강제한다(색 tone 은 className 토큰으로 덧잠금 — jest 렌더 트리에 평문으로 남음).
 */
describe('SavedStayCard — e04 vertical Figma 정합 (TRIP-729)', () => {
  const rootId = 'saved-stay-card-ss-1';

  it('🔴 AC-1 · vertical 카드 radius rounded-[12px] (rounded-card 아님)', () => {
    render(<SavedStayCard testID={rootId} name="숙소 A" layout="vertical" />);

    const tokens = cls(screen.getByTestId(rootId));
    expect(tokens).toContain('rounded-[12px]');
    expect(tokens).not.toContain('rounded-card');
  });

  it('🔴 AC-2 · isBase=true → 거점 배지(testID + "거점") 렌더', () => {
    render(
      <SavedStayCard testID={rootId} name="숙소 A" layout="vertical" isBase />
    );

    expect(screen.getByTestId(`${rootId}-base-badge`)).toBeOnTheScreen();
    expect(screen.getByText('거점')).toBeOnTheScreen();
  });

  it('🔴 AC-2 · isBase 미지정 → 배지 미렌더 (degrade)', () => {
    render(<SavedStayCard testID={rootId} name="숙소 A" layout="vertical" />);

    expect(screen.queryByTestId(`${rootId}-base-badge`)).toBeNull();
    expect(screen.queryByText('거점')).toBeNull();
  });

  it('🔴 AC-2 · isBase 는 vertical 전용 — row(g02)는 배지를 안 낸다 (scope 잠금)', () => {
    render(
      <SavedStayCard
        testID="trip-base-staysheet-cand-ss-1"
        name="숙소 A"
        layout="row"
        isBase
      />
    );

    expect(
      screen.queryByTestId('trip-base-staysheet-cand-ss-1-base-badge')
    ).toBeNull();
  });

  it('🔴 AC-3 · region 지정 → muted 지역줄 렌더 + 거리 미표시', () => {
    // 이름은 지역어를 안 담는다("숙소 A") — region 단언이 이름과 겹쳐 오탐 나지 않게.
    render(
      <SavedStayCard
        testID={rootId}
        name="숙소 A"
        layout="vertical"
        region="해운대"
      />
    );

    expect(screen.getByText('해운대')).toBeOnTheScreen();
    expect(cls(screen.getByText('해운대'))).toContain('text-muted');
    // 거리(제품 결정으로 미표시)는 region 을 줘도 안 뜬다.
    expect(screen.getByTestId(rootId)).not.toHaveTextContent(/\d+\s*m\b|km/);
  });

  it('🔴 AC-3 · region 미지정 → 지역줄 미렌더 (degrade)', () => {
    render(<SavedStayCard testID={rootId} name="숙소 A" layout="vertical" />);

    expect(screen.queryByText('해운대')).toBeNull();
  });

  it('🔴 AC-3 · priceLabel 지정 → 2톤 가격줄(금액 bold ink + "~" muted, View 형제)', () => {
    render(
      <SavedStayCard
        testID={rootId}
        name="숙소 A"
        layout="vertical"
        priceLabel="145,000원~"
      />
    );

    // 두 노드가 각각 존재해야 통과 = 2톤으로 갈렸다(단일/중첩 Text 면 '145,000원' 탈락).
    expect(screen.getByText('145,000원')).toBeOnTheScreen();
    expect(screen.getByText('~')).toBeOnTheScreen();
    // tone — 금액은 ink, "~" 는 muted(색은 className 토큰으로 관측).
    expect(cls(screen.getByText('145,000원'))).toContain('text-ink');
    expect(cls(screen.getByText('~'))).toContain('text-muted');
  });

  it('🔴 AC-3 · priceLabel 미지정 → 가격줄 미렌더 (degrade)', () => {
    render(<SavedStayCard testID={rootId} name="숙소 A" layout="vertical" />);

    expect(screen.queryByText('~')).toBeNull();
    expect(screen.getByTestId(rootId)).not.toHaveTextContent(/원~|₩/);
  });

  it('🔴 AC-5 · 발명 0 — 이름만 준 vertical 은 거점·지역·가격 문자열 0 (INV-1)', () => {
    render(
      <SavedStayCard testID={rootId} name="해운대 오션뷰" layout="vertical" />
    );

    const card = screen.getByTestId(rootId);
    expect(screen.queryByTestId(`${rootId}-base-badge`)).toBeNull();
    expect(card).not.toHaveTextContent(/원~|₩|km|\d+\s*m\b/);
    // 가짜통과 방지 짝 — 카드·이름은 떠 있다.
    expect(screen.getByText('해운대 오션뷰')).toBeOnTheScreen();
  });
});
