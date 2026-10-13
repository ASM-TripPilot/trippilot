import { fireEvent, render, screen } from '@testing-library/react-native';
import type { NotificationToggleKind } from '@/shared/api/index.schemas';
import {
  NotificationSettingsScreen,
  type NotificationSettingsScreenProps,
  type ToggleValueMap,
} from './NotificationSettingsScreen';
import type { ReactTestInstance } from 'react-test-renderer';
import { PermissionBanner } from './PermissionBanner';

/**
 * l02 알림 설정 화면 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1154): 옛 `NotificationSettingsScreen{,.parity}.test.tsx` 와 `src/__tests__/notificationKindGuard
 * .test.tsx`(이 화면만 그리는 렌더 가드)를 각자의 바깥 describe 로 옮겼다. 목이 없어 머리에 걸 것이 없다.
 */

// TRIP-607 · TRIP-939
describe('행·토글 (옛 .test)', () => {
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
  const inAppId = (kind: string) =>
    `notification-settings-toggle-inapp-${kind}`;

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

  describe('🔴 TRIP-991 · 인앱 스위치 이름 (AC-3)', () => {
    it('인앱 스위치 6개가 모두 "{행 라벨} 인앱" 이름으로 읽힌다', () => {
      renderScreen();

      // 정규식(부분 일치) — 행 라벨 카피 자체는 잠그지 않고 " 인앱" 접미만 센다.
      expect(screen.getAllByRole('switch', { name: / 인앱$/ })).toHaveLength(6);
    });
  });
});

