import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  TripWizardStep2Screen,
  type NightlyBaseCardVM,
  type Step2Variant,
} from './TripWizardStep2Screen';

/**
 * TRIP-672 · S8 g02 — **신 default 얼굴(박별 거점 카드)의 props-only 화면 심판.**
 * TRIP-674 · S10 — 그 위에 **empty·loading 두 얼굴**을 얹는다(default·error·notrip 무변경).
 *
 * 이 파일이 유일하게 잡는 것: 카드가 밤 수만큼 뜨고 각 필드(박 라벨·날짜·지역·숙소명 or "숙소 미정")를
 * 그리는가 · **카드 탭이 그 밤의 nightNumber 로 오픈 신호를 내는가**(배선의 onPressCard 는 S9 미착수라
 * 무동작 stub이라, 이 계약을 재는 곳은 화면 층뿐이다) · 진행바가 "2 / 4"·4칸(앞 2칸 활성)인가 ·
 * 두 CTA 가 게이트 없이 활성이고 콜백을 부르는가.
 *
 * TRIP-674 추가 심판:
 *  - **empty 얼굴**: 부제 "저장한 숙소가 없어요…" + 박별 미정 행(메타+chevron 만, `trip-base-empty-night-*`)
 *    + 주 CTA "숙소 없이 계속"(공유 testID `trip-base-nostay-start`) + 보조 "숙소 둘러보기"(신 `trip-base-browse`
 *    →`onBrowseStays`). `trip-base-generate` 부재.
 *  - **loading 얼굴**: 스켈레톤 3행 + 부제 "거점을 불러오는 중" + **default CTA**(generate 계승).
 *  - CTA 공유 testID 는 얼굴마다 문구가 다르나 동작은 같다 — 문구로 얼굴을 가르고 testID 로 동작을 잠근다.
 *
 * ⚠️ RNTL `toHaveTextContent(문자열)`은 **완전 일치**다(normalize 후 `===`, `matches.js:15`→`matches.js:8`
 * 소스 실측). CTA 라벨은 Pressable 텍스트가 라벨 하나뿐이라 문자열(완전 일치)로 문구 드리프트까지 잡고,
 * 카드/행 메타는 여러 Text 가 이어붙으므로 **부분 포함은 반드시 RegExp**로 잰다.
 *
 * 3동작: 준비(cards VM·jest.fn 콜백) → 실행(render + press) → 단언(렌더/콜백).
 */

/** className 을 공백으로 쪼갠 토큰 배열 — NativeWind 가 심어도 `props.className`이 렌더트리에 평문으로
 * 남는다(SocialLoginScreen.visual.test 선례). 진행바 활성색 단언에 쓴다. */
function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/) : [];
}

const CARDS: NightlyBaseCardVM[] = [
  {
    nightNumber: 1,
    dateLabel: '6/10(수)',
    region: '부산',
    stayName: '해운대 오션 호텔',
  },
  {
    nightNumber: 2,
    dateLabel: '6/11(목)',
    region: '부산',
    stayName: '해운대 오션 호텔',
  },
  // 미배정 밤 — stayName 없음 → "숙소 미정"으로 그려져야 한다.
  { nightNumber: 3, dateLabel: '6/12(금)', region: '경주' },
];

function renderScreen(
  over: Partial<Parameters<typeof TripWizardStep2Screen>[0]> = {}
) {
  const props = {
    variant: 'default' as Step2Variant,
    cards: CARDS,
    onPressCard: jest.fn(),
    onGenerate: jest.fn(),
    onNoStayStart: jest.fn(),
    onBrowseStays: jest.fn(), // TRIP-674 신규 — empty 보조 CTA "숙소 둘러보기"(→/stays).
    onBack: jest.fn(),
    onRetryAll: jest.fn(),
    onRestart: jest.fn(),
    ...over,
  };
  render(<TripWizardStep2Screen {...props} />);
  return props;
}

