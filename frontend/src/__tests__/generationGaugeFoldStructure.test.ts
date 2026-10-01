/**
 * @jest-environment node
 */
// TRIP-1040 · 진행 카드 칸 접기의 **배치** 가드(fs 소스 스캔).
// 렌더로 못 보는 것만 본다: 접기 판단이 features 순수 함수 한 곳(`foldGenerationGauge`)에 있고,
// 소비처 DraftPage 와 dev 프리뷰가 **그 함수를 실제로 부르는가**.
//
// 무엇을 보장하나:
//  - G1: DraftPage 가 draftView 에서 `foldGenerationGauge` 를 가져와 부른다(상한 판단은 소비처가 넘긴다 · Seed).
//    통합 테스트(DraftPage.gaugeFold)는 결과(칸 4개)만 본다 — 페이지에 인라인 slice 로 같은 결과를 흉내 내면
//    그쪽은 green 이라, "판단은 한 곳"은 이 가드가 잡는다.
//  - G2: 프리뷰 5일·7일 키가 손으로 쓴 칸 리터럴이 아니라 `buildGenerationGauge` → `foldGenerationGauge` 로
//    세워진다(Seed "실제 도출 함수 통과") — 6-b 가 손으로 쓴 값이 아니라 함수 출력을 보게 한다.
//
// 스캔 순서(census 규칙): `from '…draftView'` import 절을 먼저 뽑고, 그 절의 named 심볼 안에서 대상 이름을 판정한다.
// 리포 확립 규약: "없어야 한다"는 "있어야 한다"와 같은 it 안에 둔다(여기는 긍정만 — 키 문자열이 긍정 앵커).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');
const PAGE_REL = 'pages/itinerary-draft/ui/DraftPage.tsx';
const PREVIEW_REL = 'app/_dev/preview.tsx';
const DRAFT_VIEW_SPEC = '@/features/itinerary/model/draftView';

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석 먼저. 줄 주석은 바로 앞이 `:` 면 주석으로 안 본다
 * (`'https://…'` 의 슬래시 오인 방지, 리포 동결 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

/** `import { a, b } from '<spec>'`(여러 줄·`type` 수식 포함)의 named 심볼 전부. */
function namedImportsFrom(source: string, spec: string): string[] {
  const escaped = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const clause = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`,
    'g'
  );
  return [...source.matchAll(clause)].flatMap((match) =>
    match[1]
      .split(',')
      .map((part) =>
        part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim()
      )
      .filter((name) => name.length > 0)
  );
}

describe('G0 · 전처리×탐지기 자가검사 (★ 조합)', () => {
  it('주석 속 가짜 import 는 걷히고, 여러 줄 import 블록의 심볼·URL 은 살아남는다', () => {
    const sample = [
      `// import { foldGenerationGauge } from '${DRAFT_VIEW_SPEC}';`,
      `/* import { ghost } from '${DRAFT_VIEW_SPEC}'; */`,
      'import {',
      '  buildDraftPins,',
      '  buildGenerationGauge,',
      '  foldGenerationGauge,',
      `} from '${DRAFT_VIEW_SPEC}';`,
      `import type { GenerationDayState } from '${DRAFT_VIEW_SPEC}';`,
      "const url = 'https://x.dev/a';",
    ].join('\n');

    const stripped = stripComments(sample);
    const names = namedImportsFrom(stripped, DRAFT_VIEW_SPEC);

    expect(names).toEqual([
      'buildDraftPins',
      'buildGenerationGauge',
      'foldGenerationGauge',
      'GenerationDayState',
    ]);
    expect(names).not.toContain('ghost');
    expect(stripped).toContain('https://x.dev/a');
    // 주석만 있는 원본은 import 로 안 잡힌다.
    expect(
      namedImportsFrom(
        stripComments(
          `// import { foldGenerationGauge } from '${DRAFT_VIEW_SPEC}';`
        ),
        DRAFT_VIEW_SPEC
      )
    ).toEqual([]);
  });
});

describe('🔴 G1 · Seed — DraftPage 가 접기 판단을 features 순수 함수에 맡긴다', () => {
  it('draftView 에서 foldGenerationGauge 를 import 하고 호출한다', () => {
    const page = readOne(PAGE_REL);
    // 긍정 앵커 — 파일이 있고 기존 도출 함수를 여전히 쓴다(빈 문자열 공허 통과 차단).
    expect(namedImportsFrom(page, DRAFT_VIEW_SPEC)).toContain(
      'buildGenerationGauge'
    );

    expect(namedImportsFrom(page, DRAFT_VIEW_SPEC)).toContain(
      'foldGenerationGauge'
    );
    expect(page).toContain('foldGenerationGauge(');
  });
});

describe('🔴 G2 · Seed — 프리뷰 5일·7일 키는 실제 도출 함수로 세운다', () => {
  it('두 키가 있고, preview 가 draftView 의 build·fold 를 import 해 fold 를 호출한다', () => {
    const preview = readOne(PREVIEW_REL);
    // 긍정 앵커 — 두 키가 실재한다.
    expect(preview).toContain("'h07-generating-partial-5d'");
    expect(preview).toContain("'h07-generating-partial-7d'");

    const names = namedImportsFrom(preview, DRAFT_VIEW_SPEC);
    expect(names).toContain('buildGenerationGauge');
    expect(names).toContain('foldGenerationGauge');
    expect(preview).toContain('foldGenerationGauge(');
  });
});
