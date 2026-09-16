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
 * 커버하지 않는 것: 스켈레톤 회색바의 실 색(#ededed)·실 렌더 픽셀 폭/높이/반경(폭·토큰 className
 * 문자열은 L1·L2가 잠근다, TRIP-733), "어디로 갈까요?"의 진한 톤(픽셀 — 6-b/스크린샷 대조,
 * 02a §4-★3) · 배선(`isLoading` 파생은 `TripNewStep1Page.loading.test.tsx`) · 요약 문자열 도출(페이지).
 *
 * ⚠️ 매처(02a §5-1, 전 사이클 TRIP-665 실측 계승): `getByText('문자열')`=완전 일치(라벨 "기간" vs
 * 플레이스홀더 "기간 선택" 자동 구분) · `toHaveTextContent(/정규식/)`=부분 일치 · `queryAllByTestId(/re/)`
 * =0개면 throw 안 하고 `[]`(스켈레톤 카운트에 필수 — `getAllBy*` 는 0개면 throw) · `toBeDisabled()` 단독은
 * 가짜라 press + 콜백 0회 짝(★6).
 *
 * ⚠️ TRIP-732: 요약 prop 이 `string|null` → 객체형(`{main; sub?}`)으로 바뀐다 — 구현 전엔 화면이
 * 객체를 Text child 로 받아 throw 하고(의도된 red), tsc 도 shape 불일치로 red 다(02a §4-★F). 구현자가
 * 인터페이스를 `SummaryLine|null`로 바꾸면 동시 green. (`isLoading` 은 TRIP-671 로 이미 실 prop 이라 아래
 * augment 는 무해한 중복이다.)
 */

type StatesProps = TripWizardStep1ScreenProps & { isLoading?: boolean };

/** Figma 요약 셀렉터 실제 출력(TRIP-732 2톤 객체형 — en dash U+2013 · 미들닷 U+00B7). 화면은 이
 * 객체를 만들지 않고 받아 2톤으로 그린다. */
const DESTINATION_VALUE = { main: '부산', sub: '2박 · 경주 1박' };
const PERIOD_VALUE = { main: '6월 10일(수) – 13일(토)', sub: '3박 4일' };
const COMPANION_VALUE = { main: '친구 2명' };
const PREFERENCE_VALUE = { main: '미식 · 전시 · 야경', onboarding: true };
const BUDGET_VALUE = { main: '120만원', sub: '1인 총액 · 중간' };
/** empty 얼굴 예산은 **tier-only**(금액 없이 프리필 tier "중간"만, Figma empty `3652:2068`). */
const BUDGET_EMPTY = { main: '중간', sub: '1인 총액 · 온보딩' };

/** 행별 loading 스켈레톤 바 폭 px (Figma `3712:2068` 실측, TRIP-733 01b 확정). 인덱스+1 =
 * skeleton-{n}(여행지·기간·동행·취향·예산 순). 동행만 1바 — 개수 분기를 배열 길이로 표현. */
const SUMMARY_SKELETON_WIDTHS: number[][] = [
  [56, 74], // skeleton-1 여행지
  [140, 40], // skeleton-2 기간
  [78], // skeleton-3 동행
  [110, 48], // skeleton-4 취향
  [64, 78], // skeleton-5 예산
];

