import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  buildSettingsSections,
  type SettingsInput,
} from '../model/settingsSections';
import { ContrastGlyph } from './SettingsGlyphs';
import { SettingsScreen } from './SettingsScreen';

/**
 * TRIP-778 AC-5·6·7 · TRIP-1051 — l05 설정 default(라이브 Figma 4664:3279) 행 표면(프레젠테이션).
 *
 * 무엇을 보장하나:
 *  - TRIP-1051: 취향은 한 행 `여행 취향 · N/7 설정됨 ›`(반원 아이콘). N 은 설정된 축 수, 모르면 값을
 *    비운다(0/7 금지). 누르면 진입 콜백(`onPressPreferences`)이 1번 나간다. (구 TRIP-778 AC-4 7행 값·
 *    `미설정` 칩은 사용자 결정 A 로 폐기.)
 *  - AC-5: 위치정보 수집 동의 행에 `동의`(분홍)/`미동의`(회색) 칩, 모르면 칩 없음(D4).
 *  - AC-6: 위치정보 그룹의 개인화 행 — 리딩 글리프 + 동의면 `사용 중` + chevron, 누르면 진입 콜백.
 *  - AC-7: 제휴 안내 행은 chevron 이 아니라 스위치다. `affiliateNoticeOn` 을 그대로 보이고, 모르면
 *    (null) 누를 수 없다(D7 — 모르는 값 위에 PATCH 금지). 실패 안내는 행 아래 인라인(D7).
 *
 * 서버 값 ↔ UI 의미 반전(dismissed ↔ "다시 보기")은 페이지 몫이다 — 이 화면은 UI 의미만 받는다
 * (02a §2-3, 반전 방향은 SettingsPage.l05parity.integration 이 와이어 본문으로 잠근다).
 *
 * 3동작 뼈대: 준비=서버 값을 넣은 실 뷰모델 → 실행=렌더·press → 단언=행 안의 값·칩·스위치·콜백.
 *
 * ⚠️ 픽셀(칩 r8·값 14 muted·배경 canvas·행 높이)은 [검증] 스크린샷 몫 — 여기선 testID·텍스트·
 *  색 토큰 문자열 존재까지만 본다.
 *
 * (개념) `within(요소)` — 그 요소 안에서만 찾는다. 짧은 글자(`동의`)가 다른 행에 걸리는 것을 막는다.
 * (개념) `getByTestId(/-chevron$/)` — testID 도 정규식으로 찾을 수 있다(끝이 `-chevron` 인 것 전부).
 */

type Preferences = NonNullable<SettingsInput['preferences']>;

/** 7축 중 3축(스타일·밀도·예산)만 설정 → 3/7. */
const THREE_SET: Preferences = {
  styles: { value: ['휴양'], isNeutralDefault: false },
  pace: { value: '느긋하게', isNeutralDefault: false },
  budget: { tier: '중간', isNeutralDefault: false },
};

/** 7축 모두 미설정 — 모양이 전부 다르다(중립 기본값·빈 배열·축 없음·value 없음·null). */
const ALL_UNSET_MIXED: Preferences = {
  styles: { value: ['휴양'], isNeutralDefault: true },
  activities: { value: [], isNeutralDefault: false },
  foodTastes: { isNeutralDefault: false },
  pace: { value: null, isNeutralDefault: false },
  companion: { companionTypes: [], petFlag: false, isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 500000, isNeutralDefault: true },
};

const PREF_ROW = 'settings-nav-preferences';

const noop = () => {};

function renderScreen(
  input: Partial<SettingsInput> = {},
  props: Partial<React.ComponentProps<typeof SettingsScreen>> = {}
) {
  const groups = buildSettingsSections({
    nickname: '여행자123',
    email: null,
    ...input,
  });
  return render(
    <SettingsScreen
      groups={groups}
      deletionState="active"
      currentNickname="여행자123"
      onPressBack={noop}
      onSubmitNickname={noop}
      onPressExport={noop}
      onPressDeleteAccount={noop}
      onPressCancelDeletion={noop}
      {...props}
    />
  );
}

/** 라벨(완전일치)로 그룹 카드를 찾는다. */
function groupByLabel(label: string) {
  const group = screen
    .getAllByTestId('settings-group')
    .find((g) => within(g).queryByText(label) !== null);
  expect(group).toBeDefined();
  return group!;
}

/** className 을 공백으로 쪼갠 토큰 배열 — 부분 문자열 오탐(`bg-primary` ⊂ `bg-primary-pale`) 차단. */
function tokensOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);
}

/** 행 안의 SVG 수(리딩 글리프 + chevron). host 타입 이름은 §5 실측. */
function svgCount(testID: string): number {
  return screen
    .getByTestId(testID)
    .findAll((node) => String(node.type) === 'RNSVGSvgView').length;
}

/**
 * ★ 행 안에서만 찾는다(`within(row)`) — '설정됨' 같은 글자가 다른 곳에 생겨도 헷갈리지 않게.
 * ★ AC-3 은 정규식 `/\/7/` 로 "숫자/7" 모양 전부를 막는다 — 문자열 인자는 완전일치라 `'0/7 설정됨'` 하나만
 *   막게 된다(02a ★6).
 */
