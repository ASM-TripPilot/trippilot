/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-563 · AC-5·AC-8 — i13/i16 재계획안 골격 소스 층 가드(앱을 안 돌리고 소스를 글자로 읽는다).
 *
 * 무엇을 보장하나:
 *  - 🔴 G2 — 신규 5파일(화면 3·페이지·라우트)이 정본 경로에 실재하고, features/planb/ui 재귀 스캔이
 *    신규 3화면을 자동 편입한다(개념 [[소스 스캔 가드의 폴더 전수와 자동 편입]]). 구현 전 → red.
 *  - 🔴 G3 — 신규 3화면에 소요시간 표기(N분·N시간·소요) 0(INV-3·AC-5). 광역 그물은 기존
 *    executionDurationStructure.test.ts(features/{execution,planb}/ui/** 재귀)가 유지 — 이 G3 는
 *    이 사이클 전용 명시 + 파일존재 red 앵커.
 *  - 🔴 G4 — PlanbDraftPage + 신규 3화면이 useApplyReplan·itinerary PUT·codegen apply 훅을 import
 *    하지 않는다(AC-8·INV-U4-05 무쓰기). 광역 봉인은 기존 planbApplyStructure.test.ts G2 가 유지.
 *  - 🔴 G5 — 신규 3화면이 resolveReplanState·useReplanSession·expo-router·react-query 를 모른다
 *    (화면 순수성 = 판정 1회, 화면 재판정 없음).
 *  - 🔴 G6 — draft 라우트가 @/pages/planb-draft·PlanbDraftPage·useLocalSearchParams 로 얇게 위임.
 *
 * 전처리×탐지기 조합(★): 탐지기·전처리를 신규 발명하지 않고 executionDurationStructure·
 * planbApplyStructure 의 **검증된 것 그대로** 재사용한다. 부정 단언은 반드시 stripComments 후 소스에
 * 건다 — implementer 가 "// i13 은 useApplyReplan import 안 함" 같은 주석을 달면 원문엔 그 심볼이 있어
 * 거짓 red 가 나기 때문(G1 이 이 조합을 자가검사, 문제로그 [[2026-07-31 stripComments가 URL의 슬래시를
 * 주석으로 오인]] 계열).
 */

const ROOT = path.resolve('src');

/** 소요시간 **표기** 탐지기(executionDurationStructure 와 동일). HH:mm(09:30)은 숫자 뒤가 `:`라 안 걸림. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 주석 제거 — `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 소스 파일 재귀 수집(테스트·Glyphs 제외 — executionDurationStructure 관례). 없으면 빈 배열. */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      if (/Glyphs\.tsx$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

/** 없는 파일은 '' — ENOENT 로 죽으면 assertion diff 가 안 남는다(planbApplyStructure readOne 선례). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

const UI_DIR = 'features/planb/ui';
const NEW_SCREENS = [
  'features/planb/ui/ReplanDraftScreen.tsx',
  'features/planb/ui/ReplanSlotRow.tsx',
  'features/planb/ui/NoAlternativeScreen.tsx',
];
const PAGE_REL = 'pages/planb-draft/ui/PlanbDraftPage.tsx';
const ROUTE_REL = 'app/trips/[tripId]/planb/draft.tsx';
const NEW_FILES = [...NEW_SCREENS, PAGE_REL, ROUTE_REL];

const WRITE_HOOKS = [
  'useApplyReplan',
  'usePutTripsTripIdItinerary',
  'usePostTripsTripIdReplanSessionsSessionIdApply',
];

describe('G1 · 전처리×탐지기 자가검사 (★ 조합)', () => {
  it('주석 속 소요시간·금칙심볼은 걷히고, 코드 시각·URL·실배선 심볼은 살아남는다', () => {
    const sample = [
      '// INV-3 · 소요시간 30분 표기 안 함.',
      '// i13 은 useApplyReplan 을 import 하지 않는다.',
      "const url = 'https://figma.com/design/2288:2367';",
      "const meta = '09:30–10:50 · 도보 1.3km';",
      'const s = useReplanSession(tripId, sessionId);',
    ].join('\n');
    const stripped = stripComments(sample);

    // 주석 걷힘(카운트 부풀림·거짓 red 방지).
    expect(stripped).not.toContain('30분');
    expect(stripped).not.toContain('useApplyReplan');
    // URL·시각·실배선 심볼 보존(거짓 통과·거짓 red 방지).
    expect(stripped).toContain('https://figma.com/design/2288:2367');
    expect(stripped).toContain('09:30–10:50');
    expect(stripped).toContain('useReplanSession');
    // 탐지기 방향.
    expect(DURATION_TEXT.test(stripped)).toBe(false);
    expect(DURATION_TEXT.test('여유 1시간 20분')).toBe(true);
  });
});

describe('🔴 G2 · 신규 파일 실재 + features/planb/ui 재귀 편입', () => {
  it('신규 5파일이 정본 경로에 있다', () => {
    for (const rel of NEW_FILES) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
    }
  });

  it('features/planb/ui 재귀 스캔이 신규 3화면을 포함한다(자동 편입)', () => {
    const scanned = listSourceFiles(path.join(ROOT, UI_DIR)).map(relOf);
    for (const rel of NEW_SCREENS) {
      expect(scanned).toContain(rel);
    }
  });
});

describe('🔴 G3 · AC-5 — 신규 3화면에 소요시간 표기 0 (INV-3)', () => {
  it('세 화면(주석 제외)에 분·시간·소요 표기가 없다 + 긍정 짝(파일 실제로 읽음)', () => {
    const offenders = NEW_SCREENS.filter((rel) =>
      DURATION_TEXT.test(readOne(rel))
    );
    expect(offenders).toEqual([]);
    // 긍정 짝 — ReplanSlotRow 가 슬롯 표면을 그린다(빈 파일 공허 통과 방지).
    expect(readOne('features/planb/ui/ReplanSlotRow.tsx')).toContain(
      'planb-draft-slot'
    );
  });
});

describe('🔴 G4 · AC-8 — 무쓰기(useApplyReplan·itinerary PUT·codegen apply 0)', () => {
  it('PlanbDraftPage + 신규 3화면이 쓰기 훅을 import 하지 않는다 + 긍정 짝', () => {
    const targets = [PAGE_REL, ...NEW_SCREENS];
    for (const rel of targets) {
      const source = readOne(rel);
      for (const hook of WRITE_HOOKS) {
        expect(source).not.toContain(hook);
      }
    }
    // 긍정 짝 — 페이지는 실제로 세션 조회·판정을 배선한다(파일 읽음·공허 통과 방지).
    const page = readOne(PAGE_REL);
    expect(page).toContain('useReplanSession');
    expect(page).toContain('resolveReplanState');
  });
});

describe('🔴 G5 · 화면 순수성 + 판정 1회', () => {
  it('신규 3화면이 판정·조회·라우팅을 모른다(재판정 없음) + 긍정 짝(자기 testID 보유)', () => {
    const FORBIDDEN = [
      'resolveReplanState',
      'useReplanSession',
      'expo-router',
      '@tanstack/react-query',
    ];
    for (const rel of NEW_SCREENS) {
      const source = readOne(rel);
      for (const token of FORBIDDEN) {
        expect(source).not.toContain(token);
      }
    }
    // 긍정 짝 — 각 화면이 자기 표면을 그린다.
    expect(readOne('features/planb/ui/ReplanDraftScreen.tsx')).toContain(
      'planb-draft'
    );
    expect(readOne('features/planb/ui/NoAlternativeScreen.tsx')).toContain(
      'planb-noalt'
    );
  });
});

describe('🔴 G6 · 라우트 골격(얇은 위임)', () => {
  it('draft.tsx 가 @/pages/planb-draft·PlanbDraftPage·useLocalSearchParams 로 위임한다', () => {
    const route = readOne(ROUTE_REL);
    expect(route).toContain('@/pages/planb-draft');
    expect(route).toContain('PlanbDraftPage');
    expect(route).toContain('useLocalSearchParams');
  });
});