function seed(
  sourcePoiId: string,
  name: string,
  imageUrl: string | null = null,
  region: string | null = null
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl, region };
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
    summaryBudget: BUDGET_EMPTY,
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
      within(row('trip-wizard-summary-companion')).getByText(
        COMPANION_VALUE.main
      )
    ).toBeOnTheScreen();
    expect(row('trip-wizard-summary-preference')).toHaveTextContent(
      /미식 · 전시 · 야경/
    );
    // empty 예산은 tier-only — main 이 "중간"이다(120만원 아님).
    expect(row('trip-wizard-summary-budget')).toHaveTextContent(/중간/);
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
  it('L1 · 요약 5행 스켈레톤 — 컨테이너 5개(끝-앵커) + 행별 바 [2,2,1,2,2] + 폭·토큰 문자열', () => {
    render(<TripWizardStep1Screen {...filledProps({ isLoading: true })} />);

    // 컨테이너 카운트는 끝-앵커 `\d+$` 로 좁힌다(★1). 접두 일치 `/^…-skeleton-/` 는 바
    // testID(`…-bar-{i}`)까지 세어 5→14 로 부풀어(실측 §5-1), *올바른 구현*에서 이 단언이
    // 오히려 red 가 된다. 끝-앵커는 컨테이너 5만 센다. (queryAllByTestId=0개면 throw 안 하고 [])
    expect(
      screen.queryAllByTestId(/^trip-wizard-summary-skeleton-\d+$/)
    ).toHaveLength(5);

    // 행별 바 개수·폭·토큰. within(컨테이너) 는 쿼리를 그 행 subtree 로 좁혀(★2) 다른 행 바를 안
    // 센다. queryAllByTestId(/-bar-/) 는 testID 에 `-bar-` 를 포함하는 노드만(부분 일치).
    SUMMARY_SKELETON_WIDTHS.forEach((widths, idx) => {
      const container = row(`trip-wizard-summary-skeleton-${idx + 1}`);
      const bars = within(container).queryAllByTestId(/-bar-/);
      expect(bars).toHaveLength(widths.length); // 동행(idx 2)만 1

      bars.forEach((bar, i) => {
        // className 은 jest 렌더 트리에 평문 prop 으로 남는다(★3) — 폭/토큰 문자열까지만.
        // 실 픽셀·#ededed 색은 RN 네이티브라 jest 사각(6-b, ★4).
        const cls = String(bar.props.className);
        expect(cls).toContain(`w-[${widths[i]}px]`);
        expect(cls).toContain('h-[12px]');
        expect(cls).toContain('rounded-[10px]');
        // 토큰 배열로 정확 매치 — `toContain('bg-hairline')` 은 이웃 `bg-hairline-strong`(#DDDDDD)도
        // 통과시켜(부분 문자열) fill 회귀를 못 잡는다(5-b 경고-1). split 후 정확 토큰 대조.
        expect(cls.split(/\s+/)).toContain('bg-hairline');
      });

      // 바 간 gap 6·가로 배치는 컨테이너 className 으로(★3).
      const containerClass = String(container.props.className);
      expect(containerClass).toContain('flex-row');
      expect(containerClass).toContain('gap-[6px]');
    });

    // AC-4 INV-3 — 스켈레톤·헤더 어디에도 소요시간(분·시간·소요) 표기 0(거리만, 이 얼굴엔 도입 0).
    expect(root()).not.toHaveTextContent(/\d+\s*분|\d+\s*시간|소요/);
  });

  it('L2 · 꼭 갈 곳 스켈레톤 카드 4장(단일 64×64 정사각) + 실제 카드 가림 + see-all 부재', () => {
    render(
      <TripWizardStep1Screen
        {...filledProps({
          isLoading: true,
          mustVisits: [seed('poi-1', '감천마을'), seed('poi-2', '해운대')],
        })}
      />
    );

    // 카드엔 하위 바 testID 가 없어 접두·끝-앵커 어느 쪽이든 4다. L1 과 일관되게 끝-앵커.
    const cards = screen.queryAllByTestId(
      /^trip-wizard-mustvisit-skeleton-\d+$/
    );
    expect(cards).toHaveLength(4);

    // 각 카드가 단일 64×64 정사각 토큰을 직접 지닌다(★5) — testID 노드가 곧 정사각이라
    // "썸네일 바 + 텍스트 바" 2자식 구조가 배제된다(텍스트 바 제거). 실 픽셀은 6-b.
    cards.forEach((card) => {
      const cls = String(card.props.className);
      expect(cls).toContain('h-[64px]');
      expect(cls).toContain('w-[64px]');
      expect(cls).toContain('rounded-[10px]');
      expect(cls).toContain('bg-hairline');
    });

    // 실제 담은 곳 카드는 스켈레톤에 가려 안 뜬다(회귀 유지, 선제 green).
    expect(screen.queryByTestId('trip-wizard-mustvisit-poi-1')).toBeNull();

    // 스켈레톤 헤더엔 '전체 보기'(see-all) 없음 — 프레임 3712:2135 hidden 이 정본(회귀 앵커, 선제 green).
    expect(screen.queryByTestId('trip-wizard-mustvisit-see-all')).toBeNull();
  });

  it('L3 · 실값 부재 — 값을 prop 으로 줬는데 화면에 안 뜬다 (스켈레톤이 가림, ★4 짝)', () => {
    render(<TripWizardStep1Screen {...filledProps({ isLoading: true })} />);

    // 특수문자 회피 — 각 값의 안전한 조각을 부분 정규식으로 부재 단언(2톤이라 main 조각으로).
    expect(root()).not.toHaveTextContent(/부산/);
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
        DESTINATION_VALUE.main
      )
    ).toBeOnTheScreen();
    expect(next()).toBeEnabled();
  });
});
