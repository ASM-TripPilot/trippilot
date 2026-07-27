import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react-native';

import { SocialLoginScreen } from './SocialLoginScreen';

// 이 파일은 '비주얼 구조 가드'다. 픽셀은 jest 로 검증 불가(→ [검증] 단계 Figma 대조)라
// 다루지 않는다. 대신 className 이 렌더 트리에 평문 prop 으로 남는다는 사실(NativeWind 의
// CSS interop 은 jest 환경에서 소비되지 않는다, 02a §7-5 실측)을 이용해 '어느 노드가 어느
// 토큰 클래스를 입었는지'를 렌더 결과에서 직접 읽는다.
//
// 계약 동결: 이 파일은 '새 아이콘 testID 존재'(AC-VS-5~6)와 '비주얼 구조 가드'(AC-V1~V3,
// TRIP-173 FSD 완결 4/4: 로그인 화면 Figma 정합)만 본다. props 8개·조건부 UI 가 언제
// 뜨는지·기존 testID 는 SocialLoginScreen.test.tsx 가 잠근 행위 계약이므로 여기서 건드리지
// 않는다(약화·중복 금지) — 여기서 추가하는 것은 스타일(className) 단언뿐이고 동작 단언이
// 아니다.
//
// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 수동 목으로 대체한다
// (기존 테스트와 동일 규약: __mocks__/@gorhom/bottom-sheet.tsx). react-native-svg·
// expo-linear-gradient 는 미설치라 이 파일에서 직접 import 하지 않는다.
jest.mock('@gorhom/bottom-sheet');

type Props = ComponentProps<typeof SocialLoginScreen>;

// idle 이 기본값이고, AC-V3(에러 배너 스타일)처럼 다른 phase 가 필요한 케이스만 overrides 로
// 연다 — 기본값 객체 자체는 바꾸지 않고 스프레드 뒤에 ...overrides 만 붙인다
// (SocialLoginScreen.test.tsx 의 renderScreen 과 같은 형태).
function renderDefault(overrides: Partial<Props> = {}) {
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
}

// 렌더된 노드의 className 을 공백으로 쪼갠 '토큰 배열'로 만든다. 배열 원소 일치(includes)로만
// 비교하는 이유: 문자열 부분포함(includes)은 'text-primary-text'.includes('text-primary')가
// true(오탐, 02a §6-4 실측)지만, 토큰 배열 ['text-primary-text']에 'text-primary'는 원소로
// 없다 — 부분 문자열 오탐을 구조적으로 없앤다.
function classTokens(node: { props: { className?: string } }): string[] {
  return (node.props.className ?? '').trim().split(/\s+/);
}

describe('c02-social-login 비주얼 구조 가드 (AC-VS-5~6 · 신규 실패 테스트)', () => {
  it.each(['google', 'apple', 'kakao', 'naver'])(
    'AC-VS-5 %s 소셜 버튼 안에 브랜드 아이콘 SVG 가 렌더된다 — 텍스트 전용이 아니다',
    (provider) => {
      // 준비: 기본 상태로 렌더하고 해당 provider 의 버튼(기존 계약 testID)을 잡는다.
      renderDefault();
      const button = screen.getByTestId(`auth-login-${provider}`);
      // 실행+단언: 버튼 안에 브랜드 아이콘 SVG(신규 testID)가 중첩돼야 한다.
      // (현재는 라벨 텍스트만 → 아이콘 없음 → red)
      expect(
        within(button).getByTestId(`auth-login-${provider}-icon`)
      ).toBeOnTheScreen();
    }
  );

  it('AC-VS-6 브랜드 블록에 앱아이콘 글리프 SVG 가 렌더된다', () => {
    // 준비: 기본 상태로 렌더하고 브랜드 블록(기존 계약 testID)을 잡는다.
    renderDefault();
    const brand = screen.getByTestId('auth-login-brand');
    // 실행+단언: 브랜드 블록 안에 앱아이콘 글리프 SVG(신규 testID)가 중첩돼야 한다.
    // (현재는 타이틀 텍스트만 → 글리프 없음 → red)
    expect(
      within(brand).getByTestId('auth-login-logo-glyph')
    ).toBeOnTheScreen();
  });
});

// Figma c02-social-login 확정 라벨(01 §2-3) — AC-V1(전 버튼 웨이트)과 AC-V2(카카오 문구)가
// 함께 쓴다.
const FIGMA_LABELS: Record<'google' | 'apple' | 'kakao' | 'naver', string> = {
  google: '구글로 계속하기',
  apple: '애플로 계속하기',
  kakao: '카카오로 계속하기',
  naver: '네이버로 계속하기',
};

