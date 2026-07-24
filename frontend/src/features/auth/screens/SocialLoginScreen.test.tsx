import type { ComponentProps } from 'react';
import fc from 'fast-check';
import {
  cleanupAsync,
  fireEvent,
  render,
  screen,
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

// §3-5 문구 계약 — 배너 안 텍스트 총합이 정확히 이 문자열이어야 한다(완전 일치, §8 실검증).
const ERROR_COPY = '로그인에 실패했어요. 잠시 후 다시 시도해 주세요';

// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 통과 컴포넌트로 목킹한다.
// 목 본체는 __mocks__/@gorhom/bottom-sheet.tsx (수동 목) 에 있다 — 인라인 팩토리로 두면
// NativeWind babel 의 _ReactNativeCSSInterop 주입이 out-of-scope 로 걸리기 때문이다.
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

describe('c02-social-login — 이메일 충돌 바텀시트 (AC-ONB-01-6)', () => {
  it('SOCIAL_EMAIL_CONFLICT + 기존 provider 있으면 시트 제목·기존 provider 안내·CTA 를 표시한다', () => {
    const props = renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: '카카오',
    });
    expect(screen.getByTestId('auth-login-conflict-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-login-conflict-title')).toHaveTextContent(
      '이미 가입된 계정이에요'
    );
    expect(screen.getByText(/카카오/)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('auth-login-conflict-continue'));
    expect(props.onConflictContinue).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('auth-login-conflict-cancel'));
    expect(props.onConflictCancel).toHaveBeenCalledTimes(1);
  });

  it('기존 provider 필드가 없으면 일반 문구로 폴백한다 (§10)', () => {
    renderScreen({
      phase: 'error',
      errorCode: 'SOCIAL_EMAIL_CONFLICT',
      conflictProvider: null,
    });
    expect(
      screen.getByText('다른 방법으로 가입된 계정이에요')
    ).toBeOnTheScreen();
  });
});

describe('c02-social-login — 연령확인·연령 제한 (AC-ONB-01-7)', () => {
  it('phase=needs-age 이면 만 14세 확인 바텀시트를 표시하고 확인 시 onAgeConfirm 을 호출한다 (SELF_DECLARED)', () => {
    const props = renderScreen({ phase: 'needs-age' });
    expect(screen.getByTestId('auth-age-sheet')).toBeOnTheScreen();
    expect(screen.getByText(/만\s*14세/)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('auth-age-sheet-confirm'));
    expect(props.onAgeConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('auth-age-sheet-cancel'));
    expect(props.onAgeCancel).toHaveBeenCalledTimes(1);
  });

  it('phase=error·AGE_NOT_MET 이면 연령 제한 안내를 표시한다 (계정 미생성)', () => {
    renderScreen({ phase: 'error', errorCode: 'AGE_NOT_MET' });
    expect(screen.getByTestId('auth-age-restriction')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-login-conflict-sheet')).toBeNull();
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
      // 완전 일치다(§8 실검증) — 배너 안 텍스트 총합이 정확히 ERROR_COPY 와 같아야 한다.
      // VALIDATION_ERROR·AGE_REQUIREMENT_NOT_MET·UPSTREAM_UNAVAILABLE·INTERNAL·NETWORK_ERROR
      // 5종은 지금 배너가 아예 안 떠서 실패하고, SOCIAL_AUTH_FAILED·RATE_LIMITED 2종은 이미 통과.
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
      // 문자열 인자는 완전 일치라 이런 형태를 놓친다, §8).
      expect(screen.queryByText(new RegExp(code))).toBeNull();
    }
  );
});

describe('c02-social-login — PBT: 어떤 에러코드에서도 침묵하지 않는다 (AC-S6 · INV-4 · 케이스 29)', () => {
  it('임의 문자열·null errorCode 에서도 배너·연령제한·충돌시트 중 최소 하나는 항상 뜬다', async () => {
    // §8 실검증 추가 발견(02a 원안은 동기 fc.property + 동기 cleanup() 이었으나 실행해보니
    // "Can't access .root on unmounted test renderer" 로 깨졌다 — RNTL 의 동기 cleanup() 은
    // 내부적으로 unmountAsync() 를 fire-and-forget 으로만 걸고 완료를 기다리지 않는다
    // (build/cleanup.js 실측). 같은 tick 안에서 다음 render() 가 바로 이어지면 언마운트가
    // 끝나기 전에 새 렌더러를 만들어 리액트 테스트 렌더러 상태가 꼬인다. 그래서 predicate 를
    // fc.asyncProperty 로 바꾸고 cleanupAsync() 를 await 해 순서를 보장한다.
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.string(), { nil: null }),
        async (errorCode) => {
          // PBT 안에서 render 를 반복하므로 실행마다 cleanup 이 필수다(RNTL 자동 정리는
          // it 단위라 이전 트리가 남아 getByTestId 가 중복 매칭으로 터진다, 7-13).
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
