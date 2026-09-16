/**
 * @jest-environment node
 */
// TRIP-783 · widgets/map-sheet-shell + entities 신규 카드/상수 소스 층 가드(fs 소스 스캔).
// 렌더로 못 보는 것만 본다: 파일이 정본 경로에 실재하는가 · 위젯이 소요시간을 표기하는가 ·
// 위젯이 상위층/형제 위젯을 무는가 · 카드가 raw hex 로 토큰을 우회하는가 · ALT_LABEL 이 공용 상수인가.
//
// 무엇을 보장하나:
//  - AC-1 배치: 신규 9파일이 widgets/map-sheet-shell/ui · entities/itinerary-slot/{ui,config} 에 실재.
//  - AC-4 INV-3: `widgets/**` 를 훑는 소요시간 스캔이 리포에 0건이라(entities·features·record·notification
//    만 존재) 이 파일이 **위젯 층 유일 INV-3 그물**이다(02a ★8, recordsCompareStructure G5 gap-filler 선례).
//  - AC-2 경계: 위젯이 @/pages·@/app·expo-router·형제 위젯을 안 물고 @/shared/map·@/entities 를 문다.
//  - AC-5 카드 raw hex: entities SlotStopCard 가 토큰 클래스만 쓴다(entities 엔 raw-hex 스캔이 없어 gap).
//  - AC-7: ALT_LABEL 이 config 세그먼트의 단일 상수 '다른 후보 ›'.
//
// 리포 확립 규약: "없어야 한다"(부정)는 "있어야 한다"(긍정 짝)와 같은 it 안에 둔다.
// 이 파일은 `pnpm test -- <경로>` 로 돈다(ESLint 미사용이라 NODE_OPTIONS 불필요).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');
const SHELL_DIR = path.join(ROOT, 'widgets', 'map-sheet-shell');

// 소요시간 표기 탐지기(TimeSheet CS6·executionDurationStructure 이식). HH:mm(숫자 뒤 `:`)은 안 걸린다.
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

// 토큰으로 이미 존재하는 색 — raw hex 로 적으면 토큰 우회(widgetsStructure 와 같은 목록).
const TOKENIZED_HEX = [
  '#222222',
  '#6a6a6a',
  '#ededed',
  '#dddddd',
  '#ff385c',
  '#ffe4e9',
  '#c13515',
  '#f7f7f7',
  '#3f3f3f',
  '#9aa1ab',
  '#ffffff',
];

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석 먼저. 줄 주석은 바로 앞이 `:` 면 주석으로 안 본다
 * (`'https://…'` 의 슬래시 오인 방지, 리포 동결 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function readScoped(dir: string): { file: string; source: string }[] {
  return listSourceFiles(dir).map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 소요시간·hex 는 걷히고, 코드의 거리·시각·URL 은 살아남되 소요시간으로 오탐되지 않는다', () => {
    // ★ 조합 검증 — 전처리와 탐지기가 서로를 지우는지 실제 문자열로 본다(02a ★7).
    const sample = [
      '/** 소요시간(30분)은 표시하지 않는다. raw hex(#ff385c) 금지 주석. */',
      '// 이동시간 자동 계산 불가 주석.',
      "const pending = '이동 거리 계산 중';",
      "const chip = '10:00–11:00';",
      "const dist = '3.5km';",
      "const doc = 'https://cdn.example.com/a.png';",
    ].join('\n');

    const s = stripComments(sample);

    // 주석 속 소요시간·hex 는 걷힌다.
    expect(DURATION_TEXT.test(s.split('\n').slice(0, 2).join('\n'))).toBe(
      false
    );
    expect(s.toLowerCase()).not.toContain('#ff385c');

    // 코드의 거리·시각·계산중 문구는 소요시간으로 오탐되지 않는다.
    expect(DURATION_TEXT.test('이동 거리 계산 중')).toBe(false);
    expect(DURATION_TEXT.test('10:00–11:00')).toBe(false); // 숫자 뒤 `:`
    expect(DURATION_TEXT.test('3.5km')).toBe(false);
    // URL 의 `://` 는 보존된다(주석으로 오인 안 함).
    expect(/https?:\/\//.test(s)).toBe(true);
    // 탐지기가 진짜 소요시간은 잡는다.
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
  });
});

