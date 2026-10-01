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
 * TRIP-1149 — g01 여행 만들기 1/4 화면(props 만 받는 뷰) 단위 테스트. 옛 5파일(본 · `.states` · `.mustVisit` ·
 * `.errors` · `.summary2tone`)을 하나로 합쳤다. 옛 파일 하나 = 바깥 describe 하나다. 목·훅이 없는 파일들이라
 * 공유 상태도 없다. 소요시간 부재만 보던 it 2개(옛 본 AC-INV-3 · `.errors` S-4)와 `.states` L1 안의 한 줄은
 * README 판정 4(INV-3 — 이 화면은 시간·거리 재료를 안 그린다)로 지웠다.
 */

/**
 * TRIP-665 g01 여행 만들기 default 재작성 — **props만 받는 프레젠테이션 화면**(Figma `3742:2068`).
 *
 * 무엇을 보장하나: 신 default 골격이 정본대로 선다 — 앱바(back + 진행바 4칸 + "1 / 4") · 타이틀/부제 ·
 * **요약 카드 5행**(여행지→기간→동행→취향→예산, 각 값 or muted 플레이스홀더 + chevron, 탭 시 오픈 콜백) ·
 * 꼭 갈 곳 스트립 · 하단 [다음](canProceed 게이트). 그리고 **옛 인라인 컨트롤(프리셋·스테퍼·칩·예산 입력·
 * 날짜 카드·등록숙소 행·취향 카드·여행지 시트)이 default 에서 전량 사라졌다**(AC-5).
 *
 * 왜 재작성인가: 옛 default 는 인라인 전개 폼이었고, 신 default 는 온보딩 요약 + 편집 시트 오픈 신호까지다
 * (편집 시트 본체는 S2~S6). 옛 인라인 컨트롤 잠금은 걷어내고(그 대응물이 신 default 에 없다), 신 계약으로
 * 다시 짠다(01b 재작성 전략).
 *
 * 화면은 여전히 props-only 다 — 쿼리 훅·라우터·타 feature import 0(그 제약을 소스 층에서
 * 잠그던 `tripWizardStep1Boundary` 는 TRIP-1145 로 지웠다, AC-7).
 *
 * 커버하지 않는 것: 편집 시트 본체(S2~S6) · 스트립 카드 상세(같은 파일 「꼭 갈 곳 가로 스트립」) · 실패 배너·overseas
 * (같은 파일 「실패 표면」) · 요약 문자열 **도출**(페이지 `tripSummary` 셀렉터 배선, `TripNewStep1Page.test.tsx`) ·
 * 픽셀 충실도([검증] 스크린샷).
 *
 * ⚠️ 매처 함정(02a §5-2 실측): RNTL `toHaveTextContent('문자열')` = **완전 일치**(정규화 후 `===`),
 * `toHaveTextContent(/정규식/)` = 부분/패턴 일치. `getByText('문자열')` 도 완전 일치라 라벨("동행")과
 * 플레이스홀더("동행 선택")를 자동으로 갈라 준다.
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+press) → 단언=보이는 것 / 불린 콜백.
 */
