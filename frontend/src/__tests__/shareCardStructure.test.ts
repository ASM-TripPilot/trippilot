/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-574 · j06 공유 카드 — share-card 슬라이스 소스 층 가드
 * (`reflectionSummaryStructure.test.ts` + `recordPhotoBinaryGuard.test.ts` 미러).
 *
 * 무엇을 보장하나:
 *  - **G0 자가검사**: stripComments × (DURATION_TEXT · FORBIDDEN) 조합이 서로를 안 지운다(콜론예외 URL 보존).
 *  - **G1 편입 앵커**: 신규 파일이 정본 경로에 실재한다(TRIP-1071 캡처 모듈 `shareCapture.ts` 포함).
 *  - **G2 · AC-5(BR-U5-46)**: shareCard 그래프에 서버 이미지 생성·서버 저장 심볼 0
 *    (`/ai/v1`·file-system·업로드·base64 계열) + 온디바이스 앵커(`buildShareCard`·`isShareCaptureArmed`·
 *    `saveShareCardImage` 실참조). **TRIP-1071**: 캡처 3종(view-shot·media-library·sharing)은 금칙에서
 *    빠졌다 — 온디바이스 캡처는 BR-U5-46 안이다. 대신 G5 가 "정적 import 는 어댑터에만"을 진다.
 *  - **G3 3층**: 라우트→페이지→화면이 각자 몫만 진다.
 *  - **G4 testID**: reflection-share-format-seg·-save·-export(공유 카드) 3종 실재 + '준비 중'·degrade 소멸
 *    (TRIP-1071, 결과 안내 reflection-share-result 로 대체) + j03 헤더 공유
 *    `reflection-daily-share` **부재**(TRIP-762 로 j03 헤더 공유 제거 — 라이브 j03 에 공유 0, 공유는
 *    j04/j06 소관. 진입점 유지 앵커는 `reflection-daily-edit`).
 *  - **AC-8 · INV-3**: shareCard.ts + 카드 ui 표면에 소요시간 문자열 0(거리만).
 *  - **G5 · TRIP-1071 AC-2 지연 로드 경계**: 캡처 3종 패키지를 정적 import 하는 파일(어댑터)은
 *    features/reflection 안에만 있고, 어떤 프로덕션 파일도 어댑터를 정적으로 끌어오지 않으며,
 *    shareCapture.ts 가 어댑터를 동적 import 로 부른다 — 세 패키지는 import 순간 네이티브 모듈을
 *    강제 조회하므로 정적 한 줄이 재빌드 전 빌드의 h16·j04 진입을 크래시로 만든다(auth lazy 가드 동형).
 *  - **G6 · armed 판정 단일 출처**: 옛 스텁 `captureShareImage` 0 · h16 은 armed 만 보고 요약을 모른다
 *    (결정 4c) · j04 는 armed + `shareEnabled`(BR-U5-48 유지).
 *
 * ★ 위임(중복 신설 안 함, ponytail lite): **경계(타 feature import 0)**·**새 HTTP 0**·
 *   **features/reflection/ui 재귀 INV-3** 는 선재 `reflectionStructure.test.ts`(G2·G5·G6)가
 *   `features/reflection/**` 를 재귀 스캔해 신규 ShareCard*·FormatSegment 를 **자동 편입**한다
 *   (개념 [[소스 스캔 가드의 폴더 전수와 자동 편입]]). `pages/share-card/**` 는 `pagesLayerStructure`
 *   가 자동 편입(duration·zustand·URL·타이머·raw-hex). 이 파일의 INV-3 는 shareCard.ts(모델) + 카드
 *   ui 를 겨냥한 **명시적 홈**(recordsDurationStructure 선례 동형).
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const NEW_FILES = [
  'features/reflection/model/shareCard.ts',
  'features/reflection/model/shareCapture.ts',
  'features/reflection/ui/ShareCardScreen.tsx',
  'features/reflection/ui/ShareCardPreview.tsx',
  'features/reflection/ui/FormatSegment.tsx',
  'pages/share-card/ui/ShareCardPage.tsx',
  'pages/share-card/index.ts',
  'app/trips/[tripId]/records/share.tsx',
];

/** AC-5 서버 이미지 생성 0 스캔 그래프(온디바이스 조립·캡처). 캡처 어댑터는 G2 가 성질로 더한다. */
const SHARE_SCAN_FILES = [
  'features/reflection/model/shareCard.ts',
  'features/reflection/model/shareCapture.ts',
  'features/reflection/ui/ShareCardScreen.tsx',
  'features/reflection/ui/ShareCardPreview.tsx',
  'features/reflection/ui/FormatSegment.tsx',
  'pages/share-card/ui/ShareCardPage.tsx',
];

