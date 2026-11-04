/**
 * @jest-environment node
 */

/**
 * TRIP-1773 · 글리프 이름 겹침 가드의 "금지 이름 계산" 계약 — `scripts/glyphExportBlocks.cjs` 의 순수 함수.
 *
 * 왜 따로 있나: `eslint.config.js` 는 디스크의 `*Glyphs.tsx` 를 읽어 파일마다 "다른 파일이 정의한 이름" 목록을 만든다.
 * 그런데 `eslintReleaseRules.test.ts` 의 `lintText` 탐침은 가짜 경로나 "실파일 + 디스크에 없는 이름"만 쓸 수 있어서
 * "실파일 둘이 같은 이름을 정의하면 둘 다 error" 라는 핵심 성질을 못 만든다(그 계산을 "전체 − 내 이름" 으로 바꿔도 탐침 7건이 전부 green 이었다).
 * 계산을 함수로 빼고 **소스 문자열 픽스처**를 넣어 직접 단언한다 — 디스크를 읽지 않으므로 소스 스캔 금지(TRIP-1145)에 안 걸린다.
 *
 * 입력 `sources` = { 'src/…/XGlyphs.tsx': 소스 문자열 }. 출력 = eslint 설정에 그대로 펼치는 블록 배열:
 *  [0] catch-all { files: ['src/**\/*Glyphs.tsx'], rules: 전체 이름 }  — 어느 실파일도 아닌 새 글리프 파일용
 *  [1…] 입력 키마다 한 블록 { files: [그 키], rules: "그 파일이 아닌 다른 파일이 정의한 이름의 합집합" }  — catch-all 뒤에서 덮어쓴다
 *
 * 테스트가 `.ts` 인 이유: jest testMatch 가 `.cjs` 를 줍지 않아서다(noiseBudget.test.ts 와 같다).
 * 3동작 뼈대: 준비=파일 두어 개짜리 소스 픽스처 → 실행=`glyphExportBlocks(sources)` → 단언=어느 블록에 어느 이름이 있나.
 */

type Block = {
  files: string[];
  rules: {
    'no-restricted-exports': [string, { restrictedNamedExports: string[] }];
  };
};
type Lib = {
  glyphExportBlocks: (sources: Record<string, string>) => Block[];
};

const { glyphExportBlocks } = jest.requireActual<Lib>(
  './glyphExportBlocks.cjs'
);

const A = 'src/features/a/ui/AGlyphs.tsx';
const B = 'src/features/b/ui/BGlyphs.tsx';
const C = 'src/pages/c/ui/CGlyphs.tsx';

const fn = (name: string) => `export function ${name}() {\n  return null;\n}\n`;
const names = (block: Block) =>
  [...block.rules['no-restricted-exports'][1].restrictedNamedExports].sort();
// 입력 키 하나의 블록(파일별 덮어쓰기) / 맨 앞 catch-all.
const banned = (sources: Record<string, string>, file: string) => {
  const block = glyphExportBlocks(sources).find(
    (b, i) => i > 0 && b.files.length === 1 && b.files[0] === file
  );
  if (!block) throw new Error(`블록 없음: ${file}`);
  return names(block);
};
const catchAll = (sources: Record<string, string>) =>
  names(glyphExportBlocks(sources)[0]);

describe('블록 모양 — catch-all 하나 + 입력 키마다 한 블록, 전부 error', () => {
  it('첫 블록은 *Glyphs.tsx 글롭이고 이어서 키마다 [키] 블록이 한 개씩 따라온다', () => {
    const sources = { [A]: fn('ZzOneGlyph'), [B]: fn('ZzTwoGlyph') };

    const blocks = glyphExportBlocks(sources);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].files).toEqual(['src/**/*Glyphs.tsx']);
    expect(blocks.slice(1).map((b) => b.files)).toEqual([[A], [B]]);
    for (const b of blocks)
      expect(b.rules['no-restricted-exports'][0]).toBe('error');
  });

  it('입력이 비면 catch-all 만 남고 금지 목록도 비어 있다', () => {
    const blocks = glyphExportBlocks({});

    expect(blocks).toHaveLength(1);
    expect(names(blocks[0])).toEqual([]);
  });
});

