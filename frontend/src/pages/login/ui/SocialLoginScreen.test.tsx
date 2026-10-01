import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';
import fc from 'fast-check';
import {
  cleanupAsync,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { SocialLoginScreen } from './SocialLoginScreen';

// 결함 F(브리프 §5) 실측 — 백엔드 ErrorCode.kt + GlobalExceptionHandler.kt 가 실제로 낼 수
// 있는 7종. 화면이 이 중 무엇을 인식하는지가 아니라, "화면이 무엇을 렌더하는지"를 잠근다.
const SERVER_ERROR_CODES = [
  'SOCIAL_AUTH_FAILED',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'AGE_REQUIREMENT_NOT_MET',
  'UPSTREAM_UNAVAILABLE',
  'INTERNAL',
  'NETWORK_ERROR',
] as const;

// §3-5 문구 계약 — 배너 안 텍스트 총합이 정확히 이 문자열이어야 한다(완전 일치, 02a §D7).
const ERROR_COPY = '로그인에 실패했어요. 잠시 후 다시 시도해 주세요';

// provider 코드→한글 표시명(TRIP-352 신설). conflictProvider 입력은 서버 existingProvider=코드
// 이고, 화면이 한글로 매핑해 노출한다 — 코드 원문이 화면에 새면 안 된다(AC-C2).
const PROVIDER_KO: Record<string, string> = {
  google: '구글',
  apple: '애플',
  kakao: '카카오',
  naver: '네이버',
};

// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다.
// 목 본체는 __mocks__/@gorhom/bottom-sheet.tsx (수동 목) 에 있다 — 인라인 팩토리로 두면
// NativeWind babel 의 _ReactNativeCSSInterop 주입이 out-of-scope 로 걸리기 때문이다.
// 이 사이클에서 목을 확장했다: backdropComponent 를 실제로 렌더(딤 AC 선행조건, 02a ★D1).
jest.mock('@gorhom/bottom-sheet');

type Props = ComponentProps<typeof SocialLoginScreen>;

// TRIP-932 — 애플 버튼은 화면이 직접 그리지 않고 컨테이너가 넘겨 준다(`AppleButton` prop). 실물은
// SDK 의 공식 AppleAuthenticationButton 이라 lazy 경계 뒤에 있다. 화면 단위 테스트에서는 이 스텁을
// 넘겨 "받은 버튼을 둘째 자리 래퍼(auth-login-apple) 안에 그리고, 누르면 onSignIn('apple')" 만 본다.
function StubAppleButton({ onPress }: { onPress: () => void }) {
  return <Pressable testID="stub-apple-button" onPress={onPress} />;
}

// 보이는 소셜 버튼 testID 를 화면 순서대로 뽑는다. `^…$` 앵커가 없으면 `-icon` 노드가 섞인다
// (02a ★9 — host 노드만, 트리 순서로 한 번씩 나온다는 것을 실측).
function socialButtonOrder(): string[] {
  return screen
    .getAllByTestId(/^auth-login-(google|apple|kakao|naver)$/)
    .map((node) => node.props.testID as string);
}

function renderScreen(overrides: Partial<Props> = {}) {
  const props: Props = {
    phase: 'idle',
    errorCode: null,
    conflictProvider: null,
    onSignIn: jest.fn(),
    onConflictContinue: jest.fn(),
    onConflictCancel: jest.fn(),
    onAgeConfirm: jest.fn(),
    onAgeCancel: jest.fn(),
    ...overrides,
  };
  render(<SocialLoginScreen {...props} />);
  return props;
}

describe('c02-social-login — 기본 화면 (AC-ONB-01-12 · §10 이메일 버튼 숨김)', () => {
  it('애플 버튼을 받지 않으면(Android·판정 전) 브랜드와 소셜 3버튼(구글·카카오·네이버)만 렌더한다 (TRIP-932 AC-10·AC-12)', () => {
    // 준비 + 실행 — AppleButton 없음.
    renderScreen();

    // 단언 — 3버튼이 이 순서로만 있고 애플 자리는 비어 있다(빈 래퍼도 없다).
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-brand')).toBeOnTheScreen();
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    expect(screen.queryByTestId('auth-login-apple')).toBeNull();
    // TRIP-1053 — 약관 안내 줄은 지웠다(동의는 약관 화면에서만 받는다, BR-U0-10).
    expect(screen.queryByTestId('auth-login-terms')).toBeNull();
  });

  it('넘겨받은 애플 버튼을 누르면 onSignIn("apple") 이 한 번 호출된다 (TRIP-932 AC-11)', () => {
    // 준비
    const props = renderScreen({ AppleButton: StubAppleButton });

    // 실행 — 래퍼가 아니라 안쪽 버튼을 누른다(press 는 부모 방향으로만 핸들러를 찾는다, ★8).
    fireEvent.press(screen.getByTestId('stub-apple-button'));

    // 단언
    expect(props.onSignIn).toHaveBeenCalledWith('apple');
    expect(props.onSignIn).toHaveBeenCalledTimes(1);
  });

  it('이메일 회원가입 버튼·디바이더는 렌더하지 않는다 (§10 결정: 숨김)', () => {
    renderScreen();
    expect(screen.queryByTestId('auth-login-signup')).toBeNull();
    expect(screen.queryByTestId('auth-login-divider')).toBeNull();
  });

  it('소셜 버튼 testID 는 {feature}-{screen}-{role} 규약을 따른다 (AC-ONB-01-12)', () => {
    // iOS 모양(애플 포함 4종)으로 렌더해 보이는 버튼 전부를 순회한다.
    renderScreen({ AppleButton: StubAppleButton });
    ['google', 'apple', 'kakao', 'naver'].forEach((role) => {
      const node = screen.getByTestId(`auth-login-${role}`);
      expect(node.props.testID).toMatch(/^auth-login-[a-z]+$/);
    });
  });

  it('소셜 버튼 탭은 해당 provider 로 onSignIn 을 호출한다', () => {
    const props = renderScreen();
    fireEvent.press(screen.getByTestId('auth-login-google'));
    expect(props.onSignIn).toHaveBeenCalledWith('google');
    fireEvent.press(screen.getByTestId('auth-login-kakao'));
    expect(props.onSignIn).toHaveBeenCalledWith('kakao');
  });

  it('기본 화면에는 취소 토스트·에러 배너·충돌 시트·연령 시트가 없다', () => {
    renderScreen();
    expect(screen.queryByTestId('auth-login-cancel-notice')).toBeNull();
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    expect(screen.queryByTestId('auth-login-conflict-sheet')).toBeNull();
    expect(screen.queryByTestId('auth-age-sheet')).toBeNull();
  });
});

describe('c02-social-login — 취소 안내 (AC-ONB-01-4)', () => {
  it('phase=cancelled 이면 "로그인이 취소되었습니다" 토스트를 표시한다', () => {
    renderScreen({ phase: 'cancelled' });
    const notice = screen.getByTestId('auth-login-cancel-notice');
    expect(notice).toBeOnTheScreen();
    // 문구는 안내 노드 '안'에서 찾는다 — 화면 전역으로 찾으면 문구만 버튼 위로 빠지고 빈 testID
    // 껍데기가 남는 회귀(5-b 경고-1 M1)를 놓친다(에러 배너 AC-V3 의 within 과 대칭).
    expect(
      within(notice).getByText('로그인이 취소되었습니다')
    ).toBeOnTheScreen();
  });
});

describe('c02-social-login — 약관 문구 없음 (TRIP-1053 AC-3 · BR-U0-10)', () => {
  it.each([
    { name: 'idle', override: {} },
    { name: 'cancelled', override: { phase: 'cancelled' } },
    {
      name: 'error',
      override: { phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' },
    },
  ] as { name: string; override: Partial<Props> }[])(
    '$name 상태에서 "약관에 동의" 문구와 auth-login-terms 가 화면 어디에도 없다',
    ({ override }) => {
      // 준비 + 실행
      renderScreen(override);

      // 단언 — 루트 앵커(공허한 통과 방지) + testID 부재 + 문구 부재(정규식 = 부분 일치).
      expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
      expect(screen.queryByTestId('auth-login-terms')).toBeNull();
      expect(screen.queryByText(/약관에 동의/)).toBeNull();
    }
  );
});

describe('c02-social-login — 에러 배너 (AC-ONB-01-5)', () => {
  it('phase=error·SOCIAL_AUTH_FAILED 이면 에러 배너와 안내 문구를 표시하고 소셜 버튼은 유지한다', () => {
    renderScreen({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });
    expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen();
    expect(
      screen.getByText('로그인에 실패했어요. 잠시 후 다시 시도해 주세요')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-google')).toBeOnTheScreen();
  });

  it('phase=error·RATE_LIMITED 도 동일 에러 배너를 표시한다', () => {
    renderScreen({ phase: 'error', errorCode: 'RATE_LIMITED' });
    expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen();
  });
});

describe('c02-social-login — 이메일 충돌 바텀시트 (AC-ONB-01-6 · AC-C1~C4)', () => {
  it('AC-C1 conflictProvider=코드 "kakao" 를 받아 본문·CTA 에 한글 "카카오" 를 노출한다', () => {
    // ▸준비 — 입력은 서버 코드 'kakao'(한글이 아니다).
    const props = renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: 'kakao',
    });

    // ▸단언 — 시트가 뜨고, 본문에 '카카오'(정규식=부분 매칭), CTA 문구는 완전 일치.
    expect(screen.getByTestId('auth-login-conflict-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-conflict-message')).toHaveTextContent(
      /카카오/
    );
    expect(
      screen.getByTestId('auth-login-conflict-continue')
    ).toHaveTextContent('카카오 로그인으로 계속');

    // ▸단언(짝) — 핸들러 계약은 그대로 살아 있다.
    fireEvent.press(screen.getByTestId('auth-login-conflict-continue'));
    expect(props.onConflictContinue).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('auth-login-conflict-cancel'));
    expect(props.onConflictCancel).toHaveBeenCalledTimes(1);
  });

  it.each(['google', 'apple', 'kakao', 'naver'] as const)(
    'AC-C2 provider 코드 "%s" 원문은 화면에 안 나오고 한글 표시명이 대신 나온다',
    (code) => {
      // ▸준비+실행
      renderScreen({
        phase: 'error',
        errorCode: 'SOCIAL_EMAIL_CONFLICT',
        conflictProvider: code,
      });

      // ▸단언 — 루트 앵커(공허한 통과 방지) + 코드 원문 부재(정규식) + 한글 표시명 존재.
      // 한글 표시명은 queryAllByText(복수형)으로 잰다 — 매핑 후 한글은 버튼 라벨·본문·CTA
      // 여러 곳에 뜨는데, 단수형 queryByText 는 매치 2개 이상이면 throw 하기 때문이다(≥1 을
      // 요구하는 의도에 단수형이 잘못 쓰였다, 게이트①-2 교정). 코드 원문 부재 단언은 0매치라
      // throw 없이 그대로 유효하다.
      expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
      expect(screen.queryByText(new RegExp(code))).toBeNull();
      expect(
        screen.queryAllByText(new RegExp(PROVIDER_KO[code])).length
      ).toBeGreaterThan(0);
    }
  );

  it('AC-C3 제목은 "이미 가입된 계정이에요"(불변)', () => {
    renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: 'kakao',
    });
    expect(screen.getByTestId('auth-login-conflict-title')).toHaveTextContent(
      '이미 가입된 계정이에요'
    );
  });

  it('AC-C4 conflictProvider 가 null 이면 코드 없이 일반 문구로 폴백한다 (§10)', () => {
    renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: null,
    });
    expect(
      screen.getByText('다른 방법으로 가입된 계정이에요')
    ).toBeOnTheScreen();
  });

  it('AC-C4 conflictProvider 가 매핑 밖 코드면 그 코드를 노출하지 않고 일반 문구로 폴백한다', () => {
    // ▸준비 — 'line' 은 4종 매핑 밖. 코드 원문이 새면 안 된다.
    renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: 'line',
    });

    // ▸단언 — 폴백 문구 + 코드 미노출.
    expect(screen.getByTestId('auth-login-conflict-message')).toHaveTextContent(
      '다른 방법으로 가입된 계정이에요'
    );
    expect(screen.queryByText(new RegExp('line'))).toBeNull();
  });
});