/** AC-8 INV-3 명시적 홈 스캔(모델 + 카드 ui). */
const INV3_FILES = [
  'features/reflection/model/shareCard.ts',
  'features/reflection/model/shareCapture.ts',
  'features/reflection/ui/ShareCardScreen.tsx',
  'features/reflection/ui/ShareCardPreview.tsx',
  'features/reflection/ui/FormatSegment.tsx',
];

const MODEL_REL = 'features/reflection/model/shareCard.ts';
const CAPTURE_REL = 'features/reflection/model/shareCapture.ts';
const H16_PAGE_REL = 'pages/itinerary-plan/ui/ItineraryPlanPage.tsx';
const J04_PAGE_REL = 'pages/trip-summary/ui/TripSummaryPage.tsx';
const SCREEN_REL = 'features/reflection/ui/ShareCardScreen.tsx';
const SEG_REL = 'features/reflection/ui/FormatSegment.tsx';
const DAILY_REL = 'features/reflection/ui/DailyReflectionScreen.tsx';
const ROUTE_REL = 'app/trips/[tripId]/records/share.tsx';
const PAGE_REL = 'pages/share-card/ui/ShareCardPage.tsx';

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(14:30)은 숫자 뒤가 `:` 라 안 걸린다. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

/**
 * 서버 이미지 생성·서버 저장 금칙어. 라벨은 실패 메시지에 뜬다.
 * TRIP-1071: 캡처 3종(react-native-view-shot·expo-media-library·expo-sharing)은 온디바이스 캡처라
 * BR-U5-46 안이다 → 금칙에서 뺐다(정적 import 경계는 G5). file-system 은 쓸 일이 없어 남긴다
 * (view-shot `result:'tmpfile'` 이 file:// 경로를 준다). base64 도 남아 있어 `result:'base64'` 는 막힌다.
 */
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'expo-file-system', re: /expo-file-system/ },
  { label: '/ai/v1(서버 카드 생성)', re: /\/ai\/v1/ },
  { label: 'uploadForCommunity', re: /uploadForCommunity/ },
  { label: 'storage_key', re: /storage_key/i },
  { label: 'storageKey', re: /storageKey/ },
  { label: 'multipart', re: /multipart/i },
  { label: 'FormData', re: /FormData/ },
  { label: 'base64', re: /base64/i },
];

const firstForbidden = (source: string): string | null => {
  const hit = FORBIDDEN.find(({ re }) => re.test(source));
  return hit ? hit.label : null;
};

/** 콜론(:) 뒤 // 는 주석으로 보지 않는다 — URL·경로의 `//` 를 스캔 전에 안 지우기 위함. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** TRIP-1071 캡처 3종 — import 순간 네이티브 모듈을 강제 조회한다(재빌드 전 빌드에서 크래시). */
const CAPTURE_PACKAGES = [
  'react-native-view-shot',
  'expo-media-library',
  'expo-sharing',
] as const;

const TEST_ONLY_DIRS = ['__tests__', '__mocks__', 'test-support', 'mocks'];

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 정적 형태의 import(정적 from·type·side-effect import·require, 하위 경로 포함). 동적 import 는 제외. */
function hasStaticImportOf(source: string, moduleId: string): boolean {
  const id = `${escapeRe(moduleId)}(?:/[^'"]*)?`;
  return (
    new RegExp(`\\bfrom\\s*['"]${id}['"]`).test(source) ||
    new RegExp(`\\bimport\\s+['"]${id}['"]`).test(source) ||
    new RegExp(`\\brequire\\(\\s*['"]${id}['"]\\s*\\)`).test(source)
  );
}

/** `./x` · `../model/x` · `@/features/…/x` 형태로 basename 을 **정적** import 하는가. */
function staticallyImportsFile(source: string, basename: string): boolean {
  const name = escapeRe(basename);
  return new RegExp(
    `\\bfrom\\s*['"][^'"]*/${name}['"]|\\bimport\\s+['"][^'"]*/${name}['"]|\\brequire\\(\\s*['"][^'"]*/${name}['"]\\s*\\)`
  ).test(source);
}

