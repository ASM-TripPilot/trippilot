import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { LocationConsentScreen } from './LocationConsentScreen';

/**
 * TRIP-609 · l06 위치정보 동의 화면(프레젠테이션 + 철회 게이트 UI 로직).
 *
 * 무엇을 보장하나:
 *  - AC-6: default 에 용도 3항목(이동 지연 감지·실시간 Plan-B 재계획·주변 숙소·일정 추천)이 뜬다.
 *  - AC-7: "동의를 꺼도 계속 동작해요" 배너가 계속 2항목(예정 일정 알림·날씨/휴무 트리거)을 보인다.
 *  - AC-9: OS 권한 DENIED 면 토글이 **real disabled**(눌러도 안 먹음), 부제 "OS 권한 거부로 사용
 *    불가"(침묵 금지) + [설정 이동] 배너가 뜬다. 짝: 허용이면 비활성·denied 배너가 없다.
 *  - AC-1(UI 절반) + AC-8: 동의 ON 에서 토글을 끄면 **즉시 콜백을 안 부르고** 철회 다이얼로그가 먼저
 *    뜬다(중단3·계속2 문안). [동의 철회] 뒤에만 onRevokeConfirmed. 취소하면 콜백 미발화.
 *  - 승낙 경로: 동의 OFF 에서 토글을 켜면 다이얼로그 없이 곧장 onGrant.
 *
 * 왜 화면 층인가: 게이트의 **UI 로직**(토글 press → 다이얼로그냐 승낙이냐, 확정 콜백은 언제)은
 * 프레젠테이션의 성질이라 콜백 jest.fn() 만으로 잰다. 실제 서버 mutate 시퀀스·payload 는 배선이라
 * `LocationConsentPage.test.tsx` 가 잠근다(02a §4 T4).
 *
 * ⚠️ jest 사각(6-b 실기 전용): 다이얼로그 딤이 화면을 실제로 덮나·모달이 실제로 열리나 —
 *    608·바텀시트와 동형으로 원리적 사각이다. 여기선 조건부 렌더의 testID 존재/부재 + 콜백 발화로만
 *    잠근다(repo-traps). permission-denied 전체 dimmed 픽셀·글리프 SVG 도 6-b.
 *
 * (개념) 매처 — `getByText('완전문자열')` 완전일치 / `within(node)` 로 스코프해 같은 문자열이 트리에
 *  여러 번 있어도(예: '실시간 Plan-B 재계획' 은 용도항목이자 다이얼로그 중단항목) 다중 매치 throw 를
 *  피한다 / `toBeDisabled()` 는 real `disabled` prop 을 본다(02a §5-A·§5-B).
 */

/** revokeImpact() 가 공급할 문안과 동형(화면은 impact prop 만 소비 — 순수함수 결합 없음). */
const IMPACT = {
  stops: ['이동 지연 알림', '실시간 Plan-B 재계획', '현 위치 기반 추천'],
  continues: ['예정 일정 알림', '날씨·휴무 트리거'],
} as const;

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof LocationConsentScreen>> = {}
) {
  const props = {
    consentOn: true,
    disabled: false,
    impact: IMPACT,
    onGrant: jest.fn(),
    onRevokeConfirmed: jest.fn(),
    onOpenSettings: jest.fn(),
    ...overrides,
  };
  render(<LocationConsentScreen {...props} />);
  return props;
}

describe('TRIP-609 · LocationConsentScreen — 용도·배너(AC-6 · AC-7)', () => {
  it('AC-6: default 에 용도 3항목과 ON 부제를 보인다', () => {
    renderScreen({ consentOn: true, disabled: false });

    expect(screen.getByText('이동 지연 감지')).toBeOnTheScreen();
    expect(screen.getByText('실시간 Plan-B 재계획')).toBeOnTheScreen();
    expect(screen.getByText('주변 숙소·일정 추천')).toBeOnTheScreen();
    // 부제(완전일치): 동의 ON 상태.
    expect(screen.getByText('동의함 · 정확한 위치 사용')).toBeOnTheScreen();
  });

  it('AC-7: "꺼도 계속 동작해요" 배너가 계속 2항목을 보인다', () => {
    renderScreen();

    const banner = screen.getByTestId('settings-location-continue-banner');
    // 배너 스코프 안에서 — 같은 문자열이 (다이얼로그 열릴 때) 다른 곳에도 있으므로 within 으로 좁힌다.
    expect(within(banner).getByText('예정 일정 알림')).toBeOnTheScreen();
    expect(within(banner).getByText('날씨·휴무 트리거')).toBeOnTheScreen();
  });
});

