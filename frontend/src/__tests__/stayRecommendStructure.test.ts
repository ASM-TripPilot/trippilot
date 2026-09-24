/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-800 · h15 동선 기준 숙소 추천 — 소스 층 가드(AC-10 · 01b Q1·Q2·Q5 · INV-3).
 *
 * 왜 소스 층인가: 이 화면의 가장 위험한 실패는 "실앱에 가짜 추천이 뜬다"이다. h14 거점 없음 카드가 **이미**
 * 이 라우트로 push 하므로(브리프 맹점 ①-1) 라우트가 픽스처를 쓰는 순간 사용자가 지어낸 숙소 3곳을 본다.
 * 렌더 테스트는 "넘긴 데이터를 잘 그린다"만 보고, **누가 무엇을 넘기는가**는 소스에서만 보인다.
 *
 * 무엇을 보장하나:
 *  - G1 라우트는 얇다 — 페이지만 렌더하고 `recommendations` 를 **넘기지 않는다**(01b Q2).
 *  - G2 페이지는 거점 지정 mutation 을 문다(긍정) · 프리뷰·픽스처를 안 문다(부정).
 *  - G3 뷰(pages 순수 뷰)는 셸로 지도를 그린다 · `mapFallback` 우회·직접 `<MapView>`·타 feature·mutation·네트워크
 *    런타임 import 가 없다(프리뷰가 뷰만 태울 수 있어야 한다 — 전이 로드 지뢰, 02a ★15·★16·★21).
 *  - G3b 옛 자리(`features/itinerary/ui/StayRecommendScreen.tsx`)는 없고, features 층 어디도 `@/widgets` 를 안 문다(★21).
 *  - G4 프리뷰 픽스처 숙소 이름이 `app/_dev` 밖 프로덕션 소스에 0(선제 green 회귀 앵커, ★12).
 *  - G5 신규 파일에 `duration` 식별자 0(INV-3).
 *
 * 무엇을 보장하지 **못**하나: 글자까지다. 페이지가 `useAssignBase` 를 import 만 하고 안 불러도 G2 는 green —
 *   실제 요청은 통합 테스트(`StayRecommendPage.integration.test.tsx`)가 본다.
 *
 * ⚠️ 전처리+탐지기 조합(02a §5): 주석을 걷은 뒤 스캔한다. `(^|[^:])\/\/` 라 `https://` 의 `//` 는 주석으로
 *   오인하지 않는다(문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]]). G0 가 실제 문자열로
 *   먼저 확인한다.
 *
 * *유지 판정: 3사이클 관찰 — TRIP-823(실 추천 API) 배선 사이클에서 G1·G2 의 "recommendations 미전달"은 훅
 *  배선으로 바뀌므로 그때 이 파일을 재조준한다. G4 가 한 번도 red 를 못 내면 G1·G2 로 흡수해 뗀다.*
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/trips/[tripId]/itinerary/stay-recommend.tsx';
const PAGE_DIR_REL = 'pages/itinerary-stay-recommend';
const PAGE_REL = 'pages/itinerary-stay-recommend/ui/StayRecommendPage.tsx';
// 셸을 조립하는 뷰는 pages 층(02a D12 · ★21) — features 는 widgets 를 import 할 수 없다.
const VIEW_REL = 'pages/itinerary-stay-recommend/ui/StayRecommendView.tsx';
const CARD_REL = 'entities/stay/ui/StayRecommendCard.tsx';
const MODEL_REL = 'features/itinerary/model/stayRecommend.ts';
const PARTICLE_REL = 'features/itinerary/lib/objectParticle.ts';

/** 프리뷰 픽스처(Figma 4385:1623)의 숙소 이름 — 실앱 소스에 나오면 가짜 추천이 새는 것이다. */
const FIXTURE_STAY_NAMES = [
  '해운대 그랜드 호텔',
  '서면 시티 호텔',
  '광안리 오션뷰',
];

/** `@/shared/api…` 를 **런타임으로** 무는 import(`import type` 은 번들에서 지워져 안전). */
const RUNTIME_API_IMPORT =
  /^import\s+(?!type\b)[^;]*?from\s+'@\/shared\/api[^']*'/m;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 같은 it 의 실재 앵커가 먼저 red 를 낸다(빈 문자열 공허 통과 차단). */
