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
 *  - **G1 편입 앵커**: 신규 7파일이 정본 경로에 실재한다(구현 전 red).
 *  - **G2 · AC-5(BR-U5-46)**: shareCard 그래프에 서버 이미지 생성·서버 저장·네이티브 캡처 심볼 0
 *    (`/ai/v1`·view-shot·media-library·sharing·file-system·업로드 계열) + 온디바이스 앵커
 *    (`buildShareCard`·`captureShareImage` 실참조 — 공허 통과 차단).
 *  - **G3 3층**: 라우트→페이지→화면이 각자 몫만 진다.
 *  - **G4 testID 4종**: reflection-share-format-seg·-save·-export(공유 카드) + reflection-daily-share(j03 진입점).
 *  - **AC-8 · INV-3**: shareCard.ts + 카드 ui 표면에 소요시간 문자열 0(거리만).
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
  'features/reflection/ui/ShareCardScreen.tsx',
  'features/reflection/ui/ShareCardPreview.tsx',
  'features/reflection/ui/FormatSegment.tsx',
  'pages/share-card/ui/ShareCardPage.tsx',
  'pages/share-card/index.ts',
  'app/trips/[tripId]/records/share.tsx',
];

/** AC-5 서버 이미지 생성 0 스캔 그래프(온디바이스 조립만). */
const SHARE_SCAN_FILES = [
  'features/reflection/model/shareCard.ts',
  'features/reflection/ui/ShareCardScreen.tsx',
  'features/reflection/ui/ShareCardPreview.tsx',
  'features/reflection/ui/FormatSegment.tsx',
  'pages/share-card/ui/ShareCardPage.tsx',
];

/** AC-8 INV-3 명시적 홈 스캔(모델 + 카드 ui). */
const INV3_FILES = [
  'features/reflection/model/shareCard.ts',
  'features/reflection/ui/ShareCardScreen.tsx',
  'features/reflection/ui/ShareCardPreview.tsx',
  'features/reflection/ui/FormatSegment.tsx',
];

const MODEL_REL = 'features/reflection/model/shareCard.ts';
const SCREEN_REL = 'features/reflection/ui/ShareCardScreen.tsx';
const SEG_REL = 'features/reflection/ui/FormatSegment.tsx';
const DAILY_REL = 'features/reflection/ui/DailyReflectionScreen.tsx';
const ROUTE_REL = 'app/trips/[tripId]/records/share.tsx';
const PAGE_REL = 'pages/share-card/ui/ShareCardPage.tsx';

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(14:30)은 숫자 뒤가 `:` 라 안 걸린다. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

/** 서버 이미지 생성·서버 저장·네이티브 캡처 유출 금칙어. 라벨은 실패 메시지에 뜬다. */
const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'react-native-view-shot', re: /react-native-view-shot/ },
  { label: 'expo-media-library', re: /expo-media-library/ },
  { label: 'expo-sharing', re: /expo-sharing/ },
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

describe('🔴 G1 · 편입 앵커 — 신규 7파일이 정본 경로에 실재한다', () => {
  it.each(NEW_FILES)('%s 가 존재한다', (rel) => {
    expect({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }).toEqual({
      file: rel,
      exists: true,
    });
  });
});

describe('🔴 G2 · AC-5 — 서버 이미지 생성·저장·네이티브 캡처 심볼 0 + 온디바이스 앵커', () => {
  it('shareCard 그래프에 금칙 11종 0건 + buildShareCard·captureShareImage 실참조', () => {
    const sources = SHARE_SCAN_FILES.map((rel) => ({
      file: rel,
      source: readOne(rel),
    }));

    // 부정 — 금칙어를 문 파일 0건.
    const offenders = sources
      .filter(({ source }) => firstForbidden(source) !== null)
      .map(({ file, source }) => ({ file, token: firstForbidden(source) }));
    expect(offenders).toEqual([]);

    // 긍정 짝(🔴 red-first) — 그래프가 온디바이스 조립·degrade 스텁을 실참조(빈 파일이면 red).
    const joined = sources.map((s) => s.source).join('\n');
    expect(joined).toContain('buildShareCard');
    expect(joined).toContain('captureShareImage');
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

describe('🔴 G4 · testID 4종이 공유 표면·진입점에 실재한다', () => {
  it('공유 카드 3종 + j03 진입점(reflection-daily-share)', () => {
    expect(readOne(SEG_REL)).toContain('reflection-share-format-seg');
    expect(readOne(SCREEN_REL)).toContain('reflection-share-save');
    expect(readOne(SCREEN_REL)).toContain('reflection-share-export');
    expect(readOne(DAILY_REL)).toContain('reflection-daily-share');
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
