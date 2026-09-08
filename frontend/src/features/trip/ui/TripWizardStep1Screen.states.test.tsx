import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { MustVisitSeedItem } from '../model/mustVisitSeed';
import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-671 g01 여행 만들기 1/2 — **두 상태 얼굴**(empty `3652:2068` · loading `3712:2068`)을 default
 * 위에 얹는다. 화면은 여전히 props-only 프레젠테이션이다(판정 0).
 *
 * 무엇을 보장하나:
 *  - **empty**(fresh 진입) — 여행지 null → 신 카피 "어디로 갈까요?" · 기간 null → 값 줄 없음(옛
 *    "기간 선택" 제거) · 나머지 행은 prefill 값 · 다음 비활성 · 꼭 갈 곳 0 = "+더 담기"만(카드 0).
 *  - **loading**(`isLoading=true`) — 요약 5행 스켈레톤 + 꼭 갈 곳 스켈레톤 카드 4장 + 로딩 부제 +
 *    실값 부재(값을 줘도 안 뜸) + 다음 비활성(canProceed 가 참이라도). `isLoading` 미지정이면 default.
 *
 * 커버하지 않는 것: 스켈레톤 회색바 색·크기·정렬, "어디로 갈까요?"의 진한 톤(픽셀 — 6-b/스크린샷 대조,
 * 02a §4-★3) · 배선(`isLoading` 파생은 `TripNewStep1Page.loading.test.tsx`) · 요약 문자열 도출(페이지).
 *
 * ⚠️ 매처(02a §5-1, 전 사이클 TRIP-665 실측 계승): `getByText('문자열')`=완전 일치(라벨 "기간" vs
 * 플레이스홀더 "기간 선택" 자동 구분) · `toHaveTextContent(/정규식/)`=부분 일치 · `queryAllByTestId(/re/)`
 * =0개면 throw 안 하고 `[]`(스켈레톤 카운트에 필수 — `getAllBy*` 는 0개면 throw) · `toBeDisabled()` 단독은
 * 가짜라 press + 콜백 0회 짝(★6).
 *
 * ⚠️ `isLoading` 은 아직 화면 prop 이 아니다(구현 전) — 로컬 augment 타입으로 스프레드해 컴파일만
 * 통과시킨다(스프레드는 excess-property 검사를 우회). 구현자가 실 interface 에 additive 하면 이 augment 는
 * 무해한 중복이 된다.
 */

type StatesProps = TripWizardStep1ScreenProps & { isLoading?: boolean };

/** Figma 요약 셀렉터 실제 출력(tripSummary.ts 에서 복사 — en dash U+2013 · 미들닷 U+00B7). 화면은 이
 * 문자열을 만들지 않고 받아 그린다. */
const DESTINATION_VALUE = '부산 2박 · 경주 1박';
const PERIOD_VALUE = '6월 10일(수) – 13일(토) · 3박 4일';
const COMPANION_VALUE = '친구 2명';
const PREFERENCE_VALUE = '미식 · 전시 · 야경 + 온보딩';
const BUDGET_VALUE = '120만원 · 1인 총액 · 중간';

function seed(
  sourcePoiId: string,
  name: string,
  imageUrl: string | null = null
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl };
}

