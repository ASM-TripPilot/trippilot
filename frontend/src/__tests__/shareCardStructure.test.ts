/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-574 · j06 공유 카드 — 서버 이미지 생성·업로드 금지 소스 가드(BR-U5-46).
 * TRIP-1145 로 보안 단언만 남겼다 — 캡처 패키지 정적 import 경계(옛 G5)는 eslint `no-restricted-imports` 로 옮겼다.
 *
 * 무엇을 보장하나:
 *  - **G0 자가검사**: stripComments × FORBIDDEN 조합이 서로를 안 지운다(콜론예외 URL 보존).
 *  - **G2 · AC-5(BR-U5-46)**: shareCard 그래프에 서버 이미지 생성·서버 저장 심볼 0
 *    (`/ai/v1`·file-system·업로드·base64 계열) + 온디바이스 앵커(`buildShareCard`·`isShareCaptureArmed`·
 *    `saveShareCardImage` 실참조). **TRIP-1071**: 캡처 3종(view-shot·media-library·sharing)은 금칙에서
 *    빠졌다 — 온디바이스 캡처는 BR-U5-46 안이다. 캡처 어댑터는 "패키지를 정적 import 하는 파일"로 찾아
 *    스캔에 더한다 — 그 탐지기 자가검사가 G5a 다.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론예외로 URL·경로 보존).
 * **가짜 통과 방지(리포 관례)**: 모든 "없어야 한다"는 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');
// 라우트는 src 밖 루트 app/ 에 있다(TRIP-1161) — 캡처 어댑터 탐색 모집단에 함께 넣는다. 경로는 ROOT 기준(`../app/…`).
const ROUTES = path.resolve('app');

/** AC-5 서버 이미지 생성 0 스캔 그래프(온디바이스 조립·캡처). 캡처 어댑터는 G2 가 성질로 더한다. */
const SHARE_SCAN_FILES = [
  'features/reflection/model/shareCard.ts',
  'features/share-trip-card/model/shareCapture.ts',
  'pages/record/share-card/ui/ShareCardScreen.tsx',
  'pages/record/share-card/ui/ShareCardPreview.tsx',
  'pages/record/share-card/ui/FormatSegment.tsx',
  'pages/record/share-card/ui/ShareCardPage.tsx',
];

const CAPTURE_REL = 'features/share-trip-card/model/shareCapture.ts';

/**
 * 서버 이미지 생성·서버 저장 금칙어. 라벨은 실패 메시지에 뜬다.
 * TRIP-1071: 캡처 3종(react-native-view-shot·expo-media-library·expo-sharing)은 온디바이스 캡처라
 * BR-U5-46 안이다 → 금칙에서 뺐다(정적 import 경계는 eslint). file-system 은 쓸 일이 없어 남긴다
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

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

/** `src/**`·라우트(`app/**`) 프로덕션 파일 전체(테스트·테스트 전용 디렉토리 제외), 주석 걷은 소스. */
function productionSources(): { file: string; source: string }[] {
  return [ROOT, ROUTES]
    .flatMap(listSourceFiles)
    .map((full) => path.relative(ROOT, full))
    .filter(
      (rel) => !rel.split(path.sep).some((seg) => TEST_ONLY_DIRS.includes(seg))
    )
    .map((rel) => ({ file: rel, source: readOne(rel) }));
}

/** 캡처 패키지를 정적으로 끌어오는 프로덕션 파일 = 어댑터. */
function captureAdapters(): { file: string; source: string }[] {
  // shared/photo 는 제외 — TRIP-1070 사진 첨부 입구가 expo-media-library 를 호출 시점 require 로 문다(앨범
  // 읽기, 캡처 아님). 그쪽 부팅 안전(정적 import 0)은 eslint no-restricted-imports 가 잠근다.
  return productionSources().filter(
    ({ file, source }) =>
      !file.split(path.sep).join('/').startsWith('shared/photo/') &&
      CAPTURE_PACKAGES.some((pkg) => hasStaticImportOf(source, pkg))
  );
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G0 · 탐지기 자가검사 — stripComments × FORBIDDEN 조합', () => {
  it('주석 속 금칙어는 걷히고, URL 은 살아남고, 코드 속 금칙어만 잡힌다', () => {
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
    // ② URL(://)은 콜론 예외로 살아남되 금칙어로 오검출되지 않는다.
    expect(stripped).toContain("const u = 'https://cdn.example.com/x';");
    expect(firstForbidden("const u = 'https://cdn.example.com/x';")).toBeNull();
    // ③ 코드 속 금칙어는 살아남고 탐지된다(전처리가 다 지우면 G2 부정 단언이 공허).
    expect(stripped).toContain("const bad = 'storageKey';");
    expect(firstForbidden("const bad = 'storageKey';")).toBe('storageKey');
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

    // 앵커 — 고정 목록의 파일이 그 자리에 있다(옮겨지면 readOne 이 '' 를 돌려 아래 부정이 공허하게 통과한다).
    expect(
      SHARE_SCAN_FILES.filter((rel) => !fs.existsSync(path.join(ROOT, rel)))
    ).toEqual([]);

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
  });
});
