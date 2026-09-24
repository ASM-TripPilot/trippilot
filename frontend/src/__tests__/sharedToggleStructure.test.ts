/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-780 · AC-2 · AC-7 — 공유 스위치 승격이 "이동"으로 끝났는지 소스로 잠근다.
 *
 * 무엇을 보장하나:
 *  - `shared/ui/Toggle.tsx` 가 있고 스위치 역할(role switch)을 갖는다.
 *  - 소비처 3곳(l06 `LocationConsentScreen` · l02 `ToggleRow` · 개인화 `PersonalizationScreen`)이
 *    `@/shared/ui/Toggle` 를 import 해 `<Toggle` 로 그리고, 인라인 스위치(52×30 Pressable)는 0건이다.
 *    한 벌이라도 남으면 다음 사람이 어느 쪽을 고쳐야 할지 모른다.
 *  - AC-7: 이번에 바뀌는 `.tsx` 가 토큰화된 색을 raw hex 로 우회하지 않는다. MISS 2색(`#ECECEC`·
 *    `#C4C9CF`, 01b Q6)은 토큰이 없어 목록 밖이다.
 *
 * 기존 testID·checked/disabled 계약은 소비처 각자의 기존 테스트가 무수정으로 지킨다.
 * `MustVisitTimeScreen`(h 밴드 스위치)은 범위 밖이라 보지 않는다.
 *
 * 전제 — 주석을 걷어낸 소스를 스캔한다(`sharedUiStructure` 와 같은 `stripComments`). 머리말 산문이
 * 부정 단언을 대신 만족시키거나 긍정 단언을 대신 채우는 것을 막는다.
 */

const ROOT = path.resolve('src');

const TOGGLE = 'shared/ui/Toggle.tsx';
const CONSUMERS = [
  'features/settings/ui/LocationConsentScreen.tsx',
  'features/notification/ui/ToggleRow.tsx',
  'features/settings/ui/PersonalizationScreen.tsx',
];
const HEX_SCAN = [
  TOGGLE,
  ...CONSUMERS,
  'features/settings/ui/RevokeConfirmDialog.tsx',
];

/** 옛 인라인 스위치의 트랙 치수 — ToggleRow 셀의 단독 `w-[52px]` 는 774 몫이라 연속 문자열로만 잡는다. */
const INLINE_TRACK = 'h-[30px] w-[52px]';
const SWITCH_ROLE = 'accessibilityRole="switch"';

/** tailwind 토큰으로 이미 있는 색(sharedUiStructure 9색 + body·surface-strong·canvas-alt). */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#9aa1ab',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f7f7f7',
  '#ffe4e9',
  '#3f3f3f',
  '#f2f2f2',
  '#fafafa',
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

describe('탐지기 자가검사 — 전처리가 탐지 대상을 지우지 않는다', () => {
  it('주석 속 패턴은 걷히고, 코드 줄의 패턴은 살아남는다', () => {
    const sample = [
      '/** 옛 스위치 h-[30px] w-[52px] · accessibilityRole="switch" 설명 */',
      '// <Pressable accessibilityRole="switch" className="h-[30px] w-[52px]" />',
      "import { Toggle } from '@/shared/ui/Toggle';",
      '<Pressable accessibilityRole="switch" className={`h-[30px] w-[52px] ${x}`} />',
    ].join('\n');

    const stripped = stripComments(sample);

    // 코드 줄은 남는다 — 전처리가 다 지우면 아래 부정 단언이 전부 공허해진다.
    expect(stripped).toContain("from '@/shared/ui/Toggle'");
    expect(stripped.split(INLINE_TRACK)).toHaveLength(2);
    expect(stripped.split(SWITCH_ROLE)).toHaveLength(2);
  });
});

describe('TRIP-780 · AC-2 — shared/ui/Toggle 승격', () => {
  it('shared/ui/Toggle.tsx 가 있고 Toggle 을 export 하며 스위치 역할을 갖는다', () => {
    expect(fs.existsSync(path.join(ROOT, TOGGLE))).toBe(true);

    const source = read(TOGGLE);
    expect(source).toMatch(/export function Toggle\b/);
    expect(source).toContain(SWITCH_ROLE);
  });

  it.each(CONSUMERS)(
    '%s 는 공유 Toggle 을 그리고, 인라인 스위치가 없다',
    (rel) => {
      const source = read(rel);

      // 긍정 — import 만 바꾸고 렌더는 인라인으로 남긴 상태를 막는다.
      expect(source).toContain("from '@/shared/ui/Toggle'");
      expect(source).toMatch(/<Toggle\b/);

      // 부정 — 옛 52×30 트랙과 자체 switch 역할이 사라졌다.
      expect(source).not.toContain(INLINE_TRACK);
      expect(source).not.toContain(SWITCH_ROLE);
    }
  );
});

describe('TRIP-780 · AC-7 — 바뀌는 .tsx 에 토큰화된 색 raw hex 0', () => {
  it('Toggle · 소비처 3 · 철회 다이얼로그가 토큰 경유로만 색을 쓴다', () => {
    const offenders = HEX_SCAN.flatMap((rel) => {
      const source = read(rel).toLowerCase();
      return TOKENIZED_HEX.filter((hex) => source.includes(hex)).map(
        (hex) => `${rel}: ${hex}`
      );
    });

    expect(offenders).toEqual([]);
  });
});
