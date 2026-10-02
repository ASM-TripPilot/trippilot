import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import {
  buildSettingsSections,
  type SettingsInput,
} from '../model/settingsSections';
import { SettingsScreen } from './SettingsScreen';
import { ContrastGlyph } from './SettingsGlyphs';

/**
 * l05 설정 화면(프레젠테이션) 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `SettingsScreen{,.l05parity,.attribution}.test.tsx` 3개를 각자의 바깥 describe
 * 하나로 옮겼다. 목이 없는 순수 렌더 테스트라 머리에 걸 것이 없다 — 이름이 같고 모양이 다른 헬퍼
 * (`renderScreen` 시그니처·email 기본값)는 describe 안에 갇혀 그대로다.
 */

// TRIP-608 · TRIP-618 · TRIP-935 · TRIP-938
describe('행·그룹·다이얼로그 (옛 .test)', () => {
  /**
   * TRIP-608/618 AC-1 · AC-2 · AC-3 · AC-4 — l05 설정 화면 렌더(프레젠테이션).
   *
   * 무엇을 보장하나:
   *  - AC-1: 7그룹(TRIP-937 앱 정보 포함)이 정본 순서로 렌더되고, 헤더(`설정`·back), 계정 닉네임 요약, 상호작용 3행
   *    어포던스가 실재한다.
   *  - AC-2·AC-3(TRIP-618, 렌더): 위치정보·알림 행이 **네비 행으로 승격**된다 — 비활성 "준비 중"이
   *    아니라 활성 행(`settings-nav-*` testID)으로 그려진다.
   *  - TRIP-778 AC-4(재작성): 취향 행은 활성 네비 행, 제휴 행은 토글이다 — 화면 어디에도 "준비 중"이
   *    없다(구 "취향·제휴 준비 중 유지"는 01b 사용자 결정으로 계약이 뒤집혔다).
   *  - TRIP-1051 AC-5·AC-6: 취향은 머리글 없는 카드에 한 행이다 — 옛 7행 testID 가 없고, 그룹 안에 '여행 취향'
   *    글자는 행 라벨 하나뿐이다(아래 describe).
   *
   * ★ 왜 렌더를 보나(02a ★1): `renderRow`는 `switch(row.key)`로만 분기하고 `row.ready`를 안 읽는다.
   *   그래서 심판은 `ready` 플래그(그건 settingsSections.test.ts 몫)가 아니라 **네비 행이 실제로
   *   그려졌는지**를 물어야 한다 — ready:true 만 바꾸고 스위치 케이스를 빠뜨리면 여전히 '준비 중'인데
   *   데이터 가드는 green(조용한 불일치)이다. press→router.push 는 SettingsPage.nav.test.tsx 몫.
   *
   * 3동작 뼈대: 준비=실 buildSettingsSections VM 주입 → 실행=render → 단언=보이는 것/비활성.
   *
   * ⚠️ 딤 전면 커버·삭제 다이얼로그 실제 열림/닫힘은 이 화면에서 안 잰다 — 리포 Modal 선례 0 +
   * 바텀시트 딤과 동형으로 jest 사각(repo-traps). 2단 게이트는 SettingsPage 통합 테스트가
   * mutate 시퀀스로 잠근다.
   *
   * (개념) 매처 — 문자열 인자는 **완전일치**(`getByText('설정')` 는 노드 텍스트가 정확히 '설정'),
   *  정규식 인자는 **부분포함**(`getByText(/준비 중/)`). node_modules 실측(02a §5-A).
   */

  const noop = () => {};

  function renderScreen(
    overrides: Partial<React.ComponentProps<typeof SettingsScreen>> = {}
  ) {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: 'a@b.com',
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
        {...overrides}
      />
    );
  }

  /**
   * 정본 순서(Figma 라이브). AC-1 이 순서까지 잠근다.
   * TRIP-937: 앱 정보(약관 3행)를 위험 영역 앞에 더했다(01 Q7 — Figma 에 없는 그룹, 드리프트 기록).
   */
  const GROUP_LABELS = [
    '계정',
    null, // TRIP-1051 — 여행 취향 그룹은 머리글이 없다(행 testID 로 확인)
    '위치정보',
    '알림',
    '제휴 안내',
    '앱 정보',
    '위험 영역',
  ];

  /** TRIP-937 AC-3 — 앱 정보 그룹의 약관 행(termsType · 문서 제목, Figma c06 문구). */
  const TERMS_ROWS = [
    ['TERMS_OF_SERVICE', '서비스 이용약관'],
    ['PRIVACY_POLICY', '개인정보 처리방침'],
    ['LOCATION_TERMS', '위치정보 이용약관'],
  ] as const;

  describe('TRIP-608/618 · SettingsScreen (AC-1 · AC-2 · AC-3 · AC-4)', () => {
    it('AC-1: 7그룹(TRIP-937 앱 정보 포함)이 정본 순서로 렌더되고 헤더가 뜬다', () => {
      renderScreen();

      // 단언: 그룹이 정확히 7개.
      const groups = screen.getAllByTestId('settings-group');
      expect(groups).toHaveLength(7);

      // 단언(순서까지): i번째 그룹 안에 i번째 라벨이 완전일치로 있다. 머리글 없는 칸(null)은 그 자리에
      // 취향 행이 있는지로 순서를 확인한다.
      GROUP_LABELS.forEach((label, i) => {
        if (label === null) {
          expect(
            within(groups[i]).getByTestId('settings-nav-preferences')
          ).toBeOnTheScreen();
        } else {
          expect(within(groups[i]).getByText(label)).toBeOnTheScreen();
        }
      });

      // 단언: 헤더 제목(완전일치)과 back chevron.
      expect(screen.getByText('설정')).toBeOnTheScreen();
      expect(screen.getByTestId('settings-back')).toBeOnTheScreen();
    });

    it('AC-1: 계정 닉네임 행이 요약(닉네임)을 보이고, 인터랙티브 3행 어포던스가 실재한다', () => {
      renderScreen();

      // 단언(완전일치 leaf): 요약값이 닉네임이다.
      expect(screen.getByText('여행자123')).toBeOnTheScreen();

      // 단언: 닉네임 편집·내보내기·계정 삭제 진입 어포던스가 있다.
      expect(screen.getByTestId('settings-nickname-edit')).toBeOnTheScreen();
      expect(screen.getByTestId('settings-export-row')).toBeOnTheScreen();
      expect(screen.getByTestId('settings-delete-account')).toBeOnTheScreen();
    });

    it('TRIP-778 AC-4 · TRIP-1051(재작성): 취향 한 행은 활성 네비 행, 제휴 행은 토글 — "준비 중"이 화면에 없다', () => {
      renderScreen();

      const groups = screen.getAllByTestId('settings-group');
      const byLabel = (label: string) =>
        groups.find((g) => within(g).queryByText(label) !== null)!;

      // 단언: 두 번째 그룹(머리글 없는 취향 카드) 안에 취향 행이 네비 행으로 그려지고 활성이다.
      // 모델만 바꾸고 renderRow 에 case 를 안 더하면 PreparingRow 로 떨어져 여기서 red(02a ★15).
      // 그룹을 라벨로 찾지 않는다 — 머리글이 없으므로 '여행 취향'은 행 라벨에만 걸린다(TRIP-1051 02a ★1).
      const preferences = groups[1];
      expect(
        within(preferences).getByTestId('settings-nav-preferences')
      ).not.toBeDisabled();
      // 단언: 준비중 행(PreparingRow 의 공통 testID)이 취향 그룹에 없다.
      expect(within(preferences).queryAllByTestId('settings-row')).toHaveLength(
        0
      );

      // 단언: 제휴 안내 그룹은 토글 행이다(스위치 역할).
      const affiliate = byLabel('제휴 안내');
      expect(
        within(affiliate).getByTestId('settings-affiliate-toggle')
      ).toBeOnTheScreen();

      // 단언(부분포함): 화면 전체 어디에도 "준비 중"이 없다.
      expect(screen.queryAllByText(/준비 중/)).toHaveLength(0);

      // 대조 짝: 상호작용 행(계정 삭제)은 여전히 활성 — 화면이 통째로 빈 것이 아니다.
      expect(screen.getByTestId('settings-delete-account')).not.toBeDisabled();
    });

    it('AC-2·AC-3(렌더): 위치정보·알림은 네비 행으로 승격 — 활성 + "준비 중" 아님', () => {
      renderScreen();

      const groups = screen.getAllByTestId('settings-group');
      const byLabel = (label: string) =>
        groups.find((g) => within(g).queryByText(label) !== null)!;

      // ★ 심판(02a ★1): switch(key)가 두 행을 네비 행으로 그려야만 이 testID 가 뜬다.
      //   settingsSections 의 ready:true 만 바꾸고 스위치 케이스를 빠뜨리면 여전히 'settings-row'
      //   준비중이라 아래 getByTestId 가 못 찾아 red — "가드는 green인데 준비중"을 렌더 층에서 잡는다.
      const location = byLabel('위치정보');
      const locationRow = within(location).getByTestId(
        'settings-nav-location-consent'
      );
      expect(locationRow).not.toBeDisabled();
      // 네비 행은 준비 중이 아니다(승격되면 '준비 중' 표기가 사라진다).
      expect(within(location).queryByText(/준비 중/)).toBeNull();

      const notif = byLabel('알림');
      const notifRow = within(notif).getByTestId('settings-nav-notifications');
      expect(notifRow).not.toBeDisabled();
      expect(within(notif).queryByText(/준비 중/)).toBeNull();
    });

    it('TRIP-937 AC-3(렌더): 앱 정보 그룹의 약관 3행이 활성 네비 행으로 그려진다 — 준비 중 아님', () => {
      // 준비·실행: 실 뷰모델 그대로 렌더.
      renderScreen();

      const groups = screen.getAllByTestId('settings-group');
      const appInfo = groups.find(
        (g) => within(g).queryByText('앱 정보') !== null
      );
      // 긍정 앵커: 앱 정보 그룹이 실재한다(없으면 아래 행 단언이 공허하다).
      expect(appInfo).toBeDefined();

      for (const [termsType, label] of TERMS_ROWS) {
        // 단언: switch(key)가 약관 행을 네비 행으로 그려야만 이 testID 가 뜬다(02a ★1 선례 —
        //   ready:true 만 두고 렌더 분기를 빠뜨리면 PreparingRow 'settings-row' 로 떨어져 red).
        const row = within(appInfo!).getByTestId(
          `settings-nav-terms-${termsType}`
        );
        expect(row).not.toBeDisabled();
        // 단언(완전일치): 행 안의 라벨이 문서 제목이다(심사자가 찾는 이름 '개인정보 처리방침').
        expect(within(row).getByText(label)).toBeOnTheScreen();
      }
      // 단언(부분포함): 약관 행은 준비 중이 아니다.
      expect(within(appInfo!).queryByText(/준비 중/)).toBeNull();
    });
  });

  /**
   * TRIP-1051 AC-5 · AC-6 — 여행 취향은 머리글 없는 카드에 한 행(결정 (a)).
   *
   * ★ 우연 통과 차단(02a ★1): 옛 "그룹 안에 '여행 취향'이 있다"는 머리글을 지워도 행 라벨에 걸려 green 이었다.
   *   그래서 ① 그룹 안 '여행 취향'이 **정확히 1개** ② 그 1개가 행 안 ③ 그룹 안 모든 글자(host Text)가 행 안
   *   — 세 겹으로 본다. ③은 "머리글 자리에 빈 Text 를 남긴 것"(카드가 아래로 밀린다)까지 잡는다.
   * ★ 부재 단언은 칩이 실제로 뜰 입력(예산 미설정)으로, 새 행이 있다는 앵커를 먼저 본다(02a ★2·★3).
   *
   * (개념) host Text — 화면에 실제로 그려지는 글자 노드. `node.type === 'Text'`(문자열)로 고른다.
   * (개념) 조상 판정 — 노드에서 `.parent` 를 따라 올라가다 행을 만나면 그 행 안이다.
   */

  /** 예산만 미설정 — 옛 구현이면 `settings-chip-budget` 이 실제로 뜨는 입력(02a ★3). */
  const PREFERENCES_BUDGET_UNSET = {
    styles: { value: ['휴양', '자연'], isNeutralDefault: false },
    companion: {
      companionTypes: ['친구'],
      petFlag: false,
      isNeutralDefault: false,
    },
    activities: { value: ['맛집투어', '전시'], isNeutralDefault: false },
    transportModes: { value: ['대중교통'], isNeutralDefault: false },
    foodTastes: { value: ['일식'], isNeutralDefault: false },
    pace: { value: '느긋하게', isNeutralDefault: false },
  };

  const OLD_PREFERENCE_ROW_KEYS = [
    'style',
    'budget',
    'companions',
    'activities',
    'transport',
    'food',
    'pace',
  ];

  function renderWithPreferences() {
    return renderScreen({
      groups: buildSettingsSections({
        nickname: '여행자123',
        email: 'a@b.com',
        preferences: PREFERENCES_BUDGET_UNSET,
      }),
    });
  }

  function isInside(node: ReactTestInstance, ancestor: ReactTestInstance) {
    let current: ReactTestInstance | null = node;
    while (current !== null) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }

  describe('TRIP-1051 · 여행 취향 한 행 (AC-5 · AC-6)', () => {
    it('S1 AC-5: 옛 7행(settings-nav-style 등)·그 chevron·칩이 화면에 없다', () => {
      renderWithPreferences();

      // 긍정 앵커: 새 한 행은 있다(화면이 통째로 비어서 통과하는 것을 막는다).
      expect(screen.getByTestId('settings-nav-preferences')).toBeOnTheScreen();

      for (const key of OLD_PREFERENCE_ROW_KEYS) {
        expect(screen.queryByTestId(`settings-nav-${key}`)).toBeNull();
        expect(screen.queryByTestId(`settings-nav-${key}-chevron`)).toBeNull();
        expect(screen.queryByTestId(`settings-chip-${key}`)).toBeNull();
      }
    });

    it('S2 AC-6: 두 번째 그룹 안 "여행 취향"은 정확히 1개이고 행 안에 있다 — 그룹의 모든 글자가 행 안이다(머리글 없음)', () => {
      renderWithPreferences();

      const group = screen.getAllByTestId('settings-group')[1];
      const row = within(group).getByTestId('settings-nav-preferences');

      // ① 정확히 1개(머리글이 살아나면 2개 → red).
      expect(within(group).getAllByText('여행 취향')).toHaveLength(1);
      // ② 그 1개는 행 라벨이다.
      expect(within(row).getByText('여행 취향')).toBeOnTheScreen();
      // ③ 그룹 안 글자 노드가 전부 행 안이다 — 빈 머리글 Text 도 여기서 걸린다.
      const texts = group.findAll((node) => String(node.type) === 'Text');
      expect(texts.length).toBeGreaterThan(0); // 앵커: 탐지기가 빈손이 아니다
      // 실패 시 읽기 쉽게 글자(children)만 뽑아 비교한다 — 빈 Text 면 [null] 같은 값이 남아 red.
      expect(
        texts.filter((t) => !isInside(t, row)).map((t) => t.props.children)
      ).toEqual([]);
    });
  });

  /**
   * TRIP-938 — 로그아웃 행과 확인 다이얼로그(표면). 서버 호출·토큰 삭제·이동은 페이지 몫이라
   * `SettingsPage.logout.integration.test.tsx` 가 잠근다. 여기선 "누르면 무엇이 열리고, 어느 버튼에서
   * 콜백이 몇 번 나가나"만 본다.
   *
   * ★ 행은 계정 그룹 **안에서** 찾는다(02a ★8): 다이얼로그가 열리면 '로그아웃' 글자가 행과 버튼 두 곳에
   *   생긴다. 완전일치 `getByText('로그아웃')` 을 화면 전체에 쓰면 두 개가 걸려 throw 한다.
   * ★ 모르는 key 는 조용히 '준비 중' 행이 된다(02a ★9): 모델에 logout 을 넣고 renderRow 분기를
   *   빠뜨려도 크래시가 없다. S1 이 testID·활성·'준비 중' 부재를 함께 요구해 잡는다.
   * ⚠️ 딤이 화면을 실제로 덮는지·중앙 정렬은 jest 사각(6-b) — testID 트리와 콜백 횟수까지만 본다.
   */
  describe('TRIP-938 · 로그아웃 행·확인 다이얼로그 (AC-6 · AC-3 · AC-1)', () => {
    /** 계정 그룹 노드 — 행이 다른 그룹에 들어가면 여기서 못 찾는다. */
    const accountGroup = () =>
      screen
        .getAllByTestId('settings-group')
        .find((g) => within(g).queryByText('계정') !== null)!;

    it('S1 계정 그룹 안에 [로그아웃] 행이 활성으로 있고 "준비 중"이 아니다', () => {
      // 준비·실행
      renderScreen({ onPressLogout: jest.fn() });

      // 단언: 계정 그룹 안에서 행을 찾는다(다른 그룹이면 throw → red).
      const row = within(accountGroup()).getByTestId('settings-row-logout');
      expect(row).not.toBeDisabled();
      // 단언(완전일치): 행 라벨.
      expect(within(row).getByText('로그아웃')).toBeOnTheScreen();
      // 단언(부분포함): 계정 그룹에 '준비 중' 표기가 없다(02a ★9).
      expect(within(accountGroup()).queryByText(/준비 중/)).toBeNull();
    });

    it('S2 행을 누르면 확인 다이얼로그가 열린다 — 제목·[취소]·[로그아웃], 아직 콜백 0번', () => {
      const onPressLogout = jest.fn();
      renderScreen({ onPressLogout });

      // 단언(부재 · 열기 전): 다이얼로그는 처음엔 없다.
      expect(screen.queryByTestId('logout-confirm')).toBeNull();

      // 실행
      fireEvent.press(screen.getByTestId('settings-row-logout'));

      // 단언: 다이얼로그 컨테이너 안에 제목과 두 버튼이 있다.
      const dialog = screen.getByTestId('logout-confirm');
      expect(within(dialog).getByText('로그아웃할까요?')).toBeOnTheScreen();
      expect(
        within(within(dialog).getByTestId('logout-cancel')).getByText('취소')
      ).toBeOnTheScreen();
      expect(
        within(within(dialog).getByTestId('logout-confirm-button')).getByText(
          '로그아웃'
        )
      ).toBeOnTheScreen();
      // 단언(급소): 연 것만으로는 로그아웃하지 않는다.
      expect(onPressLogout).not.toHaveBeenCalled();
    });

    it('S3 [취소] 를 누르면 다이얼로그가 닫히고 콜백은 0번이다', () => {
      const onPressLogout = jest.fn();
      renderScreen({ onPressLogout });

      // 실행: 열기 → 취소.
      fireEvent.press(screen.getByTestId('settings-row-logout'));
      fireEvent.press(screen.getByTestId('logout-cancel'));

      // 단언
      expect(screen.queryByTestId('logout-confirm')).toBeNull();
      expect(onPressLogout).not.toHaveBeenCalled();
    });

    it('S4 [로그아웃] 을 누르면 콜백이 정확히 1번 나가고 다이얼로그가 닫힌다(두 번 누를 자리 없음)', () => {
      const onPressLogout = jest.fn();
      renderScreen({ onPressLogout });

      // 실행: 열기 → 확인.
      fireEvent.press(screen.getByTestId('settings-row-logout'));
      fireEvent.press(screen.getByTestId('logout-confirm-button'));

      // 단언
      expect(onPressLogout).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('logout-confirm')).toBeNull();
    });

    it('S5 계정 삭제 유예 중에도 [로그아웃] 행이 활성으로 있다(01 Q10)', () => {
      // 준비: 삭제 유예 상태.
      renderScreen({ deletionState: 'pending', onPressLogout: jest.fn() });

      // 단언(앵커): 유예 배너가 실제로 그려진 상태다.
      expect(screen.getByTestId('settings-deletion-pending')).toBeOnTheScreen();
      // 단언: 그래도 다른 계정으로 바꿀 수단(로그아웃)은 있다.
      expect(screen.getByTestId('settings-row-logout')).not.toBeDisabled();
    });
  });

  /**
   * TRIP-935 AC-3(R4) — 하단 버전 줄은 받은 `appVersion` 으로만 그린다. 값이 없으면 줄 자체를
   * 그리지 않는다(가짜 버전보다 무표기, INV-4). 값의 출처(빌드 설정)는 페이지 몫 —
   * `SettingsPage.version.test.tsx`.
   */
  describe('🔴 TRIP-935 AC-3 · 버전 줄은 appVersion 으로만 그린다', () => {
    it('appVersion="0.1.0" 이면 "TripPilot v0.1.0" 한 줄을 그린다', () => {
      renderScreen({ appVersion: '0.1.0' });

      expect(screen.getByText('TripPilot v0.1.0')).toBeOnTheScreen();
    });

    it.each([
      ['미전달', {}],
      ['null', { appVersion: null }],
    ] as const)('appVersion %s 이면 버전 줄이 없다', (_label, overrides) => {
      renderScreen(overrides);

      // 앵커 — 화면 하단(출처 블록)은 그려졌다.
      expect(screen.getByTestId('settings-data-attribution')).toBeOnTheScreen();
      expect(screen.queryAllByText(/TripPilot v/)).toHaveLength(0);
    });
  });

  describe('🔴 TRIP-991 · 제휴 안내 스위치 이름 (AC-3)', () => {
    it('제휴 토글은 행 제목 "외부 이동 시 제휴 안내 다시 보기" 스위치로 읽힌다', () => {
      renderScreen();

      expect(
        screen.getByRole('switch', { name: '외부 이동 시 제휴 안내 다시 보기' })
      ).toHaveProp('testID', 'settings-affiliate-toggle');
    });
  });

  /**
   * TRIP-990 · S3 구조 (#027 · D23) — 닉네임 행을 품은 스크롤 영역이 `keyboardShouldPersistTaps="handled"` 다.
   *
   * *(개념)* 키보드가 떠 있을 때 버튼을 탭하면, 그 탭을 "키보드 닫기"에만 쓰지 말고 버튼에도 전달하라는
   * 설정. RN 기본값은 `never` 라서 입력 중 "저장"을 처음 누르면 키보드만 닫히고 저장은 안 된다.
   *
   * 화면 안 다른 스크롤에 붙여도 통과하지 않게, 닉네임 행에서 위로 올라가 **처음 만나는 ScrollView** 의
   * 값을 읽는다. 실제로 첫 탭이 버튼에 닿는지(원인 가설이 맞는지)는 jest 사각 — 6-b 실기.
   *
   * 3동작 뼈대: 준비=설정 화면 렌더 → 실행=닉네임 행의 조상 ScrollView 찾기 → 단언=그 prop 값.
   */
  describe('🔴 S3 · 닉네임 행 스크롤이 키보드 위 첫 탭을 버튼에 넘긴다 (D23)', () => {
    function nearestScrollView(
      node: ReactTestInstance
    ): ReactTestInstance | null {
      let current: ReactTestInstance | null = node.parent;
      while (current !== null && current.type !== ScrollView) {
        current = current.parent;
      }
      return current;
    }

    it('닉네임 행의 조상 ScrollView 가 keyboardShouldPersistTaps="handled" 다', () => {
      renderScreen();

      const scroll = nearestScrollView(
        screen.getByTestId('settings-nickname-edit')
      );

      // 짝 — 조상 스크롤이 실제로 있다(없으면 아래 단언이 무엇을 재는지 모호해진다).
      expect(scroll).not.toBeNull();
      expect(scroll?.props.keyboardShouldPersistTaps).toBe('handled');
    });
  });
});