describe('default 프레젠테이션', () => {
  /** Figma `3742:2068` 요약 셀렉터 실제 출력(TRIP-732 2톤 객체형 — en dash U+2013·미들닷 U+00B7).
   * 화면은 이 객체를 만들지 않고 받아 2톤으로 그릴 뿐이라(페이지가 셀렉터로 도출), 테스트가 직접 주입한다. */
  const DESTINATION_VALUE = { main: '부산', sub: '2박 · 경주 1박' };
  const PERIOD_VALUE = { main: '6월 10일(수) – 13일(토)', sub: '3박 4일' };
  const COMPANION_VALUE = { main: '친구 2명' };
  const PREFERENCE_VALUE = { main: '미식 · 전시 · 야경', onboarding: true };
  const BUDGET_VALUE = { main: '120만원', sub: '1인 총액 · 중간' };

  function seed(
    sourcePoiId: string,
    name: string,
    imageUrl: string | null = null,
    region: string | null = null
  ): MustVisitSeedItem {
    return { sourcePoiId, name, imageUrl, region };
  }

  /** 초기(빈) 상태 — 요약 5행이 전부 null(플레이스홀더), 스트립 0곳, 게이트 닫힘. */
  function props(
    over: Partial<TripWizardStep1ScreenProps> = {}
  ): TripWizardStep1ScreenProps {
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

  /** 온보딩 반영이 다 채워진 상태 — 5행 값 present, 게이트 열림. */
  function filledProps(
    over: Partial<TripWizardStep1ScreenProps> = {}
  ): TripWizardStep1ScreenProps {
    return props({
      summaryDestinations: DESTINATION_VALUE,
      summaryPeriod: PERIOD_VALUE,
      summaryCompanion: COMPANION_VALUE,
      summaryPreferences: PREFERENCE_VALUE,
      summaryBudget: BUDGET_VALUE,
      canProceed: true,
      ...over,
    });
  }

  function root() {
    return screen.getByTestId('trip-wizard-step1-root');
  }

  /** className 은 NativeWind 가 렌더 트리에 평문 prop 으로 남긴다(02a §5-3 · loginVisual 선례).
   * 공백으로 쪼갠 토큰 배열로 본다 — 부분 문자열 오탐을 막는다. */
  function classes(testID: string): string[] {
    return String(screen.getByTestId(testID).props.className ?? '').split(
      /\s+/
    );
  }

  describe('AC-1 · 앱바 + 진행바 4칸 + "1 / 4"', () => {
    it('진행바가 4칸이고 첫 칸만 활성(primary)·나머지는 비활성(hairline-strong)이다', () => {
      render(<TripWizardStep1Screen {...props()} />);

      // 4칸이 다 있다.
      [1, 2, 3, 4].forEach((n) => {
        expect(
          screen.getByTestId(`trip-wizard-progress-seg-${n}`)
        ).toBeOnTheScreen();
      });

      // 색은 className 토큰으로 본다(★4) — 옛 화면의 raw hex `bg-[#E0E0E0]` 회귀를 잡는다.
      expect(classes('trip-wizard-progress-seg-1')).toContain('bg-primary');
      [2, 3, 4].forEach((n) => {
        expect(classes(`trip-wizard-progress-seg-${n}`)).toContain(
          'bg-hairline-strong'
        );
      });

      // "1 / 2"(옛)가 아니라 "1 / 4"(formatWizardStep(1) 소비).
      expect(screen.getByText('1 / 4')).toBeOnTheScreen();
      expect(root()).not.toHaveTextContent(/1 \/ 2/);
    });

    it('제목 · 부제가 정본대로이고, 뒤로가기가 콜백을 부른다', () => {
      const onBack = jest.fn();
      render(<TripWizardStep1Screen {...props({ onBack })} />);

      expect(screen.getByText('어디로 떠날까요?')).toBeOnTheScreen();
      // TRIP-984 D10: 요약이 전부 null 이면 온보딩 값이 없으므로 "온보딩에서 고른 취향" 을 말하지 않는다
      // (TRIP-732 AC-6 의 "전부 null → default 부제" 경계를 뒤집음). 뒤쪽 절만 남는다.
      expect(root()).not.toHaveTextContent(/온보딩에서 고른 취향/);
      expect(screen.getByText('행을 누르면 바꿀 수 있어요')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('trip-wizard-step1-back'));
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * TRIP-984 D10 · 부제 "온보딩에서 고른 취향을 그대로 반영했어요" 는 취향이 온보딩 상속
   * (`summaryPreferences.onboarding === true`)일 때만. 아니면 뒤쪽 절 "행을 누르면 바꿀 수 있어요" 만.
   */
  describe('AC-D1·D2 · 부제 "온보딩에서" 는 취향이 온보딩 상속일 때만', () => {
    it('D1 · 여행지는 있고 동행·취향·예산이 비었으면 "온보딩에서" 없이 뒤쪽 절만 보인다', () => {
      render(
        <TripWizardStep1Screen
          {...filledProps({
            summaryCompanion: null,
            summaryPreferences: null,
            summaryBudget: null,
          })}
        />
      );

      expect(screen.getByText('행을 누르면 바꿀 수 있어요')).toBeOnTheScreen();
      expect(root()).not.toHaveTextContent(/온보딩에서/);
    });

    it('D1 · 취향을 이 여행에서 바꿨으면(onboarding=false) "온보딩에서" 없이 뒤쪽 절만 보인다', () => {
      render(
        <TripWizardStep1Screen
          {...filledProps({
            summaryPreferences: { main: '휴양', onboarding: false },
          })}
        />
      );

      expect(screen.getByText('행을 누르면 바꿀 수 있어요')).toBeOnTheScreen();
      expect(root()).not.toHaveTextContent(/온보딩에서/);
    });

    it('D2 · 취향이 온보딩 상속이면 기존 default 부제 그대로다', () => {
      render(<TripWizardStep1Screen {...filledProps()} />);

      expect(
        screen.getByText(
          '온보딩에서 고른 취향을 그대로 반영했어요 · 행을 누르면 바꿀 수 있어요'
        )
      ).toBeOnTheScreen();
    });
  });

  describe('AC-2 · 요약 카드 5행 (값 present + 순서)', () => {
    it('다섯 행이 대응 값을 순서대로(여행지→기간→동행→취향→예산) 그린다', () => {
      render(<TripWizardStep1Screen {...filledProps()} />);

      // 2톤 — main 은 제 행 안에, sub 는 별도 회색 caption(`{행}-sub`). "화면 어딘가"와 다르다.
      expect(
        within(screen.getByTestId('trip-wizard-summary-destination')).getByText(
          DESTINATION_VALUE.main
        )
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-summary-destination-sub')
      ).toHaveTextContent(DESTINATION_VALUE.sub);
      // 기간 — main(날짜범위, 특수문자 포함 부분 정규식) + sub(박수).
      expect(
        screen.getByTestId('trip-wizard-summary-period')
      ).toHaveTextContent(/6월 10일\(수\) – 13일\(토\)/);
      expect(
        screen.getByTestId('trip-wizard-summary-period-sub')
      ).toHaveTextContent(PERIOD_VALUE.sub);
      expect(
        within(screen.getByTestId('trip-wizard-summary-companion')).getByText(
          COMPANION_VALUE.main
        )
      ).toBeOnTheScreen();
      // 취향 — main + 온보딩 스파클 배지(값이 채워지면 배지가 선다).
      expect(
        screen.getByTestId('trip-wizard-summary-preference')
      ).toHaveTextContent(/미식 · 전시 · 야경/);
      expect(
        screen.getByTestId('trip-wizard-preference-sparkle')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-summary-budget')
      ).toHaveTextContent(/120만원/);
      expect(
        screen.getByTestId('trip-wizard-summary-budget-sub')
      ).toHaveTextContent(BUDGET_VALUE.sub);

      // *(개념)* `getAllByTestId(/re/)` 는 매칭 요소를 **트리 순서(pre-order)** 로 돌려준다 —
      // "무엇이 먼저 그려지는가"를 배열 비교 한 줄로 잠근다(★3). 정규식 끝 `$` 로 `-sub` testID 를
      // 배열에서 배제한다(★D — sub 가 섞이면 배열이 8개가 돼 순서 비교가 깨진다).
      const order = screen
        .getAllByTestId(/^trip-wizard-summary-(?:[a-z]+)$/)
        .map((el) => el.props.testID);
      expect(order).toEqual([
        'trip-wizard-summary-destination',
        'trip-wizard-summary-period',
        'trip-wizard-summary-companion',
        'trip-wizard-summary-preference',
        'trip-wizard-summary-budget',
      ]);
    });

    it('값이 null 일 때 행별 카피 — 여행지 신 카피, 나머지 "{라벨} 선택"(기간 포함, TRIP-671·TRIP-1045)', () => {
      render(<TripWizardStep1Screen {...props()} />);

      // 여행지 null → 신 카피 "어디로 갈까요?"(옛 "여행지 선택" 전역 대체, TRIP-671 D1).
      const dest = screen.getByTestId('trip-wizard-summary-destination');
      expect(within(dest).getByText('어디로 갈까요?')).toBeOnTheScreen();
      expect(within(dest).queryByText('여행지 선택')).toBeNull();

      // 기간 null → muted "기간 선택"(TRIP-1045 QA #017 — 값 줄이 있어야 선택 전후 행 높이가 같다).
      // 라벨 "기간"도 생존(getByText 완전 일치라 둘이 갈린다).
      const period = screen.getByTestId('trip-wizard-summary-period');
      const periodPlaceholder = within(period).getByText('기간 선택');
      expect(
        String(periodPlaceholder.props.className ?? '').split(/\s+/)
      ).toContain('text-muted');
      expect(within(period).getByText('기간')).toBeOnTheScreen();

      // 나머지 3행은 "{라벨} 선택" 유지 + muted(값이 채워지면 ink 로 바뀐다).
      const kept: [string, string][] = [
        ['trip-wizard-summary-companion', '동행 선택'],
        ['trip-wizard-summary-preference', '취향 선택'],
        ['trip-wizard-summary-budget', '예산 선택'],
      ];
      kept.forEach(([testID, placeholder]) => {
        const text = within(screen.getByTestId(testID)).getByText(placeholder);
        expect(String(text.props.className ?? '').split(/\s+/)).toContain(
          'text-muted'
        );
      });
    });

    it('짝 — 여행지 값이 있으면 그 행에 신 카피 플레이스홀더가 없다', () => {
      render(<TripWizardStep1Screen {...filledProps()} />);

      const dest = screen.getByTestId('trip-wizard-summary-destination');
      expect(within(dest).getByText(DESTINATION_VALUE.main)).toBeOnTheScreen();
      expect(within(dest).queryByText('어디로 갈까요?')).toBeNull();
    });
  });

  describe('AC-3 · 요약 행 탭 → 편집 시트 오픈 콜백 (S2~S6 는 스텁)', () => {
    it('각 행을 누르면 대응 오픈 콜백만 불린다', () => {
      const handlers = {
        onPressSummaryDestination: jest.fn(),
        onPressSummaryPeriod: jest.fn(),
        onPressSummaryCompanion: jest.fn(),
        onPressSummaryPreference: jest.fn(),
        onPressSummaryBudget: jest.fn(),
      };
      render(<TripWizardStep1Screen {...filledProps(handlers)} />);

      const cases: [string, jest.Mock][] = [
        ['trip-wizard-summary-destination', handlers.onPressSummaryDestination],
        ['trip-wizard-summary-period', handlers.onPressSummaryPeriod],
        ['trip-wizard-summary-companion', handlers.onPressSummaryCompanion],
        ['trip-wizard-summary-preference', handlers.onPressSummaryPreference],
        ['trip-wizard-summary-budget', handlers.onPressSummaryBudget],
      ];
      cases.forEach(([testID, handler]) => {
        fireEvent.press(screen.getByTestId(testID));
        expect(handler).toHaveBeenCalledTimes(1);
      });

      // 짝(부정) — 여행지 행을 눌렀다고 예산 오픈이 딸려 불리지 않는다(각 1회씩만 위에서 확인).
      expect(handlers.onPressSummaryDestination).toHaveBeenCalledTimes(1);
      expect(handlers.onPressSummaryBudget).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC-4 · 꼭 갈 곳 스트립 (경량 존재 — 상세는 mustVisit.test)', () => {
    it('스트립 블록과 "더 담기" · "전체 보기" 가 선다', () => {
      render(
        <TripWizardStep1Screen
          {...filledProps({ mustVisits: [seed('poi-1', '감천마을')] })}
        />
      );

      expect(
        screen.getByTestId('trip-wizard-mustvisit-block')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-mustvisit-more')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('trip-wizard-mustvisit-see-all')
      ).toBeOnTheScreen();
    });
  });

  describe('AC-보존 · [다음] 게이트는 canProceed 하나로만 갈린다', () => {
    it('canProceed 가 참이면 눌리고 콜백이 불린다', () => {
      const onNext = jest.fn();
      render(<TripWizardStep1Screen {...filledProps({ onNext })} />);

      const next = screen.getByTestId('trip-wizard-step1-next');
      expect(next).toBeEnabled();
      fireEvent.press(next);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('canProceed 가 거짓이면 회색이기만 한 게 아니라 실제로 눌리지 않는다', () => {
      const onNext = jest.fn();
      render(
        <TripWizardStep1Screen {...props({ canProceed: false, onNext })} />
      );

      const next = screen.getByTestId('trip-wizard-step1-next');
      // ⚠️ 두 단언이 짝이다(★5). `toBeDisabled()` 는 접근성 상태만 읽어, 상태만 켜고 실제 disabled
      // prop 을 뺀 버튼이 매처를 통과하며 눌린다(리포 3회 실측).
      expect(next).toBeDisabled();
      fireEvent.press(next);
      expect(onNext).not.toHaveBeenCalled();
    });
  });

  describe('AC-5 · 옛 인라인 컨트롤이 default 에서 전량 사라졌다', () => {
    it('프리셋·스테퍼·칩·예산 입력·날짜 카드·등록숙소 행·취향 카드·여행지 시트가 없다', () => {
      // filledProps 로 화면을 꽉 채워 렌더한다 — 그래도 인라인 컨트롤은 없어야 한다.
      render(<TripWizardStep1Screen {...filledProps()} />);

      [
        'trip-wizard-period-preset-3n4d',
        'trip-wizard-party-stepper',
        'trip-wizard-companion-friend',
        'trip-wizard-budget-input',
        'trip-wizard-budget-block',
        'trip-wizard-date-field',
        'trip-wizard-stayimport-block',
        'trip-wizard-pref-card',
        'trip-wizard-destination-add',
      ].forEach((testID) => {
        expect(screen.queryByTestId(testID)).toBeNull();
      });

      // 짝(긍정, ★7) — **이게 없으면 아무것도 안 그리는 화면이 위 부재 단언을 공짜로 통과한다.**
      // 화면은 실제로 그려졌고, 인라인이 요약 행으로 대체됐다.
      expect(
        screen.getByTestId('trip-wizard-summary-destination')
      ).toBeOnTheScreen();
      expect(root()).toHaveTextContent(/어디로 떠날까요\?/);
      expect(screen.getByTestId('trip-wizard-step1-next')).toBeOnTheScreen();
    });
  });
});

/**
 * TRIP-671 g01 여행 만들기 1/2 — **두 상태 얼굴**(empty `3652:2068` · loading `3712:2068`)을 default
 * 위에 얹는다. 화면은 여전히 props-only 프레젠테이션이다(판정 0).
 *
 * 무엇을 보장하나:
 *  - **empty**(fresh 진입) — 여행지 null → 신 카피 "어디로 갈까요?" · 기간 null → muted "기간 선택"
 *    (TRIP-1045 복귀 — 값 줄이 없으면 선택 전후 행 높이가 달라진다) · 나머지 행은 prefill 값 · 다음
 *    비활성 · 꼭 갈 곳 0 = "+더 담기"만(카드 0).
 *  - **loading**(`isLoading=true`) — 요약 5행 스켈레톤 + 꼭 갈 곳 스켈레톤 카드 4장 + 로딩 부제 +
 *    실값 부재(값을 줘도 안 뜸) + 다음 비활성(canProceed 가 참이라도). `isLoading` 미지정이면 default.
 *
 * 커버하지 않는 것: 스켈레톤 회색바의 실 색(#ededed)·실 렌더 픽셀 폭/높이/반경(폭·토큰 className
 * 문자열은 L1·L2가 잠근다, TRIP-733), "어디로 갈까요?"의 진한 톤(픽셀 — 6-b/스크린샷 대조,
 * 02a §4-★3) · 배선(`isLoading` 파생은 `TripNewStep1Page.test.tsx` 「isLoading 파생」) · 요약 문자열 도출(페이지).
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
describe('두 상태 얼굴 (empty · loading)', () => {
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

    it('E2 · 기간 행은 muted "기간 선택"을 그린다 — 라벨 "기간"도 생존 (TRIP-1045 QA #017)', () => {
      render(<TripWizardStep1Screen {...emptyProps()} />);

      const period = row('trip-wizard-summary-period');
      // getByText 완전 일치라 라벨 "기간" 과 플레이스홀더 "기간 선택" 이 자동으로 갈린다.
      const placeholder = within(period).getByText('기간 선택');
      expect(String(placeholder.props.className ?? '').split(/\s+/)).toContain(
        'text-muted'
      );
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

      expect(
        screen.getByTestId('trip-wizard-mustvisit-more')
      ).toBeOnTheScreen();
      expect(
        screen.queryAllByTestId(/^trip-wizard-mustvisit-poi-/)
      ).toHaveLength(0);
      expect(
        screen.getByTestId('trip-wizard-mustvisit-block')
      ).toHaveTextContent(/꼭 갈 곳\s*0/);
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
});

/**
 * TRIP-665 g01 default 재작성 — **꼭 갈 곳 가로 스트립 전담**(Figma `3742:2068`).
 *
 * 무엇을 보장하나: 스트립이 헤더("꼭 갈 곳 {N}") + 전체 보기 + 더 담기(첫 위치) + 담은 곳 카드(이름)로
 * 서고, 카운트가 `mustVisits.length` 이며, 카드 이미지는 imageUrl 이 있을 때만 그린다(없으면 회색 자리,
 * INV-1). 그리고 **옛 스트립의 개별 제거(×)·+N 오버플로우가 신 계약에서 사라졌다**(01b D3 — 제거는 S12
 * 전체 보기 몫). 0곳도 헤더+더담기+전체보기로 graceful degrade(empty 일러스트 얼굴은 S7).
 *
 * 왜 재작성인가: 옛 스트립은 4얼굴 판별 유니온(seeded/empty/failed/loading)·overflow·remove× 를 가졌다.
 * 신 스트립은 **seeded 만**(0곳 포함) 그리는 단순 배열 렌더다 — 조회 실패·로딩·0곳 일러스트 얼굴은 S7.
 *
 * 커버하지 않는 것: 카운트·카드를 **도출**하는 배선(`TripNewStep1Page.test.tsx` 「담은목록 게이트」) · 등록 실패
 * 배너(같은 파일 「실패 표면」) · 픽셀([검증]).
 *
 * ⚠️ 매처 함정(02a §5-2): 카운트가 든 헤더는 합성 텍스트라 **정규식**(`/꼭 갈 곳\s*3/`, 공백 유무 무관)으로,
 * 카드 이름은 단일 Text 라 `getByText` 로 본다.
 *
 * 3동작 뼈대: 준비=props(mustVisits) → 실행=render(+press) → 단언=보이는 것 / 불린 콜백.
 */
describe('꼭 갈 곳 가로 스트립', () => {
  function seed(
    sourcePoiId: string,
    name: string,
    imageUrl: string | null = null,
    region: string | null = null
  ): MustVisitSeedItem {
    return { sourcePoiId, name, imageUrl, region };
  }

  const THREE = [
    seed('poi-1', '감천마을'),
    seed('poi-2', '광안리'),
    seed('poi-3', '전포'),
  ];

  function props(
    over: Partial<TripWizardStep1ScreenProps> = {}
  ): TripWizardStep1ScreenProps {
    return {
      // TRIP-732: 요약 5행은 이 파일 관심사(스트립)와 무관 → 전부 null 로 둔다(2톤 객체를 넣으면
      // 구 화면이 render throw, 신 shape 로 tsc 오류 — null 은 구·신 모두 안전, 02a §4-★E).
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

  function block() {
    return screen.getByTestId('trip-wizard-mustvisit-block');
  }

  describe('N3 · seeded 스트립 — 담은 곳이 있을 때', () => {
    it('제목·카운트와 카드가 담은 곳 수만큼(이름) 그려진다', () => {
      render(<TripWizardStep1Screen {...props({ mustVisits: THREE })} />);

      // 카운트는 헤더 합성 텍스트라 정규식으로(★2). "3박" 등과 안 섞이게 블록 안으로 좁힌다.
      expect(block()).toHaveTextContent(/꼭 갈 곳\s*3/);

      THREE.forEach((item) => {
        const card = screen.getByTestId(
          `trip-wizard-mustvisit-${item.sourcePoiId}`
        );
        // 이름표가 카드 **안**에 있다.
        expect(within(card).getByText(item.name)).toBeOnTheScreen();
      });
    });

    it('사진이 있으면 그리고 없으면 자리만 둔다 (★6 짝 — 기본 이미지를 지어내지 않는다)', () => {
      render(
        <TripWizardStep1Screen
          {...props({
            mustVisits: [
              seed('poi-1', '감천마을', 'https://cdn.example.com/a.jpg'),
              seed('poi-2', '광안리', null),
            ],
          })}
        />
      );

      // 두 항목이 서로의 짝이다 — 하나만 두면 "이미지를 아예 안 그리는" 구현도 통과한다.
      expect(
        screen.getByTestId('trip-wizard-mustvisit-image-poi-1')
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('trip-wizard-mustvisit-image-poi-2')
      ).toBeNull();
      // 사진이 없어도 카드·이름표는 남는다.
      expect(
        within(screen.getByTestId('trip-wizard-mustvisit-poi-2')).getByText(
          '광안리'
        )
      ).toBeOnTheScreen();
    });

    it('"더 담기" 와 "전체 보기" 가 각자 제 콜백을 부른다', () => {
      const onPressMore = jest.fn();
      const onPressSeeAll = jest.fn();
      render(
        <TripWizardStep1Screen
          {...props({ mustVisits: THREE, onPressMore, onPressSeeAll })}
        />
      );

      fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));
      expect(onPressMore).toHaveBeenCalledTimes(1);
      expect(onPressSeeAll).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-see-all'));
      expect(onPressSeeAll).toHaveBeenCalledTimes(1);
      expect(onPressMore).toHaveBeenCalledTimes(1);
    });

    it('신 계약 — 카드 개별 제거(×)·+N 오버플로우가 없다 (01b D3)', () => {
      render(<TripWizardStep1Screen {...props({ mustVisits: THREE })} />);

      // 제거는 S12 전체 보기 몫이라 카드에 × 가 없고, 3장 상한 접기(+N)도 신 스트립엔 없다.
      THREE.forEach((item) => {
        expect(
          screen.queryByTestId(
            `trip-wizard-mustvisit-remove-${item.sourcePoiId}`
          )
        ).toBeNull();
      });
      expect(screen.queryByTestId('trip-wizard-mustvisit-overflow')).toBeNull();

      // 짝(긍정) — 카드 자체는 정상적으로 그려졌다.
      expect(
        screen.getByTestId('trip-wizard-mustvisit-poi-1')
      ).toBeOnTheScreen();
    });
  });

  describe('N3 · 0곳도 스트립을 감추지 않는다 (S7 empty 일러스트 아님)', () => {
    it('카드 0장 · 더 담기·카운트 0 은 남고, "전체 보기"는 미렌더 (TRIP-732 AC-7 반전)', () => {
      render(<TripWizardStep1Screen {...props({ mustVisits: [] })} />);

      expect(block()).toBeOnTheScreen();
      expect(block()).toHaveTextContent(/꼭 갈 곳\s*0/);
      expect(
        screen.getByTestId('trip-wizard-mustvisit-more')
      ).toBeOnTheScreen();

      // ⚠️ 반전 — 이전(TRIP-665)엔 0곳에서도 "전체 보기"가 있었으나(승인 프리즈), TRIP-732 AC-7 은
      // `mustVisits.length===0`이면 미렌더로 확정(01b, 볼 게 없는데 목록으로 보내는 링크 제거).
      // 새 사이클이라 프리즈 개봉은 정당하다(traps-shell 프리즈 개봉 관례, 기계 강제 없음).
      expect(screen.queryByTestId('trip-wizard-mustvisit-see-all')).toBeNull();

      // 카드가 하나도 없다(0곳). 옛 empty 일러스트 얼굴(`-empty`)도 없다(S7).
      expect(
        screen.queryAllByTestId(/^trip-wizard-mustvisit-poi-/)
      ).toHaveLength(0);
      expect(screen.queryByTestId('trip-wizard-mustvisit-empty')).toBeNull();
    });
  });

  /**
   * ─── TRIP-685 지역선 ───────────────────────────────────────────────────────────
   *
   * 무엇을 보장하나: 담은 장소가 가진 `region`(예 "수영구")이 시드에 실려 오면 스트립 카드가 이름
   * **아래에 지역 한 줄**을 그리고(testID `trip-wizard-mustvisit-region-{sourcePoiId}`), 값을 서버 원문
   * **그대로**(무가공) 보여준다. `null`·`''`이면 지역 요소를 **아예 안 만든다**(빈 줄도 없음 — degrade 유지).
   *
   * ⚠️ 매처: `getByTestId(id)` 는 요소가 없으면 throw 라 **존재 단언**을 겸하고, 이어 붙인
   * `.toHaveTextContent('수영구')` 는 RNTL 완전 일치(정규화 후 ===)라 지역 Text 의 전체 내용이 딱 그
   * 문자열임을 잰다(02a ★4·§5, 문제로그 RNTL toHaveTextContent 완전 일치). 부재는 `queryByTestId(...).toBeNull()`.
   *
   * ⚠️ present·absent 를 **한 배열**에 섞는다 — "항상 그린다"와 "절대 안 그린다" 뮤턴트를 한 테스트로
   * 동시에 잡는다. 섞인 배열에서 absent 는 **특정 testID**(poi-3)로 본다(정규식은 present 카드를 매치).
   */
  describe('N3 · 지역선 — 값 있으면 이름 아래 한 줄, null/빈값이면 미표시 (TRIP-685)', () => {
    it('region 이 있는 카드엔 지역선을 원문 그대로 그리고, null 인 카드엔 안 그린다 (present/absent 짝)', () => {
      render(
        <TripWizardStep1Screen
          {...props({
            mustVisits: [
              seed('poi-1', '감천마을', null, '수영구'),
              seed('poi-2', '광안리', null, '부산 해운대구'),
              seed('poi-3', '전포', null, null),
            ],
          })}
        />
      );

      // present — 짧은 값·긴 값 모두 place.region 을 무가공으로. 포맷터를 끼우면 이 완전 일치가 깨진다(★4).
      expect(
        screen.getByTestId('trip-wizard-mustvisit-region-poi-1')
      ).toHaveTextContent('수영구');
      expect(
        screen.getByTestId('trip-wizard-mustvisit-region-poi-2')
      ).toHaveTextContent('부산 해운대구');

      // absent — region 이 null 인 카드는 지역선을 만들지 않는다.
      expect(
        screen.queryByTestId('trip-wizard-mustvisit-region-poi-3')
      ).toBeNull();

      // 짝(긍정) — 카드·이름은 정상(카드 자체가 안 떠서 공짜 통과하는 것을 막는다).
      expect(
        within(screen.getByTestId('trip-wizard-mustvisit-poi-1')).getByText(
          '감천마을'
        )
      ).toBeOnTheScreen();
    });

    it("region 이 빈 문자열('')이어도 접는다 (빈 값 falsy — 빈 줄 방지, 01b Q3)", () => {
      render(
        <TripWizardStep1Screen
          {...props({ mustVisits: [seed('poi-1', '감천마을', null, '')] })}
        />
      );

      // 카드·이름은 정상(짝).
      expect(
        screen.getByTestId('trip-wizard-mustvisit-poi-1')
      ).toBeOnTheScreen();
      // 빈 문자열은 지역선을 만들지 않는다.
      expect(
        screen.queryByTestId('trip-wizard-mustvisit-region-poi-1')
      ).toBeNull();
    });
  });
});

/**
 * TRIP-665 g01 default 재작성 — **실패 표면 전담**(보존 계약).
 *
 * 무엇을 보장하나: 신 default 에서도 **제출 실패 배너 · 등록 실패 배너 · 국내 차단 다이얼로그**가 그대로
 * 그려지고, 두 배너가 **서로 다른 testID 로 갈려 섞이지 않으며**(01b D2 — 합치면 [다시 시도]가 여행을 하나
 * 더 만든다), '국내 도시 고르기' 가 여행지 행 오픈 콜백을 부른다(D6).
 *
 * 왜 재작성인가: 옛 `…errors.test.tsx` 는 인라인 오류(여행지·기간·날짜 카드)까지 봤는데 그 인라인 오류
 * 표면은 이번에 제거된다(편집은 S2~S6 시트로 이연 — `trip-wizard-error-destination/period/budget` testID
 * 소멸). 남는 것은 **배너 2종 + overseas 다이얼로그**(보존 testID)뿐이라 이 파일을 그것만 보게 다시 짠다.
 *
 * 커버하지 않는 것: **언제** 배너가 뜨는지(서버 400 매핑·재시도 사정거리)는 `TripNewStep1Page.integration.
 * test.tsx` 몫. 이 파일은 "문자열/불리언을 받으면 어떻게 그리나"까지다.
 *
 * TRIP-734(§F ⓐ): 제출 배너 본문이 옛 제목+서버사유 2줄에서 **단일 줄 고정 카피 "저장하지 못했어요"**로
 * 바뀐다(submitError 는 표시값→트리거로 격하). 크롬(흰 배경+헤어라인 테두리)·재시도(pill→텍스트 링크)도
 * Figma `saveFail·v2` 정합 — S-5 가 잠근다. 아이콘 색(#C13515→#FF385C)은 SVG stroke 라 jest 완전 사각
 * (02a ★A) — 6-b 스크린샷 전용, 여기선 단언하지 않는다.
 *
 * ⚠️ 매처 함정(02a §5): `getByText('문자열')`/`queryByText` = 완전 일치, `queryBy*` 는 부재 시 null.
 * className 토큰은 `String(el.props.className).split(/\s+/)` 후 배열 `toContain` — **부분매치 금지**
 * (`text-primary` vs `text-primary-text` 거짓 통과 방지, 02a ★B).
 */
describe('실패 표면', () => {
  function props(
    over: Partial<TripWizardStep1ScreenProps> = {}
  ): TripWizardStep1ScreenProps {
    return {
      // TRIP-732: 실패 배너/다이얼로그가 관심사라 요약은 전부 null(2톤 객체를 넣으면 구 화면이 render
      // throw, 신 shape 로 tsc 오류 — null 은 구·신 모두 안전, 02a §4-★E). 배너 로직은 무회귀.
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

  describe('S-1 · 제출 실패 배너 — 단일 줄 고정 카피 (§F ⓐ)', () => {
    it('고정 카피 한 줄만 보여주고(옛 제목·서버 사유 미표시), 다시 시도가 콜백을 부른다', () => {
      const onRetrySubmit = jest.fn();
      render(
        <TripWizardStep1Screen
          {...props({
            // §F ⓐ — submitError 는 이제 배너를 켜는 **트리거**일 뿐, 그 내용은 화면에 안 뜬다.
            submitError: '네트워크를 확인하고 다시 시도해주세요',
            onRetrySubmit,
          })}
        />
      );

      const banner = screen.getByTestId('trip-wizard-submit-banner');
      // 본문은 화면 소유 고정 카피 한 줄.
      expect(within(banner).getByText('저장하지 못했어요')).toBeOnTheScreen();
      // 옛 제목·2줄째 서버 사유는 렌더에서 사라진다(AC-7 "소멸"). queryBy* 는 못 찾으면 null(부재 단언용).
      expect(within(banner).queryByText('여행을 만들지 못했어요')).toBeNull();
      expect(
        within(banner).queryByText('네트워크를 확인하고 다시 시도해주세요')
      ).toBeNull();

      fireEvent.press(
        within(banner).getByTestId('trip-wizard-submit-banner-retry')
      );
      expect(onRetrySubmit).toHaveBeenCalledTimes(1);
    });

    it('짝 — 본문을 안 넘기면 배너가 없다', () => {
      render(<TripWizardStep1Screen {...props()} />);
      expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
    });
  });

  describe('S-2 · 등록 실패 배너는 제출 실패 배너와 섞이지 않는다 (01b D2)', () => {
    it('등록 배너만 뜨고 제출 배너는 없으며, 재시도는 등록 쪽 콜백만 부른다', () => {
      const onRetryMustVisits = jest.fn();
      const onRetrySubmit = jest.fn();
      const NOTICE = '꼭 갈 곳 3곳 중 1곳을 등록하지 못했어요';
      render(
        <TripWizardStep1Screen
          {...props({
            mustVisitError: NOTICE,
            onRetryMustVisits,
            onRetrySubmit,
          })}
        />
      );

      const banner = screen.getByTestId('trip-wizard-mustvisit-banner');
      expect(within(banner).getByText(NOTICE)).toBeOnTheScreen();
      // ⚠️ 여행 생성 실패 배너는 뜨지 않는다 — 그쪽 [다시 시도]는 여행을 다시 만든다(D2).
      expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();

      fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-banner-retry'));
      expect(onRetryMustVisits).toHaveBeenCalledTimes(1);
      expect(onRetrySubmit).not.toHaveBeenCalled();
    });

    it('짝(반대 방향) — 제출 실패만 주면 제출 배너만 뜨고 등록 배너는 없다', () => {
      render(<TripWizardStep1Screen {...props({ submitError: '실패' })} />);

      expect(screen.getByTestId('trip-wizard-submit-banner')).toBeOnTheScreen();
      expect(screen.queryByTestId('trip-wizard-mustvisit-banner')).toBeNull();
    });
  });

  describe('S-3 · 국내 차단 다이얼로그 (보존, D6)', () => {
    it('정본 문구를 그리고, 국내 도시 고르기·닫기가 각자 콜백을 부른다', () => {
      const onPickDomesticRegion = jest.fn();
      const onCloseOverseasDialog = jest.fn();
      render(
        <TripWizardStep1Screen
          {...props({
            overseasBlocked: true,
            onPickDomesticRegion,
            onCloseOverseasDialog,
          })}
        />
      );

      const dialog = screen.getByTestId('trip-wizard-overseas-dialog');
      expect(
        within(dialog).getByText('지금은 국내 여행만 지원해요')
      ).toBeOnTheScreen();

      // '국내 도시 고르기' — 새 default 엔 옛 인라인 도시 시트가 없다. 다이얼로그는 여행지 행 오픈
      // 콜백(D6)을 부를 뿐이고, 옛 `-destination-sheet` 는 열리지 않는다(제거됨).
      fireEvent.press(
        screen.getByTestId('trip-wizard-overseas-dialog-confirm')
      );
      expect(onPickDomesticRegion).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();

      fireEvent.press(screen.getByTestId('trip-wizard-overseas-dialog-close'));
      expect(onCloseOverseasDialog).toHaveBeenCalledTimes(1);
    });

    it('TRIP-939 B-9: 다이얼로그에 "준비 중" 문구가 없다(제목·국내 안내는 그대로)', () => {
      // 준비·실행: 해외 차단 다이얼로그를 띄운다.
      render(<TripWizardStep1Screen {...props({ overseasBlocked: true })} />);
      const dialog = screen.getByTestId('trip-wizard-overseas-dialog');

      // 단언: 미완성 기능 예고("해외 여행지는 준비 중이에요.") 부재 + 짝 앵커(제목·국내 유도 문구).
      expect(within(dialog).queryByText(/준비 중/)).toBeNull();
      expect(
        within(dialog).getByText('지금은 국내 여행만 지원해요')
      ).toBeOnTheScreen();
      expect(
        within(dialog).getByText('국내 도시로 만들어볼까요?')
      ).toBeOnTheScreen();
    });

    it('짝 — overseasBlocked 가 아니면 다이얼로그가 없다', () => {
      render(<TripWizardStep1Screen {...props()} />);
      expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();
    });
  });

  describe('S-5 · 배너 크롬·재시도 링크 정합 (Figma saveFail·v2, AC-8·AC-9)', () => {
    // 두 배너를 동시에 켜서 제출·등록 크롬을 한 번에 잰다.
    function renderBothBanners() {
      render(
        <TripWizardStep1Screen
          {...props({
            submitError: '실패',
            mustVisitError: '꼭 갈 곳 3곳 중 1곳을 등록하지 못했어요',
            onRetrySubmit: jest.fn(),
            onRetryMustVisits: jest.fn(),
          })}
        />
      );
    }

    // className 문자열을 공백으로 쪼갠 토큰 배열 — 부분매치(text-primary vs text-primary-text) 함정 회피(★B).
    function tokens(el: { props: { className?: unknown } }): string[] {
      return String(el.props.className ?? '').split(/\s+/);
    }

    it('AC-8 — 제출·등록 배너 컨테이너가 흰 배경+헤어라인 테두리+r12 이고 pale 채움이 아니다', () => {
      renderBothBanners();

      for (const testId of [
        'trip-wizard-submit-banner',
        'trip-wizard-mustvisit-banner',
      ]) {
        const banner = tokens(screen.getByTestId(testId));
        // 있어야 할 크롬 토큰(현행엔 bg-canvas·border·border-hairline 없음 → red).
        expect(banner).toContain('bg-canvas');
        expect(banner).toContain('border');
        expect(banner).toContain('border-hairline');
        expect(banner).toContain('rounded-button'); // 현행 유지(선제 green).
        // 옛 pale 채움은 사라진다(현행 있음 → red). 이 단언이 className 가독 증명도 겸한다(02a §5).
        expect(banner).not.toContain('bg-primary-pale');
      }
    });

    it('AC-9 — 재시도는 pill 크롬 없는 text-primary 텍스트 링크다', () => {
      renderBothBanners();

      for (const [bannerId, retryId] of [
        ['trip-wizard-submit-banner', 'trip-wizard-submit-banner-retry'],
        ['trip-wizard-mustvisit-banner', 'trip-wizard-mustvisit-banner-retry'],
      ]) {
        const banner = screen.getByTestId(bannerId);
        const retry = within(banner).getByTestId(retryId);
        // pill 크롬(둥근 알약·primary 테두리)이 사라진다(현행 있음 → red).
        expect(tokens(retry)).not.toContain('rounded-pill');
        expect(tokens(retry)).not.toContain('border-primary');
        // 링크 글자는 선명한 primary(#FF385C). split 정확매치라 text-primary-text 는 안 걸린다(★B, 현행 red).
        const label = within(retry).getByText('다시 시도');
        expect(tokens(label)).toContain('text-primary');
      }
    });
  });
});

/**
 * TRIP-732 g01 요약 5행 2톤 — **신규 시각 계약 전담**(Figma default `3742:2068`·empty `3652:2068`).
 *
 * 무엇을 보장하나:
 *  - **AC-4 sub caption**: 요약 행이 `{main, sub?}`를 받으면 값(main) 뒤 **같은 줄**에 회색 sub caption
 *    (`text-muted`, testID `{행}-sub`)을 그린다. sub 없는 행(동행)은 caption 요소 자체를 안 만든다.
 *  - **AC-5 온보딩 배지**: 취향 행이 `onboarding:true`면 main 뒤에 **기존 SparkleGlyph**
 *    (testID `trip-wizard-preference-sparkle`) + 분홍(`text-primary`) "온보딩" 텍스트를 붙이고, `false`면
 *    둘 다 미렌더한다. 옛 문자열 `" + 온보딩"`은 어디에도 없다.
 *  - **AC-6 부제 3분기**: 여행지·기간 둘 다 null → empty 부제, isLoading → 로딩 부제(empty 이김),
 *    그 외 → default 부제.
 *  - **AC-8 비활성 CTA 재스타일**: 비활성([다음])은 `bg-[#E9E9EB]`+라벨 `text-muted-soft`(opacity-40 폐기),
 *    활성은 `bg-primary`+`text-on-primary`. loading 도 비활성 스타일 공유.
 *
 * 커버하지 않는 것(색은 jest 사각, 02a §4-★A):
 *  - 스파클 fill·"온보딩" 실제 분홍·비활성 CTA 실제 회색·물방울 대비는 [검증] 6-b 스크린샷 몫.
 *    여기서는 **존재(testID)·텍스트·className 토큰**까지만 잠근다(실색 단언 없음).
 *  - 요약 문자열 **도출**(페이지 `tripSummary` 셀렉터, `tripSummary.test.ts`).
 *
 * ⚠️ 매처(02a §5, 기존 파일 헤더 계승): `getByText('문자열')`=완전 일치 · `toHaveTextContent('문자열')`
 * =완전 일치 · `toHaveTextContent(/re/)`=부분 일치 · `queryByTestId(...).toBeNull()`=부재 ·
 * `props.className`은 arbitrary 토큰까지 raw 로 보존(probe 실측, §5-4) → `split(/\s+/)`로 토큰 검사.
 *
 * ⚠️ prop shape 는 이번 사이클이 `string|null` → 객체형으로 바꾼다 — 구현 전엔 화면이 객체를 Text child
 * 로 받아 throw 한다(의도된 red). 구현자가 인터페이스를 `SummaryLine|null`로 바꾸면 green(02a §4-★F).
 *
 * 3동작 뼈대: 준비=props(객체) → 실행=render(+press) → 단언=보이는 것 / 토큰 / 불린 콜백.
 */
describe('요약 5행 2톤', () => {
  /** 요약 셀렉터 신 출력(객체형). 화면은 이 객체를 받아 2톤으로 그린다. */
  const DEST = { main: '부산', sub: '2박 · 경주 1박' };
  const PERIOD = { main: '6월 10일(수) – 13일(토)', sub: '3박 4일' };
  const COMPANION = { main: '친구 2명' }; // sub 없음
  const PREF_ON = { main: '미식 · 전시 · 야경', onboarding: true };
  const PREF_OFF = { main: '미식 · 전시 · 야경', onboarding: false };
  const BUDGET = { main: '120만원', sub: '1인 총액 · 중간' };

  function props(
    over: Partial<TripWizardStep1ScreenProps> = {}
  ): TripWizardStep1ScreenProps {
    return {
      summaryDestinations: DEST,
      summaryPeriod: PERIOD,
      summaryCompanion: COMPANION,
      summaryPreferences: PREF_ON,
      summaryBudget: BUDGET,
      onPressSummaryDestination: jest.fn(),
      onPressSummaryPeriod: jest.fn(),
      onPressSummaryCompanion: jest.fn(),
      onPressSummaryPreference: jest.fn(),
      onPressSummaryBudget: jest.fn(),
      mustVisits: [],
      onPressMore: jest.fn(),
      onPressSeeAll: jest.fn(),
      canProceed: true,
      onNext: jest.fn(),
      onBack: jest.fn(),
      ...over,
    };
  }

  function root() {
    return screen.getByTestId('trip-wizard-step1-root');
  }

  /** className 은 NativeWind 가 렌더 트리에 raw prop 으로 남긴다(probe 실측). 공백 토큰 배열로 본다. */
  function classes(node: { props: { className?: string } }): string[] {
    return String(node.props.className ?? '').split(/\s+/);
  }

  function classesOf(testID: string): string[] {
    return classes(screen.getByTestId(testID));
  }

  describe('AC-4 · sub caption (값 뒤 같은 줄 회색)', () => {
    it('sub 있는 행은 회색 caption 을, 없는 행(동행)은 caption 자체를 안 만든다', () => {
      render(<TripWizardStep1Screen {...props()} />);

      // 여행지 — main + sub(별도 회색 caption).
      const dest = screen.getByTestId('trip-wizard-summary-destination');
      expect(within(dest).getByText('부산')).toBeOnTheScreen();
      const destSub = screen.getByTestId('trip-wizard-summary-destination-sub');
      expect(destSub).toHaveTextContent('2박 · 경주 1박'); // 완전 일치
      expect(classesOf('trip-wizard-summary-destination-sub')).toContain(
        'text-muted'
      );

      // 예산 — sub 도 회색 caption.
      expect(
        screen.getByTestId('trip-wizard-summary-budget-sub')
      ).toHaveTextContent('1인 총액 · 중간');

      // 짝(부재) — 동행은 sub 가 없어 caption 요소를 안 만든다.
      expect(
        screen.queryByTestId('trip-wizard-summary-companion-sub')
      ).toBeNull();
      // 짝(긍정) — 그래도 동행 main 은 그려졌다(카드 자체가 안 떠서 공짜 통과하는 것 방지).
      const comp = screen.getByTestId('trip-wizard-summary-companion');
      expect(within(comp).getByText('친구 2명')).toBeOnTheScreen();
    });
  });

  describe('AC-5 · 취향 온보딩 배지 (스파클 + 분홍 "온보딩")', () => {
    it('onboarding=true 면 스파클 + 분홍 "온보딩" 텍스트를 붙인다 (옛 " + 온보딩" 문자열 소멸)', () => {
      render(
        <TripWizardStep1Screen {...props({ summaryPreferences: PREF_ON })} />
      );

      const pref = screen.getByTestId('trip-wizard-summary-preference');
      // main 은 라벨 조인만.
      expect(within(pref).getByText('미식 · 전시 · 야경')).toBeOnTheScreen();
      // 배지 — 스파클 글리프(존재만, fill 은 jest 사각) + 분홍 "온보딩" 텍스트.
      expect(
        screen.getByTestId('trip-wizard-preference-sparkle')
      ).toBeOnTheScreen();
      const badge = within(pref).getByText('온보딩');
      expect(badge).toBeOnTheScreen();
      // 색은 실색 아니라 className 토큰만 (★A) — primary(#FF385C).
      expect(classes(badge)).toContain('text-primary');
      // 옛 접미 문자열은 화면 어디에도 없다.
      expect(root()).not.toHaveTextContent(/\+ 온보딩/);
    });

    it('onboarding=false 면 스파클·"온보딩" 텍스트가 둘 다 없다 (짝)', () => {
      render(
        <TripWizardStep1Screen {...props({ summaryPreferences: PREF_OFF })} />
      );

      const pref = screen.getByTestId('trip-wizard-summary-preference');
      // main 은 그대로(카드 자체는 그려짐).
      expect(within(pref).getByText('미식 · 전시 · 야경')).toBeOnTheScreen();
      // 배지는 미렌더.
      expect(screen.queryByTestId('trip-wizard-preference-sparkle')).toBeNull();
      expect(within(pref).queryByText('온보딩')).toBeNull();
    });
  });

  describe('AC-6 · 부제 3분기 (empty / loading / default)', () => {
    it('여행지·기간 둘 다 null 이면 empty 부제 (default 부제 아님)', () => {
      render(
        <TripWizardStep1Screen
          {...props({ summaryDestinations: null, summaryPeriod: null })}
        />
      );

      expect(root()).toHaveTextContent(/여행지와 기간만 정하면/);
      expect(root()).not.toHaveTextContent(/온보딩에서 고른 취향/);
    });

    it('여행지 값이 있으면 default 부제 (empty 부제 아님)', () => {
      render(<TripWizardStep1Screen {...props()} />);

      expect(root()).toHaveTextContent(/온보딩에서 고른 취향/);
      expect(root()).not.toHaveTextContent(/여행지와 기간만 정하면/);
    });

    it('isLoading 이면 로딩 부제가 empty 부제를 이긴다 (우선순위 loading > empty)', () => {
      render(
        <TripWizardStep1Screen
          {...props({
            summaryDestinations: null,
            summaryPeriod: null,
            isLoading: true,
          })}
        />
      );

      expect(root()).toHaveTextContent(/여행 정보를 불러오는 중/);
      expect(root()).not.toHaveTextContent(/여행지와 기간만 정하면/);
    });
  });

  describe('AC-8 · 비활성 CTA 재스타일 (연회색 채움 + 회색 글자, opacity-40 폐기)', () => {
    it('활성(canProceed) — 분홍 채움 + on-primary 글자, 눌리면 콜백', () => {
      const onNext = jest.fn();
      render(
        <TripWizardStep1Screen {...props({ canProceed: true, onNext })} />
      );

      const next = screen.getByTestId('trip-wizard-step1-next');
      expect(next).toBeEnabled();
      expect(classes(next)).toContain('bg-primary');
      expect(classes(next)).not.toContain('bg-[#E9E9EB]');
      expect(classes(within(next).getByText('다음'))).toContain(
        'text-on-primary'
      );

      fireEvent.press(next);
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('비활성(!canProceed) — 연회색 채움 + muted-soft 글자, opacity-40 없음, 실제로 안 눌린다 (3단)', () => {
      const onNext = jest.fn();
      render(
        <TripWizardStep1Screen {...props({ canProceed: false, onNext })} />
      );

      const next = screen.getByTestId('trip-wizard-step1-next');
      // 3단 심판 — toBeDisabled 단독은 가짜(접근성 상태만), press + 콜백 0 회로 실제 차단 확인.
      expect(next).toBeDisabled();
      fireEvent.press(next);
      expect(onNext).not.toHaveBeenCalled();

      // 재스타일 — 채움 토큰만(실색은 6-b). 연회색 arbitrary hex + muted-soft 글자, opacity-40 없음.
      expect(classes(next)).toContain('bg-[#E9E9EB]');
      expect(classes(next)).not.toContain('opacity-40');
      expect(classes(next)).not.toContain('bg-primary');
      const label = within(next).getByText('다음');
      expect(classes(label)).toContain('text-muted-soft');
      expect(classes(label)).not.toContain('text-on-primary');
    });

    it('loading 도 비활성 스타일을 공유한다 (canProceed 참이어도)', () => {
      render(
        <TripWizardStep1Screen
          {...props({ canProceed: true, isLoading: true })}
        />
      );

      const next = screen.getByTestId('trip-wizard-step1-next');
      expect(next).toBeDisabled();
      expect(classes(next)).toContain('bg-[#E9E9EB]');
    });
  });
});