describe('앱바·진행바 크롬 (AC-1 · AC-7)', () => {
  it('진행바가 4칸이고 앞 2칸이 활성(primary)·뒤 2칸이 비활성이며 "2 / 4"를 그린다', () => {
    renderScreen();

    // "2 / 2" → "2 / 4" — formatWizardStep(2)의 결과가 화면에 뜬다.
    expect(screen.getByText('2 / 4')).toBeOnTheScreen();

    // 4칸이 실재한다(S1 자매 testID).
    [1, 2, 3, 4].forEach((n) =>
      expect(
        screen.getByTestId(`trip-wizard-progress-seg-${n}`)
      ).toBeOnTheScreen()
    );

    // 정확히 2칸 활성 — seg2 활성색 + seg3 비활성색을 짝으로 잰다(1칸·3칸 뮤턴트 red).
    // Figma 가 4칸 모두 같은 너비라 활성 구분은 색(className)뿐이다(★3).
    expect(
      classTokens(screen.getByTestId('trip-wizard-progress-seg-2'))
    ).toContain('bg-primary');
    expect(
      classTokens(screen.getByTestId('trip-wizard-progress-seg-3'))
    ).toContain('bg-hairline-strong');
  });

  it('타이틀은 "어디서 묵을까요?"이고 옛 부제("박별 거점 · …")는 없다', () => {
    renderScreen();

    expect(screen.getByText('어디서 묵을까요?')).toBeOnTheScreen();
    // 부제 삭제(브리프 §4) — 옛 `박별 거점 · {기간}` 부제가 사라졌다.
    expect(screen.queryByText(/박별 거점/)).toBeNull();
    // TRIP-674 맹점② — default 얼굴엔 부제가 없다(loading·empty 부제가 default 로 새면 red).
    expect(screen.queryByText('거점을 불러오는 중')).toBeNull();
    expect(screen.queryByText(/저장한 숙소가 없어요/)).toBeNull();
  });

  it('guide 한 줄이 뜬다 — "숙소는 나중에 …" 와 "동선 기준으로 추천"이 한 문장이다 (옛 2줄 배너 대체)', () => {
    renderScreen();

    // 옛 OnrampBanner 는 두 줄(별도 Text)이라 이 정규식(둘이 한 노드)엔 안 맞았다.
    expect(
      screen.getByText(/숙소는 나중에 정해도 돼요.*동선 기준/)
    ).toBeOnTheScreen();
  });

  it('뒤로 가기를 누르면 onBack 을 부른다', () => {
    const props = renderScreen();

    fireEvent.press(screen.getByTestId('trip-base-back'));

    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('박별 거점 카드 (AC-2)', () => {
  it('밤 수만큼 카드가 뜨고 각 카드가 박 라벨·날짜(요일)·지역·숙소명을 그린다', () => {
    renderScreen();

    // 밤 3개 = 카드 3장.
    expect(screen.getAllByTestId(/^trip-base-night-card-/)).toHaveLength(3);

    // 카드1 — 배정된 밤. 각 필드를 RegExp(부분 포함)로 잰다(카드 전체 텍스트가 이어붙으므로).
    const card1 = screen.getByTestId('trip-base-night-card-1');
    expect(card1).toHaveTextContent(/1박/);
    expect(card1).toHaveTextContent(/6\/10\(수\)/);
    expect(card1).toHaveTextContent(/부산/);
    expect(card1).toHaveTextContent(/해운대 오션 호텔/);
    // 배정된 밤엔 "숙소 미정"이 뜨지 않는다.
    expect(card1).not.toHaveTextContent(/숙소 미정/);
  });

  it('미배정 밤(stayName 없음)은 "숙소 미정"으로 그린다', () => {
    renderScreen();

    const card3 = screen.getByTestId('trip-base-night-card-3');
    expect(card3).toHaveTextContent(/3박/);
    expect(card3).toHaveTextContent(/6\/12\(금\)/);
    expect(card3).toHaveTextContent(/경주/);
    expect(card3).toHaveTextContent(/숙소 미정/);
  });

  it('★ 행↔콜백 — 둘째 카드를 누르면 그 밤(nightNumber:2)으로 오픈 신호가 난다', () => {
    // 첫 카드가 아니라 둘째를 눌러 "항상 1번만 여는" 뮤턴트를 잡는다.
    const props = renderScreen();

    fireEvent.press(screen.getByTestId('trip-base-night-card-2'));

    expect(props.onPressCard).toHaveBeenCalledTimes(1);
    expect(props.onPressCard).toHaveBeenCalledWith(2);
  });
});

describe('하단 CTA 2종 (AC-5) — 게이트 없이 둘 다 활성', () => {
  it('"이 거점으로 일정 만들기"가 활성이고 누르면 onGenerate 를 부른다', () => {
    const props = renderScreen();

    const generate = screen.getByTestId('trip-base-generate');
    // 게이트 제거 — 예전 generateDisabled 로 회색이 되던 자리가 항상 활성이다(뮤턴트 red).
    expect(generate).toBeEnabled();
    fireEvent.press(generate);

    expect(props.onGenerate).toHaveBeenCalledTimes(1);
  });

  it('"숙소 없이 시작하기"가 활성이고 누르면 onNoStayStart 를 부른다', () => {
    const props = renderScreen();

    const nostay = screen.getByTestId('trip-base-nostay-start');
    expect(nostay).toBeEnabled();
    fireEvent.press(nostay);

    expect(props.onNoStayStart).toHaveBeenCalledTimes(1);
  });
});

describe('제거 확인 (AC-3) — 옛 후보/커버리지/묶음/폴백/시트가 신 화면에 없다', () => {
  it('박별 카드는 뜨고(긍정 짝) 옛 요소 testID 는 하나도 없다', () => {
    renderScreen();

    // 긍정 짝 — 카드가 실제로 그려졌다(빈 화면이 부정 단언을 공짜로 통과하는 것 차단).
    expect(screen.getByTestId('trip-base-night-card-1')).toBeOnTheScreen();

    // 후보 하트/닻·연박 묶음·fix 시트 — 접두 testID 군 0건.
    expect(screen.queryAllByTestId(/^trip-base-candidate-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^trip-base-section-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/trip-base-fixsheet/)).toHaveLength(0);
    // 커버리지/blocked·폴백 경고 — 개별 testID 부재.
    expect(screen.queryByTestId('trip-base-blocked-notice')).toBeNull();
    expect(screen.queryByTestId('trip-base-fallback-warning')).toBeNull();
  });
});

describe('변형 얼굴 (골격 보존)', () => {
  it('notrip — 안내를 그리고 처음부터 버튼이 onRestart 를 부른다', () => {
    const props = renderScreen({ variant: 'notrip', cards: [] });

    expect(screen.getByTestId('trip-base-notrip')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('trip-base-notrip-restart'));
    expect(props.onRestart).toHaveBeenCalledTimes(1);
  });

  it('error — 안내를 그리고 다시 시도가 onRetryAll 을 부른다', () => {
    const props = renderScreen({ variant: 'error', cards: [] });

    expect(screen.getByTestId('trip-base-error')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('trip-base-error-retry'));
    expect(props.onRetryAll).toHaveBeenCalledTimes(1);
  });

  it('loading — 박별 행 스켈레톤만 뜨고(후보 카드 스켈레톤 아님) 보조 CTA 는 살아 있다', () => {
    const props = renderScreen({ variant: 'loading', cards: [] });

    // 박별 행 스켈레톤이 뜬다.
    expect(
      screen.getAllByTestId(/^trip-base-skeleton-night-/).length
    ).toBeGreaterThan(0);
    // 옛 후보 카드 스켈레톤은 사라졌다.
    expect(screen.queryAllByTestId(/^trip-base-skeleton-card-/)).toHaveLength(
      0
    );
    // 로딩 중에도 나가는 문(숙소 없이 시작)은 열려 있다.
    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    expect(props.onNoStayStart).toHaveBeenCalledTimes(1);
  });
});

// 미배정 밤만 있는 카드 — empty 얼굴의 박별 행 출처(stayName 없음).
const EMPTY_CARDS: NightlyBaseCardVM[] = [
  { nightNumber: 1, dateLabel: '6/10(수)', region: '부산' },
  { nightNumber: 2, dateLabel: '6/11(목)', region: '부산' },
  { nightNumber: 3, dateLabel: '6/12(금)', region: '경주' },
];

describe('empty 얼굴 (AC-1 · AC-3) — 저장 숙소 0', () => {
  it('부제·박별 미정 행·둘러보기 CTA 를 그리고 generate 는 없다', () => {
    renderScreen({ variant: 'empty', cards: EMPTY_CARDS });

    // 부제 — empty 에만 있는 줄(미들닷 포함 한 노드라 부분 앵커 RegExp).
    expect(screen.getByText(/저장한 숙소가 없어요/)).toBeOnTheScreen();

    // 박별 미정 행 3개 — 메타는 뜨되(부분 포함) "숙소 미정" 둘째 줄은 없다(chevron 만).
    expect(screen.getAllByTestId(/^trip-base-empty-night-/)).toHaveLength(3);
    const row1 = screen.getByTestId('trip-base-empty-night-1');
    expect(row1).toHaveTextContent(/1박/);
    expect(row1).toHaveTextContent(/부산/);
    expect(row1).not.toHaveTextContent(/숙소 미정/);
    // ★2 상호배타 — empty 는 default 카드(stayName 렌더)로 새지 않는다.
    expect(screen.queryAllByTestId(/^trip-base-night-card-/)).toHaveLength(0);

    // 주 CTA — 공유 testID·다른 문구. "숙소 없이 계속"은 Pressable 텍스트가 라벨 하나뿐이라
    // 완전 일치(문자열)로 잰다(default 의 "숙소 없이 시작하기"와 갈림, ★3).
    const primary = screen.getByTestId('trip-base-nostay-start');
    expect(primary).toBeEnabled();
    expect(primary).toHaveTextContent('숙소 없이 계속');
    // 보조 CTA — 신 testID·문구.
    expect(screen.getByTestId('trip-base-browse')).toHaveTextContent(
      '숙소 둘러보기'
    );

    // ★5 부정 짝(긍정 짝과 같은 it) — default 주 CTA(generate)는 empty 에 없다
    // (뮤턴트: empty 에 generate 표시·CTA 스왑 → red).
    expect(screen.queryByTestId('trip-base-generate')).toBeNull();
  });

  it('둘러보기를 누르면 onBrowseStays 를, 미정 행을 누르면 그 밤으로 onPressCard 를 부른다', () => {
    const props = renderScreen({ variant: 'empty', cards: EMPTY_CARDS });

    fireEvent.press(screen.getByTestId('trip-base-browse'));
    expect(props.onBrowseStays).toHaveBeenCalledTimes(1);

    // 첫 행이 아니라 둘째를 눌러 "항상 1번만 여는" 뮤턴트를 잡는다(S9 오픈 신호, 01b D2).
    fireEvent.press(screen.getByTestId('trip-base-empty-night-2'));
    expect(props.onPressCard).toHaveBeenCalledWith(2);
  });

  it('주 CTA "숙소 없이 계속"을 누르면 onNoStayStart 를 부른다 (공유 동작)', () => {
    const props = renderScreen({ variant: 'empty', cards: EMPTY_CARDS });

    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));

    expect(props.onNoStayStart).toHaveBeenCalledTimes(1);
  });
});

describe('loading 얼굴 (AC-2) — 신 스켈레톤·부제·default CTA', () => {
  it('밤 3행 스켈레톤 + "거점을 불러오는 중" 부제 + default CTA(generate) 를 그린다', () => {
    renderScreen({ variant: 'loading', cards: [] });

    // 스켈레톤 3행 고정(Figma·현행 답습, 01b D3·맹점⑤).
    expect(screen.getAllByTestId(/^trip-base-skeleton-night-/)).toHaveLength(3);

    // loading 전용 부제 — 한 노드라 완전 일치(문자열).
    expect(screen.getByText('거점을 불러오는 중')).toBeOnTheScreen();

    // default CTA 계승 — loading 은 generate 가 산다(empty 와 갈리는 지점, 01b D3).
    expect(screen.getByTestId('trip-base-generate')).toBeOnTheScreen();

    // 조회 중이라 값·empty 마커는 아직 없다(loading≠empty).
    expect(screen.queryByText(/숙소 미정/)).toBeNull();
    expect(screen.queryByTestId('trip-base-browse')).toBeNull();
  });
});