function baseProps(over: Partial<StatesProps> = {}): StatesProps {
  return {
    summaryDestinations: null,
    summaryPeriod: null,
    summaryCompanion: null,
    summaryPreferences: null,
    summaryBudget: null,
    onPressSummaryDestination: jest.fn(),
    onPressSummaryPeriod: jest.fn(),
    onPressSummaryCompanion: jest.fn(),
    onPressSummaryPreference: jest.fn(),
    onPressSummaryBudget: jest.fn(),
    mustVisits: [],
    onPressMore: jest.fn(),
    onPressSeeAll: jest.fn(),
    canProceed: false,
    onNext: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

/** empty 얼굴 — fresh 진입: 여행지·기간 null, 동행·취향·예산은 prefill 로 채워짐(01b D1 픽스처). */
function emptyProps(over: Partial<StatesProps> = {}): StatesProps {
  return baseProps({
    summaryDestinations: null,
    summaryPeriod: null,
    summaryCompanion: COMPANION_VALUE,
    summaryPreferences: PREFERENCE_VALUE,
    summaryBudget: BUDGET_VALUE,
    mustVisits: [],
    canProceed: false,
    ...over,
  });
}

/** 5행 값이 다 채워진 상태(loading 이 실값을 가리는지 보려면 값을 줘야 한다). */
function filledProps(over: Partial<StatesProps> = {}): StatesProps {
  return baseProps({
    summaryDestinations: DESTINATION_VALUE,
    summaryPeriod: PERIOD_VALUE,
    summaryCompanion: COMPANION_VALUE,
    summaryPreferences: PREFERENCE_VALUE,
    summaryBudget: BUDGET_VALUE,
    canProceed: true,
    ...over,
  });
}

function row(testID: string) {
  return screen.getByTestId(testID);
}

function next() {
  return screen.getByTestId('trip-wizard-step1-next');
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

describe('AC-1 · empty 얼굴 (fresh 진입 — 여행지·기간 null, 나머지 prefill)', () => {
  it('E1 · 여행지 행이 신 카피 "어디로 갈까요?"를 그린다 (옛 "여행지 선택" 대체)', () => {
    render(<TripWizardStep1Screen {...emptyProps()} />);

    const dest = row('trip-wizard-summary-destination');
    expect(within(dest).getByText('어디로 갈까요?')).toBeOnTheScreen();
    // 옛 플레이스홀더는 이제 어디에도 안 뜬다.
    expect(within(dest).queryByText('여행지 선택')).toBeNull();
  });

  it('E2 · 기간 행은 값 줄이 없다 — 옛 "기간 선택" 부재, 라벨 "기간"은 생존', () => {
    render(<TripWizardStep1Screen {...emptyProps()} />);

    const period = row('trip-wizard-summary-period');
    // getByText 완전 일치라 라벨 "기간" 과 옛 플레이스홀더 "기간 선택" 이 자동으로 갈린다.
    expect(within(period).queryByText('기간 선택')).toBeNull();
    expect(within(period).getByText('기간')).toBeOnTheScreen();
  });

  it('E3 · 채워진 동행·취향·예산 행은 prefill 값을 그린다 (empty ≠ 전부 빈 화면, 긍정 앵커)', () => {
    render(<TripWizardStep1Screen {...emptyProps()} />);

    expect(
      within(row('trip-wizard-summary-companion')).getByText(COMPANION_VALUE)
    ).toBeOnTheScreen();
    expect(row('trip-wizard-summary-preference')).toHaveTextContent(
      /미식 · 전시 · 야경/
    );
    expect(row('trip-wizard-summary-budget')).toHaveTextContent(/120만원/);
  });

  it('E4 · 꼭 갈 곳 0 → "+더 담기"만, 카드 0 (부재 + 긍정 앵커 짝, ★7)', () => {
    render(<TripWizardStep1Screen {...emptyProps({ mustVisits: [] })} />);

    expect(screen.getByTestId('trip-wizard-mustvisit-more')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^trip-wizard-mustvisit-poi-/)).toHaveLength(
      0
    );
    expect(screen.getByTestId('trip-wizard-mustvisit-block')).toHaveTextContent(
      /꼭 갈 곳\s*0/
    );
  });

  it('E5 · 다음 비활성 — 회색이기만 한 게 아니라 실제로 안 눌린다 (3단, ★6)', () => {
    const onNext = jest.fn();
    render(<TripWizardStep1Screen {...emptyProps({ onNext })} />);

    expect(next()).toBeDisabled();
    fireEvent.press(next());
    expect(onNext).not.toHaveBeenCalled();
  });
});

describe('AC-2 · loading 얼굴 (isLoading=true — 값을 줘도 스켈레톤이 가린다)', () => {
  it('L1 · 요약 5행 스켈레톤이 뜬다', () => {
    render(<TripWizardStep1Screen {...filledProps({ isLoading: true })} />);

    // queryAllByTestId — 구현 전엔 0개라 getAllBy* 는 throw. length 로 잰다(★8).
    expect(
      screen.queryAllByTestId(/^trip-wizard-summary-skeleton-/)
    ).toHaveLength(5);
  });

  it('L2 · 꼭 갈 곳 스켈레톤 카드 4장 + 실제 카드는 가려진다', () => {
    render(
      <TripWizardStep1Screen
        {...filledProps({
          isLoading: true,
          mustVisits: [seed('poi-1', '감천마을'), seed('poi-2', '해운대')],
        })}
      />
    );

    expect(
      screen.queryAllByTestId(/^trip-wizard-mustvisit-skeleton-/)
    ).toHaveLength(4);
    // 실제 담은 곳 카드는 스켈레톤에 가려 안 뜬다.
    expect(screen.queryByTestId('trip-wizard-mustvisit-poi-1')).toBeNull();
  });

  it('L3 · 실값 부재 — 값을 prop 으로 줬는데 화면에 안 뜬다 (스켈레톤이 가림, ★4 짝)', () => {
    render(<TripWizardStep1Screen {...filledProps({ isLoading: true })} />);

    // 특수문자 회피 — 각 값의 안전한 조각을 부분 정규식으로 부재 단언.
    expect(root()).not.toHaveTextContent(/부산 2박/);
    expect(root()).not.toHaveTextContent(/친구 2명/);
    expect(root()).not.toHaveTextContent(/120만원/);
    expect(root()).not.toHaveTextContent(/미식/);
    expect(root()).not.toHaveTextContent(/6월 10일/);
  });

  it('L4 · 로딩 부제로 갈리고 기본 부제는 사라진다 (타이틀은 생존)', () => {
    render(<TripWizardStep1Screen {...filledProps({ isLoading: true })} />);

    expect(root()).toHaveTextContent(/여행 정보를 불러오는 중/);
    expect(root()).not.toHaveTextContent(/온보딩에서 고른 취향/);
    // 타이틀은 얼굴과 무관하게 선다(긍정 앵커).
    expect(screen.getByText('어디로 떠날까요?')).toBeOnTheScreen();
  });

  it('L5 · 다음 비활성 — canProceed 가 참이어도 loading 이면 안 눌린다 (★2·★6)', () => {
    const onNext = jest.fn();
    render(
      <TripWizardStep1Screen
        {...filledProps({ isLoading: true, canProceed: true, onNext })}
      />
    );

    // canProceed=true 인데도 disabled = 화면이 isLoading 을 next 게이트에 물렸다는 증거.
    expect(next()).toBeDisabled();
    fireEvent.press(next());
    expect(onNext).not.toHaveBeenCalled();
  });

  it('L6 · isLoading 미지정(default) → 스켈레톤 0, 값 렌더, 다음 활성 (loading 은 opt-in, 회귀 앵커)', () => {
    render(<TripWizardStep1Screen {...filledProps({ canProceed: true })} />);

    expect(
      screen.queryAllByTestId(/^trip-wizard-summary-skeleton-/)
    ).toHaveLength(0);
    expect(
      screen.queryAllByTestId(/^trip-wizard-mustvisit-skeleton-/)
    ).toHaveLength(0);
    expect(
      within(row('trip-wizard-summary-destination')).getByText(
        DESTINATION_VALUE
      )
    ).toBeOnTheScreen();
    expect(next()).toBeEnabled();
  });
});