describe('TRIP-1051 · 여행 취향 한 행 — N/7 설정됨·진입', () => {
  it('A1 AC-1: 3축만 설정이면 행 안에 "3/7 설정됨"(완전일치)·chevron, 칩은 없다', () => {
    renderScreen({ preferences: THREE_SET });

    const row = screen.getByTestId(PREF_ROW);
    expect(within(row).getByText('3/7 설정됨')).toBeOnTheScreen();
    expect(within(row).getByTestId(`${PREF_ROW}-chevron`)).toBeOnTheScreen();
    expect(within(row).queryAllByTestId(/^settings-chip-/)).toHaveLength(0);
  });

  it('A2 AC-2: 7축 모두 미설정이면 "0/7 설정됨" — "미설정" 칩·글자는 없다', () => {
    renderScreen({ preferences: ALL_UNSET_MIXED });

    const row = screen.getByTestId(PREF_ROW);
    expect(within(row).getByText('0/7 설정됨')).toBeOnTheScreen();
    expect(within(row).queryByText('미설정')).toBeNull();
    expect(within(row).queryAllByTestId(/^settings-chip-/)).toHaveLength(0);
  });

  it('A3 AC-3: 취향을 모르면(응답 전·실패) 행과 chevron 은 있지만 "N/7"·"설정됨"을 지어내지 않는다', () => {
    renderScreen();

    // 긍정 앵커: 행과 chevron 은 있다(누르면 편집 화면으로 갈 수 있다).
    const row = screen.getByTestId(PREF_ROW);
    expect(within(row).getByTestId(`${PREF_ROW}-chevron`)).toBeOnTheScreen();
    // 단언(부분포함): 어떤 숫자든 "/7" 이 없고, "설정됨"도 없다.
    expect(within(row).queryByText(/\/7/)).toBeNull();
    expect(within(row).queryByText(/설정됨/)).toBeNull();
    expect(within(row).queryAllByTestId(/^settings-chip-/)).toHaveLength(0);
  });

  it('A4 AC-4: 취향 행을 누르면 onPressPreferences 가 정확히 1번 나간다', () => {
    const onPressPreferences = jest.fn();
    renderScreen({ preferences: THREE_SET }, { onPressPreferences });

    // 실행
    fireEvent.press(screen.getByTestId(PREF_ROW));

    // 단언
    expect(onPressPreferences).toHaveBeenCalledTimes(1);
  });

  it('A5 AC-8(구조): 리딩 아이콘은 반원(ContrastGlyph) 1개 — SVG 는 아이콘+chevron 2개', () => {
    renderScreen({ preferences: THREE_SET });

    const row = screen.getByTestId(PREF_ROW);
    // 컴포넌트 종류로 센다 — SVG 개수만 보면 다른 글리프가 들어가도 통과한다(02a ★10).
    expect(row.findAllByType(ContrastGlyph)).toHaveLength(1);
    expect(svgCount(PREF_ROW)).toBe(2);
  });
});

describe('TRIP-778 AC-5 · 위치정보 수집 동의 칩 (D4)', () => {
  it('B1 동의면 행 안에 분홍 "동의" 칩 · chevron 유지 · 누르면 onPressLocation 1회', () => {
    const onPressLocation = jest.fn();
    renderScreen({ locationConsent: true }, { onPressLocation });

    const row = screen.getByTestId('settings-nav-location-consent');
    const chip = within(row).getByTestId('settings-chip-location-consent');
    expect(within(chip).getByText('동의')).toBeOnTheScreen();
    expect(tokensOf('settings-chip-location-consent')).toContain(
      'bg-primary-pale'
    );
    expect(
      within(row).getByTestId('settings-nav-location-consent-chevron')
    ).toBeOnTheScreen();

    fireEvent.press(row);
    expect(onPressLocation).toHaveBeenCalledTimes(1);
  });

  it('B2 미동의면 회색 "미동의" 칩이고 "동의" 칩은 없다', () => {
    renderScreen({ locationConsent: false });

    const chip = within(
      screen.getByTestId('settings-nav-location-consent')
    ).getByTestId('settings-chip-location-consent');
    expect(within(chip).getByText('미동의')).toBeOnTheScreen();
    expect(within(chip).queryByText('동의')).toBeNull();
    expect(tokensOf('settings-chip-location-consent')).toContain(
      'bg-surface-strong'
    );
  });

  it('B3 모르면(응답 전·실패) 칩을 그리지 않는다 — 행은 그대로 있다', () => {
    renderScreen();

    // 긍정 앵커: 행 자체는 있다.
    expect(
      screen.getByTestId('settings-nav-location-consent')
    ).toBeOnTheScreen();
    // 단언: 칩이 없다("미동의"라고 잘못 말하지 않는다).
    expect(screen.queryByTestId('settings-chip-location-consent')).toBeNull();
  });
});