describe('AC-V1 · 소셜 버튼 라벨이 Figma Bold 조합을 쓴다 (렌더)', () => {
  it.each(['google', 'apple', 'kakao', 'naver'] as const)(
    '%s 라벨이 font-noto-bold+font-bold 를 갖고, 옛 medium 조합(font-noto-medium+font-medium)은 없다',
    (provider) => {
      // ▸준비 — 무엇을 보장하나: 라벨이 Figma Bold 조합으로 렌더되고 옛 medium 조합으로
      // 되돌아가지 않는다.
      renderDefault();

      // ▸실행 — within(노드) 는 '이 노드 안에서만 찾는다'는 스코프 도구다. 버튼 안에서
      // 찾으므로 다른 버튼의 라벨과 섞이지 않는다.
      // (kakao 행은 AC-V2 가 아직 안 되면 '카카오로 계속하기' 노드를 못 찾아 여기서부터
      // 실패한다 — 우연이 아니라 같은 Figma 계약의 양면이다, 02a §5-1.)
      const button = screen.getByTestId(`auth-login-${provider}`);
      const label = within(button).getByText(FIGMA_LABELS[provider]);

      // ▸단언 — 여러 키를 한 객체로 묶어 toEqual 하면 실패 diff 에 어느 값이 빠졌는지
      // 한 번에 보인다(줄을 나누면 첫 실패에서 죽어 나머지 상태를 못 본다).
      const tokens = classTokens(label);
      expect({
        family: tokens.includes('font-noto-bold'),
        weight: tokens.includes('font-bold'),
        oldFamily: tokens.includes('font-noto-medium'),
        oldWeight: tokens.includes('font-medium'),
        size: tokens.includes('text-card-title'),
        color: tokens.includes('text-ink'),
      }).toEqual({
        family: true,
        weight: true,
        oldFamily: false,
        oldWeight: false,
        size: true,
        color: true,
      });
    }
  );
});

describe('AC-V2 · 카카오 라벨 문구 — 한글이 뜨고 영문은 화면에서 사라진다 (렌더)', () => {
  it('카카오 버튼 라벨이 "카카오로 계속하기"로 나오고, "Kakao로 계속하기"는 화면 어디에도 없다', () => {
    // ▸준비
    renderDefault();
    const kakaoButton = screen.getByTestId('auth-login-kakao');

    // ▸실행+단언 — 긍정: getByText(문자열)은 완전 일치다(부분 포함이 아니다, 02a §7-2
    // 실측). 카카오 버튼 안에서 한글 라벨을 찾는다.
    expect(
      within(kakaoButton).getByText('카카오로 계속하기')
    ).toBeOnTheScreen();

    // ▸단언 — 부정(긍정과 같은 it 안에서 짝을 이룬다): queryByText 는 못 찾으면 던지지
    // 않고 null 을 준다 — '있으면 안 된다'를 잴 때 쓰는 짝이다. 화면 전역으로 봐서
    // 라벨이 다른 버튼으로 옮겨 살아남는 경우까지 막는다.
    expect(screen.queryByText('Kakao로 계속하기')).toBeNull();

    // ▸단언 — 모집단 앵커: 렌더가 통째로 실패해 위 두 단언이 '전부 null'로 공허하게
    // 통과하는 것을 막는다(SocialLoginScreen.test.tsx 가 이미 쓰는 규약).
    expect(screen.getByTestId('auth-login-root')).toBeOnTheScreen();
  });
});

// Figma error 변형 문구(01 §2-5) — 현행 문구와 동일하다.
const ERROR_COPY = '로그인에 실패했어요. 잠시 후 다시 시도해 주세요';

describe('AC-V3 · 에러 배너가 Figma error 변형 토큰을 입는다 (렌더)', () => {
  it('배너 컨테이너가 bg-primary-pale·rounded-button 을, 배너 텍스트가 text-primary-text·font-noto-bold·font-bold·text-label 을 갖는다', () => {
    // ▸준비 — overrides 로 error phase 를 연다. SOCIAL_AUTH_FAILED 는 충돌 시트·연령
    // 제한을 타지 않는 가장 평범한 에러코드다(SocialLoginScreen.test.tsx:108 과 동일 값).
    renderDefault({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });

    // ▸실행 — 신규 testID 없이 배너 안 텍스트 노드를 잡는다(배너 안 텍스트 노드는
    // 1개뿐임을 실측했다, 02a §5-3).
    const banner = screen.getByTestId('auth-login-error-banner');
    const text = within(banner).getByText(ERROR_COPY);

    // ▸단언 (a) — 배너 컨테이너
    const bannerTokens = classTokens(banner);
    expect({
      background: bannerTokens.includes('bg-primary-pale'),
      radius: bannerTokens.includes('rounded-button'),
    }).toEqual({ background: true, radius: true });

    // ▸단언 (b) — 배너 텍스트
    const textTokens = classTokens(text);
    expect({
      color: textTokens.includes('text-primary-text'),
      family: textTokens.includes('font-noto-bold'),
      weight: textTokens.includes('font-bold'),
      size: textTokens.includes('text-label'),
    }).toEqual({ color: true, family: true, weight: true, size: true });

    // 의도적으로 단언하지 않는 것(02a §5-3): flex-row·items-center·w-full·px-[14px]·
    // py-md·gap-[9px]·텍스트의 flex-1. AC-V3 문구가 이 값들을 지목하지 않고(AC 없는
    // 단언 금지), 전부 스크린샷 대조가 한눈에 잡는 기하값이라 여기서 고정하면 Figma가
    // 조금만 바뀌어도 정당한 작업에 red 를 낸다.
  });
});