describe('금지 목록 = 다른 파일이 정의한 이름의 합집합 (전체 − 내 이름이 아니다)', () => {
  it('두 파일이 같은 이름을 정의하면 두 파일 블록 모두에 그 이름이 금지된다', () => {
    const sources = { [A]: fn('ZzDupGlyph'), [B]: fn('ZzDupGlyph') };

    const inA = banned(sources, A);
    const inB = banned(sources, B);

    expect(inA).toContain('ZzDupGlyph');
    expect(inB).toContain('ZzDupGlyph');
  });

  it('한 파일만 정의한 이름은 그 파일 블록엔 없고 다른 파일 블록과 catch-all 엔 있다', () => {
    const sources = {
      [A]: fn('ZzOnlyAGlyph'),
      [B]: fn('ZzOnlyBGlyph'),
      [C]: fn('ZzOnlyCGlyph'),
    };

    expect(banned(sources, A)).toEqual(['ZzOnlyBGlyph', 'ZzOnlyCGlyph']);
    expect(banned(sources, B)).toEqual(['ZzOnlyAGlyph', 'ZzOnlyCGlyph']);
    expect(catchAll(sources)).toEqual([
      'ZzOnlyAGlyph',
      'ZzOnlyBGlyph',
      'ZzOnlyCGlyph',
    ]);
  });

  it('겹치는 이름과 고유 이름이 섞여도 각각 맞게 갈린다', () => {
    const sources = {
      [A]: fn('ZzDupGlyph') + fn('ZzSoloAGlyph'),
      [B]: fn('ZzDupGlyph'),
    };

    expect(banned(sources, A)).toEqual(['ZzDupGlyph']);
    expect(banned(sources, B)).toEqual(['ZzDupGlyph', 'ZzSoloAGlyph']);
  });
});

describe('무엇을 "정의"로 거두나 — 수집 범위', () => {
  it('둘째 글자가 대문자인 이름(UIDupGlyph·AIGlyph)도 거둔다 (W1-a)', () => {
    const sources = {
      [A]: fn('UIDupGlyph') + fn('AIGlyph'),
      [B]: fn('UIDupGlyph'),
    };

    expect(banned(sources, A)).toContain('UIDupGlyph');
    expect(banned(sources, B)).toContain('UIDupGlyph');
    expect(banned(sources, B)).toContain('AIGlyph');
  });

  it('`function X(){}` + `export { X }` 로 만든 이름을 두 파일이 쓰면 둘 다 금지된다 (W1-b)', () => {
    const local =
      'function ZzLeakGlyph() {\n  return null;\n}\nexport { ZzLeakGlyph };\n';
    const sources = { [A]: local, [B]: local };

    expect(banned(sources, A)).toContain('ZzLeakGlyph');
    expect(banned(sources, B)).toContain('ZzLeakGlyph');
  });

  it('`export { Y as X }` 는 바깥 이름 X 로 거둔다 (줄바꿈된 목록 포함, 안쪽 이름 Y 는 아니다)', () => {
    const sources = {
      [A]: 'function Local() {\n  return null;\n}\nexport { Local as ZzAliasGlyph };\n',
      [B]: 'function Inner() {\n  return null;\n}\nexport {\n  Inner as ZzMultiGlyph,\n  Inner as ZzLineGlyph,\n};\n',
      [C]: fn('ZzAliasGlyph'),
    };

    const all = catchAll(sources);

    expect(all).toEqual(
      expect.arrayContaining(['ZzAliasGlyph', 'ZzMultiGlyph', 'ZzLineGlyph'])
    );
    expect(all).not.toContain('Local');
    expect(all).not.toContain('Inner');
    // A 의 별칭 정의와 C 의 함수 정의가 같은 이름 → 둘 다 금지
    expect(banned(sources, A)).toContain('ZzAliasGlyph');
    expect(banned(sources, C)).toContain('ZzAliasGlyph');
  });

  it('`export const` 화살표 정의와 `export async function` 도 거둔다', () => {
    const sources = {
      [A]: 'export const ZzArrowGlyph = () => null;\nexport async function ZzAsyncGlyph() {\n  return null;\n}\n',
      [B]: fn('ZzArrowGlyph') + fn('ZzAsyncGlyph'),
    };

    expect(banned(sources, A)).toEqual(
      expect.arrayContaining(['ZzArrowGlyph', 'ZzAsyncGlyph'])
    );
    expect(banned(sources, B)).toEqual(
      expect.arrayContaining(['ZzArrowGlyph', 'ZzAsyncGlyph'])
    );
  });

  it('남의 이름을 재수출(`export { X } from`)하는 파일은 그 이름의 정의자가 아니다 — 정의한 쪽 블록엔 안 들어간다', () => {
    const sources = {
      [A]: "export { ZzReGlyph } from '@/shared/ui/glyphs';\n",
      [B]: fn('ZzReGlyph'),
    };

    expect(banned(sources, A)).toContain('ZzReGlyph'); // 재수출 쪽은 걸린다
    expect(banned(sources, B)).not.toContain('ZzReGlyph'); // 정의한 쪽은 안 걸린다
  });

  it('ALL_CAPS 상수와 타입 export 는 거두지 않는다 (MUTED·GLYPH_COLORS·GlyphComponent 동명 오탐 방지)', () => {
    const noise =
      "export const MUTED = '#6A6A6A';\nexport const MUTED_SOFT = '#9AA1AB';\nexport type GlyphComponent = () => null;\nexport interface ZzShape {\n  a: number;\n}\nexport type { ZzTypeOnly };\n";
    const sources = {
      [A]: noise + fn('ZzAGlyph'),
      [B]: noise + fn('ZzBGlyph'),
    };

    const all = catchAll(sources);

    expect(all).toEqual(['ZzAGlyph', 'ZzBGlyph']);
    expect(banned(sources, A)).toEqual(['ZzBGlyph']);
  });
});