describe('🔴 G1 · AC-1 배치 — 신규 9파일이 정본 경로에 실재', () => {
  it('widgets/map-sheet-shell/ui 5 + Glyphs + entities 카드/글리프/config 가 있다', () => {
    // 위젯 슬라이스 부품.
    expect(exists('widgets/map-sheet-shell/ui/MapSheetShell.tsx')).toBe(true);
    expect(exists('widgets/map-sheet-shell/ui/SheetHeader.tsx')).toBe(true);
    expect(exists('widgets/map-sheet-shell/ui/DistanceConnector.tsx')).toBe(
      true
    );
    expect(exists('widgets/map-sheet-shell/ui/CtaBar.tsx')).toBe(true);
    expect(exists('widgets/map-sheet-shell/ui/DayChipOverlay.tsx')).toBe(true);
    // 커넥터 이동수단 글리프 — @/features import 금지라 로컬 필수(02a ★5).
    expect(exists('widgets/map-sheet-shell/ui/MapSheetGlyphs.tsx')).toBe(true);
    // entities 신규 카드 + config 상수.
    expect(exists('entities/itinerary-slot/ui/SlotStopCard.tsx')).toBe(true);
    expect(exists('entities/itinerary-slot/config/altLabel.ts')).toBe(true);
    // 시각 칩 글리프 — SlotGlyphs 에 ClockGlyph 추가(로컬 복제).
    expect(readOne('entities/itinerary-slot/ui/SlotGlyphs.tsx')).toContain(
      'ClockGlyph'
    );
  });
});

describe('🔴 G2 · AC-4 INV-3 — 위젯 층에 소요시간 표기 0 (위젯 유일 그물)', () => {
  it('widgets/map-sheet-shell 전 소스에 소요시간 0 + 커넥터 계산중 문구 긍정 짝', () => {
    const sources = readScoped(SHELL_DIR);

    // 긍정 앵커 — 모집단이 채워졌고 커넥터가 "이동 거리 계산 중"을 그린다(빈 dir 공허 통과 차단).
    expect(sources.length).toBeGreaterThanOrEqual(1);
    expect(
      sources.some(({ source }) => source.includes('이동 거리 계산 중'))
    ).toBe(true);

    // 부정 — 소요시간 표기 0(분·시간·소요). 위젯 층엔 다른 INV-3 스캔이 없다(02a ★8).
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G3 · AC-2 경계 — 위젯은 상위층·형제 위젯을 안 물고 shared·entities 를 문다', () => {
  it('@/pages·@/app·expo-router·형제 위젯 0 (부정) + shell 이 @/shared/map·@/entities import (긍정 짝)', () => {
    const sources = readScoped(SHELL_DIR);

    // 긍정 짝 — 셸이 지도(shared)와 카드(entities)를 실제로 참조한다(빈 dir 공허 통과 차단).
    const shell = readOne('widgets/map-sheet-shell/ui/MapSheetShell.tsx');
    expect(shell).toContain('@/shared/map');
    expect(shell).toContain('@/entities/itinerary-slot');

    // 부정 — 상위층·라우터·형제 위젯 역참조 0.
    const FORBIDDEN = [
      { name: '@/pages/', hit: (s: string) => s.includes('@/pages/') },
      { name: '@/app/', hit: (s: string) => /@\/app\//.test(s) },
      { name: '@/app-shell', hit: (s: string) => s.includes('@/app-shell') },
      { name: 'expo-router', hit: (s: string) => s.includes('expo-router') },
      {
        name: '@/widgets/itinerary-edit',
        hit: (s: string) => s.includes('@/widgets/itinerary-edit'),
      },
      {
        name: '@/widgets/time-sheet',
        hit: (s: string) => s.includes('@/widgets/time-sheet'),
      },
      { name: '@/features/', hit: (s: string) => s.includes('@/features/') },
    ];
    const offenders = sources.flatMap(({ file, source }) =>
      FORBIDDEN.filter((rule) => rule.hit(source)).map(
        (rule) => `${file}: ${rule.name}`
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G4 · AC-5 raw hex — entities 카드는 토큰 클래스만 쓴다(entities raw-hex gap)', () => {
  it('SlotStopCard.tsx 에 TOKENIZED_HEX 0 (부정) + 토큰 클래스 사용 (긍정 짝)', () => {
    const card = readOne('entities/itinerary-slot/ui/SlotStopCard.tsx');

    // 긍정 짝 — 카드가 실재하고 토큰 클래스를 쓴다(빈 파일 공허 통과 차단).
    expect(card.length).toBeGreaterThan(0);
    expect(/\bbg-canvas\b|\bbg-primary\b/.test(card)).toBe(true);

    // 부정 — 토큰화된 색을 raw hex 로 적지 않는다(그림자 #000000·글리프는 이 파일 밖이라 무관).
    const offenders = TOKENIZED_HEX.filter((hex) =>
      card.toLowerCase().includes(hex)
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G5 · AC-7 — ALT_LABEL 이 config 세그먼트의 단일 공용 상수', () => {
  it("config/altLabel.ts 가 ALT_LABEL = '다른 후보 ›' 를 export 한다", () => {
    const cfg = readOne('entities/itinerary-slot/config/altLabel.ts');

    expect(cfg).toContain('ALT_LABEL');
    expect(cfg).toContain('다른 후보 ›');
  });
});