describe('TRIP-778 AC-6 · 개인화 행 (D3)', () => {
  it('C1 위치정보 그룹 안 개인화 행 — 리딩 글리프 · "사용 중" · chevron · 누르면 onPressPersonalization 1회', () => {
    const onPressPersonalization = jest.fn();
    renderScreen({ personalizationOn: true }, { onPressPersonalization });

    // 단언: 위치정보 그룹 안에 있다(다른 그룹이면 throw → red).
    const row = within(groupByLabel('위치정보')).getByTestId(
      'settings-nav-personalization'
    );
    expect(within(row).getByText('개인화')).toBeOnTheScreen();
    expect(within(row).getByText('사용 중')).toBeOnTheScreen();
    expect(
      within(row).getByTestId('settings-nav-personalization-chevron')
    ).toBeOnTheScreen();
    // 단언: 리딩 글리프 + chevron = SVG 2개(LEADING_GLYPHS 에 personalization 이 없으면 1개).
    expect(svgCount('settings-nav-personalization')).toBe(2);

    fireEvent.press(row);
    expect(onPressPersonalization).toHaveBeenCalledTimes(1);
  });

  it('C2 미동의면 값 없이 chevron 만 — "사용 중" 없음, 칩 없음', () => {
    renderScreen({ personalizationOn: false });

    const row = screen.getByTestId('settings-nav-personalization');
    // 긍정 앵커: 행과 chevron 은 있다.
    expect(
      within(row).getByTestId('settings-nav-personalization-chevron')
    ).toBeOnTheScreen();
    expect(within(row).queryByText('사용 중')).toBeNull();
    expect(screen.queryByTestId('settings-chip-personalization')).toBeNull();
  });
});

describe('TRIP-778 AC-7 · 제휴 안내 토글 (D7)', () => {
  it('D1 ON 이면 켜진 스위치 · chevron·네비 행 없음 · 누르면 onToggleAffiliateNotice 1회', () => {
    const onToggleAffiliateNotice = jest.fn();
    renderScreen({}, { affiliateNoticeOn: true, onToggleAffiliateNotice });

    const group = groupByLabel('제휴 안내');
    const toggle = within(group).getByTestId('settings-affiliate-toggle');
    // 단언: 스위치 상태 = prop.
    expect(toggle).toBeChecked();
    expect(toggle).not.toBeDisabled();
    // 단언(부재): 네비 행이 아니다 — chevron 0개, settings-nav-affiliate-toggle 없음.
    expect(within(group).queryAllByTestId(/-chevron$/)).toHaveLength(0);
    expect(
      within(group).queryByTestId('settings-nav-affiliate-toggle')
    ).toBeNull();
    // 짝: 같은 탐지기가 다른 네비 행에선 chevron 을 센다(공짜 green 차단, 02a ★7).
    expect(
      within(groupByLabel('알림')).queryAllByTestId(/-chevron$/)
    ).toHaveLength(1);

    fireEvent.press(toggle);
    expect(onToggleAffiliateNotice).toHaveBeenCalledTimes(1);
  });

  it('D2 OFF 면 꺼진 스위치다', () => {
    renderScreen({}, { affiliateNoticeOn: false });

    expect(screen.getByTestId('settings-affiliate-toggle')).not.toBeChecked();
    expect(screen.getByTestId('settings-affiliate-toggle')).not.toBeDisabled();
  });

  it.each([
    ['null', { affiliateNoticeOn: null }],
    ['미전달', {}],
  ] as const)(
    'D3 값을 모르면(%s) 스위치가 비활성이고 눌러도 콜백이 없다',
    (_title, extra) => {
      const onToggleAffiliateNotice = jest.fn();
      renderScreen({}, { ...extra, onToggleAffiliateNotice });

      const toggle = screen.getByTestId('settings-affiliate-toggle');
      expect(toggle).toBeDisabled();
      fireEvent.press(toggle);
      expect(onToggleAffiliateNotice).not.toHaveBeenCalled();
    }
  );

  it('D4 실패 안내는 제휴 안내 그룹 안에 인라인으로 뜬다(문구 완전일치), 없으면 안 뜬다', () => {
    const { rerender } = renderScreen(
      {},
      { affiliateNoticeOn: true, affiliateNoticeError: true }
    );

    const error = within(groupByLabel('제휴 안내')).getByTestId(
      'settings-affiliate-error'
    );
    expect(
      within(error).getByText('설정을 바꾸지 못했어요. 다시 시도해 주세요.')
    ).toBeOnTheScreen();

    // 짝: 오류가 없으면 안내도 없다.
    rerender(
      <SettingsScreen
        groups={buildSettingsSections({ nickname: '여행자123', email: null })}
        deletionState="active"
        currentNickname="여행자123"
        onPressBack={noop}
        onSubmitNickname={noop}
        onPressExport={noop}
        onPressDeleteAccount={noop}
        onPressCancelDeletion={noop}
        affiliateNoticeOn
      />
    );
    expect(screen.queryByTestId('settings-affiliate-error')).toBeNull();
  });
});
