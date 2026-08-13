import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react-native';

import { SocialLoginScreen } from './SocialLoginScreen';

// 이 파일은 '비주얼/구조 가드'다. 픽셀은 jest 로 검증 불가(→ [검증] 단계 Figma 대조)라
// 다루지 않는다. 대신 className 이 렌더 트리에 평문 prop 으로 남는다는 사실(NativeWind 의
// CSS interop 은 jest 환경에서 소비되지 않는다, 02a §5-4 실측)을 이용해 '어느 노드가 어느
// 토큰 클래스를 입었는지'와 'testID 가 어떤 순서로 나타나는지'를 렌더 결과에서 직접 읽는다.
//
// 계약 동결: 아이콘 존재(AC-VS-5~6)·라벨/배너 스타일(AC-V1~V3)은 그대로 두고, 이 사이클에서
// 레이아웃 구조(AC-L1/L2/L4)·딤(AC-D1/D2)·시트 셸(AC-S1~S4)을 추가한다. props 8개·조건부 UI 가
// 언제 뜨는지·문구·핸들러는 SocialLoginScreen.test.tsx 가 잠근 행위 계약이므로 여기서 건드리지
// 않는다 — 여기서 추가하는 것은 스타일(className)·구조(존재/순서) 단언뿐이다.
//
// @gorhom/bottom-sheet 은 reanimated/gesture 런타임 의존이라 수동 목으로 대체한다
// (__mocks__/@gorhom/bottom-sheet.tsx). 이 사이클에서 그 목을 확장했다 — backdropComponent 를
// 실제로 렌더하도록(딤 AC 의 선행조건, 02a ★D1).
jest.mock('@gorhom/bottom-sheet');

type Props = ComponentProps<typeof SocialLoginScreen>;

// idle 이 기본값이고, 시트/에러처럼 다른 phase 가 필요한 케이스만 overrides 로 연다 — 기본값
// 객체 자체는 바꾸지 않고 스프레드 뒤에 ...overrides 만 붙인다(test.tsx 의 renderScreen 과 동형).
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
// 비교하는 이유(02a §D5): 문자열 부분포함은 'text-primary-text'.includes('text-primary')가
// true(오탐)지만, 토큰 배열 ['text-primary-text']에 'text-primary'는 원소로 없다 — 부분 문자열
// 오탐을 구조적으로 없앤다. 'bg-scrim/40' 은 '/'를 품어도 공백이 없어 한 토큰으로 온전히 남는다.
function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.trim().split(/\s+/).filter(Boolean) : [];
}

