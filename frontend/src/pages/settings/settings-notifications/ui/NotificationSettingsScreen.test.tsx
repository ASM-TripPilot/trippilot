import { fireEvent, render, screen } from '@testing-library/react-native';
import type { NotificationToggleKind } from '@/shared/api/index.schemas';
import {
  NotificationSettingsScreen,
  type NotificationSettingsScreenProps,
  type ToggleValueMap,
} from './NotificationSettingsScreen';

/**
 * l02 알림 설정 화면 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `NotificationSettingsScreen{,.parity}.test.tsx` 와 `src/__tests__/notificationKindGuard
 * .test.tsx`(이 화면만 그리는 렌더 가드)를 각자의 바깥 describe 로 옮겼다. 목이 없어 머리에 걸 것이 없다.
 */

// TRIP-607 · TRIP-939 · TRIP-1442
describe('행·토글 (옛 .test)', () => {
  /**
   * TRIP-607 · l02 알림 설정 화면(순수 프레젠테이션). TRIP-1442 가 TRIP-939 의 "푸시 부재" 단언을 Figma l02 두 상태
   * (default 1600:2388 · permission-denied 1601:2388) 기준으로 다시 뒤집었다 — 푸시 수신 배선(TRIP-835)이 끝났다.
   *
   * 무엇을 보장하나:
   *  - 6종(STAY·TRIP_PRE·TRIP_DAY·SLOT_PRE·PLAN_B·REFLECTION) 행마다 푸시·인앱 스위치가 하나씩 있다.
   *  - 권한 있음: 푸시·인앱 checked 가 주입 값 그대로, 상단 반영 안내·머리 "푸시"·"인앱"·하단 SYSTEM 문구.
   *  - 권한 거부: 서버 값이 켜짐이어도 푸시는 꺼짐·잠김(화면 읽기 값 기준 — 색은 disabled 가 이겨 구분 못 함),
   *    권한 배너·"권한 필요" 칩·푸시-누적 문구, 배너 press → onOpenSettings. 인앱은 그대로 조작 가능(BR-U6-16).
   *
   * (개념) 매처 — `toBeChecked()` 는 role="switch" 요소의 accessibilityState.checked 를 읽고,
   *  `toBeDisabled()` 는 accessibilityState.disabled 를 본다. press 차단(real `disabled`)은 press 단언으로 따로 잰다.
   */

  /** 실물 l02 기본값(BR-U6-18): SLOT_PRE·PLAN_B 는 푸시 OFF·인앱 ON, 나머지 5종은 둘 다 ON. */
  const DEFAULT_VALUES: ToggleValueMap = {
    STAY: { pushEnabled: true, inAppEnabled: true },
    TRIP_PRE: { pushEnabled: true, inAppEnabled: true },
    TRIP_DAY: { pushEnabled: true, inAppEnabled: true },
    SLOT_PRE: { pushEnabled: false, inAppEnabled: true },
    PLAN_B: { pushEnabled: false, inAppEnabled: true },
    REFLECTION: { pushEnabled: true, inAppEnabled: true },
  };

  /** 화면이 그려야 하는 6종(순서 무관 — 존재만 본다). */
  const VISIBLE_KINDS: NotificationToggleKind[] = [
    'STAY',
    'TRIP_PRE',
    'TRIP_DAY',
    'SLOT_PRE',
    'PLAN_B',
    'REFLECTION',
  ];

  const pushId = (kind: string) => `notification-settings-toggle-push-${kind}`;
  const inAppId = (kind: string) =>
    `notification-settings-toggle-inapp-${kind}`;
  const BANNER_ID = 'notification-settings-permission-banner';

  function renderScreen(
    overrides: Partial<NotificationSettingsScreenProps> = {}
  ): NotificationSettingsScreenProps {
    const props: NotificationSettingsScreenProps = {
      values: DEFAULT_VALUES,
      pushColumnAvailable: true,
      onToggle: jest.fn(),
      onOpenSettings: jest.fn(),
      ...overrides,
    };
    render(<NotificationSettingsScreen {...props} />);
    return props;
  }

  const TOP_COPY = '변경한 알림 설정은 다음 알림부터 바로 반영돼요';
  const BOTTOM_COPY = '모든 알림을 꺼도 보안·계정 관련 알림은 알림함에 보여요';
  const DENIED_TOP_COPY = '기기 설정에서 알림 권한을 허용하세요';
  const DENIED_BOTTOM_COPY = '푸시를 꺼도 인앱 알림은 알림함에 계속 쌓여요';

  describe('6종 행마다 푸시·인앱 두 스위치 (US-NOTIF-05)', () => {
    it.each([true, false])(
      '권한 %s 여도 6종 행마다 푸시·인앱 스위치가 하나씩 있다',
      (pushColumnAvailable) => {
        renderScreen({ pushColumnAvailable });

        VISIBLE_KINDS.forEach((kind) => {
          expect(screen.getByTestId(pushId(kind))).toBeOnTheScreen();
          expect(screen.getByTestId(inAppId(kind))).toBeOnTheScreen();
        });
      }
    );

    it('권한이 있으면 푸시 스위치 checked 가 주입 값 그대로고 잠기지 않는다', () => {
      renderScreen({ pushColumnAvailable: true });

      // DEFAULT_VALUES: SLOT_PRE·PLAN_B 만 푸시 OFF.
      expect(screen.getByTestId(pushId('STAY'))).toBeChecked();
      expect(screen.getByTestId(pushId('TRIP_PRE'))).toBeChecked();
      expect(screen.getByTestId(pushId('TRIP_DAY'))).toBeChecked();
      expect(screen.getByTestId(pushId('REFLECTION'))).toBeChecked();
      expect(screen.getByTestId(pushId('SLOT_PRE'))).not.toBeChecked();
      expect(screen.getByTestId(pushId('PLAN_B'))).not.toBeChecked();
      VISIBLE_KINDS.forEach((kind) => {
        expect(screen.getByTestId(pushId(kind))).not.toBeDisabled();
      });
    });

    it('각 인앱 스위치 checked 가 주입 값 그대로다', () => {
      // 준비: STAY 인앱 ON, SLOT_PRE 인앱 OFF 로 덮는다.
      renderScreen({
        values: {
          ...DEFAULT_VALUES,
          SLOT_PRE: { pushEnabled: false, inAppEnabled: false },
        },
      });

      // 단언
      expect(screen.getByTestId(inAppId('STAY'))).toBeChecked();
      expect(screen.getByTestId(inAppId('SLOT_PRE'))).not.toBeChecked();
      expect(screen.getByTestId(inAppId('PLAN_B'))).toBeChecked();
    });

    it('권한 있으면 권한 배너가 없고 인앱 토글이 비활성이 아니다 (짝)', () => {
      renderScreen({ pushColumnAvailable: true });

      expect(screen.queryByTestId(BANNER_ID)).toBeNull();
      VISIBLE_KINDS.forEach((kind) => {
        expect(screen.getByTestId(inAppId(kind))).not.toBeDisabled();
      });
    });
  });

  describe('문구 — 권한 상태별 얼굴 (Figma l02 두 상태)', () => {
    it('권한이 있으면 상단 반영 안내 · 머리 "푸시"·"인앱" · 하단 SYSTEM 문구가 보이고 권한 표면은 없다', () => {
      renderScreen({ pushColumnAvailable: true });

      // 문자열 쿼리는 글자 전체가 같아야 맞는다 — "푸시" 는 머리 이름표 하나만 고른다.
      expect(screen.getByText(TOP_COPY)).toBeOnTheScreen();
      expect(screen.getByText('푸시')).toBeOnTheScreen();
      expect(screen.getByText('인앱')).toBeOnTheScreen();
      expect(screen.getByText(BOTTOM_COPY)).toBeOnTheScreen();

      expect(screen.queryByTestId(BANNER_ID)).toBeNull();
      expect(screen.queryByText('권한 필요')).toBeNull();
      expect(screen.queryByText(DENIED_BOTTOM_COPY)).toBeNull();
    });

    it('권한 거부면 권한 배너 · "권한 필요" 칩 · 하단 푸시-누적 문구가 보이고 반영 안내·"푸시" 머리는 없다', () => {
      renderScreen({ pushColumnAvailable: false });

      expect(screen.getByTestId(BANNER_ID)).toBeOnTheScreen();
      expect(screen.getByText(DENIED_TOP_COPY)).toBeOnTheScreen();
      expect(screen.getByText('설정 이동')).toBeOnTheScreen();
      expect(screen.getByText('권한 필요')).toBeOnTheScreen();
      expect(screen.getByText('인앱')).toBeOnTheScreen();
      expect(screen.getByText(DENIED_BOTTOM_COPY)).toBeOnTheScreen();

      expect(screen.queryByText(TOP_COPY)).toBeNull();
      expect(screen.queryByText('푸시')).toBeNull();
      expect(screen.queryByText(BOTTOM_COPY)).toBeNull();
    });
  });

  describe('TRIP-607 · NotificationSettingsScreen — 콜백 배선', () => {
    it('켜진 인앱 토글을 press 하면 onToggle(kind, "inapp", false) 가 1회 나간다', () => {
      const props = renderScreen();

      fireEvent.press(screen.getByTestId(inAppId('STAY'))); // 현재 true → 끄기

      expect(props.onToggle).toHaveBeenCalledTimes(1);
      expect(props.onToggle).toHaveBeenCalledWith('STAY', 'inapp', false);
    });

    it('꺼진 인앱 토글을 press 하면 onToggle(kind, "inapp", true) 가 나간다', () => {
      const props = renderScreen({
        values: {
          ...DEFAULT_VALUES,
          SLOT_PRE: { pushEnabled: false, inAppEnabled: false },
        },
      });

      fireEvent.press(screen.getByTestId(inAppId('SLOT_PRE'))); // 현재 false → 켜기

      expect(props.onToggle).toHaveBeenCalledWith('SLOT_PRE', 'inapp', true);
    });

    it('인앱 토글을 press 해도 채널이 "push" 인 호출은 나가지 않는다', () => {
      const props = renderScreen();

      fireEvent.press(screen.getByTestId(inAppId('TRIP_DAY')));

      expect(
        (props.onToggle as jest.Mock).mock.calls.map((call) => call[1])
      ).toEqual(['inapp']);
    });

    it('권한이 있으면 켜진 푸시를 누를 때 onToggle(kind, "push", false), 꺼진 푸시는 true 로 나간다', () => {
      const props = renderScreen({ pushColumnAvailable: true });

      fireEvent.press(screen.getByTestId(pushId('STAY'))); // 현재 true → 끄기
      fireEvent.press(screen.getByTestId(pushId('SLOT_PRE'))); // 현재 false → 켜기

      expect((props.onToggle as jest.Mock).mock.calls).toEqual([
        ['STAY', 'push', false],
        ['SLOT_PRE', 'push', true],
      ]);
    });
  });

  describe('권한 거부 — 푸시는 꺼짐·잠김, 인앱은 정상 (BR-U6-16 · PBT-U6-F2)', () => {
    it('권한 거부면 서버 값이 켜짐이어도 6종 푸시 스위치가 전부 꺼짐·잠김으로 읽힌다 (거짓 켜짐 금지)', () => {
      // DEFAULT_VALUES 상 STAY·TRIP_PRE·TRIP_DAY·REFLECTION 은 푸시가 켜져 있다.
      renderScreen({ pushColumnAvailable: false });

      VISIBLE_KINDS.forEach((kind) => {
        expect(screen.getByTestId(pushId(kind))).not.toBeChecked();
        expect(screen.getByTestId(pushId(kind))).toBeDisabled();
      });
    });

    it('권한 거부면 푸시 스위치를 눌러도 onToggle 이 나가지 않는다 (인앱은 눌린다)', () => {
      const props = renderScreen({ pushColumnAvailable: false });

      fireEvent.press(screen.getByTestId(pushId('STAY')));
      fireEvent.press(screen.getByTestId(inAppId('STAY'))); // 앵커

      expect(
        (props.onToggle as jest.Mock).mock.calls.map((call) => call[1])
      ).toEqual(['inapp']);
    });

    it('권한 배너를 누르면 onOpenSettings 가 1회 나간다', () => {
      const props = renderScreen({ pushColumnAvailable: false });
      expect(props.onOpenSettings).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId(BANNER_ID));

      expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('인앱 열은 DENIED 에서도 비활성이 아니고 press 하면 onToggle 이 발화한다 (repo-trap 금지-1)', () => {
      const props = renderScreen({ pushColumnAvailable: false });

      VISIBLE_KINDS.forEach((kind) => {
        expect(screen.getByTestId(inAppId(kind))).not.toBeDisabled();
      });

      fireEvent.press(screen.getByTestId(inAppId('STAY')));
      expect(props.onToggle).toHaveBeenCalledWith('STAY', 'inapp', false);
    });

    it('권한 거부여도 인앱 열은 값대로 checked 다 (켜졌다는 거짓말도, 꺼졌다는 거짓말도 금지)', () => {
      renderScreen({ pushColumnAvailable: false });

      // DEFAULT_VALUES 상 인앱은 6종 모두 true — 권한과 무관하게 그대로 checked.
      VISIBLE_KINDS.forEach((kind) => {
        expect(screen.getByTestId(inAppId(kind))).toBeChecked();
      });
    });
  });

  // TRIP-991
  describe('🔴 스위치 이름 (AC-3)', () => {
    it('푸시·인앱 스위치 6개씩이 "{행 라벨} 푸시" / "{행 라벨} 인앱" 이름으로 읽힌다', () => {
      renderScreen();

      // 정규식(부분 일치) — 행 라벨 카피 자체는 잠그지 않고 접미만 센다.
      expect(screen.getAllByRole('switch', { name: / 푸시$/ })).toHaveLength(6);
      expect(screen.getAllByRole('switch', { name: / 인앱$/ })).toHaveLength(6);
    });
  });
});

// TRIP-607 · INV-U6-04·05
describe('COMMUNITY·SYSTEM 미렌더 (옛 __tests__/notificationKindGuard)', () => {
  /**
   * TRIP-607 · l02 · INV-U6-04·05 (금지-2 구조 가드) — 알림 설정 화면은 어떤 응답에서도 `SYSTEM`·
   * `COMMUNITY` 행을 렌더 트리에 두지 않는다.
   *
   * 무엇을 보장하나: 화면에 **COMMUNITY 값이 실제로 들어와도**(서버는 7종을 다 보낸다) 그 행이 렌더되지
   * 않고, **SYSTEM 이 섞여 들어와도** 나타나지 않는다. Figma 두 프레임은 COMMUNITY 를 7번째로 그리지만
   * U7 개통 전까지 비즈니스 규칙(BR-U6-19·INV-U6-05)이 숨김을 우선한다 — 이 가드가 그 숨김을 잠근다.
   *
   * 왜 렌더 가드인가: "렌더 트리 부재"는 소스 문자열이 아니라 실제 출력에서만 정직하게 확인된다. 화면이
   * 자신의 6종 목록만 순회하므로, values 에 COMMUNITY·SYSTEM 을 넣어도 산출 testID 에 없어야 한다.
   *
   * 가짜 통과 방지(리포 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 짝과 같은 it 에 둔다 — 화면이
   * 통째로 비어도(빈 스캔) 6종 존재 단언이 함께 red 를 낸다.
   *
   * TRIP-1442: 푸시 열이 다시 열려 푸시 testID 는 6종엔 있고 COMMUNITY·SYSTEM 에는 없다로 잰다.
   */

  const pushId = (kind: string) => `notification-settings-toggle-push-${kind}`;
  const inAppId = (kind: string) =>
    `notification-settings-toggle-inapp-${kind}`;

  /** 서버가 보내는 7종 전부 + SYSTEM(계약상 오지 않지만 방어적으로 주입) 을 값으로 채운다. */
  const ALL_KINDS_VALUES = {
    STAY: { pushEnabled: true, inAppEnabled: true },
    TRIP_PRE: { pushEnabled: true, inAppEnabled: true },
    TRIP_DAY: { pushEnabled: true, inAppEnabled: true },
    SLOT_PRE: { pushEnabled: false, inAppEnabled: true },
    PLAN_B: { pushEnabled: false, inAppEnabled: true },
    REFLECTION: { pushEnabled: true, inAppEnabled: true },
    COMMUNITY: { pushEnabled: true, inAppEnabled: true },
    // SYSTEM 은 NotificationToggleKind 에 없다 — 방어적 주입을 위해 맵에 얹는다(화면은 순회하지 않음).
    SYSTEM: { pushEnabled: true, inAppEnabled: true },
  } as ToggleValueMap;

  describe('TRIP-607 · notificationKindGuard — SYSTEM·COMMUNITY 렌더 트리 부재 (금지-2)', () => {
    it('COMMUNITY 값이 들어와도 COMMUNITY 행이 렌더되지 않는다 (6종은 렌더된다)', () => {
      render(
        <NotificationSettingsScreen
          values={ALL_KINDS_VALUES}
          pushColumnAvailable
          onToggle={jest.fn()}
          onOpenSettings={jest.fn()}
        />
      );

      // 있어야 한다 — 보이는 6종.
      (
        [
          'STAY',
          'TRIP_PRE',
          'TRIP_DAY',
          'SLOT_PRE',
          'PLAN_B',
          'REFLECTION',
        ] as const
      ).forEach((kind) => {
        expect(screen.getByTestId(inAppId(kind))).toBeOnTheScreen();
        expect(screen.getByTestId(pushId(kind))).toBeOnTheScreen();
      });

      // 없어야 한다 — COMMUNITY 는 숨김.
      expect(screen.queryByTestId(pushId('COMMUNITY'))).toBeNull();
      expect(screen.queryByTestId(inAppId('COMMUNITY'))).toBeNull();
    });

    it('SYSTEM 이 섞여 들어와도 SYSTEM 행이 렌더되지 않는다 (INV-U6-04)', () => {
      render(
        <NotificationSettingsScreen
          values={ALL_KINDS_VALUES}
          pushColumnAvailable
          onToggle={jest.fn()}
          onOpenSettings={jest.fn()}
        />
      );

      // 있어야 한다 — 대표 STAY 행(빈 렌더면 이 줄이 red).
      expect(screen.getByTestId(inAppId('STAY'))).toBeOnTheScreen();
      expect(screen.getByTestId(pushId('STAY'))).toBeOnTheScreen();
      // 없어야 한다 — SYSTEM 은 토글 목록에 없다.
      expect(screen.queryByTestId(pushId('SYSTEM'))).toBeNull();
      expect(screen.queryByTestId(inAppId('SYSTEM'))).toBeNull();
    });
  });
});
