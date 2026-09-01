/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-573 · j05 여행 스타일 — travel-style 슬라이스 소스 층 가드
 * (`reflectionSummaryStructure.test.ts` + `shareCardStructure.test.ts` 미러).
 *
 * 무엇을 보장하나:
 *  - **G0 자가검사**: stripComments × DURATION_TEXT 조합이 서로를 안 지운다(콜론예외 URL 보존).
 *  - **G1 편입 앵커**: 신규 9파일이 정본 경로에 실재한다(구현 전 red).
 *  - **G3 3층 책임**: 라우트→페이지→화면/훅 이 각자 몫만 진다.
 *  - **G4 testID 2종**: reflection-style-bar(CategoryBarList)·reflection-style-evidence(EvidenceLink).
 *  - **G5 · AC-4(BR-U5-41·INV-U5-09)**: 신규 feature 파일에 저장 mutation 훅·customInstance·axios 0
 *    + `useGetMeStyle` 재사용 앵커. **선재 reflectionStructure G5 는 customInstance/axios 만 훑어
 *    mutation 훅 import 는 사각**(recordsCompareStructure G4 선례) — 이 가드가 유일 그물(gap-filler).
 *  - **AC-6 라우트 경계(INV-U5-08)**: `app/records/style.tsx` 존재 + `app/records/index.tsx` **부재**
 *    (`/records` 탭 충돌 회피).
 *  - **★ feature 경계(맹점②)**: 신규 6 feature 파일에 `@/features/settings`·`buildStyleCardModel`·
 *    `styleCardModel` 0(병렬 판정 드리프트를 소스로 차단 — cross-feature import 금지).
 *  - **★ 지도 degrade(맹점③)**: 신규 4 ui 파일에 `KakaoMapView`·`@/shared/map` 0
 *    → `itineraryMapSurfaceStructure` LOCKED_CALLERS 등재 불필요(계약 좌표 공백, placeholder degrade).
 *  - **INV-3 명시홈**: 신규 4 ui 파일 소요시간 문자열 0(값 인터폴레이션만 — 리터럴 금지, 두 층 가르는 선).
 *
 * ★ 위임(중복 신설 안 함, ponytail lite): **경계(타 feature import 0)**·**customInstance/axios 0**·
 *   **features/reflection/ui 재귀 INV-3** 는 선재 `reflectionStructure.test.ts`(G2·G5·G6)가
 *   `features/reflection/**` 를 재귀 스캔해 신규 6파일을 **자동 편입**한다(개념 [[소스 스캔 가드의 폴더
 *   전수와 자동 편입]]). `pages/travel-style/**` 는 `pagesLayerStructure` 가 자동 편입. 이 파일은
 *   j05 표면 전용 **명시적 홈**(mutation 훅·지도·라우트 경계는 선재 가드 사정거리 밖이라 여기가 유일 그물).
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'features/reflection/model/styleThreshold.ts',
  'features/reflection/model/useStyleAnalysis.ts',
  'features/reflection/ui/TravelStyleScreen.tsx',
  'features/reflection/ui/CategoryBarList.tsx',
  'features/reflection/ui/StatTile.tsx',
  'features/reflection/ui/EvidenceLink.tsx',
  'pages/travel-style/ui/TravelStylePage.tsx',
  'pages/travel-style/index.ts',
  'app/records/style.tsx',
];

/** 신규 feature 파일 6종(model 2 + ui 4) — 경계·mutation 스캔 모집단. */
const FEATURE_FILES = [
  'features/reflection/model/styleThreshold.ts',
  'features/reflection/model/useStyleAnalysis.ts',
  'features/reflection/ui/TravelStyleScreen.tsx',
  'features/reflection/ui/CategoryBarList.tsx',
  'features/reflection/ui/StatTile.tsx',
  'features/reflection/ui/EvidenceLink.tsx',
];

/** INV-3 · 지도 degrade 스캔 모집단(ui 4). */
const UI_FILES = [
  'features/reflection/ui/TravelStyleScreen.tsx',
  'features/reflection/ui/CategoryBarList.tsx',
  'features/reflection/ui/StatTile.tsx',
  'features/reflection/ui/EvidenceLink.tsx',
];

