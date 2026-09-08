/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-672 g02 거점 숙소 2/4 — **층 책임·제거 계약·화면 순수성 소스면 심판.**
 *
 * ── TRIP-225 판이 대규모 재작성됐다 ─────────────────────────────────────────────
 * 옛 default 얼굴(후보 하트·연박 묶음·커버리지·blocked·fixSheet·generateDisable)이 걷히고
 * **박별 거점 카드**로 바뀐다(D1·D2). 그래서 이 파일에서:
 *   - **삭제** ★1(GAP/OVERLAP·blocked 재판정 금지) — 커버리지 축이 통째로 사라져 주제 소멸.
 *   - **완화** ★7 — `${n}박` 금칙은 뗀다(신 메타 라인이 `${nightNumber}박`을 정당하게 그린다).
 *             `.sort(` 금칙은 유지(정렬·박 번호 소유는 여전히 순수 함수 몫).
 *   - **신설** AC-3 배선 제거(page 가 coverage/gate/fix 훅을 더는 import 안 함) · AC-1 앵커
 *             (`2 / 2` → `formatWizardStep(2)`) · INV-3 소스 스캔(옛 화면 테스트 ★6 승계).
 *   - **유지** AC-G1 라우트 두께 · d-층 실재 · 층 경계(화면 순수성) · TRIP-493 고정 푸터.
 *
 * ⚠️ 전처리 함정: 모든 스캔은 주석을 걷어낸 소스를 본다. 이 칸 소스엔 설계 근거 머리말이 붙고
 * 그 안에 `.sort(`·Figma URL 이 등장한다 — 걷지 않으면 산문이 부정 단언을 red 로 만든다(거짓 red).
 * 반대로 순진한 `//.*` 제거는 `'https://…'`의 슬래시를 주석으로 오인해 그 줄을 통째 지운다
 * (2026-07-31 실사고). 첫 describe 가 전처리와 탐지기를 함께 태워 둘이 서로를 안 지움을 잠근다.
 *
 * 가짜 통과 방지: 모든 "없어야 한다"는 "있어야 한다" 짝과 같은 it 안에 산다. 헬퍼는 파일마다 각자 갖는다.
 */

const SRC_ROOT = resolve(__dirname, '..');

const ROUTE_REL = 'app/trips/new/step2.tsx';
const BARREL_REL = 'pages/trip-new-step2/index.ts';
const PAGE_REL = 'pages/trip-new-step2/ui/TripNewStep2Page.tsx';
const SCREEN_REL = 'features/trip/ui/TripWizardStep2Screen.tsx';

/**
 * 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석 규칙에서 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** — `'https://…'`의 슬래시를
 * 주석 시작으로 오인하지 않기 위한 것이다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 구현 전에도 깨끗한 assertion diff 를 남긴다(ENOENT 예외 회피).
 * 빈 문자열이 부정 단언을 공짜로 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다. */
function readOne(rel: string): string {
  const full = join(SRC_ROOT, rel);
  if (!existsSync(full)) return '';
  return stripComments(readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: existsSync(join(SRC_ROOT, rel)) };
}

/** 주어진 소스들에서 needle 을 가진 파일 목록 — 위반을 파일 이름과 함께 남긴다. */
function offenders(
  sources: { file: string; source: string }[],
  needle: string | RegExp
): string[] {
  const test =
    typeof needle === 'string'
      ? (source: string) => source.includes(needle)
      : (source: string) => needle.test(source);
  return sources.filter(({ source }) => test(source)).map(({ file }) => file);
}

function read(rels: string[]): { file: string; source: string }[] {
  return rels.map((file) => ({ file, source: readOne(file) }));
}

describe('P-0 · 탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('머리말은 걷히고, 코드의 URL·정렬 탐지는 살아남는다 (전처리 × 탐지기)', () => {
    // 머리말 Figma URL·주석 속 정렬, 그리고 코드 쪽 URL·정렬이 함께 든 표본.
    const sample = [
      '/**',
      ' * g02 거점 숙소 2/4 — Figma https://www.figma.com/design/1MTF3dt?node-id=3657-2068',
      ' * 정렬(sort)은 순수 함수가 소유한다.',
      ' */',
      '// const dead = rows.sort((a, b) => (a.date < b.date ? -1 : 1));',
      "const url = 'https://cdn.example.com/x.jpg';",
      'const rows = nightlyBaseCards({ destinations, startDate, sections });',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 머리말 금칙어는 걷힌다 — 안 걷으면 산문이 부정 단언을 red 로 만든다.
    expect(stripped).not.toContain('figma.com');
    expect(/\.sort\s*\(/.test(stripped)).toBe(false);

    // ② 조합 검증 — 전처리 뒤에도 코드 URL 이 살아 있다(순진한 `//.*`는 여기서 URL 을 자른다).
    expect(stripped).toContain("const url = 'https://cdn.example.com/x.jpg';");
    expect(stripped).toContain('nightlyBaseCards(');

    // ③ 진짜 위반은 여전히 잡힌다 — 전처리 때문에 눈이 먼 것이 아니다.
    expect(/\.sort\s*\(/.test(stripComments('rows.sort((a, b) => 0);'))).toBe(
      true
    );
  });
});