/** basename 을 **동적** import( … ) 로 부르는가. */
function dynamicallyImportsFile(source: string, basename: string): boolean {
  return new RegExp(
    `\\bimport\\s*\\(\\s*['"][^'"]*/${escapeRe(basename)}['"]\\s*\\)`
  ).test(source);
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** `src/**` 프로덕션 파일 전체(테스트·테스트 전용 디렉토리 제외), 주석 걷은 소스. */
function productionSources(): { file: string; source: string }[] {
  return listSourceFiles(ROOT)
    .map((full) => path.relative(ROOT, full))
    .filter(
      (rel) => !rel.split(path.sep).some((seg) => TEST_ONLY_DIRS.includes(seg))
    )
    .map((rel) => ({ file: rel, source: readOne(rel) }));
}

/** 캡처 패키지를 정적으로 끌어오는 프로덕션 파일 = 어댑터. */
function captureAdapters(): { file: string; source: string }[] {
  return productionSources().filter(({ source }) =>
    CAPTURE_PACKAGES.some((pkg) => hasStaticImportOf(source, pkg))
  );
}

const baseName = (rel: string) => path.basename(rel).replace(/\.tsx?$/, '');

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — stripComments × (DURATION_TEXT · FORBIDDEN) 조합', () => {
  it('주석 속 금칙어는 걷히고, URL 은 살아남고, 코드 속 금칙어·소요시간만 잡힌다', () => {
    const sample = [
      '// storage_key·expo-media-library·소요 30분 은 산문으로 적어도 걷힌다.',
      "const u = 'https://cdn.example.com/x';",
      "const chip = '14:30';",
      "const dist = '840m';",
      "const bad = 'storageKey';",
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다(부정 단언을 거짓 red 로 만들지 않는다).
    expect(firstForbidden(stripped.split('\n')[0] ?? '')).toBeNull();
    expect(DURATION_TEXT.test(stripped.split('\n')[0] ?? '')).toBe(false);
    // ② URL(://)은 콜론 예외로 살아남되 금칙어로 오검출되지 않는다.
    expect(stripped).toContain("const u = 'https://cdn.example.com/x';");
    expect(firstForbidden("const u = 'https://cdn.example.com/x';")).toBeNull();
    // ③ 코드 속 금칙어는 살아남고 탐지된다(전처리가 다 지우면 G2 부정 단언이 공허).
    expect(stripped).toContain("const bad = 'storageKey';");
    expect(firstForbidden("const bad = 'storageKey';")).toBe('storageKey');
    // ④ 시각칩·거리는 살아남되 DURATION_TEXT 에 안 걸린다(오검출 아님).
    expect(DURATION_TEXT.test("const chip = '14:30';")).toBe(false);
    expect(DURATION_TEXT.test("const dist = '840m';")).toBe(false);
    // ⑤ 짝 — 진짜 소요시간은 검출.
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
  });
});