const MODEL_THRESHOLD_REL = 'features/reflection/model/styleThreshold.ts';
const HOOK_REL = 'features/reflection/model/useStyleAnalysis.ts';
const SCREEN_REL = 'features/reflection/ui/TravelStyleScreen.tsx';
const BAR_REL = 'features/reflection/ui/CategoryBarList.tsx';
const EVIDENCE_REL = 'features/reflection/ui/EvidenceLink.tsx';
const ROUTE_REL = 'app/records/style.tsx';
const PAGE_REL = 'pages/travel-style/ui/TravelStylePage.tsx';

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(14:30)은 숫자 뒤가 `:` 라 안 걸린다. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

/** 저장 mutation 유출 금칙어(AC-4). raw HTTP 도 함께 잠근다. */
const MUTATION_FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'usePost*', re: /usePost/ },
  { label: 'usePut*', re: /usePut/ },
  { label: 'usePatch*', re: /usePatch/ },
  { label: 'useDelete*', re: /useDelete/ },
  { label: 'useMutation', re: /useMutation/ },
  { label: 'customInstance', re: /customInstance/ },
  { label: "from 'axios'", re: /from ['"]axios['"]/ },
];

/** 병렬 판정 드리프트 금칙어(맹점②) — reflection→settings 판정 재사용 금지. */
const SETTINGS_FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: '@/features/settings', re: /@\/features\/settings/ },
  { label: 'buildStyleCardModel', re: /buildStyleCardModel/ },
  { label: 'styleCardModel', re: /styleCardModel/ },
];

/** 지도 유출 금칙어(맹점③) — placeholder degrade, 실 지도 미사용. */
const MAP_FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'KakaoMapView', re: /KakaoMapView/ },
  { label: '@/shared/map', re: /@\/shared\/map/ },
];

const firstHit = (
  source: string,
  table: { label: string; re: RegExp }[]
): string | null => {
  const hit = table.find(({ re }) => re.test(source));
  return hit ? hit.label : null;
};