describe('AC-G1 · 라우트는 얇다', () => {
  it('step2 라우트가 pages 배선을 가리키고, 마크업과 조회를 직접 갖지 않는다', () => {
    // 긍정 짝 ① — 파일이 실재한다(`typedRoutes` 라 사라지면 push 가 타입에서 막힌다).
    expect(existsPair(ROUTE_REL)).toEqual({ file: ROUTE_REL, exists: true });

    const source = readOne(ROUTE_REL);

    // 긍정 짝 ② — 빈 파일이 아니고 배선 층을 실제로 가리킨다.
    expect(source).toMatch(/export\s+default\s+function\s+\w+/);
    expect(source).toContain('@/pages/trip-new-step2');

    // 부정 — 라우트가 화면을 직접 그리거나 서버를 직접 부르면 층이 무너진다.
    const FORBIDDEN = [
      'View',
      'Text',
      'useTripBases',
      'useSavedStays',
      '@tanstack/react-query',
    ];
    expect(FORBIDDEN.filter((needle) => source.includes(needle))).toEqual([]);
  });
});

describe('d-층 파일이 실재하고 각자의 심볼을 갖는다', () => {
  it('배럴·배선·화면 셋이 서 있다', () => {
    [BARREL_REL, PAGE_REL, SCREEN_REL].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );

    expect(readOne(BARREL_REL)).toContain('TripNewStep2Page');
    expect(readOne(PAGE_REL)).toMatch(/export function TripNewStep2Page\b/);
    expect(readOne(SCREEN_REL)).toMatch(
      /export function TripWizardStep2Screen\b/
    );
  });
});

describe('AC-3 · 배선에서 커버리지·게이트·fix·지정 축이 통째로 빠진다 (D2)', () => {
  it('배선은 박별 카드 파생을 쓰고, 제거된 훅·게이트를 더는 import 하지 않는다', () => {
    const pageSource = readOne(PAGE_REL);

    // 긍정 짝 — 신 파생·유지 조회를 실제로 쓴다(빈 파일 공짜 통과 차단).
    expect(pageSource).toContain('nightlyBaseCards');
    expect(pageSource).toContain('toBaseSections');
    expect(pageSource).toContain('useTripBases');
    expect(pageSource).toContain('useSavedStays');

    // 부정 — 제거 계약(D2). 하나라도 남으면 "대규모 재작성 제거"가 새는 것이다. 파일 자체는
    // 삭제하지 않으므로(orphan) 이 소스 스캔이 "배선이 안 쓴다"의 유일한 그물이다(★7).
    const page = read([PAGE_REL]);
    [
      'useTripCoverage',
      'useAssignBase',
      'useUnassignBase',
      'baseGate',
      'useBaseFix',
      'useFixSavedStay',
      'useExtendTripPeriod',
    ].forEach((needle) => expect(offenders(page, needle)).toEqual([]));
  });
});

describe('★7(완화) · 정렬·박 번호는 순수 함수가 소유한다', () => {
  it('배선·화면이 다시 정렬하지 않는다 (`${n}박` 렌더는 이제 허용)', () => {
    const sources = read([PAGE_REL, SCREEN_REL]);

    // 부정 — 화면·배선이 몰래 다시 정렬하면 진실이 두 곳으로 갈린다(nightlyBaseCards·toBaseSections
    // 가 순서를 소유). `${n}박` 은 신 메타 라인이 정당하게 그리므로 더는 금칙이 아니다(완화).
    expect(offenders(sources, /\.sort\s*\(/)).toEqual([]);
  });

  it('여행 조회를 새로 붙이지 않는다 — startDate 는 스토어에서 온다', () => {
    const pageSource = readOne(PAGE_REL);

    expect(pageSource).toContain('startDate');
    expect(pageSource).not.toContain('useGetTripsTripId');
  });
});

describe('AC-1 · 진행 표시는 formatWizardStep(2)이다 (옛 "2 / 2" 하드코딩 제거)', () => {
  it('화면이 formatWizardStep 을 소비하고, 하드코딩 "2 / 2"가 사라졌다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정 — 진행 문자열의 단일 출처를 실제로 쓴다.
    expect(screenSource).toContain('formatWizardStep');
    // 부정 — 옛 2/2 (2칸) 표기가 남지 않는다.
    expect(screenSource).not.toContain('2 / 2');
  });
});