// TRIP-774
describe('Figma 정합 (옛 .parity)', () => {
  /**
   * TRIP-774 · l02 알림 설정 Figma(1600:2388) 정합 — 렌더 트리 className 가드.
   *
   * 무엇을 보장하나:
   *  - AC-2 열 정렬: 헤더 "인앱" 칸과 행의 인앱 토글 칸이 같은 폭·같은 간격을 쓰고, 공통 조상까지의
   *    오른쪽 여백 합이 같다. 지금은 카드에만 `px-lg` 가 있어 헤더 글자가 토글보다 16px 오른쪽에 있다.
   *  - AC-4b(01b Q2=A): 숨은 푸시 분기의 권한 배너는 r12·버튼 r8·문구 13. 운영·프리뷰 어디에도 안 보여
   *    육안 대조가 닿지 않으므로 이 가드가 유일한 그물이다.
   *
   * jest 는 좌표를 모른다 — 실제 픽셀 정렬·구분선 전폭·그림자는 [검증] 04b·6-b 소관(02a §4-11).
   * 조상은 호스트 요소만 센다: 합성 `View` 도 className 을 들고 있어 그대로 세면 토큰이 두 번 잡힌다.
   */

  /** BR-U6-18 기본값 — SLOT_PRE·PLAN_B 는 푸시 OFF·인앱 ON, 나머지는 둘 다 ON. */
  const DEFAULT_VALUES: ToggleValueMap = {
    STAY: { pushEnabled: true, inAppEnabled: true },
    TRIP_PRE: { pushEnabled: true, inAppEnabled: true },
    TRIP_DAY: { pushEnabled: true, inAppEnabled: true },
    SLOT_PRE: { pushEnabled: false, inAppEnabled: true },
    PLAN_B: { pushEnabled: false, inAppEnabled: true },
    REFLECTION: { pushEnabled: true, inAppEnabled: true },
  };

  function tokens(el: ReactTestInstance): string[] {
    return String(el.props.className ?? '')
      .split(/\s+/)
      .filter(Boolean);
  }

  function hostAncestors(el: ReactTestInstance): ReactTestInstance[] {
    const out: ReactTestInstance[] = [];
    let cur = el.parent;
    while (cur) {
      if (typeof cur.type === 'string') out.push(cur);
      cur = cur.parent;
    }
    return out;
  }

  const WIDTH = /^(min-|max-)?w-/;
  const GAP = /^gap-(x-)?(.+)$/;
  /** 오른쪽 여백을 만드는 토큰 → 값 부분(`px-lg`→`lg`, `-mx-lg`→`-lg`). */
  const RIGHT_INSET = /^(-?)(?:p|px|pr|m|mx|mr)-(.+)$/;

  function widthTokens(el: ReactTestInstance): string[] {
    return tokens(el)
      .filter((t) => WIDTH.test(t))
      .sort();
  }

  function gapKeys(el: ReactTestInstance): string[] {
    return tokens(el)
      .map((t) => GAP.exec(t)?.[2])
      .filter((v): v is string => v !== undefined)
      .sort();
  }

  function insetKeys(chain: ReactTestInstance[]): string[] {
    return chain
      .flatMap(tokens)
      .map((t) => {
        const m = RIGHT_INSET.exec(t);
        return m ? `${m[1]}${m[2]}` : undefined;
      })
      .filter((v): v is string => v !== undefined)
      .sort();
  }

  function renderColumns() {
    render(
      <NotificationSettingsScreen
        values={DEFAULT_VALUES}
        pushColumnAvailable
        onToggle={jest.fn()}
        onOpenSettings={jest.fn()}
      />
    );
    const header = hostAncestors(screen.getByText('인앱'));
    const row = hostAncestors(
      screen.getByTestId('notification-settings-toggle-inapp-STAY')
    );
    return { header, row };
  }

  describe('TRIP-774 · AC-2 — 열 헤더 "인앱"이 인앱 토글 열과 정렬된다', () => {
    it('헤더 칸과 행의 인앱 칸이 같은 폭 클래스를 쓰고, 옛 52px 칸이 아니다', () => {
      // 준비·실행: 헤더 글자와 인앱 토글의 바로 위 칸.
      const { header, row } = renderColumns();
      const headerCell = header[0];
      const rowCell = row[0];

      // 단언: 폭 토큰이 있고, 서로 같고, 52px 이 아니다.
      expect(widthTokens(rowCell).length).toBeGreaterThan(0);
      expect(widthTokens(headerCell)).toEqual(widthTokens(rowCell));
      expect(widthTokens(rowCell)).not.toContain('w-[52px]');
    });

    it('두 열 사이 간격이 헤더와 행에서 같다', () => {
      const { header, row } = renderColumns();

      // 칸의 부모 = 두 열을 묶는 클러스터.
      expect(gapKeys(header[1])).toEqual(gapKeys(row[1]));
    });

    it('공통 조상까지의 오른쪽 여백 합이 헤더 줄과 토글 행에서 같다', () => {
      // 준비·실행: 두 조상 목록이 처음 만나는 곳(공통 조상) 직전까지를 사슬로 자른다.
      const { header, row } = renderColumns();
      const common = row.find((el) => header.includes(el));
      expect(common).toBeDefined();
      const headerChain = header.slice(2, header.indexOf(common!));
      const rowChain = row.slice(2, row.indexOf(common!));

      // 단언: 사슬이 비지 않았고(헤더 줄·행 루트), 오른쪽 여백 값 목록이 같다.
      expect(headerChain.length).toBeGreaterThan(0);
      expect(rowChain.length).toBeGreaterThan(0);
      expect(insetKeys(headerChain)).toEqual(insetKeys(rowChain));
    });
  });

  describe('TRIP-774 · AC-4b (01b Q2=A) — 숨은 권한 배너 값', () => {
    it('배너는 r12, [설정 이동] 버튼은 r8, 안내 문구는 13(text-label)이다', () => {
      // 준비·실행: 배너 단독 렌더(화면의 푸시 분기는 비공개 상수 뒤라 닿지 않는다).
      render(<PermissionBanner onOpenSettings={jest.fn()} />);
      const banner = screen.getByTestId(
        'notification-settings-permission-banner'
      );
      const button = hostAncestors(screen.getByText('설정 이동'))[0];
      const copy = screen.getByText('기기 설정에서 알림 권한을 허용하세요');

      // 단언
      expect(tokens(banner)).toContain('rounded-[12px]');
      expect(tokens(banner)).not.toContain('rounded-[20px]');
      expect(tokens(button)).toContain('rounded-[8px]');
      expect(tokens(button)).not.toContain('rounded-pill');
      expect(tokens(copy)).toContain('text-label');
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
   * TRIP-939 AC-11: 푸시 열이 운영 화면에서 사라져(TRIP-835 미배선) 존재 앵커를 **인앱** testID 로 옮기고,
   * 푸시 testID 는 6종·COMMUNITY·SYSTEM 모두 부재로 잰다.
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
        expect(screen.queryByTestId(pushId(kind))).toBeNull();
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
      // 없어야 한다 — SYSTEM 은 토글 목록에 없다.
      expect(screen.queryByTestId(pushId('SYSTEM'))).toBeNull();
      expect(screen.queryByTestId(inAppId('SYSTEM'))).toBeNull();
    });
  });
});
