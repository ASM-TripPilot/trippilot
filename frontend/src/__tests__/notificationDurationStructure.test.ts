/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-576 · l01 · AC-7 · INV-3 · BR-U6-05 · PBT-U6-5 — 알림 표면 소스 층 **소요시간 비표기 가드**.
 *
 * 알림 클라가 **짓는** 문자열(`features/notification/**` · `pages/notification-inbox/**` · `app/notifications.tsx`)
 * 어디에도 소요시간 표기(분·시간·소요)가 없다(INV-3 — 거리만). 렌더 스캔이 못 보는 accessibilityLabel
 * 같은 prop 문자열도 여기서 잡는다(`executionDurationStructure` 계열·같은 규율).
 *
 * ★ 스캔 대상은 **클라 조립 문자열만**이다. 서버 `body`(런타임 값)·`{row.meta}`(런타임 조립)는 변수라
 *   리터럴 스캔에 안 걸린다. `formatRelativeTime`("N분 전")은 (1)shared/date 라 이 모집단 밖 (2)`}분`은
 *   앞이 숫자가 아니라 DURATION_TEXT 불일치 — 이중으로 무해(경과 시각이라 INV-3 소요시간도 아니다).
 *
 * ★ 조합 실검증(전처리×탐지기, 강제) — stripComments 가 주석 속 "30분"은 걷되 URL(`://`)·라우트·
 *   시각칩(14:30)·거리(840m)는 살려두고, 탐지기가 그 살아남은 것에 오검출/미검출을 안 내는지 **실제
 *   문자열로 1회 태운다**(문제로그 [[stripComments 가 URL 슬래시 오인]] 계열). 이 G1 이 green 이라야
 *   G2 의 부정 단언이 의미를 갖는다.
 *
 * **가짜 통과 방지**: "없어야 한다"는 같은 it 의 "있어야 한다"(모집단 비어있지 않음 + 화면 편입)와 짝.
 */

const ROOT = path.resolve('src');
const SURFACE_DIRS = ['features/notification', 'pages/notification-inbox'];
const EXTRA_FILES = ['app/notifications.tsx'];
const SCREEN_REL = 'features/notification/ui/NotificationInboxScreen.tsx';

/** 소요시간 **표기** 탐지기 — 화면에 나갈 문자열 형태. `HH:mm`(14:30)은 숫자 뒤가 `:` 라 안 걸리고,
 * 거리(840m)·"N분 전" 참조 변수는 안 걸린다. '시각'(U+AC01)≠'시간'(U+AC04). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

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
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      if (/Glyphs\.tsx$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

function collectSurface(): { file: string; source: string }[] {
  const fromDirs = SURFACE_DIRS.flatMap((dir) =>
    listSourceFiles(path.join(ROOT, dir))
  );
  const extra = EXTRA_FILES.map((rel) => path.join(ROOT, rel)).filter((full) =>
    fs.existsSync(full)
  );
  return [...fromDirs, ...extra].map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

describe('G1 · 탐지기 자가검사 — 전처리×탐지기 상호소거 실검증', () => {
  it('주석 속 소요시간은 걷히고, URL·라우트·시각칩·거리는 살아남되 안 걸리고, 진짜 표기는 잡힌다', () => {
    const sample = [
      '// INV-3 · 소요시간 30분 표기 안 함(수호 주석).',
      "const chip = '14:30';",
      "const dist = '840m';",
      "const url = 'https://map.kakao.com/x';",
      "const route = '/trips/t1/planb';",
    ].join('\n');
    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다(부정 단언을 거짓 red 로 만들지 않는다).
    expect(stripped).not.toContain('소요');
    expect(stripped).not.toContain('30분');
    expect(DURATION_TEXT.test(stripped)).toBe(false);

    // ② URL(://)·라우트는 콜론 예외로 살아남는다(전처리가 지우지 않는다).
    expect(stripped).toContain("const url = 'https://map.kakao.com/x';");
    expect(stripped).toContain("const route = '/trips/t1/planb';");
    // ③ 시각칩·거리는 살아남되 탐지기에 안 걸린다(오검출 아님).
    expect(stripped).toContain("const chip = '14:30';");
    expect(stripped).toContain("const dist = '840m';");

    // ④ 짝 — 진짜 소요시간 표기는 검출(우회 불가 증명), 시각/거리는 미검출.
    expect(DURATION_TEXT.test('이동 30분')).toBe(true);
    expect(DURATION_TEXT.test('소요 2시간')).toBe(true);
    expect(DURATION_TEXT.test('14:30')).toBe(false);
    expect(DURATION_TEXT.test('840m')).toBe(false);
  });
});

describe('G2 · INV-3 — 알림 표면 클라 문자열에 소요시간 표기 0건', () => {
  it('알림 표면 전수(주석·Glyphs 제외)에 분·시간·소요 표기가 없다', () => {
    const sources = collectSurface();

    // 긍정 앵커 — 모집단이 비어 있지 않고 이 칸의 화면이 그 안에 있다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(SCREEN_REL);

    const offenders = sources
      .filter(({ source }) => DURATION_TEXT.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