// TRIP-778 · TRIP-1051
describe('Figma 행 표면 (옛 .l05parity)', () => {
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
    return String(screen.getByTestId(testID).props.className ?? '').split(
      /\s+/
    );
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
      expect(
        screen.getByTestId('settings-affiliate-toggle')
      ).not.toBeDisabled();
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
});

// TRIP-886
describe('데이터 출처 고지 (옛 .attribution)', () => {
  /**
   * TRIP-886 AC-1 · AC-2 · AC-4 · AC-5 — 설정 하단 데이터 출처 고지 블록(프레젠테이션).
   *
   * 무엇을 보장하나:
   *  - AC-1: 버전 문구 바로 다음에 출처 세 줄이 글자 그대로 보인다 — 링크 콜백이 없어도(고지는 의무).
   *  - AC-2: OSM 줄을 누르면 주입된 콜백이 정확히 1회 나가고, 나머지 두 줄은 링크가 아니다.
   *  - AC-4: 계정 삭제 유예(pending) 상태에서도 블록이 남는다.
   *  - AC-5: 블록은 그룹이 아니다 — 그룹 수는 buildSettingsSections 그대로, 어느 그룹 안에도 없다.
   * URL 과 Linking.openURL 배선은 페이지 몫이라 SettingsPage.attribution.test.tsx 가 잠근다.
   *
   * ⚠️ 문구의 `·`(U+00B7)·`©`(U+00A9)는 글자 그대로 적었다 — 문자열 매처는 완전일치라 ASCII `.`·`(c)`
   *  로 바뀌면 red 다(02a ★1).
   *
   * (개념) `fireEvent.press` 는 누른 요소에서 위로 올라가며 가장 가까운 onPress 를 부른다 — 블록 전체를
   *  Pressable 로 감싸면 TourAPI 줄을 눌러도 콜백이 나가므로, "이 줄만 링크"를 그 성질로 잰다(02a ★3).
   */

  const noop = () => {};

  const SOURCE_TITLE = '데이터 출처';
  const SOURCE_DATASETS = '한국관광공사 TourAPI · Overture Maps Foundation';
  const SOURCE_OSM = '© OpenStreetMap contributors';

  function sections() {
    return buildSettingsSections({ nickname: '여행자123', email: 'a@b.com' });
  }

  function renderScreen(
    overrides: Partial<React.ComponentProps<typeof SettingsScreen>> = {}
  ) {
    return render(
      <SettingsScreen
        groups={sections()}
        deletionState="active"
        currentNickname="여행자123"
        onPressBack={noop}
        onSubmitNickname={noop}
        onPressExport={noop}
        onPressDeleteAccount={noop}
        onPressCancelDeletion={noop}
        {...overrides}
      />
    );
  }

  /**
   * 렌더 트리의 글자를 읽는 순서대로 모아 하나로 잇는다. 중첩 Text(`© <Text>…</Text>`)는 조각으로
   * 쪼개져 나오므로 구분자 없이 이어야 원문이 된다(02a ★2).
   */
  function readingText(node: unknown): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(readingText).join('');
    const children = (node as { children?: unknown[] | null }).children;
    return children ? children.map(readingText).join('') : '';
  }

  describe('TRIP-886 · 설정 데이터 출처 고지 (AC-1 · AC-2 · AC-4 · AC-5)', () => {
    it('AC-1: 링크 콜백이 없어도 출처 블록에 세 줄이 글자 그대로 보인다', () => {
      // 준비·실행: 링크 콜백 없이 그린다(프리뷰와 같은 조건).
      renderScreen();

      // 단언: 블록 안에 세 줄이 완전일치로 있다.
      const block = within(screen.getByTestId('settings-data-attribution'));
      expect(block.getByText(SOURCE_TITLE)).toBeTruthy();
      expect(block.getByText(SOURCE_DATASETS)).toBeTruthy();
      expect(block.getByText(SOURCE_OSM)).toBeTruthy();
    });

    it('AC-1(위치): 출처 블록은 버전 문구 바로 다음에 온다 — 사이에 다른 문구가 끼지 않는다', () => {
      // 준비: 링크 콜백 없이, 버전을 주고 그린다(TRIP-935 — 버전이 없으면 버전 줄 자체가 없다).
      renderScreen({ appVersion: '0.1.0' });

      // 실행: 화면 글자를 읽는 순서대로 잇는다.
      const text = readingText(screen.toJSON());
      const versionAt = text.indexOf('TripPilot v');
      const blockAt = text.indexOf(SOURCE_TITLE + SOURCE_DATASETS + SOURCE_OSM);

      // 단언: 버전이 있고, 블록이 그 뒤에 있으며, 둘 사이에 한글(그룹 이름·행 문구)이 없다.
      expect(versionAt).toBeGreaterThanOrEqual(0);
      expect(blockAt).toBeGreaterThan(versionAt);
      expect(text.slice(versionAt, blockAt)).not.toMatch(/[가-힣]/);
    });

    it('AC-2: OSM 줄을 누르면 주입된 링크 콜백이 정확히 1회 나간다', () => {
      // 준비: 링크 콜백을 가짜로 주입한다.
      const onPressOsmCopyright = jest.fn();
      renderScreen({ onPressOsmCopyright });

      // 실행: OSM 줄을 누른다.
      fireEvent.press(screen.getByTestId('settings-osm-copyright'));

      // 단언: 정확히 한 번.
      expect(onPressOsmCopyright).toHaveBeenCalledTimes(1);
    });

    it('AC-2(이 줄만 링크): 제목·TourAPI 줄을 눌러도 콜백은 나가지 않는다 — OSM 줄만 링크다', () => {
      // 준비: 링크 콜백을 가짜로 주입한다.
      const onPressOsmCopyright = jest.fn();
      renderScreen({ onPressOsmCopyright });
      const block = within(screen.getByTestId('settings-data-attribution'));

      // 실행: 링크가 아닌 두 줄을 누른다.
      fireEvent.press(block.getByText(SOURCE_TITLE));
      fireEvent.press(block.getByText(SOURCE_DATASETS));

      // 단언: 콜백 0회.
      expect(onPressOsmCopyright).not.toHaveBeenCalled();

      // 짝 앵커: OSM 줄은 여전히 눌리고 1회 나간다(콜백이 아예 끊긴 구현의 공허 통과 차단).
      fireEvent.press(block.getByText(SOURCE_OSM));
      expect(onPressOsmCopyright).toHaveBeenCalledTimes(1);
    });

    it('AC-4: 계정 삭제 유예(pending) 상태에서도 출처 블록 세 줄이 보인다', () => {
      // 준비·실행: 유예 상태로 그린다.
      renderScreen({
        deletionState: 'pending',
        purgeAt: '2026-10-23T00:00:00Z',
      });

      // 앵커: 화면이 실제로 유예 상태로 그려졌다.
      expect(screen.getByTestId('settings-deletion-pending')).toBeTruthy();

      // 단언: 출처 블록은 상태와 무관하게 남는다.
      const block = within(screen.getByTestId('settings-data-attribution'));
      expect(block.getByText(SOURCE_TITLE)).toBeTruthy();
      expect(block.getByText(SOURCE_DATASETS)).toBeTruthy();
      expect(block.getByText(SOURCE_OSM)).toBeTruthy();
    });

    it('AC-5: 출처 블록은 그룹이 아니다 — 그룹 수는 그대로이고 어느 그룹 안에도 없다', () => {
      // 준비·실행: 링크 콜백 없이 그린다.
      renderScreen();

      // 단언 1: 그룹 수는 입력 VM 그대로(블록이 그룹 하나를 더 만들지 않는다, 02a ★10).
      const groups = screen.getAllByTestId('settings-group');
      expect(groups).toHaveLength(sections().length);

      // 단언 2: 어느 그룹 안에도 블록이 없다.
      for (const group of groups) {
        expect(
          within(group).queryByTestId('settings-data-attribution')
        ).toBeNull();
      }

      // 짝 앵커: 블록 자체는 화면에 있다(블록이 아예 없어 공허 통과하는 것 차단).
      expect(screen.getByTestId('settings-data-attribution')).toBeTruthy();
    });
  });
});