describe('INV-3 · 소요 시간은 소스 어디에도 없다 (옛 화면 테스트 ★6 승계)', () => {
  it('화면·배선 소스에 소요시간 표기가 0건이다 (거리만, duration 금지)', () => {
    const DURATION = /(\d+\s*분|\d+\s*시간|소요)/;

    // 자가검사 — 탐지기가 실제 소요시간 문자열을 문다.
    expect(DURATION.test('15분')).toBe(true);
    expect(DURATION.test('6/10(수)')).toBe(false); // 날짜 라벨은 안 걸린다.
    expect(DURATION.test('3박')).toBe(false); // 박 라벨은 안 걸린다.

    const sources = read([SCREEN_REL, PAGE_REL]);
    expect(offenders(sources, DURATION)).toEqual([]);
  });
});

describe('AC-7 · 화면에 raw hex 색이 없다 (토큰만, 색은 디자인시스템 경유)', () => {
  it('화면 소스에 `#rrggbb` 리터럴이 0건이다 (글리프는 별 파일 TripGlyphs 로 격리)', () => {
    // 자가검사 — 탐지기가 실제 hex 를 문다(오탐/미탐 방지).
    const RAW_HEX = /#[0-9a-fA-F]{3,8}\b/;
    expect(RAW_HEX.test('#ff385c')).toBe(true);
    // 임의값 사이즈(text-[16px]·rounded-[2px])는 # 이 없어 안 걸린다.
    expect(RAW_HEX.test('rounded-[2px]')).toBe(false);

    // 화면 본문은 토큰만 쓴다 — SVG stroke/fill 이 필요한 색은 `TripGlyphs.tsx`(별 파일)에 산다.
    expect(offenders(read([SCREEN_REL]), RAW_HEX)).toEqual([]);
  });
});

describe('층 경계 · 화면은 판정하지 않는다 (README §59·§66)', () => {
  it('화면이 조회·라우팅·스토어·생성 클라이언트·박별 파생을 모른다', () => {
    const screenSource = readOne(SCREEN_REL);

    // 긍정 짝 — 읽은 것이 정말 그 화면이고, 아이콘은 같은 feature 안에서 가져온다.
    expect(screenSource).toMatch(/export function TripWizardStep2Screen\b/);
    expect(screenSource).toContain('@/features/trip/ui/TripGlyphs');

    // 부정 — 화면이 이 중 하나라도 쥐면 "완성된 VM 만 받는다"는 계약이 깨진다.
    // `nightlyBaseCards`(밤 번호·지역 파생)는 배선 몫 — 화면이 부르면 파생이 두 곳에 산다.
    // (pure 셀렉터 `formatWizardStep` 은 표시 포맷이라 허용 — S1 자매 동형.)
    const FORBIDDEN = [
      'expo-router',
      '@tanstack/react-query',
      'useTripBases',
      'useSavedStays',
      'useTripWizardStore',
      '@/shared/api/generated',
      'toBaseSections',
      'nightlyBaseCards',
    ];
    expect(FORBIDDEN.filter((needle) => screenSource.includes(needle))).toEqual(
      []
    );
  });
});

describe('TRIP-493 · 하단 CTA는 스크롤 밖에 고정된다', () => {
  it('고정 푸터(border-t)가 ScrollView 를 닫은 뒤에 온다 (CTA 가 카드와 함께 스크롤되지 않는다)', () => {
    // 렌더 단언으로는 볼 수 없는 것: 두 CTA 가 카드 아래 파묻히지 않고 하단에 고정된다는 것.
    // 승인 테스트는 전부 testID 로 조회해 위치를 안 재므로 소스 순서로만 막는다.
    const source = readOne(SCREEN_REL);

    const scrollCloseIndex = source.indexOf('</ScrollView>');
    const footerIndex = source.indexOf('border-t border-hairline bg-canvas');

    // 긍정 짝 — 둘 다 실재한다(없으면 -1 비교가 부정 단언을 공짜로 통과시킨다).
    expect(scrollCloseIndex).toBeGreaterThan(-1);
    expect(footerIndex).toBeGreaterThan(-1);

    // 본체 — 고정 푸터가 ScrollView 를 닫은 뒤 온다 = 스크롤 자식이 아니다.
    expect(footerIndex).toBeGreaterThan(scrollCloseIndex);
  });
});
