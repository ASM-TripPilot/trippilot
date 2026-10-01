/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1105 — 목적지 상세를 d01 지역 필터로 합친 뒤 남으면 안 되는 것들(소스 스캔).
 *
 * 무엇을 보장하나:
 *  - AC-17 — 목적지 상세의 흔적(장소 2열 격자·FAB 여백 `mr-[56px]`·화면/페이지 심볼·페이지 슬라이스
 *    경로·홈 진입 탭 타입)이 프로덕션 코드에 0건이다. TRIP-1076 AC-8(격자 FAB 여백)은 격자가 사라져 폐기.
 *  - 옛 페이지 슬라이스·화면 파일이 실제로 지워졌고, 옛 딥링크 라우트 파일은 리다이렉트로 **남아 있다**.
 *  - AC-8 — d01 page·화면은 탭바를 직접 import 하지 않는다(복제 탭바 0). 진짜 탭바는 `(tabs)` 레이아웃이
 *    그린다 — 그래서 어느 진입 경로로 와도 탭바는 '탐색'이다(실제 활성 표시는 6-b). 라우트 층은
 *    `tabsShell.test.tsx` 탐색 래퍼가 렌더로도 재지만 전국·게스트 한 갈래뿐이라, 모든 갈래는 이 스캔이 진다.
 *
 * 왜 소스 스캔인가: 지워진 파일·import 는 렌더 테스트가 볼 수 없다. 주석은 걷고 코드만 본다(02a ★14) —
 * 주석 속 옛 이름은 사정거리 밖이다. 테스트 파일은 뺀다 — 금지어를 문자열로 적어야 하는 이 파일과
 * 이관 테스트가 스스로 걸리지 않게(02a ★15).
 *
 * 리포 규약: "없어야 한다"는 "있어야 한다"(모집단·짝 앵커)와 같은 it 에 둔다.
 */

const ROOT = path.resolve('src');

const FORBIDDEN = [
  'mr-[56px]',
  'destination-detail-place-grid',
  'DestinationDetailScreen',
  'DestinationDetailPage',
  'pages/destination-detail',
  'RegionPickerTab',
];

const TABBAR_FROM = /from\s*['"]@\/shared\/ui\/BottomTabBar['"]/;

/** 블록 주석 먼저, 줄 주석은 바로 앞 글자가 `:` 면 보존(`https://` 보호 — 리포 관례). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** src 아래 테스트가 아닌 .ts/.tsx 전부(src 기준 상대경로, `/` 구분). */
function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path.relative(ROOT, full).split(path.sep).join('/')];
  });
}

function readCode(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

describe('G0 · 조합 자가검사 — 주석 제거가 금지어 코드를 지우지 않는다', () => {
  it('코드 속 금지어는 살아남아 잡히고, 주석 속 같은 글자는 걷힌다', () => {
    const code = [
      "import { DestinationDetailPage } from '@/pages/destination-detail';",
      '<View testID="destination-detail-place-grid" className="mr-[56px] gap-md" />',
      "const u = 'https://example.com/a'; // DestinationDetailScreen 은 주석",
      '/* RegionPickerTab 도 주석 */',
      "import { BottomTabBar } from '@/shared/ui/BottomTabBar';",
    ].join('\n');

    const stripped = stripComments(code);
    const hits = FORBIDDEN.filter((needle) => stripped.includes(needle));

    // 코드 줄의 4종은 남고, 주석 속 2종(DestinationDetailScreen·RegionPickerTab)은 걷혔다.
    expect(hits).toEqual([
      'mr-[56px]',
      'destination-detail-place-grid',
      'DestinationDetailPage',
      'pages/destination-detail',
    ]);
    expect(stripped).toContain('https://example.com/a');
    expect(TABBAR_FROM.test(stripped)).toBe(true);
    expect(
      TABBAR_FROM.test(
        stripComments(
          "// import { BottomTabBar } from '@/shared/ui/BottomTabBar';"
        )
      )
    ).toBe(false);
  });
});

describe('🔴 AC-17 · 목적지 상세 흔적 0건 (TRIP-1076 AC-8 폐기 · 고아 제거)', () => {
  it('프로덕션 코드 어디에도 금지어가 없다', () => {
    const files = productionFiles(ROOT);
    // 모집단 앵커 — 스캔이 실제로 src 를 훑었다(경로가 틀려 0파일이라 초록인 게 아니다).
    expect(files).toEqual(
      expect.arrayContaining([
        'pages/explore-landing/ui/ExploreLandingPage.tsx',
        'features/explore/ui/ExploreLandingScreen.tsx',
        'app/_dev/preview.tsx',
      ])
    );

    const offenders = files.flatMap((rel) => {
      const code = readCode(rel);
      return FORBIDDEN.filter((needle) => code.includes(needle)).map(
        (needle) => `${rel}: ${needle}`
      );
    });
    expect(offenders).toEqual([]);
  });

  it('옛 페이지 슬라이스·화면 파일은 지워졌고, 옛 딥링크 라우트는 리다이렉트로 남아 있다', () => {
    // 짝 — 리다이렉트 라우트 파일은 있어야 한다(AC-18, 행동은 destinationRedirectRoute.test).
    expect(
      fs.existsSync(path.join(ROOT, 'app/explore/destination/[region].tsx'))
    ).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'pages/destination-detail'))).toBe(
      false
    );
    expect(
      fs.existsSync(
        path.join(ROOT, 'features/explore/ui/DestinationDetailScreen.tsx')
      )
    ).toBe(false);
  });
});

describe('AC-8 · 탐색 탭은 복제 탭바를 그리지 않는다 (선제 green · 회귀 가드)', () => {
  it('(tabs)/_layout 은 탭바를 import 하고, d01 page·화면은 import 하지 않는다', () => {
    // 짝 — 진짜 탭바는 (tabs) 레이아웃이 그린다(탐지기가 헛돌지 않는다는 증거).
    expect(TABBAR_FROM.test(readCode('app/(tabs)/_layout.tsx'))).toBe(true);

    // 렌더 심판(tabsShell)은 전국·게스트 한 갈래만 그려 지역 필터·로그인 갈래의 탭바를 못 본다 —
    // 렌더가 모든 갈래를 볼 때만 스캔을 지울 수 있다(README 판정 3). 파일 전체 import 금지로 남긴다.
    expect(
      TABBAR_FROM.test(
        readCode('pages/explore-landing/ui/ExploreLandingPage.tsx')
      )
    ).toBe(false);
    expect(
      TABBAR_FROM.test(readCode('features/explore/ui/ExploreLandingScreen.tsx'))
    ).toBe(false);
  });
});
