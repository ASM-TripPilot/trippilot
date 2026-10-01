/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-979 B · AC-B3·B4·B6 · Seed Q5·Q6 — 재계획 지도 중심 소스 스캔.
 *
 * 무엇을 보장하나(초심자용):
 *  - G1 재계획 진행·결과·위치 입력 화면 소스에 **부산 좌표 상수**(해운대 35.1587/129.1604 ·
 *    광안리 35.1533/129.1189)가 0건이다. 렌더 테스트는 "이번 픽스처에서 부산이 안 나왔다"만 보므로,
 *    상수가 폴백 사다리 어딘가에 숨어 남는 것은 소스 층이라야 잡힌다.
 *  - G2 위치 입력 화면 소스에 `광안리`·`STAY_ANCHOR` 프리시드·`'등록 숙소 기준'` 라벨 리터럴·
 *    "등록 숙소를 기준으로" 힌트가 없다(Q6 — 숙소를 조회하지 않으니 숙소라고 말하면 거짓).
 *    소요·대기 시간 표기(`N초`·`N분`·`N시간`·`소요`)도 없다(INV-3, AC-B6).
 *  - G3 세 페이지가 같은 중심 유도 함수(`@/features/planb/model/replanMapCenter`)를 import 한다 —
 *    페이지마다 `pins[0]` 식 사본을 또 만들지 않는다.
 *  - G4 프리뷰는 **순수 뷰**(`@/pages/live-location/ui/LiveLocationView`)만 import 하고 배럴
 *    `@/pages/live-location` 은 import 하지 않는다 — 배럴은 컨테이너(네트워크 계층)를 함께 싣는다
 *    (traps-shell TRIP-610). 뷰는 값 import 로 네트워크·라우터·조회 훅을 물지 않는다.
 *
 * 소비처 census 는 **from 절을 먼저** 잡고 그 안에서 심볼을 본다(주석·문자열·동명 심볼 오탐 방지).
 * ★ 전처리×탐지기 조합 자가검사(G0): stripComments 로 가공한 뒤에도 코드 속 부산 좌표·금칙 리터럴은
 *   살아남고, 주석 속 것은 걷히는지를 실제 문자열로 확인한다(리포 실측 2건, URL `//` 오인).
 */

const ROOT = path.resolve('src');

const SOLVING = 'pages/planb-draft/ui/PlanbSolvingPage.tsx';
const DRAFT = 'pages/planb-draft/ui/PlanbDraftPage.tsx';
const LIVE_PAGE = 'pages/live-location/ui/LiveLocationPage.tsx';
const LIVE_VIEW = 'pages/live-location/ui/LiveLocationView.tsx';
const PREVIEW = 'app/_dev/preview.tsx';
const CENTER_MODULE = '@/features/planb/model/replanMapCenter';

const BUSAN_COORD = /35\.1587|129\.1604|35\.1533|129\.1189/;
const DURATION = /\d+\s*(초|분|시간)|소요/;

/** 블록 주석 → 줄 주석(콜론 뒤 `//` 는 URL 이라 제외). JSX `{/* … *\/}` 도 블록 주석으로 걷힌다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readRaw(rel: string): string {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

function readOne(rel: string): string {
  return stripComments(readRaw(rel));
}

function listSourceFiles(dirRel: string): string[] {
  const dir = path.join(ROOT, dirRel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = path.posix.join(dirRel, entry.name);
      if (entry.isDirectory()) return listSourceFiles(rel);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [rel];
    })
    .sort();
}

/** import 문 전수 — { typeOnly, clause, from }. 여러 줄 import 도 한 문장으로 잡는다. */
function importsOf(
  source: string
): { typeOnly: boolean; clause: string; from: string }[] {
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  return [...source.matchAll(re)].map((m) => ({
    typeOnly: Boolean(m[1]),
    clause: m[2],
    from: m[3],
  }));
}