/** 콜론(:) 뒤 // 는 주석으로 보지 않는다 — URL·경로의 `//` 를 스캔 전에 안 지우기 위함. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — stripComments × DURATION_TEXT 조합', () => {
  it('주석 속 소요시간은 걷히고, URL·시각·거리는 살아남되 안 걸리고, 진짜 표기는 잡힌다', () => {
    const sample = [
      '// INV-3 · 소요시간 30분 비표기(수호 주석).',
      'const dwell = `${avgDwellMinutes}분`;',
      "const chip = '14:30';",
      "const dist = '840m';",
      "const url = 'https://map.kakao.com/x';",
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다(부정 단언을 거짓 red 로 만들지 않는다).
    expect(DURATION_TEXT.test(stripped.split('\n')[0] ?? '')).toBe(false);
    // ② URL(://)은 콜론 예외로 살아남는다.
    expect(stripped).toContain("const url = 'https://map.kakao.com/x';");
    // ③ 값 인터폴레이션 `${...}분` 은 리터럴 숫자가 없어 안 걸린다(★2 화해의 근거).
    expect(DURATION_TEXT.test('const dwell = `${avgDwellMinutes}분`;')).toBe(
      false
    );
    // ④ 시각칩·거리는 살아남되 미검출.
    expect(DURATION_TEXT.test("const chip = '14:30';")).toBe(false);
    expect(DURATION_TEXT.test("const dist = '840m';")).toBe(false);
    // ⑤ 짝 — 진짜 리터럴 소요시간은 검출(우회 불가).
    expect(DURATION_TEXT.test('평균 체류 72분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
  });
});

describe('🔴 G1 · 편입 앵커 — 신규 9파일이 정본 경로에 실재한다', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('🔴 G3 · 3층 책임 — 라우트→페이지→화면/훅', () => {
  it('라우트는 페이지에 위임하고 feature·조회를 직접 모른다', () => {
    const route = readOne(ROUTE_REL);
    // 긍정 — 페이지로 위임.
    expect(route).toContain('@/pages/travel-style');
    // 부정 — 라우트가 feature·조회훅을 직접 물지 않는다.
    expect(route).not.toContain('@/features/reflection');
    expect(route).not.toContain('useStyleAnalysis');
    expect(route).not.toContain('useGetMeStyle');
  });

  it('페이지가 화면·조회훅을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/reflection');
    expect(page).toContain('useStyleAnalysis');
    expect(page).toContain('TravelStyleScreen');
  });
});

describe('🔴 G4 · testID 2종이 j05 표면에 실재한다', () => {
  it('reflection-style-bar(CategoryBarList) · reflection-style-evidence(EvidenceLink)', () => {
    // 긍정 앵커 — 각 testID 를 소유하는 파일이 실제로 그 문자열을 갖는다(빈 파일 공허 통과 차단).
    expect(readOne(BAR_REL)).toContain('reflection-style-bar');
    expect(readOne(EVIDENCE_REL)).toContain('reflection-style-evidence');
  });
});

describe('🔴 G5 · AC-4 — 저장 mutation 0 + useGetMeStyle 재사용(★7 gap-filler)', () => {
  it('신규 feature 6파일에 mutation 훅·customInstance·axios 0 + 조회훅 재사용 앵커', () => {
    const sources = FEATURE_FILES.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    // 부정 — 저장/변형 심볼을 문 파일 0건.
    const offenders = sources
      .filter(({ source }) => firstHit(source, MUTATION_FORBIDDEN) !== null)
      .map(({ file, source }) => ({
        file,
        token: firstHit(source, MUTATION_FORBIDDEN),
      }));
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 조회는 재사용 훅을 얇게 감싼다(새 함수 금지의 증거).
    expect(readOne(HOOK_REL)).toContain('useGetMeStyle');
  });
});

describe('🔴 AC-6 · 라우트 경계 — records/style 존재 + records/index 부재(탭 충돌 회피)', () => {
  it('app/records/style.tsx 존재(계정 단위) · app/records/index.tsx 부재', () => {
    // 긍정 — 계정 단위 상세 라우트 존재.
    expect(fs.existsSync(path.join(ROOT, ROUTE_REL))).toBe(true);
    // 부정(선제 green 회귀 앵커) — /records 는 (tabs)/records.tsx 가 이미 소유(충돌 금지).
    expect(fs.existsSync(path.join(ROOT, 'app/records/index.tsx'))).toBe(false);
  });
});

describe('🔴 ★ feature 경계 — reflection 이 settings 판정을 재사용하지 않는다(맹점②)', () => {
  it('신규 6파일에 @/features/settings·buildStyleCardModel·styleCardModel 0 + resolveStyleFace 앵커', () => {
    const sources = FEATURE_FILES.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    const offenders = sources
      .filter(({ source }) => firstHit(source, SETTINGS_FORBIDDEN) !== null)
      .map(({ file, source }) => ({
        file,
        token: firstHit(source, SETTINGS_FORBIDDEN),
      }));
    expect(offenders).toEqual([]);

    // 긍정 짝 — reflection 이 자체 판정(styleThreshold)을 소유한다(병렬 존재의 증거).
    expect(readOne(MODEL_THRESHOLD_REL)).toContain('resolveStyleFace');
  });
});

describe('🔴 ★ 지도 degrade — 신규 ui 에 실 지도 0(맹점③ LOCKED_CALLERS N/A)', () => {
  it('4 ui 파일에 KakaoMapView·@/shared/map 0 + reflection-style-bar 모집단 앵커', () => {
    const sources = UI_FILES.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    const offenders = sources
      .filter(({ source }) => firstHit(source, MAP_FORBIDDEN) !== null)
      .map(({ file, source }) => ({
        file,
        token: firstHit(source, MAP_FORBIDDEN),
      }));
    expect(offenders).toEqual([]);

    // 긍정 앵커 — ui 모집단이 실제로 채워졌다(빈 문자열 공허 통과 차단).
    const joined = sources.map((s) => s.source).join('\n');
    expect(joined).toContain('reflection-style-bar');
  });
});

describe('🔴 INV-3 명시홈 — 신규 ui 4파일 소요시간 리터럴 0(값 인터폴레이션만)', () => {
  it('features/reflection/ui 신규 4파일에 소요시간 문자열 0 + 화면 편입 앵커', () => {
    const sources = UI_FILES.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    // 긍정 앵커 — 화면이 모집단에 실재.
    expect(readOne(SCREEN_REL)).not.toBe('');

    // 부정 — 리터럴 소요시간 0건(체류 분은 인터폴레이션이라 미매치, §5 실검증).
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