describe('TRIP-609 · LocationConsentScreen — permission-denied(AC-9)', () => {
  it('DENIED 면 토글 real disabled + "사용 불가" 부제 + [설정 이동] 배너, 이동 시 onOpenSettings', () => {
    const props = renderScreen({ disabled: true, consentOn: false });

    // 급소: accessibilityState 만이 아니라 real disabled — press 실차단은 아래 짝(Page)에서 확인.
    expect(screen.getByTestId('settings-location-toggle')).toBeDisabled();
    // 부제(완전일치): 왜 못 쓰는지 명시(INV-4 침묵 금지).
    expect(screen.getByText('OS 권한 거부로 사용 불가')).toBeOnTheScreen();
    expect(
      screen.getByTestId('settings-location-denied-banner')
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('settings-location-open-settings'));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('짝: 허용이면 토글이 비활성이 아니고 denied 배너가 없다', () => {
    renderScreen({ disabled: false, consentOn: true });

    expect(screen.getByTestId('settings-location-toggle')).not.toBeDisabled();
    expect(screen.queryByTestId('settings-location-denied-banner')).toBeNull();
  });
});

describe('TRIP-609 · LocationConsentScreen — 철회 게이트 UI + 문안(AC-1 UI · AC-8)', () => {
  it('동의 ON 에서 토글을 끄면 즉시 콜백 없이 다이얼로그가 먼저 뜨고 중단3·계속2 를 고지한다', () => {
    const props = renderScreen({ consentOn: true, disabled: false });

    // 준비 확인: 초기엔 다이얼로그가 없다.
    expect(screen.queryByTestId('settings-location-revoke-confirm')).toBeNull();

    // 실행: 토글 끄기(ON→OFF 시도).
    fireEvent.press(screen.getByTestId('settings-location-toggle'));

    // 급소: 즉시 철회 콜백이 나가지 않는다(다이얼로그 없이 PUT 금지의 UI 절반).
    expect(props.onRevokeConfirmed).not.toHaveBeenCalled();
    expect(props.onGrant).not.toHaveBeenCalled();

    // 단언: 다이얼로그가 뜨고, 중단3·계속2 를 구조화 리스트로 고지한다(Q1 확정).
    const dialog = screen.getByTestId('settings-location-revoke-confirm');
    expect(within(dialog).getByText('이동 지연 알림')).toBeOnTheScreen();
    expect(within(dialog).getByText('실시간 Plan-B 재계획')).toBeOnTheScreen();
    expect(within(dialog).getByText('현 위치 기반 추천')).toBeOnTheScreen();
    expect(within(dialog).getByText('예정 일정 알림')).toBeOnTheScreen();
    expect(within(dialog).getByText('날씨·휴무 트리거')).toBeOnTheScreen();
  });

  it('[동의 철회] 를 눌러야 onRevokeConfirmed 가 정확히 1회 나간다', () => {
    const props = renderScreen({ consentOn: true, disabled: false });

    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    fireEvent.press(
      screen.getByTestId('settings-location-revoke-confirm-button')
    );

    expect(props.onRevokeConfirmed).toHaveBeenCalledTimes(1);
  });

  it('짝: 다이얼로그에서 취소하면 철회 콜백 없이 다이얼로그만 닫힌다', () => {
    const props = renderScreen({ consentOn: true, disabled: false });

    fireEvent.press(screen.getByTestId('settings-location-toggle'));
    fireEvent.press(screen.getByTestId('settings-location-revoke-cancel'));

    expect(props.onRevokeConfirmed).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-location-revoke-confirm')).toBeNull();
  });
});

describe('TRIP-609 · LocationConsentScreen — 승낙 경로(게이트 없음)', () => {
  it('동의 OFF 에서 토글을 켜면 다이얼로그 없이 곧장 onGrant 를 1회 부른다', () => {
    const props = renderScreen({ consentOn: false, disabled: false });

    fireEvent.press(screen.getByTestId('settings-location-toggle'));

    // 승낙엔 재확인 게이트가 없다(철회만 법적 재확인 대상).
    expect(props.onGrant).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('settings-location-revoke-confirm')).toBeNull();
  });
});
