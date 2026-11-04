/**
 * @jest-environment node
 */

// TRIP-1774 · 색 정본 구조 계약. 색 "값"이 맞는지(Figma·픽셀)는 여기서 보지 않는다 — 렌더 덤프 전/후와 실화면 QA 몫(README 판정 4).
// 여기서 지키는 건 "정의가 한 곳이고 나머지는 거기서 온다"는 구조다:
//  · 정본 = src/shared/config/colorTokens.cjs (tailwind.config.js 가 그대로 쓰는 맵 하나, 이름은 tailwind 키 그대로 kebab-case)
//  · TS 창구 = @/shared/config (COLOR_TOKENS, ColorTokenName) — 같은 객체를 타입과 함께 내준다
//  · 파생 표 = 정본 값 집합 안의 값만 가진다(소문자 비교). 문자열이라 "참조"는 못 재므로 "정본에 없는 새 색이 끼어들지 않는다"로 재다.
// 값 문자열을 테스트에 적지 않는다 — 기대값은 전부 정본에서 읽는다.
import { COLOR_TOKENS, type ColorTokenName } from '@/shared/config';
import { CARD_SHADOW } from '@/features/settings/ui/cardShadow';
import {
  AUTH_ICON_COLORS,
  SPLASH_BACKGROUND_COLORS,
} from '@/features/auth/config/gradients';
import { COVER_GRADIENTS } from '@/entities/trip/config/coverGradients';
import { SHEET_HANDLE_INDICATOR_STYLE } from '@/shared/lib/sheetHandle';
import { LOCATION_ICON_COLORS } from '@/shared/location/locationColors';
import {
  PIN_MUTED_SOFT,
  PIN_PRIMARY,
  PIN_SUCCESS,
  PIN_WHITE,
} from '@/shared/map/pinShapes';
import { PUSH_ICON_COLORS } from '@/shared/push/pushColors';
import { GLYPH_COLORS, type GlyphColor } from '@/shared/ui/glyphs';

const canon = jest.requireActual<Record<string, string>>(
  '../shared/config/colorTokens.cjs'
);
const tailwind = jest.requireActual<{
  theme: { extend: { colors: Record<string, string> } };
}>('../../tailwind.config.js');

// tailwind 클래스(bg-primary·text-muted-soft …)로 쓰이는 이름들 — 정본에서 빠지면 클래스가 조용히 스타일 없이 남는다(린트가 className 문자열은 못 본다).
const TOKEN_NAMES = [
  'primary',
  'primary-active',
  'primary-pale',
  'primary-text',
  'on-primary',
  'canvas',
  'canvas-alt',
  'surface-soft',
  'surface-strong',
  'hairline',
  'hairline-strong',
  'ink',
  'body',
  'muted',
  'muted-soft',
  'link',
  'info',
  'info-bg',
  'info-border',
  'success',
  'success-bg',
  'presence-blue',
  'presence-blue-bg',
  'presence-teal',
  'scrim',
];

const canonValues = new Set(Object.values(canon).map((v) => v.toLowerCase()));

describe('정본 colorTokens.cjs — 모양', () => {
  it('이름은 kebab-case, 값은 #RRGGBB 문자열이다', () => {
    const entries = Object.entries(canon);

    expect(entries.length).toBeGreaterThan(0);
    for (const [name, value] of entries) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('tailwind 클래스로 쓰이는 이름이 하나도 빠지지 않았다', () => {
    expect(Object.keys(canon)).toEqual(expect.arrayContaining(TOKEN_NAMES));
  });
});

describe('정본 → 소비처 (손으로 복사하지 않고 같은 객체를 쓴다)', () => {
  it('tailwind theme.extend.colors 는 정본 객체 그 자체다 — 값만 같은 사본이면 red', () => {
    expect(tailwind.theme.extend.colors).toBe(canon);
  });

  it('TS 창구 COLOR_TOKENS 는 정본 객체 그 자체다', () => {
    expect(COLOR_TOKENS).toBe(canon);
  });

  it('ColorTokenName 은 정본 이름의 리터럴 유니온이다 (컴파일 타임 — pnpm tsc 가 판정)', () => {
    const known: ColorTokenName = 'muted-soft';
    // @ts-expect-error 정본에 없는 이름은 컴파일 에러여야 한다(키 타입이 string 으로 넓어지지 않는다)
    const unknown: ColorTokenName = 'not-a-token';

    expect(Object.keys(COLOR_TOKENS)).toContain(known);
    expect(Object.keys(COLOR_TOKENS)).not.toContain(unknown);
  });
});

describe('GlyphColor — 글리프가 쓰는 키 이름은 그대로 유지된다', () => {
  it('기존 키 9개가 남아 있고, 값은 정본 값 중 하나다 (키가 늘어나는 건 허용)', () => {
    const keep: GlyphColor[] = [
      'ink',
      'body',
      'muted',
      'mutedSoft',
      'primary',
      'primaryText',
      'onPrimary',
      'success',
      'info',
    ];

    expect(Object.keys(GLYPH_COLORS)).toEqual(expect.arrayContaining(keep));
    for (const value of Object.values(GLYPH_COLORS)) {
      expect(canonValues.has(value.toLowerCase())).toBe(true);
    }
  });
});

describe('파생 표는 정본에 없는 색을 갖지 않는다', () => {
  // 면제 파일(gradients.ts)의 파생 부분도 여기서 잡힌다 — 그 파일은 린트 가드가 꺼져 있다.
  // SPLASH_BACKGROUND_COLORS 는 첫 stop(흰색)만 토큰 값이고 나머지 stop·APP_ICON_COLORS 는 브랜드 고유 색이라 뺀다.
  it.each([
    ['LOCATION_ICON_COLORS', Object.values(LOCATION_ICON_COLORS)],
    ['PUSH_ICON_COLORS', Object.values(PUSH_ICON_COLORS)],
    ['AUTH_ICON_COLORS', Object.values(AUTH_ICON_COLORS)],
    ['SPLASH_BACKGROUND_COLORS[0]', [SPLASH_BACKGROUND_COLORS[0]]],
    ['PIN_*', [PIN_PRIMARY, PIN_SUCCESS, PIN_MUTED_SOFT, PIN_WHITE]],
    ['COVER_GRADIENTS', Object.values(COVER_GRADIENTS).flat()],
    ['CARD_SHADOW.shadowColor', [CARD_SHADOW.shadowColor]],
    [
      'SHEET_HANDLE_INDICATOR_STYLE.backgroundColor',
      [SHEET_HANDLE_INDICATOR_STYLE.backgroundColor],
    ],
  ])('%s', (_label, values) => {
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(canonValues.has(String(value).toLowerCase())).toBe(true);
    }
  });
});
