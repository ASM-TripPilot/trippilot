import { fireEvent, render, screen } from '@testing-library/react-native';

import type { NotificationToggleKind } from '@/shared/api/generated/schemas';

import {
  NotificationSettingsScreen,
  type NotificationSettingsScreenProps,
  type ToggleValueMap,
} from './NotificationSettingsScreen';

/**
 * TRIP-607 · l02 알림 설정 화면(순수 프레젠테이션).
 *
 * 무엇을 보장하나:
 *  - **정상-1**: 6종(STAY·TRIP_PRE·TRIP_DAY·SLOT_PRE·PLAN_B·REFLECTION) × 2열(푸시·인앱) 토글이
 *    testID 로 렌더되고, 각 스위치의 checked 가 주입 값 그대로다(SLOT_PRE·PLAN_B 는 푸시 OFF·인앱 ON).
 *  - **금지-1(렌더 절반)**: `pushColumnAvailable=false`(OS 거부) 면 푸시 열 토글이 **real disabled**
 *    이고 권한 배너(notification-settings-permission-banner)가 뜨며, [설정 이동] press → onOpenSettings.
 *    그리고 **인앱 열은 disabled 가 아니고 press 하면 onToggle 이 발화**한다(repo-trap 금지-1: 인앱은
 *    DENIED 에서도 조작 가능). 짝: 권한 있으면 푸시가 비활성이 아니고 배너가 없다.
 *  - **콜백 배선**: 켜진 푸시/인앱 토글을 press 하면 `onToggle(kind, channel, !현재값)` 이 정확히 나간다.
 *
 * 왜 화면 층인가: 토글 배선의 UI 성질(어느 testID·checked·disabled·press→콜백)은 콜백 jest.fn() 으로
 * 잰다. 실제 픽셀 회색/thumb 위치/실차단은 jest 원리적 사각(LocationConsentScreen 선례와 동형) →
 * 6-b 실기 전용(repo-traps). PBT-U6-F2 순수 함수 반환은 channelAvailability.test.ts 가 잠근다.
 *
 * (개념) 매처 — `toBeChecked()` 는 role="switch" 요소의 accessibilityState.checked 를 읽고,
 *  `toBeDisabled()` 는 real `disabled` prop 을 본다. `queryByTestId(...)===null` 은 부재 확인.
 *  (02a §5-A·§5-B, node_modules 확인 근거 남김).
 *
 * 라벨 카피(숙소 등록·저장 완료 등)·배너 문구·배지 색은 화면 정본(Figma) 소관이라 여기서 문자열로
 * 잠그지 않는다 — testID·상태로만 잠그고 카피 충실도는 6-b/figma-screen-impl.
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
const inAppId = (kind: string) => `notification-settings-toggle-inapp-${kind}`;

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

describe('TRIP-607 · NotificationSettingsScreen — 6행×2열 값대로 렌더 (정상-1)', () => {
  it('6종의 푸시·인앱 토글이 모두 렌더된다', () => {
    renderScreen();
    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.getByTestId(pushId(kind))).toBeOnTheScreen();
      expect(screen.getByTestId(inAppId(kind))).toBeOnTheScreen();
    });
  });

  it('각 스위치 checked 가 주입 값 그대로다 (SLOT_PRE·PLAN_B 는 푸시 OFF·인앱 ON)', () => {
    renderScreen();

    // ON·ON 5종 중 대표 STAY.
    expect(screen.getByTestId(pushId('STAY'))).toBeChecked();
    expect(screen.getByTestId(inAppId('STAY'))).toBeChecked();

    // SLOT_PRE·PLAN_B — 푸시 OFF, 인앱 ON.
    expect(screen.getByTestId(pushId('SLOT_PRE'))).not.toBeChecked();
    expect(screen.getByTestId(inAppId('SLOT_PRE'))).toBeChecked();
    expect(screen.getByTestId(pushId('PLAN_B'))).not.toBeChecked();
    expect(screen.getByTestId(inAppId('PLAN_B'))).toBeChecked();
  });

  it('권한 있으면 권한 배너가 없고 푸시 토글이 비활성이 아니다 (짝)', () => {
    renderScreen({ pushColumnAvailable: true });

    expect(
      screen.queryByTestId('notification-settings-permission-banner')
    ).toBeNull();
    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.getByTestId(pushId(kind))).not.toBeDisabled();
    });
  });
});

describe('TRIP-607 · NotificationSettingsScreen — 콜백 배선', () => {
  it('켜진 푸시 토글을 press 하면 onToggle(kind, "push", false) 가 1회 나간다', () => {
    const props = renderScreen();

    fireEvent.press(screen.getByTestId(pushId('STAY'))); // 현재 true → 끄기

    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onToggle).toHaveBeenCalledWith('STAY', 'push', false);
  });

  it('꺼진 푸시 토글을 press 하면 onToggle(kind, "push", true) 가 나간다', () => {
    const props = renderScreen();

    fireEvent.press(screen.getByTestId(pushId('SLOT_PRE'))); // 현재 false → 켜기

    expect(props.onToggle).toHaveBeenCalledWith('SLOT_PRE', 'push', true);
  });

  it('인앱 토글을 press 하면 onToggle(kind, "inapp", !현재값) 이 나간다', () => {
    const props = renderScreen();

    fireEvent.press(screen.getByTestId(inAppId('STAY'))); // 현재 true → 끄기

    expect(props.onToggle).toHaveBeenCalledWith('STAY', 'inapp', false);
  });
});

describe('TRIP-607 · NotificationSettingsScreen — 권한 거부 (금지-1 렌더 절반)', () => {
  it('푸시 열이 real disabled 이고 권한 배너가 뜨며 [설정 이동] 시 onOpenSettings', () => {
    const props = renderScreen({ pushColumnAvailable: false });

    // 푸시 열 토글 전부 real disabled.
    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.getByTestId(pushId(kind))).toBeDisabled();
    });
    // 권한 배너 존재 + 설정 이동 배선.
    const banner = screen.getByTestId(
      'notification-settings-permission-banner'
    );
    expect(banner).toBeOnTheScreen();
    fireEvent.press(banner);
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

  it('권한 거부면 pushEnabled=true 종류도 푸시 토글이 not.checked 이고 인앱 열은 값대로 checked 다 (켜졌다는 거짓말 금지)', () => {
    // disabled 와 checked 는 독립 prop이라 위의 toBeDisabled() 만으로는 담보 못 한다 —
    // OS 권한 거부면 pushEnabled 값과 무관하게 "꺼진 것"으로 그려져야 한다(빨강/thumb 우측 금지).
    renderScreen({ pushColumnAvailable: false });

    // DEFAULT_VALUES 상 pushEnabled=true 인 종류(STAY·TRIP_PRE·TRIP_DAY·REFLECTION)가
    // 거짓말이 새는 자리 — 이들이 checked 로 그려지면 곧 "켜졌다는 거짓말"이다.
    const pushOnKinds = VISIBLE_KINDS.filter(
      (kind) => DEFAULT_VALUES[kind]?.pushEnabled
    );
    expect(pushOnKinds.length).toBeGreaterThan(0); // 공짜 통과 방지(대상 집합 비어있지 않음).
    pushOnKinds.forEach((kind) => {
      expect(screen.getByTestId(pushId(kind))).not.toBeChecked();
    });

    // 대칭: 인앱 열은 권한과 무관 — 주입 값(inAppEnabled=true) 그대로 checked 를 유지한다.
    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.getByTestId(inAppId(kind))).toBeChecked();
    });
  });
});