describe('c02-social-login — 연령확인 시트 (AC-ONB-01-7 · AC-A1~A2)', () => {
  it('AC-A1 phase=needs-age 이면 제목/본문이 교정된 연령 확인 시트를 표시한다', () => {
    // ▸준비+실행
    renderScreen({ phase: 'needs-age' });

    // ▸단언 — 시트 존재 + 제목/본문 완전 일치(현재 제목↔본문 뒤바뀜을 바로잡는다).
    expect(screen.getByTestId('auth-age-sheet')).toBeOnTheScreen();
    expect(screen.getByText('만 14세 이상이 맞나요?')).toBeOnTheScreen();
    expect(
      screen.getByText('관련 법령에 따라 만 14세 이상만 가입할 수 있어요.')
    ).toBeOnTheScreen();
  });

  it('AC-A2 확인 시 onAgeConfirm, 취소 시 onAgeCancel 을 각각 1회 호출한다', () => {
    const props = renderScreen({ phase: 'needs-age' });
    fireEvent.press(screen.getByTestId('auth-age-sheet-confirm'));
    expect(props.onAgeConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('auth-age-sheet-cancel'));
    expect(props.onAgeCancel).toHaveBeenCalledTimes(1);
  });
});

describe('c02-social-login — 연령 제한 시트 (인라인→시트 승격 · AC-R1~R3)', () => {
  it('AC-R1 phase=error·AGE_NOT_MET 이면 딤 위 시트로 뜬다 — 인라인 회색 Text 가 아니다', () => {
    // ▸준비+실행
    renderScreen({ phase: 'error', errorCode: 'AGE_NOT_MET' });

    // ▸단언 — 시트 루트 testID 유지 + 딤 존재(딤 위 = 인라인 아님, AC-D1 과 짝).
    expect(screen.getByTestId('auth-age-restriction')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-sheet-backdrop')).toBeOnTheScreen();
    // 전용 화면이라 충돌 시트는 안 뜬다(기존 계약 유지).
    expect(screen.queryByTestId('auth-login-conflict-sheet')).toBeNull();
  });

  it('AC-R2 제목·본문·단일 [확인] 이 뜨고 취소 버튼은 없다', () => {
    // ▸준비+실행
    renderScreen({ phase: 'error', errorCode: 'AGE_NOT_MET' });
    const sheet = screen.getByTestId('auth-age-restriction');

    // ▸단언 — 제목/본문 완전 일치 + 확인 버튼 존재(앵커).
    expect(
      screen.getByText('만 14세 미만은 가입할 수 없어요')
    ).toBeOnTheScreen();
    expect(
      screen.getByText(
        '관련 법령에 따라 만 14세 이상부터 이용할 수 있어요. 나이를 잘못 확인했다면 다시 시도해 주세요.'
      )
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('auth-age-restriction-confirm')
    ).toBeOnTheScreen();

    // ▸단언(짝) — 이 시트 안에는 취소가 없다(확인 존재를 앵커로).
    expect(within(sheet).queryByText('취소')).toBeNull();
  });

  it('AC-R3 [확인] 탭은 dismiss 핸들러(onAgeCancel 재사용)를 1회 호출한다', () => {
    // ▸준비 — 확정 결정 1: 새 prop 없이 기존 onAgeCancel 재사용(→ idle 복귀).
    const props = renderScreen({ phase: 'error', errorCode: 'AGE_NOT_MET' });

    // ▸실행+단언
    fireEvent.press(screen.getByTestId('auth-age-restriction-confirm'));
    expect(props.onAgeCancel).toHaveBeenCalledTimes(1);
  });
});

describe('c02-social-login — 서버 에러코드 7종 배너 (AC-S6 · 결함 F · INV-4 · 케이스 26)', () => {
  it.each(SERVER_ERROR_CODES)(
    'errorCode=%s 이면 에러 배너에 단일 문구가 렌더된다',
    (code) => {
      // 준비 + 실행 — 렌더 자체가 실행이다.
      renderScreen({ phase: 'error', errorCode: code });

      // 단언 — 루트 존재부터 확인한다(부재 단언과 짝을 이루는 규칙, 7-19 — 이 케이스는
      // 부재가 아니라 존재 단언이지만 렌더 실패 자체를 조기에 드러내기 위해 유지한다).
      expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
      expect(screen.getByTestId('auth-login-error-banner')).toBeOnTheScreen();
      // 완전 일치다(02a §D7) — 배너 안 텍스트 총합이 정확히 ERROR_COPY 와 같아야 한다.
      expect(screen.getByTestId('auth-login-error-banner')).toHaveTextContent(
        ERROR_COPY
      );
    }
  );
});

describe('c02-social-login — 배너가 떠도 재입력 가능 (AC-S6 · 케이스 27)', () => {
  it('에러 배너 상태에서도 소셜 4버튼이 모두 렌더되고 눌린다', () => {
    // 준비 + 실행 — iOS 모양(애플 버튼 주입).
    const props = renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_AUTH_FAILED',
      AppleButton: StubAppleButton,
    });

    // 단언 — 배너 유무와 무관하게 버튼은 항상 렌더되고 탭이 그대로 전달된다.
    expect(socialButtonOrder()).toEqual([
      'auth-login-google',
      'auth-login-apple',
      'auth-login-kakao',
      'auth-login-naver',
    ]);
    fireEvent.press(screen.getByTestId('auth-login-google'));
    expect(props.onSignIn).toHaveBeenCalledWith('google');
    fireEvent.press(screen.getByTestId('stub-apple-button'));
    expect(props.onSignIn).toHaveBeenCalledWith('apple');
  });
});

