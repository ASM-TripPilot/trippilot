import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import type { StaySearchState } from '../model/staySearchState';
import { stayKey } from '../model/stayKey';
import { StaySearchScreen } from './StaySearchScreen';

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
      screen.getByTestId('stay-search-filterzero-clear').props.accessibilityRole
    ).toBe('button');
    expect(
      screen.getByTestId('stay-search-filterzero-reset').props.accessibilityRole
    ).toBe('button');
  });
});
