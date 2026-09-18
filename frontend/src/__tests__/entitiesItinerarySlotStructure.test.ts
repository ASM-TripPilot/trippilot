/**
 * @jest-environment node
 */
// TRIP-809 · AC-8 · INV-1·INV-3 — entities/itinerary-slot 층 구조 가드(fs 소스 스캔). 806·807·808 동형.
// entities 는 shared(+슬라이스 내부 상대)만 참조하고 props-only(상태·라우터·query·store 0) 여야 한다.
// 카드가 이미지 URL 을 지어내면(INV-1) · 소요시간을 표시하면(INV-3) 여기서 잡힌다.
//
// ⚠️ 이 가드는 이관된 슬롯 표면의 **유일한 INV-3 그물**이다(02a ★8). SlotPhotoPlaceholder·PoiSlotCard 는
//    `itineraryTimeStructure`(features/itinerary/ui) 밖으로, ReplanSlotRow 는 `executionDurationStructure`
//    (features/{execution,planb}/ui) 밖으로 실질 이동한다(옛 자리엔 재수출 shim 만 남아 내용이 없다).
//    그 사정거리를 여기서 다시 세운다.
// ⚠️ 글리프(`SlotGlyphs.tsx`)는 SVG raw-hex 관례로 스캔 제외 대상이지만, 이 파일은 raw-hex 를 안 본다
//    (INV-3·INV-1 만). 글리프 fill·모양은 jest 원리적 사각(6-b 육안, traps-itinerary).
//
// 이 파일은 `pnpm test -- <경로>` 로 돈다(ESLint 미사용이라 NODE_OPTIONS 불필요).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');
const SLOT_DIR = path.join(ROOT, 'entities', 'itinerary-slot');

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석 먼저(순서 바꾸면 한 줄 코드가 소실). 줄 주석은 **바로 앞이
 * `:` 면 주석으로 안 본다** — `'https://…'` 의 슬래시를 주석 시작으로 오인하지 않기 위함(문제로그
 * [[2026-07-31 stripComments 가 URL 슬래시 오인]] 계열 회귀 방지). 808 entitiesTrip* 와 동일 규칙.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 디렉토리를 재귀로 훑어 프로덕션 소스(.ts/.tsx, 테스트·generated 제외) 절대경로를 모은다. */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'generated' ? [] : listSourceFiles(full);
      }
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readScoped(dir: string): { file: string; source: string }[] {
  return listSourceFiles(dir).map((full) => ({
    file: path.relative(ROOT, full).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 소스 스캔이 의미를 갖는다', () => {
  it('주석 속 금칙어는 걷히고, 코드의 URL·자기참조·duration 은 살아남는다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 실제 문자열로 본다(문제로그 2026-07-31 계열).
    const sample = [
      '/** layer-entities.md: @/features/x 는 entities 가 못 본다. */',
      "// import { SlotPhotoPlaceholder } from '@/features/itinerary/ui/SlotPhotoPlaceholder';",
      "import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';",
      "const doc = 'https://example.com/a//b';",
      "const bad = '@/features/planb/ui/Foo';",
      'const dwell = slotDuration;',
    ].join('\n');

    const s = stripComments(sample);

    // 주석 속 @/features 는 걷힌다.
    const commentLines = s.split('\n').slice(0, 2).join('\n');
    expect(/@\/features\//.test(commentLines)).toBe(false);
    // 코드의 @/features·URL·shared 는 살아남는다(콜론 뒤 `//` 는 주석 아님).
    expect(/@\/features\//.test(s)).toBe(true);
    expect(/https?:\/\//.test(s)).toBe(true);
    expect(s).toContain('@/shared/api/generated/schemas');
    // INV-3 는 substring `/duration/i` — `\bduration\b` 는 slotDuration 을 놓친다(807 ★9).
    expect(/duration/i.test(s)).toBe(true);
    expect(/\bduration\b/i.test(s)).toBe(false);
  });
});

describe('🔴 G1 · entities/itinerary-slot 3세그먼트 대표 파일 실재(빈 층 공허 통과 차단)', () => {
  it('lib(순수 2벌: 카테고리 매핑 · 슬롯 키)·model·ui 에 대표 파일이 있다', () => {
    // lib 은 순수 헬퍼 2파일(카테고리 플레이스홀더 매핑 · 슬롯 키 규약, 01b 세그먼트 결정).
    expect(
      fs.existsSync(path.join(SLOT_DIR, 'lib', 'categoryPlaceholder.ts'))
    ).toBe(true);
    expect(fs.existsSync(path.join(SLOT_DIR, 'lib', 'slotKey.ts'))).toBe(true);
    // model 은 서버 타입 재수출 + VM 타입(파생 함수 0).
    expect(fs.existsSync(path.join(SLOT_DIR, 'model'))).toBe(true);
    // ui 는 카드·플레이스홀더·글리프.
    const uiFiles = listSourceFiles(path.join(SLOT_DIR, 'ui'));
    expect(uiFiles.length).toBeGreaterThanOrEqual(1);
  });
});

describe('🔴 G2 · props-only — entities/itinerary-slot 은 shared(+슬라이스 내부)만 참조한다', () => {
  it('금칙 import 0 + shared 참조 긍정 짝', () => {
    const sources = readScoped(SLOT_DIR);

    // 긍정 짝 — 모집단이 채워졌고 shared(슬롯 타입 재수출 등)를 참조한다(빈 층이면 red).
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(sources.some(({ source }) => source.includes('@/shared/'))).toBe(
      true
    );

    // 부정 — 역참조·상태·라우터·query·store·네트워크 금지.
    const FORBIDDEN = [
      { name: '@/features/', hit: (s: string) => s.includes('@/features/') },
      { name: '@/pages/', hit: (s: string) => s.includes('@/pages/') },
      { name: '@/widgets/', hit: (s: string) => s.includes('@/widgets/') },
      { name: 'expo-router', hit: (s: string) => s.includes('expo-router') },
      { name: 'zustand', hit: (s: string) => s.includes('zustand') },
      {
        name: '@tanstack/react-query',
        hit: (s: string) => s.includes('@tanstack/react-query'),
      },
      { name: 'axios', hit: (s: string) => /from ['"]axios['"]/.test(s) },
      {
        name: 'customInstance',
        hit: (s: string) => s.includes('customInstance'),
      },
      {
        name: 'query/mutation hook',
        hit: (s: string) =>
          /\buse(Get|Post|Put|Patch|Delete)[A-Z]\w*|\buse(Query|Mutation)\b/.test(
            s
          ),
      },
    ];
    const offenders = sources.flatMap(({ file, source }) =>
      FORBIDDEN.filter((rule) => rule.hit(source)).map(
        (rule) => `${file}: ${rule.name}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('ui 카드·플레이스홀더는 로컬 상태를 갖지 않는다(useState·useReducer 0)', () => {
    const uiSources = readScoped(path.join(SLOT_DIR, 'ui'));

    // 긍정 짝 — ui 모집단이 실재.
    expect(uiSources.length).toBeGreaterThanOrEqual(1);

    const offenders = uiSources
      .filter(({ source }) => /\buseState\b|\buseReducer\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G3 · INV-3 — entities/itinerary-slot(ui·lib) 에 소요시간 표기 0 (거리·시각만)', () => {
  it('duration 식별자 0 + 슬롯 표면 실재 긍정 짝', () => {
    const sources = [
      ...readScoped(path.join(SLOT_DIR, 'ui')),
      ...readScoped(path.join(SLOT_DIR, 'lib')),
    ];

    // 긍정 짝 — 이관된 슬롯 표면이 실재(빈 층 공허 통과 차단). 카테고리 매핑(lib)과 시각(ui) 둘 다.
    expect(
      sources.some(({ source }) =>
        source.includes('resolveCategoryPlaceholder')
      )
    ).toBe(true);
    expect(sources.some(({ source }) => source.includes('startAt'))).toBe(true);

    // 부정 — substring `/duration/i`(807 ★9, `\bduration\b` 는 slotDuration 을 놓친다).
    // ReplanSlotRow 의 metaText·PoiSlotCard 의 startAt.slice 는 duration 문자열이 아니라 통과.
    // 이 가드가 이관 후 슬롯 표면의 유일 INV-3 그물(02a ★8).
    const offenders = sources
      .filter(({ source }) => /duration/i.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G4 · INV-1 — 카드가 이미지 URL 을 지어내지 않는다(imageUrl null → 회색/틴트 자리)', () => {
  it('ui 소스에 외부 이미지 URL 리터럴 0 + 회색/틴트 자리 긍정 짝', () => {
    const uiSources = readScoped(path.join(SLOT_DIR, 'ui'));

    // 긍정 짝 — 사진 없는 자리를 회색(bg-surface-soft) 또는 카테고리 틴트로 정직하게 그린다
    // (imageUrl null 에 기본 이미지를 발명하지 않는다 · TRIP-219 · INV-1). PoiSlotCard 회색 자리 ·
    // SlotPhotoPlaceholder 틴트 타일이 이 짝을 진다.
    expect(
      uiSources.some(({ source }) => source.includes('bg-surface-soft'))
    ).toBe(true);

    // 부정 — 코드 리터럴 URL 0(주석 URL 은 stripComments 로 이미 걷힘, `://` 보존 후 코드만 스캔).
    const offenders = uiSources
      .filter(({ source }) => /https?:\/\//.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