describe('c02-social-login — 서버 에러코드 문자열 비노출 (AC-S6 · SEC-07 회귀 가드 · 케이스 28)', () => {
  it.each(SERVER_ERROR_CODES)(
    'errorCode=%s 문자열은 화면 어디에도 노출되지 않는다',
    (code) => {
      // 준비 + 실행
      renderScreen({ phase: 'error', errorCode: code });

      // 단언 — 렌더 자체가 실패해 "전부 null"이 되는 공허한 통과를 막기 위해 루트를 먼저 본다.
      expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
      // 정규식을 쓴다 — 코드가 문장 안에 섞여도 잡아야 한다("오류: INTERNAL" 같은 형태,
      // 문자열 인자는 완전 일치라 이런 형태를 놓친다, 02a §D8).
      expect(screen.queryByText(new RegExp(code))).toBeNull();
    }
  );
});

describe('c02-social-login — PBT: 어떤 에러코드에서도 침묵하지 않는다 (AC-S6 · INV-4 · 케이스 29)', () => {
  it('임의 문자열·null errorCode 에서도 배너·연령제한·충돌시트 중 최소 하나는 항상 뜬다', async () => {
    // §8 실검증(동결분) — 동기 fc.property + 동기 cleanup() 은 "Can't access .root on
    // unmounted test renderer" 로 깨졌다: RNTL 동기 cleanup() 은 unmountAsync() 를
    // fire-and-forget 으로만 걸고 완료를 안 기다린다(build/cleanup.js 실측). 같은 tick 에서
    // 다음 render() 가 이어지면 언마운트 전에 새 렌더러를 만들어 상태가 꼬인다. 그래서
    // predicate 를 fc.asyncProperty 로 바꾸고 cleanupAsync() 를 await 해 순서를 보장한다.
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.string(), { nil: null }),
        async (errorCode) => {
          try {
            // 준비 + 실행
            renderScreen({ phase: 'error', errorCode });

            // 단언 — 렌더가 통째로 실패해 "전부 null"이 되는 공허한 통과를 막는다.
            expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
            const banner = screen.queryByTestId('auth-login-error-banner');
            const ageRestriction = screen.queryByTestId('auth-age-restriction');
            const conflictSheet = screen.queryByTestId(
              'auth-login-conflict-sheet'
            );
            // 셋 중 최소 하나는 null 이 아니어야 한다 — 7종은 오늘 아는 목록일 뿐이고,
            // 내일 서버가 새 코드를 내도 화면이 침묵하면 안 된다(INV-4).
            expect(banner ?? ageRestriction ?? conflictSheet).not.toBeNull();
          } finally {
            await cleanupAsync();
          }
        }
      ),
      { numRuns: 100 } // 렌더 PBT 는 컴포넌트 트리를 매번 새로 만들어 비용이 크다(7-14).
    );
  });
});