function readRel(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

describe('G0 · 탐지기 자가검사 — 주석 걷기와 import 탐지가 서로를 지우지 않는다', () => {
  it('주석 속 금칙어는 걷히고, 코드의 런타임 import·URL 은 남으며, import type 은 런타임으로 안 친다', () => {
    const sample = [
      "import type { StayPrice } from '@/shared/api/generated/schemas';",
      "// import { x } from '@/shared/api';",
      "/* import { y } from '@/shared/api' */",
      "const url = 'https://example.com'; // mapFallback 우회 금지",
    ].join('\n');
    const stripped = stripComments(sample);

    // 주석 속 import·mapFallback 은 사라진다.
    expect(RUNTIME_API_IMPORT.test(stripped)).toBe(false);
    expect(/\bmapFallback\b/.test(stripped)).toBe(false);
    // 코드의 URL 은 살아남는다(`://` 를 주석으로 오인하지 않는다).
    expect(stripped).toContain("'https://example.com'");
    // 한 줄·여러 줄 런타임 import 는 잡힌다.
    expect(
      RUNTIME_API_IMPORT.test(
        "import { postTripsTripIdBases } from '@/shared/api/generated/trips/trips';"
      )
    ).toBe(true);
    expect(
      RUNTIME_API_IMPORT.test(
        "import {\n  a,\n  b,\n} from '@/shared/api/generated/trips/trips';"
      )
    ).toBe(true);
  });
});

describe('🔴 G1 · AC-10 · Q2 — 라우트는 얇고, 추천 데이터를 넘기지 않는다', () => {
  it('라우트 파일이 페이지만 렌더하고 recommendations 글자가 없다', () => {
    const route = readRel(ROUTE_REL);

    // 실재 앵커 — 라우트가 있다(없으면 h14 링크가 404 로 떨어진다).
    expect(fs.existsSync(path.join(ROOT, ROUTE_REL))).toBe(true);
    expect(route).toContain("from '@/pages/itinerary-stay-recommend'");
    expect(route).toContain('<StayRecommendPage');

    // 부정 — 라우트가 추천 뷰를 만들어 넘기면 실앱에 가짜 추천이 뜬다.
    expect(route).not.toMatch(/\brecommendations\b/);
  });
});

describe('🔴 G2 · AC-10 — 페이지는 mutation 을 물고, 프리뷰·픽스처는 안 문다', () => {
  it('페이지 슬라이스 소스에 useAssignBase(긍정) · @/app·preview·fixture 0(부정)', () => {
    const files = listSourceFiles(path.join(ROOT, PAGE_DIR_REL)).map(relOf);

    // 실재 앵커 — 페이지·배럴이 있다.
    expect(files).toEqual(
      expect.arrayContaining([PAGE_REL, `${PAGE_DIR_REL}/index.ts`])
    );
    // 긍정 — 거점 지정 배선은 페이지 층에 산다(features/itinerary 는 features/trip 을 못 문다).
    expect(readRel(PAGE_REL)).toContain('useAssignBase');

    // 부정 — 프리뷰(`app/_dev`)나 픽스처를 무는 파일이 없다.
    const offenders = files.filter((rel) => {
      const source = readRel(rel);
      return (
        /from\s+'@\/app/.test(source) ||
        /preview/i.test(source) ||
        /fixture/i.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G3 · Q5 · ★15·★16·★21 — pages 뷰는 셸로 지도를 그리고, 네트워크·타 feature 를 모른다', () => {
  it('<MapSheetShell 사용(긍정) · mapFallback·<MapView·@/features/trip·useAssignBase·런타임 api import 0(부정)', () => {
    const view = readRel(VIEW_REL);

    // 실재·긍정 앵커.
    expect(fs.existsSync(path.join(ROOT, VIEW_REL))).toBe(true);
    expect(view).toContain('<MapSheetShell');

    // 반경 원은 셸 prop 으로 — 폴백 슬롯에 자체 지도를 끼우는 우회 금지(01b Q5).
    expect(view).not.toMatch(/\bmapFallback\b/);
    // 뷰가 `<MapView>` 를 직접 쓰면 셸의 실패 폴백·잠금 규칙을 잃는다(itineraryMapSurfaceStructure S2 명부 밖).
    expect(view).not.toContain('<MapView');
    // 프리뷰가 뷰만 태울 수 있게 — mutation·타 feature·네트워크 런타임 import 0.
    expect(view).not.toContain('@/features/trip');
    expect(view).not.toContain('useAssignBase');
    expect(RUNTIME_API_IMPORT.test(view)).toBe(false);
  });
});

describe('🔴 G3b · ★21 — 셸 조립이 features 층으로 새지 않는다 (층 방향)', () => {
  it('옛 features 화면 파일 부재 + features 층 소스에 @/widgets import 0 (긍정 짝: features 층을 실제로 훑었다)', () => {
    // 옛 자리 — 여기 두면 features → widgets 역참조(eslint 층 zone error)가 된다.
    expect(
      fs.existsSync(
        path.join(ROOT, 'features/itinerary/ui/StayRecommendScreen.tsx')
      )
    ).toBe(false);

    const files = listSourceFiles(path.join(ROOT, 'features')).map(relOf);
    // 도달 앵커 — features 층을 실제로 훑었다(경로 오타 공허 통과 차단).
    expect(files.length).toBeGreaterThan(50);

    const offenders = files.filter((rel) =>
      /from\s+'@\/widgets/.test(readRel(rel))
    );
    expect(offenders).toEqual([]);
  });
});

describe('🟢 G4 · ★12 — 프리뷰 픽스처 숙소 이름은 app/_dev 밖 프로덕션 소스에 없다 (선제 green 회귀 앵커)', () => {
  it('src 전체(테스트·app/_dev 제외)에 픽스처 숙소 이름 3개가 0건', () => {
    const files = listSourceFiles(ROOT)
      .map(relOf)
      .filter((rel) => !rel.startsWith('app/_dev/'));

    // 도달 앵커 — 실제로 많이 훑었다(경로 오타로 빈 목록이 공허 통과하는 것 차단).
    expect(files.length).toBeGreaterThan(300);

    const offenders = files.filter((rel) => {
      const source = readRel(rel);
      return FIXTURE_STAY_NAMES.some((name) => source.includes(name));
    });
    expect(offenders).toEqual([]);
  });
});

describe('🔴 G5 · INV-3 — 신규 파일에 duration 식별자 0', () => {
  it.each([ROUTE_REL, PAGE_REL, VIEW_REL, CARD_REL, MODEL_REL, PARTICLE_REL])(
    '%s — 실재하고 duration 이 없다',
    (rel) => {
      // 실재가 긍정 짝(없는 파일의 빈 문자열이 공짜로 통과하지 않게).
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
      expect(readRel(rel)).not.toMatch(/\bduration\b/i);
    }
  );
});