describe('🔴 G1 · 편입 앵커 — 신규 파일이 정본 경로에 실재한다(TRIP-1071 shareCapture 포함)', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('🔴 G2 · AC-5 — 서버 이미지 생성·저장 심볼 0 + 온디바이스 앵커 (TRIP-1071 캡처 3종 허용)', () => {
  it('shareCard 그래프(+캡처 모듈·어댑터)에 금칙 8종 0건 + buildShareCard·isShareCaptureArmed·saveShareCardImage 실참조', () => {
    // 스캔 목록 = 고정 목록 + 캡처 어댑터(이름이 아니라 "패키지를 정적 import 하는 파일"로 편입 — 02a ★8).
    const adapterFiles = captureAdapters().map(({ file }) => file);
    const scanFiles = [...new Set([...SHARE_SCAN_FILES, ...adapterFiles])];
    const sources = scanFiles.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    // 부정 — 금칙어를 문 파일 0건.
    const offenders = sources
      .filter(({ source }) => firstForbidden(source) !== null)
      .map(({ file, source }) => ({ file, token: firstForbidden(source) }));
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 그래프가 온디바이스 조립·캡처를 실참조(빈 파일이면 red).
    const joined = sources.map((s) => s.source).join('\n');
    expect(joined).toContain('buildShareCard');
    expect(readOne(CAPTURE_REL)).toContain('isShareCaptureArmed');
    expect(readOne(CAPTURE_REL)).toContain('saveShareCardImage');
    // 어댑터도 스캔에 들어왔다(0개면 캡처 코드가 G2 사각에 있다).
    expect(adapterFiles.length).toBeGreaterThan(0);
  });
});

describe('🔴 G3 · 3층 책임 — 라우트→페이지→화면', () => {
  it('라우트는 페이지에 위임하고 feature·조회를 직접 모른다', () => {
    const route = readOne(ROUTE_REL);
    expect(route).toContain('@/pages/share-card');
    expect(route).not.toContain('@/features/reflection');
    expect(route).not.toContain('useTripSummary');
    expect(route).not.toContain('useGetTripsTripId');
  });

  it('페이지가 화면·조회훅·조립 모델을 물어 배선한다', () => {
    const page = readOne(PAGE_REL);
    expect(page).toContain('@/features/reflection');
    expect(page).toContain('useTripSummary');
    expect(page).toContain('useGetTripsTripId');
    expect(page).toContain('ShareCardScreen');
  });
});

describe('🔴 G4 · 공유 카드 testID 3종 실재 + j03 헤더 공유 제거', () => {
  it('공유 카드 3종은 실재하고, j03 DailyReflectionScreen 의 헤더 공유는 사라진다', () => {
    // 긍정 — 공유 카드 표면 3종은 그대로.
    expect(readOne(SEG_REL)).toContain('reflection-share-format-seg');
    expect(readOne(SCREEN_REL)).toContain('reflection-share-save');
    expect(readOne(SCREEN_REL)).toContain('reflection-share-export');
    // TRIP-1071 — '준비 중' 안내는 소멸하고 결과 안내(성공/실패 공용)로 바뀐다(TRIP-939 AC: 운영 '준비 중' 0).
    expect(readOne(SCREEN_REL)).not.toContain('준비 중');
    expect(readOne(SCREEN_REL)).not.toContain('reflection-share-degrade');
    expect(readOne(SCREEN_REL)).toContain('reflection-share-result');
    // 부정(TRIP-762) — j03 헤더 공유 아이콘 제거.
    expect(readOne(DAILY_REL)).not.toContain('reflection-daily-share');
    // 긍정 짝 — 공유는 지웠지만 편집 진입점(reflection-daily-edit)은 남는다(공허 통과 차단).
    expect(readOne(DAILY_REL)).toContain('reflection-daily-edit');
  });
});

describe('🔴 AC-4 · 캡션 카드 = 해시태그만(페이지 문장 시드 제거)', () => {
  it('ShareCardPage 에 캡션 문장 시드가 없고, 해시태그 조립은 유지된다', () => {
    const page = readOne(PAGE_REL);
    // 부정 — 문장 시드 제거(현 `${trip.data.title} 여행의 기록` → red).
    expect(page).not.toContain('여행의 기록');
    // 긍정 짝 — 해시태그 조립은 남는다(공허 통과 차단: 페이지가 캡션 카드 자체를 지운 게 아님).
    expect(page).toContain('hashtagText');
    expect(page).toMatch(/#/);
  });
});

describe('🔴 AC-8 · INV-3 — shareCard 모델·카드 ui 에 소요시간 0(거리만)', () => {
  it('shareCard.ts + 카드 ui 4파일에 소요시간 문자열 0 + buildShareCard 앵커', () => {
    const sources = INV3_FILES.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    // 긍정 앵커 — shareCard.ts 가 실제로 buildShareCard 를 정의(빈 파일 공허 통과 차단).
    expect(readOne(MODEL_REL)).toContain('buildShareCard');

    // 부정 — 소요시간 문자열 0건(avgDwellMinutes 예외 없음, j06 DTO 부재).
    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('G5a · 탐지기 자가검사 — stripComments × 정적/동적 import 탐지 조합', () => {
  it('주석 속 이름은 걷히고, 정적(from·type·side-effect·require·하위 경로)만 잡히고 동적은 안 잡힌다', () => {
    const commented = stripComments(
      "// import { captureRef } from 'react-native-view-shot';\nconst a = 1;"
    );
    expect(hasStaticImportOf(commented, 'react-native-view-shot')).toBe(false);

    expect(
      hasStaticImportOf(
        "import { shareAsync } from 'expo-sharing';",
        'expo-sharing'
      )
    ).toBe(true);
    expect(
      hasStaticImportOf(
        "import type { PermissionResponse } from 'expo-media-library';",
        'expo-media-library'
      )
    ).toBe(true);
    expect(
      hasStaticImportOf(
        "import x from 'expo-sharing/build/Sharing';",
        'expo-sharing'
      )
    ).toBe(true);
    expect(
      hasStaticImportOf(
        "require('react-native-view-shot')",
        'react-native-view-shot'
      )
    ).toBe(true);
    expect(
      hasStaticImportOf(
        "const m = await import('expo-sharing');",
        'expo-sharing'
      )
    ).toBe(false);
    // 이름이 겹치는 다른 패키지는 안 잡는다.
    expect(
      hasStaticImportOf("import x from 'expo-sharing-extra';", 'expo-sharing')
    ).toBe(false);

    expect(
      staticallyImportsFile(
        "import { a } from './shareCaptureNative';",
        'shareCaptureNative'
      )
    ).toBe(true);
    expect(
      staticallyImportsFile(
        "import { a } from '@/features/reflection/model/shareCaptureNative';",
        'shareCaptureNative'
      )
    ).toBe(true);
    expect(
      staticallyImportsFile(
        "const m = await import('./shareCaptureNative');",
        'shareCaptureNative'
      )
    ).toBe(false);
    expect(
      dynamicallyImportsFile(
        "const m = await import('./shareCaptureNative');",
        'shareCaptureNative'
      )
    ).toBe(true);
    expect(
      dynamicallyImportsFile(
        "import { a } from './shareCaptureNative';",
        'shareCaptureNative'
      )
    ).toBe(false);
  });
});

describe('🔴 G5 · TRIP-1071 AC-2 — 캡처 패키지는 동적 경계 뒤에서만 산다 (부팅 크래시 방지)', () => {
  it('어댑터가 실재하고(3종 전부), features/reflection 안에만 있으며, 누구도 정적으로 끌어오지 않고, shareCapture.ts 가 동적 import 로 부른다', () => {
    const sources = productionSources();
    // 도달 앵커 — src 모집단이 채워졌다.
    expect(sources.length).toBeGreaterThan(20);

    const adapters = captureAdapters();
    // 긍정 — 어댑터가 있고, 세 패키지가 각각 어떤 어댑터에서 정적으로 불린다(0이면 아래 부정이 공허).
    expect(adapters.length).toBeGreaterThan(0);
    CAPTURE_PACKAGES.forEach((pkg) => {
      expect({
        pkg,
        adapted: adapters.some(({ source }) => hasStaticImportOf(source, pkg)),
      }).toEqual({ pkg, adapted: true });
    });

    // 어댑터는 reflection feature 안에만(shared/photo 에 두면 recordPhotoBinaryGuard 금칙과도 충돌).
    expect(
      adapters
        .map(({ file }) => file.split(path.sep).join('/'))
        .filter((file) => !file.startsWith('features/reflection/'))
    ).toEqual([]);

    // 본체 — 어댑터를 정적으로 끌어오는 프로덕션 파일 0(있으면 패키지가 부팅 그래프에 실린다).
    const offenders = adapters.flatMap((adapter) =>
      sources
        .filter(
          (s) =>
            s.file !== adapter.file &&
            staticallyImportsFile(s.source, baseName(adapter.file))
        )
        .map((s) => `${s.file} -> ${adapter.file}`)
    );
    expect(offenders).toEqual([]);

    // 지연 구조의 증거 — 판정·실행 진입점(shareCapture.ts)이 어댑터를 동적 import 로 부른다.
    const capture = readOne(CAPTURE_REL);
    expect(
      adapters.some(({ file }) =>
        dynamicallyImportsFile(capture, baseName(file))
      )
    ).toBe(true);
    // 진입점 자신은 어댑터가 아니다(화면·페이지가 정적으로 무는 파일이므로).
    CAPTURE_PACKAGES.forEach((pkg) => {
      expect(hasStaticImportOf(capture, pkg)).toBe(false);
    });
  });
});

describe('🔴 G6 · armed 판정 단일 출처 — 옛 스텁 0, h16 은 요약을 모른다(결정 4c)', () => {
  it('captureShareImage 는 src 프로덕션 어디에도 없고, h16·j04 는 isShareCaptureArmed 로 게이트한다', () => {
    const sources = productionSources();
    expect(sources.length).toBeGreaterThan(20);

    // 옛 이름이 남으면 늘 false 를 주는 두 번째 판정이 생긴다.
    expect(
      sources
        .filter(({ source }) => source.includes('captureShareImage'))
        .map(({ file }) => file)
    ).toEqual([]);

    const h16 = readOne(H16_PAGE_REL);
    expect(h16).toContain('isShareCaptureArmed');
    // 결정 4(c) — h16 [공유하기]는 ready 무관. 요약을 끌어오면 결정 (b)(요약 뒤에만)로 샌다.
    expect(h16).not.toContain('useTripSummary');
    expect(h16).not.toContain('shareEnabled');

    const j04 = readOne(J04_PAGE_REL);
    expect(j04).toContain('isShareCaptureArmed');
    // j04 는 BR-U5-48 게이트(ready)를 그대로 유지한다.
    expect(j04).toContain('shareEnabled');
  });
});
