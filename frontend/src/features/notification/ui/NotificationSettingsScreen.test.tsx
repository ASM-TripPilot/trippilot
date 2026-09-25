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
 * TRIP-939 AC-11(심사 2.1 · TRIP-835 푸시 미배선): 푸시 채널은 기기 토큰 등록이 없어 켜도 아무 알림이
 *  오지 않는다 → 운영 화면에서 **푸시 열·"푸시"/"권한 필요" 헤더·권한 배너를 그리지 않는다**. 인앱 6종만
 *  남고, 문구는 푸시를 언급하지 않는 쪽(Q6)을 권한 유무와 무관하게 쓴다. 구 "6행×2열"·"권한 거부 시 푸시
 *  disabled + 배너" 단언은 전부 "푸시 부재"로 뒤집었다. props(`pushColumnAvailable`·`onOpenSettings`)는
 *  되살림 대비로 그대로 넘긴다(02a ★17 — 되살림 짝 테스트는 새 플래그 이름을 박제하지 않으려 두지 않음).
 *
 * 무엇을 보장하나:
 *  - **정상-1**: 6종(STAY·TRIP_PRE·TRIP_DAY·SLOT_PRE·PLAN_B·REFLECTION)의 **인앱** 토글만 testID 로
 *    렌더되고, checked 가 주입 값 그대로다. 푸시 토글은 권한 유무와 무관하게 0개.
 *  - **문구**: 상단 "변경한 알림 설정은 다음 알림부터 바로 반영됩니다", 하단 "모든 알림을 꺼도 보안·계정
 *    관련 알림은 알림함에 표시됩니다", 열 헤더 "인앱"만 — "푸시"·"권한 필요"는 없다.
 *  - **금지-1(렌더 절반)**: OS 거부(`pushColumnAvailable=false`)여도 권한 배너가 없고, **인앱 열은 disabled
 *    가 아니며 press 하면 onToggle 이 발화**한다(repo-trap 금지-1 유지).
 *  - **콜백 배선**: 인앱 토글 press → `onToggle(kind, 'inapp', !현재값)`.
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

const TOP_COPY = '변경한 알림 설정은 다음 알림부터 바로 반영됩니다';
const BOTTOM_COPY =
  '모든 알림을 꺼도 보안·계정 관련 알림은 알림함에 표시됩니다';

describe('TRIP-607 · NotificationSettingsScreen — 6행 인앱 토글 값대로 렌더 (정상-1 · TRIP-939 AC-11)', () => {
  it.each([true, false])(
    '권한 %s 여도 6종 인앱 토글만 렌더되고 푸시 토글은 0개다',
    (pushColumnAvailable) => {
      // 준비·실행
      renderScreen({ pushColumnAvailable });

      // 단언: 인앱 6개 존재(앵커) + 푸시 6개 부재.
      VISIBLE_KINDS.forEach((kind) => {
        expect(screen.getByTestId(inAppId(kind))).toBeOnTheScreen();
        expect(screen.queryByTestId(pushId(kind))).toBeNull();
      });
    }
  );

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

    expect(
      screen.queryByTestId('notification-settings-permission-banner')
    ).toBeNull();
    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.getByTestId(inAppId(kind))).not.toBeDisabled();
    });
  });
});

describe('TRIP-939 AC-11 · 문구 — 푸시를 언급하지 않는다 (Q6)', () => {
  it.each([true, false])(
    '권한 %s 여도 상·하단 문구가 같고 열 헤더는 "인앱"뿐이다',
    (pushColumnAvailable) => {
      // 준비·실행
      renderScreen({ pushColumnAvailable });

      // 단언: 상·하단 문구 완전일치 + "인앱" 헤더(앵커).
      expect(screen.getByText(TOP_COPY)).toBeOnTheScreen();
      expect(screen.getByText(BOTTOM_COPY)).toBeOnTheScreen();
      expect(screen.getByText('인앱')).toBeOnTheScreen();
      // 부재: 푸시 헤더·권한 칩·푸시 언급 문구.
      expect(screen.queryByText(/푸시/)).toBeNull();
      expect(screen.queryByText('권한 필요')).toBeNull();
    }
  );
});

describe('TRIP-607 · NotificationSettingsScreen — 콜백 배선 (인앱)', () => {
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
});

describe('TRIP-607 · NotificationSettingsScreen — 권한 거부 (금지-1 렌더 절반 · TRIP-939 AC-11)', () => {
  it('권한 거부여도 푸시 열·권한 배너가 없다 — [설정 이동]으로 갈 길 자체가 없다', () => {
    // 준비·실행: OS 권한 거부.
    const props = renderScreen({ pushColumnAvailable: false });

    // 단언: 배너·푸시 토글 부재 + 짝 앵커(인앱 6개는 있다).
    expect(
      screen.queryByTestId('notification-settings-permission-banner')
    ).toBeNull();
    VISIBLE_KINDS.forEach((kind) => {
      expect(screen.queryByTestId(pushId(kind))).toBeNull();
      expect(screen.getByTestId(inAppId(kind))).toBeOnTheScreen();
    });
    expect(props.onOpenSettings).not.toHaveBeenCalled();
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
