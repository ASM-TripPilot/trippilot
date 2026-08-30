import { render, screen } from '@testing-library/react-native';

import {
  NotificationSettingsScreen,
  type ToggleValueMap,
} from '@/features/notification/ui/NotificationSettingsScreen';

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
 */

const pushId = (kind: string) => `notification-settings-toggle-push-${kind}`;
const inAppId = (kind: string) => `notification-settings-toggle-inapp-${kind}`;

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
      expect(screen.getByTestId(pushId(kind))).toBeOnTheScreen();
      expect(screen.getByTestId(inAppId(kind))).toBeOnTheScreen();
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
    expect(screen.getByTestId(pushId('STAY'))).toBeOnTheScreen();
    // 없어야 한다 — SYSTEM 은 토글 목록에 없다.
    expect(screen.queryByTestId(pushId('SYSTEM'))).toBeNull();
    expect(screen.queryByTestId(inAppId('SYSTEM'))).toBeNull();
  });
});