// toJSON 트리 노드(호스트 렌더 결과)의 최소 형태.
type JsonNode = {
  props?: { testID?: unknown; className?: unknown };
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

// ── 동결 계약: 아이콘 글리프 존재 (AC-VS-5~6) ────────────────────────────────
describe('c02-social-login 비주얼 구조 가드 (AC-VS-5~6)', () => {
  it.each(['google', 'apple', 'kakao', 'naver'])(
    'AC-VS-5 %s 소셜 버튼 안에 브랜드 아이콘 SVG 가 렌더된다 — 텍스트 전용이 아니다',
    (provider) => {
      renderDefault();
      const button = screen.getByTestId(`auth-login-${provider}`);
      expect(
        within(button).getByTestId(`auth-login-${provider}-icon`)
      ).toBeOnTheScreen();
    }
  );

  it('AC-VS-6 브랜드 블록에 앱아이콘 글리프 SVG 가 렌더된다', () => {
    renderDefault();
    const brand = screen.getByTestId('auth-login-brand');
    expect(
      within(brand).getByTestId('auth-login-logo-glyph')
    ).toBeOnTheScreen();
  });
});

// Figma c02-social-login 확정 라벨 — AC-V1(전 버튼 웨이트)과 AC-V2(카카오 문구)가 함께 쓴다.
const FIGMA_LABELS: Record<'google' | 'apple' | 'kakao' | 'naver', string> = {
  google: '구글로 계속하기',
  apple: '애플로 계속하기',
  kakao: '카카오로 계속하기',
  naver: '네이버로 계속하기',
};

// ── 동결 계약: 라벨/배너 스타일 (AC-V1~V3) ───────────────────────────────────
describe('AC-V1 · 소셜 버튼 라벨이 Figma Bold 조합을 쓴다 (렌더)', () => {
  it.each(['google', 'apple', 'kakao', 'naver'] as const)(
    '%s 라벨이 font-noto-bold+font-bold 를 갖고, 옛 medium 조합은 없다',
    (provider) => {
      // ▸준비 — 무엇을 보장하나: 라벨이 Figma Bold 조합으로 렌더되고 옛 medium 조합으로
      // 되돌아가지 않는다.
      renderDefault();

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

const ERROR_COPY = '로그인에 실패했어요. 잠시 후 다시 시도해 주세요';

describe('AC-V3 · 에러 배너가 Figma error 변형 토큰을 입는다 (렌더)', () => {
  it('배너 컨테이너가 bg-primary-pale·rounded-button 을, 배너 텍스트가 text-primary-text·font-noto-bold·font-bold·text-label 을 갖는다', () => {
    // ▸준비 — overrides 로 error phase 를 연다.
    renderDefault({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });

    // ▸실행 — 배너 안 텍스트 노드(1개)를 잡는다.
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
  });
});

// ── 신규: 레이아웃 구조 (AC-L1/L2/L4) ────────────────────────────────────────
describe('AC-L1 · 루트는 상단정렬 컨테이너다 (렌더)', () => {
  it('루트 className 토큰에 justify-center·justify-between 이 없다 — 로고가 튀는 가운데 정렬 위반 차단', () => {
    // ▸준비+실행
    renderDefault();
    const tokens = classTokens(screen.getByTestId('auth-login-root'));

    // ▸단언 — 짝: 상단정렬 토큰 2종의 부재. (앵커는 루트 존재 자체.)
    expect({
      center: tokens.includes('justify-center'),
      between: tokens.includes('justify-between'),
    }).toEqual({ center: false, between: false });
  });
});

describe('AC-L2 · error 상태에서 로고가 배너보다 먼저 온다 (DOM 순서)', () => {
  it('brand → errorBanner → 소셜버튼 → terms 순서다 — 배너 등장에도 로고 세로 이동 없음', () => {
    // ▸준비 — SOCIAL_AUTH_FAILED 는 시트를 안 타는 평범한 에러라 배너가 뜬다.
    renderDefault({ phase: 'error', errorCode: 'SOCIAL_AUTH_FAILED' });

    // ▸실행 — 관심 4개 testID 만 등장 순서대로 뽑는다.
    const WATCH = [
      'auth-login-brand',
      'auth-login-error-banner',
      'auth-login-google',
      'auth-login-terms',
    ];
    const order = testIdOrder().filter((t) => WATCH.includes(t));

    // ▸단언 — 순서가 정확히 이것이어야 한다(로고가 배너 앞 = 위에 고정).
    expect(order).toEqual([
      'auth-login-brand',
      'auth-login-error-banner',
      'auth-login-google',
      'auth-login-terms',
    ]);
  });
});

describe('AC-L4 · 회귀 토큰 유지 (렌더)', () => {
  it('루트 px-2xl · 로고 h-14 w-14 · 소셜버튼 h-[52px] · 버튼 래퍼 gap-md 가 유지된다', () => {
    // ▸준비+실행
    renderDefault();
    const rootTokens = classTokens(screen.getByTestId('auth-login-root'));
    const buttonTokens = classTokens(screen.getByTestId('auth-login-google'));
    // 로고·래퍼는 testID 가 없어 토큰으로 잡는다(트리 유일, 02a §5-4 실측).
    const logos = nodesWithToken('h-14');
    const wrappers = nodesWithToken('gap-md');

    // ▸단언 — 한 객체로 묶어 어느 회귀가 깨졌는지 한 번에 본다.
    expect({
      rootPad: rootTokens.includes('px-2xl'),
      buttonHeight: buttonTokens.includes('h-[52px]'),
      logoOne: logos.length === 1,
      logoSquare: logos.length === 1 && classTokens(logos[0]).includes('w-14'),
      wrapperOne: wrappers.length === 1,
    }).toEqual({
      rootPad: true,
      buttonHeight: true,
      logoOne: true,
      logoSquare: true,
      wrapperOne: true,
    });
  });
});

// ── 신규: 딤 backdrop (AC-D1/D2) ─────────────────────────────────────────────
describe('AC-D1 · 시트가 열리면 딤(backdrop)이 전면 스크림으로 깔린다 (렌더 · 목 확장 선행)', () => {
  it.each(SHEETS)(
    '$name 시트가 열리면 auth-sheet-backdrop 이 렌더되고 bg-scrim/40 을 입는다',
    ({ override }) => {
      // ▸준비 — 각 phase 로 시트를 연다.
      renderDefault(override);

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
    renderDefault();

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
      renderDefault(override);
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
      renderDefault(override);

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
      renderDefault(override);
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
      renderDefault(override);
      const tokens = classTokens(screen.getByTestId(cancelId as string));

      // ▸단언
      expect(tokens).toContain('h-[44px]');
    }
  );
});
