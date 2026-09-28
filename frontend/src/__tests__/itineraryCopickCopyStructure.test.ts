/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1043 · QA #041 — 같이 짜기 두 화면(h09 컨셉 · h10 후보)의 **소스 층 가드**.
 *
 * 무엇을 보장하나:
 *  - 🔴 G1: 화면 2파일 + 배선 1파일의 사용자 노출 문자열에 내부 용어 「슬롯」이 0건이다. 렌더 스캔
 *    (`SlotFillPage.context.integration.test.tsx` A4r)은 얼굴마다 따로 그려야 하고 `accessibilityLabel`
 *    을 놓치므로, 소스를 한 번 더 훑는 이중 그물이다(선례 `itineraryDraftFallbackShellStructure` G1).
 *
 * 전제 — 스캔은 주석을 걷어낸 소스를 본다. 세 파일에는 「슬롯」을 쓰는 설명 주석이 많아서, 걷지 않으면
 * 어떤 구현도 통과하지 못한다. G0 이 "주석은 걷히고 문자열은 남는다"를 먼저 증명한다.
 * 가짜 통과 방지: 「슬롯」 0건 단언은 같은 it 안의 파일 실재·대표 심볼 단언과 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const FILES: { rel: string; symbol: string }[] = [
  {
    rel: 'features/itinerary/ui/ConceptPickerScreen.tsx',
    symbol: 'ConceptPickerScreen',
  },
  { rel: 'features/itinerary/ui/SlotFillScreen.tsx', symbol: 'SlotFillScreen' },
  { rel: 'pages/itinerary-copick/ui/SlotFillPage.tsx', symbol: 'SlotFillPage' },
];

/** 블록 주석을 먼저 지운다. 줄 주석은 바로 앞 글자가 `:` 가 아닐 때만 — `'https://…'` 보존. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 빈 문자열이 부정 단언을 공짜로 통과시키는 것은 같은 it 의 실재 단언이 막는다. */
function readStripped(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 「슬롯」 0건이 의미를 갖는다', () => {
  it('주석 속 「슬롯」은 걷히고, 문자열 속 「슬롯」과 URL 은 살아남는다', () => {
    const sample = [
      '// 슬롯 진행 — 비고정만 센다',
      '/* 슬롯 하나를 채운다 */',
      '{/* JSX 주석의 슬롯 */}',
      '<Text>{`${band} 슬롯`}</Text>',
      "const url = 'https://example.com/a';",
    ].join('\n');

    const stripped = stripComments(sample);

    expect(count(stripped, '슬롯')).toBe(1);
    expect(stripped).toContain('${band} 슬롯');
    expect(stripped).toContain('https://example.com/a');
  });
});

describe('🔴 G1 · 같이 짜기 두 화면·배선의 문자열에 「슬롯」이 0건이다 (QA #041)', () => {
  it('세 파일이 모두 있고 대표 심볼을 품으며, 주석을 걷은 본문에 「슬롯」이 없다', () => {
    FILES.forEach(({ rel, symbol }) => {
      expect({ rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
        rel,
        exists: true,
      });
      expect(readStripped(rel)).toContain(symbol);
    });

    const counts = Object.fromEntries(
      FILES.map(({ rel }) => [rel, count(readStripped(rel), '슬롯')])
    );
    expect(counts).toEqual(
      Object.fromEntries(FILES.map(({ rel }) => [rel, 0]))
    );
  });
});