describe('c02-social-login — 취소는 실패가 아니다 (AC-S6 · 짝 단언 · 케이스 30)', () => {
  it('phase=cancelled 이면 취소 안내만 뜨고 에러 배너는 뜨지 않는다', () => {
    // 준비 + 실행
    renderScreen({ phase: 'cancelled', errorCode: null });

    // 단언 — 취소 안내는 뜨고, 실패 배너는 동시에 뜨지 않는다(§3-5 계약).
    expect(screen.getByTestId('auth-login-cancel-notice')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-login-error-banner')).toBeNull();
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
  });
});

/**
 * 비주얼·구조 가드 — 옛 SocialLoginScreen.visual.test.tsx (TRIP-162·592·648·932·1053·1056·1124).
 *
 * 픽셀은 jest 로 검증 불가(→ [검증] 단계 Figma 대조)라 다루지 않는다. 대신 className 이 렌더 트리에
 * 평문 prop 으로 남는다는 사실(NativeWind 의 CSS interop 은 jest 환경에서 소비되지 않는다)을 이용해
 * '어느 노드가 어느 토큰 클래스를 입었는지'와 'testID 가 어떤 순서로 나타나는지'를 렌더 결과에서 읽는다.
 * props·조건부 UI·문구·핸들러는 위 행위 describe 들이 잠근 계약이라 여기서는 className·구조만 본다.
 * 딤(AC-D1/D2)은 __mocks__/@gorhom/bottom-sheet.tsx 가 backdropComponent 를 실제로 렌더해서 성립한다.
 */
describe('비주얼 구조', () => {
  // 렌더된 노드의 className 을 공백으로 쪼갠 '토큰 배열'로 만든다. 배열 원소 일치(includes)로만
  // 비교하는 이유(02a §D5): 문자열 부분포함은 'text-primary-text'.includes('text-primary')가
  // true(오탐)지만, 토큰 배열 ['text-primary-text']에 'text-primary'는 원소로 없다 — 부분 문자열
  // 오탐을 구조적으로 없앤다. 'bg-scrim/40' 은 '/'를 품어도 공백이 없어 한 토큰으로 온전히 남는다.
  function classTokens(node: { props?: { className?: unknown } }): string[] {
    const cn = node.props?.className;
    return typeof cn === 'string' ? cn.trim().split(/\s+/).filter(Boolean) : [];
  }

  // toJSON 트리 노드(호스트 렌더 결과)의 최소 형태.
  type JsonNode = {
    props?: { testID?: unknown; className?: unknown; style?: unknown };
    children?: (JsonNode | string)[] | null;
  };

  // toJSON 을 전위(pre-order) 순회하며 testID 를 '등장 순서대로' 모은다. screen.root.findAll 을
  // 쓰지 않는 이유(02a ★D3 실측): findAll 은 합성(composite)+호스트 노드가 testID 를 이중으로
  // 실어 ['brand','brand',...]로 계수된다. toJSON 은 호스트 결과라 한 번씩만 나온다.
  function testIdOrder(): string[] {
    const acc: string[] = [];
    const walk = (n: JsonNode | string | null | undefined): void => {
      if (!n || typeof n === 'string') return;
      const tid = n.props?.testID;
      if (typeof tid === 'string') acc.push(tid);
      (n.children ?? []).forEach(walk);
    };
    const root = screen.toJSON() as unknown as JsonNode | JsonNode[] | null;
    if (Array.isArray(root)) root.forEach(walk);
    else walk(root);
    return acc;
  }

  // className 토큰으로 노드를 찾는다(testID 가 없는 로고/래퍼/grabber 를 잡을 때 — 신규 testID 를
  // 늘리지 않기 위해, 02a ★D9). 앵커가 0개면 뒤따르는 length 단언이 red 가 되어 조용한 통과가 없다.
  function nodesWithToken(token: string): JsonNode[] {
    const acc: JsonNode[] = [];
    const walk = (n: JsonNode | string | null | undefined): void => {
      if (!n || typeof n === 'string') return;
      if (classTokens(n).includes(token)) acc.push(n);
      (n.children ?? []).forEach(walk);
    };
    const root = screen.toJSON() as unknown as JsonNode | JsonNode[] | null;
    if (Array.isArray(root)) root.forEach(walk);
    else walk(root);
    return acc;
  }

  // 3시트 공통 셸을 iterate 로 검증하기 위한 서술자. 세 시트는 phase 로 상호배타라 한 번에 하나만
  // 열린다(딤·grabber 도 트리에 하나씩만 나타난다).
  const SHEETS: {
    name: string;
    override: Partial<Props>;
    containerId: string;
    ctaId: string;
    ctaLabel: string;
    cancelId: string | null;
  }[] = [
    {
      name: 'conflict',
      override: {
        phase: 'error',
        errorCode: 'SOCIAL_EMAIL_CONFLICT',
        conflictProvider: 'kakao',
      },
      containerId: 'auth-login-conflict-sheet',
      ctaId: 'auth-login-conflict-continue',
      ctaLabel: '카카오 로그인으로 계속',
      cancelId: 'auth-login-conflict-cancel',
    },
    {
      name: 'age-confirm',
      override: { phase: 'needs-age' },
      containerId: 'auth-age-sheet',
      ctaId: 'auth-age-sheet-confirm',
      ctaLabel: '네, 확인했어요',
      cancelId: 'auth-age-sheet-cancel',
    },
    {
      name: 'age-restriction',
      override: { phase: 'error', errorCode: 'AGE_NOT_MET' },
      containerId: 'auth-age-restriction',
      ctaId: 'auth-age-restriction-confirm',
      ctaLabel: '확인',
      cancelId: null,
    },
  ];

  // 이 화면이 직접 그리는 버튼은 3종이다. 애플 버튼은 컨테이너가 lazy 애플 모듈에서 받아 prop 으로
  // 꽂아 준다(TRIP-932 주입 경로). TRIP-1124 부터 그 버튼은 SDK 시스템 버튼이 아니라 직접 그린 HIG
  // 커스텀 버튼(로고 24 + "Apple로 계속하기")이지만, 여기서는 스텁이 꽂히므로 애플의 로고·제목·색은
  // LoginPage.apple.test.tsx(AC-Q3′)가 실물로 잠근다. 두 파일을 합쳐야 '4버튼 공통'이 된다.
  const CUSTOM_PROVIDERS = ['google', 'kakao', 'naver'] as const;

  // ── 동결 계약: 아이콘 글리프 존재 (AC-VS-5~6) ────────────────────────────────
  describe('c02-social-login 비주얼 구조 가드 (AC-VS-5~6)', () => {
    it.each(CUSTOM_PROVIDERS)(
      'AC-VS-5 %s 소셜 버튼 안에 브랜드 아이콘 SVG 가 렌더된다 — 텍스트 전용이 아니다',
      (provider) => {
        renderScreen();
        const button = screen.getByTestId(`auth-login-${provider}`);
        expect(
          within(button).getByTestId(`auth-login-${provider}-icon`)
        ).toBeOnTheScreen();
      }
    );

    it('AC-VS-6 브랜드 블록에 앱아이콘 글리프 SVG 가 렌더된다', () => {
      renderScreen();
      const brand = screen.getByTestId('auth-login-brand');
      expect(
        within(brand).getByTestId('auth-login-logo-glyph')
      ).toBeOnTheScreen();
    });
  });

  // Figma c02-social-login 확정 라벨 — AC-V1(전 버튼 웨이트)과 AC-V2(카카오 문구)가 함께 쓴다.
  const FIGMA_LABELS: Record<(typeof CUSTOM_PROVIDERS)[number], string> = {
    google: '구글로 계속하기',
    kakao: '카카오로 계속하기',
    naver: '네이버로 계속하기',
  };

  // ── 동결 계약: 라벨/배너 스타일 (AC-V1~V3) ───────────────────────────────────
  describe('AC-V1 · 소셜 버튼 라벨이 Figma Bold 22 조합을 쓴다 (렌더 · TRIP-1124 15→22)', () => {
    it.each(CUSTOM_PROVIDERS)(
      '%s 라벨이 font-noto-bold+font-bold+text-hero(22/29) 를 갖고, 옛 medium 조합·옛 15(text-card-title)는 없다',
      (provider) => {
        // ▸준비 — 무엇을 보장하나: 라벨이 Figma Bold 22 조합으로 렌더되고 옛 medium 조합이나
        // 옛 15 크기로 되돌아가지 않는다(HIG 제목:높이 43% 비례를 4버튼이 함께 지킨다, 결정 2-d).
        renderScreen();

        // ▸실행 — within(노드) 는 '이 노드 안에서만 찾는다'는 스코프 도구다.
        const button = screen.getByTestId(`auth-login-${provider}`);
        const label = within(button).getByText(FIGMA_LABELS[provider]);

        // ▸단언 — 여러 키를 한 객체로 묶어 toEqual 하면 실패 diff 에 어느 값이 빠졌는지
        // 한 번에 보인다.
        const tokens = classTokens(label);
        expect({
          family: tokens.includes('font-noto-bold'),
          weight: tokens.includes('font-bold'),
          oldFamily: tokens.includes('font-noto-medium'),
          oldWeight: tokens.includes('font-medium'),
          size: tokens.includes('text-hero'),
          oldSize: tokens.includes('text-card-title'),
          color: tokens.includes('text-ink'),
        }).toEqual({
          family: true,
          weight: true,
          oldFamily: false,
          oldWeight: false,
          size: true,
          oldSize: false,
          color: true,
        });
      }
    );
  });

  describe('AC-7 · 소셜 버튼 로고가 24×24 다 (렌더 · TRIP-1124 20→24)', () => {
    it.each(CUSTOM_PROVIDERS)(
      '%s 로고 SVG 가 width 24 · height 24 로 렌더된다',
      (provider) => {
        // ▸준비+실행 — 로고 크기는 Svg 의 width/height prop 으로 렌더 트리에 남는다(AC-L5 선례).
        renderScreen();
        const icon = screen.getByTestId(`auth-login-${provider}-icon`);

        // ▸단언
        expect({ width: icon.props.width, height: icon.props.height }).toEqual({
          width: 24,
          height: 24,
        });
      }
    );
  });

  describe('AC-V2 · 카카오 라벨 문구 — 한글이 뜨고 영문은 화면에서 사라진다 (렌더)', () => {
    it('카카오 버튼 라벨이 "카카오로 계속하기"로 나오고, "Kakao로 계속하기"는 화면 어디에도 없다', () => {
      // ▸준비
      renderScreen();
      const kakaoButton = screen.getByTestId('auth-login-kakao');

      // ▸실행+단언 — 긍정: getByText(문자열)은 완전 일치다(02a §D7).
      expect(
        within(kakaoButton).getByText('카카오로 계속하기')
      ).toBeOnTheScreen();

      // ▸단언 — 부정(짝): queryByText 는 못 찾으면 null 을 준다.
      expect(screen.queryByText('Kakao로 계속하기')).toBeNull();

      // ▸단언 — 모집단 앵커: 렌더 통째 실패가 '전부 null'로 공허하게 통과하는 것을 막는다.
      expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    });
  });

  describe('AC-Q3 · 화면은 애플 버튼 표면을 직접 그리지 않고 넘겨받은 버튼만 꽂는다 (TRIP-932 주입 경로 · TRIP-1124 재서술)', () => {
    it('애플 버튼을 받으면 래퍼 안에는 넘겨받은 버튼만 있고, 화면 자신은 애플 로고·"애플로 계속하기" 라벨을 그리지 않는다', () => {
      // ▸준비 + 실행 — iOS 모양.
      renderScreen({ AppleButton: StubAppleButton });

      // ▸단언 — 짝(존재): 래퍼 안에 넘겨받은 버튼이 있다. 이게 없으면 아래 부재 단언이 공허해진다.
      const apple = screen.getByTestId('auth-login-apple');
      expect(within(apple).getByTestId('stub-apple-button')).toBeOnTheScreen();

      // ▸단언 — 부재: 애플 로고·제목은 넘겨받은 버튼(appleAuthorize 소유)이 그린다. 화면이 자기
      // 손으로 애플 글리프나 음차 라벨을 그리면 스텁 옆에 나타나 여기서 걸린다.
      expect(within(apple).queryByTestId('auth-login-apple-icon')).toBeNull();
      expect(screen.queryByTestId('auth-login-apple-icon')).toBeNull();
      expect(screen.queryByText('애플로 계속하기')).toBeNull();
    });
  });

  // ── TRIP-1053: 커스텀 3버튼 테두리를 애플 공식 버튼(검은 1px)에 맞춘다 (AC-1 · AC-2) ──
  describe('AC-1 · 구글·카카오·네이버 테두리가 ink 1px 이다 (TRIP-1053)', () => {
    it.each(CUSTOM_PROVIDERS)(
      '%s 버튼의 테두리 토큰이 정확히 border·border-ink 둘이다 — 옛 border-[1.5px]·border-hairline-strong 은 없다',
      (provider) => {
        // ▸준비+실행
        renderScreen();
        const tokens = classTokens(
          screen.getByTestId(`auth-login-${provider}`)
        );
        // 테두리 토큰만 거른다. 'border'(두께 1px)는 접두어 'border-' 로 안 잡혀 두 조건이 다 필요하다.
        const borderTokens = tokens.filter(
          (t) => t === 'border' || t.startsWith('border-')
        );

        // ▸단언 — 정렬 후 비교(className 안 순서는 계약이 아니다). 옛 토큰이 섞여 남으면 어느 쪽이
        // 이길지 jest 가 모르므로 '정확히 이 둘'을 잠근다.
        expect([...borderTokens].sort()).toEqual(['border', 'border-ink']);
      }
    );

    it.each(CUSTOM_PROVIDERS)(
      '%s 버튼이 높이 52·rounded-button·bg-canvas 를 유지한다 (AC-2 무회귀)',
      (provider) => {
        // ▸준비+실행
        renderScreen();
        const tokens = classTokens(
          screen.getByTestId(`auth-login-${provider}`)
        );

        // ▸단언 — arrayContaining 은 부분집합 검사(셋이 다 있으면 통과, 순서·여분 무관).
        expect(tokens).toEqual(
          expect.arrayContaining(['h-[52px]', 'rounded-button', 'bg-canvas'])
        );
      }
    );
  });

  // TRIP-592(→ C안)은 파스텔 채움(bg-primary-pale)을 폐기하고 카드 없는 배경 없는 인라인으로 갔다.
  // **TRIP-648 계약 교체**: 그 폼의 '코랄 원 아이콘 배지(⚠)'까지 제거한다 — 사용자 실기 관측 + Figma
  // 대조로 에러 배너는 아이콘 없는 텍스트-온리 인라인이 정본이 됐다. 아래 두 it 은 폐기 토큰의 '부재'
  // (pale·보더·캔버스채움 카드) + 아이콘 배지의 '부재' + ink 텍스트의 '존재'를 잠근다. 뮤테이션:
  // 배지(auth-login-error-icon-badge)를 되살리면 noIconBadge 가 깨져 red(아이콘 재등장 트립와이어).
  describe('AC-V3 · 에러 배너가 카드·아이콘 없는 텍스트 인라인이다 (렌더 · TRIP-648 계약 교체)', () => {
    it('배너가 카드(pale·보더·캔버스채움) 없는 인라인이고, 경고 아이콘 배지가 없다', () => {
      // ▸준비 — overrides 로 error phase 를 연다.
      renderScreen({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });

      // ▸실행 — 배너 컨테이너(앵커) + 그 안에서 아이콘 배지를 queryBy 로 찾는다(부재는 queryBy — getBy 는 못 찾으면 throw).
      const banner = screen.getByTestId('auth-login-error-banner');
      const bannerTokens = classTokens(banner);

      // ▸단언 — 카드 토큰 3종 부재 + 아이콘 배지 부재. 배너 자체는 앵커로 존재(공허 통과 차단).
      expect({
        noPaleFill: bannerTokens.includes('bg-primary-pale'),
        noOutline: bannerTokens.includes('border-primary'),
        noCardBg: bannerTokens.includes('bg-canvas'),
        noIconBadge:
          within(banner).queryByTestId('auth-login-error-icon-badge') !== null,
      }).toEqual({
        noPaleFill: false,
        noOutline: false,
        noCardBg: false,
        noIconBadge: false,
      });
    });

    it('배너 텍스트가 text-ink 를 갖고 폐기된 text-primary-text 는 없다 (문구·웨이트·크기는 유지)', () => {
      // ▸준비 — Q2 결정: 단일 문구(ERROR_COPY)를 유지한다(2줄 분할 금지 — 동결 toHaveTextContent 파손 방지).
      renderScreen({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });

      // ▸실행 — 배너 안 텍스트 노드(1개). getByText(문자열)은 완전 일치(§D7)라 '단일 문구 유지'를 함께 잠근다.
      const banner = screen.getByTestId('auth-login-error-banner');
      const text = within(banner).getByText(ERROR_COPY);
      const textTokens = classTokens(text);

      // ▸단언 — 뉴트럴 ink 채택 + primary-text 폐기, 웨이트/크기 회귀 방지.
      // 'text-ink' 와 'text-primary-text' 는 서로 다른 토큰이라 겹오탐이 없다(§D5, 02a §5 실측).
      expect({
        color: textTokens.includes('text-ink'),
        noPaleText: textTokens.includes('text-primary-text'),
        family: textTokens.includes('font-noto-bold'),
        weight: textTokens.includes('font-bold'),
        size: textTokens.includes('text-label'),
      }).toEqual({
        color: true,
        noPaleText: false,
        family: true,
        weight: true,
        size: true,
      });
    });
  });

  // ── 신규: 레이아웃 구조 (AC-L1/L4 — L2 는 TRIP-1056 AC-6 으로 교체) ────────────────────────────────────────
  describe('AC-L1 · 루트는 상단정렬 컨테이너다 (렌더)', () => {
    it('루트 className 토큰에 justify-center·justify-between 이 없다 — 로고가 튀는 가운데 정렬 위반 차단', () => {
      // ▸준비+실행
      renderScreen();
      const tokens = classTokens(screen.getByTestId('auth-login-root'));

      // ▸단언 — 짝: 상단정렬 토큰 2종의 부재. (앵커는 루트 존재 자체.)
      expect({
        center: tokens.includes('justify-center'),
        between: tokens.includes('justify-between'),
      }).toEqual({ center: false, between: false });
    });
  });

  // ── TRIP-1056: 취소 안내·실패 배너가 버튼을 밀지 않는다 (AC-5 · AC-6) ─────────
  // 옛 AC-L2(brand → error-banner → google → terms)는 배너를 버튼 '위'에 굳히고 있었다 — 그 자리가
  // 버튼을 아래로 미는 원인이라 AC-6 으로 계약을 교체했다(terms 는 TRIP-1053 에서 삭제).
  // jest 사각: 좌표는 못 본다. AC-5 는 "버튼 위에 끼는 노드가 없다"는 대리 관측이라, 노드 없이
  // 조건부 여백(pt-*/mt-*)으로 버튼을 미는 회귀는 6-b 실기에서만 잡힌다.

  // 트리 순서에서 첫 소셜 버튼(google) '앞'에 오는 testID 만 자른다.
  function idsBeforeGoogle(): string[] {
    const ids = testIdOrder();
    // 앵커 — google 이 없으면 indexOf 가 -1 이고 slice(0, -1) 이 엉뚱한 배열을 준다.
    expect(ids).toContain('auth-login-google');
    return ids.slice(0, ids.indexOf('auth-login-google'));
  }

  // 루트(auth-login-root)의 직계 자식 노드들. testIdOrder 는 깊이를 무시하므로, "래퍼 밖 형제"는
  // 이것으로 따로 잰다.
  function rootChildren(): JsonNode[] {
    const find = (n: JsonNode | string | null | undefined): JsonNode | null => {
      if (!n || typeof n === 'string') return null;
      if (n.props?.testID === 'auth-login-root') return n;
      for (const c of n.children ?? []) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const tree = screen.toJSON() as unknown as JsonNode | JsonNode[] | null;
    const root = Array.isArray(tree)
      ? (tree.map(find).find(Boolean) ?? null)
      : find(tree);
    return (root?.children ?? []).filter(
      (c): c is JsonNode => typeof c !== 'string'
    );
  }

  describe('AC-5 · 취소·실패 상태에서도 버튼 위에 끼어드는 노드가 없다 (TRIP-1056)', () => {
    it('idle·cancelled·error 세 상태에서 google 버튼 앞의 testID 목록과 루트 안 버튼 래퍼 자리가 같다', () => {
      // testID 목록만 비교하면 testID 없는 노드(스페이서·맨 Text)가 버튼 위에 끼어도 green 이다
      // (5-b 경고-1 M1·M2). 그래서 "루트의 몇 번째 자식이 버튼 래퍼인가"(구조 인덱스)도 함께 잰다.
      const wrapperIndex = (): number => {
        const idx = rootChildren().findIndex((k) =>
          classTokens(k).includes('gap-md')
        );
        // 앵커 — 래퍼를 못 찾으면 -1 끼리 같아져 공허 통과한다.
        expect(idx).toBeGreaterThanOrEqual(0);
        return idx;
      };

      // ▸준비+실행 — 한 it 안에서 세 번 렌더한다. screen 은 늘 마지막 렌더를 가리킨다(02a ★6).
      renderScreen();
      const idle = { ids: idsBeforeGoogle(), wrapperAt: wrapperIndex() };
      renderScreen({ phase: 'cancelled' });
      const cancelled = { ids: idsBeforeGoogle(), wrapperAt: wrapperIndex() };
      renderScreen({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });
      const error = { ids: idsBeforeGoogle(), wrapperAt: wrapperIndex() };

      // ▸단언 — 버튼 위에 무엇이든(이름표 유무 무관) 끼면 그 상태의 목록 또는 래퍼 자리가 달라진다.
      expect({ cancelled, error }).toEqual({ cancelled: idle, error: idle });
    });
  });

  describe('AC-6 · 취소 안내·실패 배너는 버튼 묶음 뒤 형제다 (TRIP-1056 · AC-L2 교체)', () => {
    it.each([
      {
        name: 'cancelled',
        override: { phase: 'cancelled' },
        noticeId: 'auth-login-cancel-notice',
      },
      {
        name: 'error',
        override: { phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' },
        noticeId: 'auth-login-error-banner',
      },
    ] as { name: string; override: Partial<Props>; noticeId: string }[])(
      '$name: brand → 소셜 버튼 → $noticeId 순서이고, 안내는 버튼 래퍼 밖(루트 직계)에서 래퍼 뒤에 온다',
      ({ override, noticeId }) => {
        // ▸준비+실행
        renderScreen(override);
        const WATCH = [
          'auth-login-brand',
          'auth-login-google',
          'auth-login-kakao',
          'auth-login-naver',
          noticeId,
        ];
        const order = testIdOrder().filter((t) => WATCH.includes(t));
        const kids = rootChildren();
        // 버튼 래퍼는 testID 가 없어 gap-md 토큰으로 잡는다(AC-L4 와 같은 앵커).
        const wrapperIdx = kids.findIndex((k) =>
          classTokens(k).includes('gap-md')
        );
        const noticeIdx = kids.findIndex((k) => k.props?.testID === noticeId);

        // ▸단언 — 순서(로고 → 버튼 → 안내).
        expect(order).toEqual([
          'auth-login-brand',
          'auth-login-google',
          'auth-login-kakao',
          'auth-login-naver',
          noticeId,
        ]);
        // ▸단언 — 위치: 래퍼 안이면 루트 직계가 아니고, 래퍼 앞이면 인덱스가 작다.
        expect({
          wrapperFound: wrapperIdx >= 0,
          noticeIsRootChild: noticeIdx >= 0,
          noticeAfterWrapper: noticeIdx > wrapperIdx,
        }).toEqual({
          wrapperFound: true,
          noticeIsRootChild: true,
          noticeAfterWrapper: true,
        });
      }
    );
  });

  describe('AC-L4 · 회귀 토큰 유지 (렌더)', () => {
    // TRIP-598: 앱아이콘 확대로 로고 박스 동결값이 h-14 w-14(56px) → h-[72px] w-[72px] 로
    // 갱신됐다(후속 회차 64→72 재확대). AC-L4 는 로고 박스를 '트리에서 유일한 크기 토큰
    // 노드'로 잡으므로, 확대 시 이 동결 토큰도 함께 갱신하지 않으면 앵커(nodesWithToken)가
    // 0개가 되어 logoOne 이 red 다.
    it('루트 px-2xl · 로고 박스 72×72(style) · 소셜버튼 h-[52px] · 버튼 래퍼 gap-md 가 유지된다', () => {
      // ▸준비+실행
      renderScreen();
      const rootTokens = classTokens(screen.getByTestId('auth-login-root'));
      const buttonTokens = classTokens(screen.getByTestId('auth-login-google'));
      // 로고 박스는 testID 로 잡고 크기는 style width/height 로 잰다 — LinearGradient 는 className
      // 크기를 안 먹어 박스가 글리프(43px)로 접혔던 회귀(TRIP-648)를 style 값으로 못박는다.
      const logoBox = screen.getByTestId('auth-login-logo-box');
      const wrappers = nodesWithToken('gap-md');

      // ▸단언 — 한 객체로 묶어 어느 회귀가 깨졌는지 한 번에 본다.
      expect({
        rootPad: rootTokens.includes('px-2xl'),
        buttonHeight: buttonTokens.includes('h-[52px]'),
        logoWidth: styleNumber(logoBox, 'width'),
        logoHeight: styleNumber(logoBox, 'height'),
        wrapperOne: wrappers.length === 1,
      }).toEqual({
        rootPad: true,
        buttonHeight: true,
        logoWidth: 72,
        logoHeight: 72,
        wrapperOne: true,
      });
    });
  });

  // ── 신규(TRIP-598): 앱아이콘 라운드 클립 + 확대 형태 가드 (AC-L5) ─────────────
  // jest 사각 주의 — 그라디언트가 '실제로' 모서리에서 클립되는지·확대 픽셀이 눈에 얼마나
  // 큰지는 jest 가 원리적으로 못 본다(6-b 실기/프리뷰 몫). 아래는 그 회귀를 굳히는 '형태
  // 가드'다: ① 반경이 className(rounded-button)이 아니라 style(borderRadius)로 주어졌는가
  // — LinearGradient 는 className 반경으로 그라디언트를 클립하지 않아 각지므로, style 로 주는
  // 것이 각짐 회귀를 막는 계약이다. ② 박스가 56px 를 넘겨 확대됐고 글리프가 비율 0.6 을 유지.

  // 노드의 style prop 에서 숫자 필드를 뽑는다. RN style 은 단일 객체일 수도 배열일 수도 있어
  // flat(Infinity)로 평탄화한 뒤 첫 매치를 반환한다(없으면 undefined). 로고 박스 크기·반경이
  // className 이 아니라 style 로 굳는 것을 검증하는 데 쓴다(TRIP-648 — LinearGradient 는
  // NativeWind className 크기를 안 먹어 style 이 유일한 실제 계약).
  function styleNumber(
    node: { props?: { style?: unknown } },
    key: string
  ): number | undefined {
    const flat = [node.props?.style].flat(Infinity) as Array<
      Record<string, unknown> | null | undefined
    >;
    for (const s of flat) {
      if (s && typeof s === 'object' && typeof s[key] === 'number') {
        return s[key] as number;
      }
    }
    return undefined;
  }

  function styleBorderRadius(node: {
    props?: { style?: unknown };
  }): number | undefined {
    return styleNumber(node, 'borderRadius');
  }

  describe('AC-L5 · 앱아이콘 라운드 클립 + 확대 (렌더 · 형태 가드)', () => {
    it('박스 반경을 style borderRadius 로 주고 rounded-button className 은 안 쓴다 (각짐 회귀 차단)', () => {
      // ▸준비+실행 — 박스는 testID 로 잡는다(TRIP-648).
      renderScreen();
      const box = screen.getByTestId('auth-login-logo-box');

      // ▸단언 — style 에 borderRadius 존재 + className 에 rounded-button 부재.
      expect({
        hasStyleRadius: typeof styleBorderRadius(box) === 'number',
        noClassNameRadius: !classTokens(box).includes('rounded-button'),
      }).toEqual({ hasStyleRadius: true, noClassNameRadius: true });
    });

    it('박스 반경 값이 라운드 스퀘어 비율(0.2227×72≈16.03)을 지킨다 — 값 회귀 차단', () => {
      // ▸준비+실행 — AC-L5-1 의 hasStyleRadius 는 borderRadius 가 '숫자로 존재하나'만 본다.
      // 값이 틀려도(4=거의 각짐 · 30=거의 원) 그 가드는 green 이므로, AC-4(반경/박스=0.223)를
      // 실제로 잠그려면 값을 못박아야 한다. 16.03 은 박스 72·글리프 43 과 한 비율 세트라,
      // 6-b 에서 박스 크기를 바꾸면 이 값도 h-[72px]·size 43 과 함께 갱신한다.
      renderScreen();
      const box = screen.getByTestId('auth-login-logo-box');

      expect(styleBorderRadius(box)).toBe(16.03);
    });

    it('박스가 56px 를 넘겨 확대되고 글리프가 비율 0.6(size 43)을 유지한다', () => {
      // ▸준비+실행 — 글리프 size 는 Svg width prop, 박스 크기는 style width 로 렌더 트리에 남는다.
      renderScreen();
      const glyph = screen.getByTestId('auth-login-logo-glyph');
      const box = screen.getByTestId('auth-login-logo-box');

      // ▸단언 — 박스 style 72px 확대(56 초과) + 글리프 width=43(72×0.6≈43, 비율 유지).
      expect({
        boxWidth: styleNumber(box, 'width'),
        enlargedOver56: (styleNumber(box, 'width') ?? 0) > 56,
        glyphSize: glyph.props.width,
      }).toEqual({ boxWidth: 72, enlargedOver56: true, glyphSize: 43 });
    });
  });

  // ── 신규: 딤 backdrop (AC-D1/D2) ─────────────────────────────────────────────
  describe('AC-D1 · 시트가 열리면 딤(backdrop)이 전면 스크림으로 깔린다 (렌더 · 목 확장 선행)', () => {
    it.each(SHEETS)(
      '$name 시트가 열리면 auth-sheet-backdrop 이 렌더되고 bg-scrim/40 을 입는다',
      ({ override }) => {
        // ▸준비 — 각 phase 로 시트를 연다.
        renderScreen(override);

        // ▸실행 — 딤 노드(화면이 backdropComponent 로 넘긴 커스텀 딤).
        const backdrop = screen.getByTestId('auth-sheet-backdrop');

        // ▸단언 — 존재 + 스크림 토큰.
        expect(backdrop).toBeOnTheScreen();
        expect(classTokens(backdrop)).toContain('bg-scrim/40');
      }
    );
  });

  describe('AC-D2 · 시트가 없으면 딤도 없다 (부재 짝)', () => {
    it('idle 에는 auth-sheet-backdrop 이 없다', () => {
      // ▸준비+실행
      renderScreen();

      // ▸단언 — 부재 + 루트 존재 앵커(공허한 통과 방지).
      expect(screen.queryByTestId('auth-sheet-backdrop')).toBeNull();
      expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    });
  });

  // ── 신규: 시트 셸 치수/위계 (AC-S1~S4) ──────────────────────────────────────
  describe('AC-S1 · 시트 컨테이너 공통 셸 토큰 (3시트)', () => {
    it.each(SHEETS)(
      '$name 컨테이너가 px-[22px]·pb-[26px]·gap-[14px]·rounded-sheet-top 를 갖는다',
      ({ override, containerId }) => {
        // ▸준비+실행
        renderScreen(override);
        const tokens = classTokens(screen.getByTestId(containerId));

        // ▸단언 — 간격 14 균일은 gap-[14px] 단일 값이 보장한다.
        expect({
          px: tokens.includes('px-[22px]'),
          pb: tokens.includes('pb-[26px]'),
          gap: tokens.includes('gap-[14px]'),
          round: tokens.includes('rounded-sheet-top'),
        }).toEqual({ px: true, pb: true, gap: true, round: true });
      }
    );
  });

  describe('AC-S2 · grabber 40×5 pill (3시트)', () => {
    it.each(SHEETS)(
      '$name 시트에 w-[40px]·h-[5px]·bg-hairline-strong·rounded-pill grabber 가 있다',
      ({ override }) => {
        // ▸준비+실행
        renderScreen(override);

        // ▸실행 — grabber 는 시트 내 유일한 pill 노드로 앵커한다(신규 testID 없이).
        const grabbers = nodesWithToken('rounded-pill');

        // ▸단언 — 앵커(정확히 1개) + 4토큰.
        expect(grabbers).toHaveLength(1);
        const tokens = classTokens(grabbers[0]);
        expect({
          w: tokens.includes('w-[40px]'),
          h: tokens.includes('h-[5px]'),
          color: tokens.includes('bg-hairline-strong'),
          pill: tokens.includes('rounded-pill'),
        }).toEqual({ w: true, h: true, color: true, pill: true });
      }
    );
  });

  describe('AC-S3 · CTA 는 filled primary 다 — 아웃라인이면 위반 (3시트)', () => {
    it.each(SHEETS)(
      '$name CTA 가 h-[52px]·bg-primary·rounded-button 이고 테두리가 없으며, 텍스트가 흰 볼드다',
      ({ override, ctaId, ctaLabel }) => {
        // ▸준비+실행
        renderScreen(override);
        const cta = screen.getByTestId(ctaId);
        const ctaTokens = classTokens(cta);
        const text = within(cta).getByText(ctaLabel);
        const textTokens = classTokens(text);

        // ▸단언 — 컨테이너(채움+라운드+높이, 테두리 부재) + 텍스트(흰 볼드).
        // 테두리 부재는 접두어로 잰다: bg-primary 존재만으로는 '테두리+채움 동시'를 못 막는다.
        expect({
          height: ctaTokens.includes('h-[52px]'),
          filled: ctaTokens.includes('bg-primary'),
          round: ctaTokens.includes('rounded-button'),
          bordered: ctaTokens.some((t) => t.startsWith('border-')),
          textColor: textTokens.includes('text-on-primary'),
          textWeight: textTokens.includes('font-bold'),
        }).toEqual({
          height: true,
          filled: true,
          round: true,
          bordered: false,
          textColor: true,
          textWeight: true,
        });
      }
    );
  });

  describe('AC-S4 · 취소 버튼 h-[44px] (취소 있는 2시트)', () => {
    it.each(SHEETS.filter((s) => s.cancelId !== null))(
      '$name 취소 버튼이 h-[44px] 다',
      ({ override, cancelId }) => {
        // ▸준비+실행
        renderScreen(override);
        const tokens = classTokens(screen.getByTestId(cancelId as string));

        // ▸단언
        expect(tokens).toContain('h-[44px]');
      }
    );
  });
});