describe('G0 · 전처리×탐지기 자가검사 (★ 조합 — 선제 green)', () => {
  it('주석 속 부산 좌표·금칙 문구는 걷히고, 코드 속 것과 URL 은 살아남는다', () => {
    const sample = [
      '// 옛 부산 폴백 35.1587, 129.1604 는 지웠다',
      '/* 광안리 인근 · STAY_ANCHOR 프리시드 · 5초 대기 */',
      'const FALLBACK = { lat: 35.1587, lng: 129.1604 };',
      "const label = '광안리 인근';",
      "const kind = 'STAY_ANCHOR';",
      "const seed = '등록 숙소 기준';",
      "const u = 'https://x.dev/a'; const b = 2;",
      '<Text>{/* 30분 */}여행지 기준</Text>',
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석 줄은 사라진다(부정 단언이 주석 산문에 거짓 red 가 나지 않게).
    expect(stripped).not.toContain('옛 부산 폴백');
    expect(stripped).not.toContain('프리시드');
    expect(stripped).not.toContain('30분');
    expect(DURATION.test(stripped)).toBe(false);
    // 코드 속 대상은 살아남는다(탐지기가 눈멀지 않았다).
    expect(BUSAN_COORD.test(stripped)).toBe(true);
    expect(stripped).toContain("'광안리 인근'");
    expect(stripped).toContain("'STAY_ANCHOR'");
    expect(stripped).toMatch(/['"`]등록 숙소 기준['"`]/);
    expect(stripped).toContain('https://x.dev/a');
    expect(stripped).toContain('const b = 2;');
    expect(stripped).toContain('여행지 기준');
    // 탐지기 단독 — 소요시간·대기시간 표기를 잡는다.
    expect(DURATION.test('5초 기다려요')).toBe(true);
    expect(DURATION.test('여유 1시간')).toBe(true);
  });

  it('import census — 여러 줄·type import 를 가르고, 주석 속 import 는 걷힌다', () => {
    const sample = [
      "// import { LiveLocationPage } from '@/pages/live-location';",
      'import {',
      '  LiveLocationView,',
      "} from '@/pages/live-location/ui/LiveLocationView';",
      "import type { StartReplanRequestOriginKind } from '@/shared/api/generated/schemas/startReplanRequestOriginKind';",
    ].join('\n');

    const imports = importsOf(stripComments(sample));

    expect(imports.map((i) => i.from)).toEqual([
      '@/pages/live-location/ui/LiveLocationView',
      '@/shared/api/generated/schemas/startReplanRequestOriginKind',
    ]);
    expect(imports[0].clause).toContain('LiveLocationView');
    expect(imports.map((i) => i.typeOnly)).toEqual([false, true]);
  });
});

describe('🔴 G1 · AC-B4 — 재계획 지도 화면 소스에 부산 좌표 상수가 0건', () => {
  it('pages/planb-draft · pages/live-location 비테스트 소스 전수에 35.1587·129.1604·35.1533·129.1189 가 없다', () => {
    const files = [
      ...listSourceFiles('pages/planb-draft'),
      ...listSourceFiles('pages/live-location'),
      ...listSourceFiles('features/planb/model').filter((rel) =>
        rel.endsWith('/replanMapCenter.ts')
      ),
    ];

    // 앵커 — 모집단에 이번에 바꾸는 파일이 실제로 있다(공집합 공허 통과 차단).
    for (const rel of [
      SOLVING,
      DRAFT,
      LIVE_PAGE,
      LIVE_VIEW,
      'features/planb/model/replanMapCenter.ts',
    ]) {
      expect(files).toContain(rel);
    }

    const offenders = files.filter((rel) => BUSAN_COORD.test(readOne(rel)));
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G2 · AC-B3·B6 · Q6 — 위치 입력 화면 소스에 부산·숙소 프리시드·시간 표기가 없다', () => {
  it('광안리·STAY_ANCHOR·등록 숙소 기준 리터럴·등록 숙소를 기준으로·소요/대기 시간이 0건', () => {
    const files = listSourceFiles('pages/live-location');
    expect(files).toEqual(
      expect.arrayContaining([
        LIVE_PAGE,
        LIVE_VIEW,
        'pages/live-location/index.ts',
      ])
    );

    const FORBIDDEN: [string, RegExp][] = [
      ['광안리', /광안리/],
      ['STAY_ANCHOR', /STAY_ANCHOR/],
      ["'등록 숙소 기준' 리터럴", /['"`]등록 숙소 기준['"`]/],
      ['등록 숙소를 기준으로', /등록 숙소를 기준으로/],
      ['소요·대기 시간', DURATION],
    ];
    const offenders = files.flatMap((rel) => {
      const code = readOne(rel);
      return FORBIDDEN.filter(([, re]) => re.test(code)).map(
        ([name]) => `${rel}: ${name}`
      );
    });
    expect(offenders).toEqual([]);

    // 긍정 짝 — 새 라벨·힌트 재료가 실제로 있다(파일을 비워 통과하는 길 차단).
    const view = readOne(LIVE_VIEW);
    expect(view).toContain('인근');
    expect(view).toContain('여행지 기준');
    expect(view).toContain('CenterPinPicker');
  });
});

describe('🔴 G3 · AC-B1 — 세 페이지가 같은 중심 유도 함수를 쓴다', () => {
  it.each([SOLVING, DRAFT, LIVE_PAGE])(
    '%s 가 @/features/planb/model/replanMapCenter 에서 값을 import 한다',
    (rel) => {
      const fromCenter = importsOf(readOne(rel)).filter(
        (i) => i.from === CENTER_MODULE && !i.typeOnly
      );
      expect(fromCenter.length).toBeGreaterThan(0);
    }
  );
});

describe('🔴 G4 · 맹점 ①-4 — 프리뷰는 순수 뷰만 싣고, 뷰는 네트워크·라우터·조회를 모른다', () => {
  it('preview.tsx 는 @/pages/live-location/ui/LiveLocationView 에서 LiveLocationView 를 import 하고, 배럴·LiveLocationPage 는 import 하지 않는다', () => {
    const imports = importsOf(readOne(PREVIEW));
    const liveImports = imports.filter((i) =>
      i.from.startsWith('@/pages/live-location')
    );

    expect(liveImports.map((i) => i.from)).toEqual([
      '@/pages/live-location/ui/LiveLocationView',
    ]);
    expect(liveImports[0]?.clause).toContain('LiveLocationView');
    expect(liveImports.some((i) => i.clause.includes('LiveLocationPage'))).toBe(
      false
    );
  });

  it('LiveLocationView 의 값 import 에 네트워크·라우터·조회·요청·폼 스토어·컨테이너가 없다', () => {
    const view = readOne(LIVE_VIEW);
    expect(view).not.toBe('');

    const BANNED = [
      /^@\/shared\/api(\/|$)/,
      /^expo-router$/,
      /^@tanstack\/react-query$/,
      /^@\/features\/execution\//,
      /useStartReplan$/,
      /replanFormStore$/,
      /LiveLocationPage$/,
    ];
    const offenders = importsOf(view)
      .filter((i) => !i.typeOnly)
      .map((i) => i.from)
      .filter((from) => BANNED.some((re) => re.test(from)));
    expect(offenders).toEqual([]);
  });
});
