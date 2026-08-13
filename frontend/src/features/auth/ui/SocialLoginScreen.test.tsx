import type { ComponentProps } from 'react';
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
  it('브랜드와 소셜 4버튼(구글·애플·카카오·네이버)·약관 안내를 렌더한다', () => {
    renderScreen();
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-brand')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-google')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-apple')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-kakao')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-naver')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-terms')).toBeOnTheScreen();
  });

  it('이메일 회원가입 버튼·디바이더는 렌더하지 않는다 (§10 결정: 숨김)', () => {
    renderScreen();
    expect(screen.queryByTestId('auth-login-signup')).toBeNull();
    expect(screen.queryByTestId('auth-login-divider')).toBeNull();
  });

  it('소셜 버튼 testID 는 {feature}-{screen}-{role} 규약을 따른다 (AC-ONB-01-12)', () => {
    renderScreen();
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

  it('어떤 요소도 소요시간(duration)을 표시하지 않는다 (INV-3, AC-ONB-01-11)', () => {
    renderScreen();
    expect(screen.queryByText(/소요\s*시간|duration/i)).toBeNull();
  });
});

describe('c02-social-login — 취소 안내 (AC-ONB-01-4)', () => {
  it('phase=cancelled 이면 "로그인이 취소되었습니다" 토스트를 표시한다', () => {
    renderScreen({ phase: 'cancelled' });
    const notice = screen.getByTestId('auth-login-cancel-notice');
    expect(notice).toBeOnTheScreen();
    expect(screen.getByText('로그인이 취소되었습니다')).toBeOnTheScreen();
  });
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
    // 준비 + 실행
    const props = renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_AUTH_FAILED',
    });

    // 단언 — 배너 유무와 무관하게 버튼은 항상 렌더되고 탭이 그대로 전달된다.
    (['google', 'apple', 'kakao', 'naver'] as const).forEach((provider) => {
      expect(screen.getByTestId(`auth-login-${provider}`)).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByTestId('auth-login-google'));
    expect(props.onSignIn).toHaveBeenCalledWith('google');
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
