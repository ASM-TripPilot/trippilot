/**
 * @jest-environment node
 */
// TRIP-805 · widgets 층 신설 구조 심판(fs 소스 스캔). 렌더로 못 보는 "이동이 끝났는가 · 중복이
// 사라졌는가 · 위젯이 상태·상위층을 안 쥐는가"를 본다.
//
// 무엇을 보장하나:
//  - AC-1 이동: shared/itinerary-edit 소멸 + widgets 층 실재 + 전 소스에 옛 경로 참조 0.
//  - AC-1 완료조건: shared 직계에 도메인명(itinerary·stay·place·trip) 0.
//  - AC-1 경계: features/planb 에 @/widgets import 0 + ManualEditScreen 은 어디에도 없다(TRIP-753 —
//    pages 로 옮겨졌던 화면이 i07 을 h12 편집기로 합치며 슬라이스째 삭제됐다).
//  - (AC-3 담은 곳 FAB 추출은 이번 범위에서 빠졌다 — 소비처가 features 층이라 features→widgets
//    상향 참조가 되어 층 린트와 충돌. page 층 소비로 후속 티켓.)
//  - AC-2 통일: features/itinerary/ui/SlotTimeSheet.tsx 소멸 + 소비처(PlaceAddPage 포함)가
//    @/widgets/time-sheet 소비(★4 누락 소비처 fail-closed). TRIP-753 으로 PlanbManualPage 는 빠졌다 —
//    i07 은 ItineraryEditPage(시작/종료 라벨)를 그대로 쓴다.
//  - AC-4/AC-5 상태·경계 규약: 위젯 소스에 expo-router·@/features·@/pages·raw hex 0,
//    useState 0(단 STATE_EXEMPT 명시 등재 파일 예외 — TimeSheet D8 선택 셀, MapSheetShell TRIP-919
//    지도 실패/재시도 + TRIP-920 현재 스냅 칸 = 2개. 예외는 파일 + 허용 개수로 등재 — 호출 수가 개수와
//    완전일치해야 한다).
//
// 리포 확립 규약: "없어야 한다"(부정)는 "있어야 한다"(긍정 짝)와 같은 it 안에 둔다 —
// 빈 모집단에서 부정이 공허 통과하는 것을 긍정 짝이 먼저 막는다. 모든 스캔은 주석을 걷은 소스를 본다.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('src');

/** 토큰으로 이미 존재하는 색 — raw hex 로 적으면 토큰 우회(동결 가드들과 같은 목록). */
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

// AC-2 TimeSheet 소비처 — seed 목록(ItineraryEditPage·PlanbManualPage)에 PlaceAddPage 누락(★4 sweep).
// TRIP-753: PlanbManualPage(도착/출발·'시각 입력')는 슬라이스째 삭제 — 남은 소비처는 둘이다.
// 5-c(03b 경고-1): 소비처가 넘기는 라벨·제목은 통합 테스트가 단언하지 않아, 위젯 기본값으로의
// 조용한 회귀를 여기 소스 스캔으로 잠근다(뮤테이션 실측: 라벨 한 글자만 바꿔도 red).
const TIME_SHEET_CONSUMERS: {
  rel: string;
  labels: RegExp;
  title?: RegExp;
}[] = [
  {
    rel: 'pages/itinerary-edit/ui/ItineraryEditPage.tsx',
    labels: /labels=\{\{\s*start:\s*'시작',\s*end:\s*'종료'\s*\}\}/,
  },
  {
    rel: 'pages/itinerary-manual/ui/PlaceAddPage.tsx',
    labels: /labels=\{\{\s*start:\s*'시작',\s*end:\s*'종료'\s*\}\}/,
  },
];

// 상태-소유 예외 — **파일 + 허용 개수**로 등재한다(스캔 범위는 줄이지 않는다). 개수는 useState **호출**
// 수(import 줄 제외)와 완전일치해야 한다 — 늘리려면 이 숫자와 사유를 한 줄 고쳐야 한다(의도한 마찰,
// 03b 경고-1). 새 예외는 사유와 함께 한 줄씩.
const STATE_EXEMPT: { rel: string; count: number }[] = [
  // D8 — TimeSheet 는 선택 셀 useState 를 그대로 가진다(SlotTimeSheet 이관, 02a ★7). 시·분 4 + 활성 칸
  // + 종료 설정 여부 = 6.
  { rel: 'widgets/time-sheet/ui/TimeSheet.tsx', count: 6 },
  // TRIP-919 사용자 결정 — 셸이 지도 실패/재시도 상태를 쥔다(9 소비처가 배선 없이 폴백을 얻는다).
  // TRIP-920 사용자 결정(3-a) — 셸이 `BottomSheet onChange` 로 받은 현재 스냅 칸을 쥔다(닫힘에서만 지도
  // 풀림 · CTA 숨김). 2 = 실패 1 + 스냅 칸 1.
  { rel: 'widgets/map-sheet-shell/ui/MapSheetShell.tsx', count: 2 },
];
const STATE_EXEMPT_FILES = STATE_EXEMPT.map(({ rel }) => rel);

/** useState **호출** 수 — `useState(`·`useState<T>(` 만 센다(import 줄의 이름은 안 센다). */
function countUseStateCalls(source: string): number {
  return (source.match(/\buseState\s*(<[^>]*>)?\s*\(/g) ?? []).length;
}

/**
 * 스캔 전처리 — 주석을 걷는다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석에서 바로 앞 글자가 `:` 이면 주석으로 보지 않는다 — `'https://…'` 의 슬래시를 주석 시작으로
 * 오인하지 않기 위한 것(동결 가드들과 같은 규칙).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 디렉토리 바로 아래(재귀 없음) 하위 디렉토리 이름만 정렬해 반환(없으면 빈 배열). */
function listDirNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** 프로덕션 소스 파일만 재귀 수집(generated·테스트 제외). */
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

function readAll(files: string[]): { file: string; source: string }[] {
  return files.map((full) => ({
    file: relOf(full),
    source: stripComments(fs.readFileSync(full, 'utf8')),
  }));
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 먼저 막는다(리포 규약). */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

/** src 전체 프로덕션 소스(주석 제거). 옛 경로 참조가 어디 남았는지 전수로 본다. */
function allSources(): { file: string; source: string }[] {
  return readAll(listSourceFiles(ROOT));
}

/** widgets 위젯 UI 소스만(`*Glyphs.tsx` 제외 — raw hex 관례 예외). */
function widgetUiSources(): { file: string; source: string }[] {
  return readAll(listSourceFiles(path.join(ROOT, 'widgets'))).filter(
    ({ file }) =>
      /^widgets\/[^/]+\/ui\/[^/]+\.tsx$/.test(file) &&
      !/Glyphs\.tsx$/.test(file)
  );
}

describe('G0 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 금칙어·hex 는 걷히고, 코드의 참조·URL·useState 는 살아남는다', () => {
    const sample = [
      '/** layer-widgets: @/shared/itinerary-edit 는 옮겨졌다. raw hex(#ff385c) 금지 주석. */',
      "// import from 'features/itinerary/ui/SlotTimeSheet' — 옛 경로 주석.",
      "import { ManualEditShell } from '@/widgets/itinerary-edit';",
      "const doc = 'https://figma.com/x';",
      'const [open, setOpen] = useState(false);',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어·hex 는 걷힌다 — 안 걷으면 수호 주석이 부정 단언을 거짓 red 로 만든다.
    expect(stripped).not.toContain('shared/itinerary-edit');
    expect(stripped).not.toContain('features/itinerary/ui/SlotTimeSheet');
    expect(stripped.toLowerCase()).not.toContain('#ff385c');

    // ② 코드의 참조·URL·상태는 살아남는다(콜론 뒤 `//` 는 주석이 아니다).
    expect(stripped).toContain('@/widgets/itinerary-edit');
    expect(/https?:\/\//.test(stripped)).toBe(true);
    expect(stripped).toContain('useState');

    // ③ 짝 — 탐지기가 진짜 참조는 잡는다(우회 불가 증명).
    expect('const x = 1; // note'.includes('shared/itinerary-edit')).toBe(
      false
    );
    expect(
      stripComments("const b = '@/shared/itinerary-edit';").includes(
        'shared/itinerary-edit'
      )
    ).toBe(true);
  });
});

describe('🔴 A · AC-1 이동 — shared/itinerary-edit 소멸 + widgets 층 실재', () => {
  it('shared 디렉토리 부재·전 소스 옛 경로 0 (부정) + 실재 위젯·widget 경로 참조 (긍정 짝)', () => {
    const sources = allSources();

    // 긍정 짝 — widgets 층이 실재하고 어떤 소스가 위젯 경로를 참조한다(공허 통과 방지). TRIP-753 으로
    // 옛 목적지(widgets/itinerary-edit)가 슬라이스째 사라져 앵커를 남은 위젯(time-sheet)으로 옮겼다.
    expect(exists('widgets/time-sheet/ui/TimeSheet.tsx')).toBe(true);
    expect(
      sources.some(({ source }) => source.includes('@/widgets/time-sheet'))
    ).toBe(true);

    // 부정 — 옛 shared 디렉토리가 사라졌고, 어떤 소스도 옛 경로를 참조하지 않는다.
    expect(exists('shared/itinerary-edit')).toBe(false);
    const offenders = sources
      .filter(({ source }) => source.includes('shared/itinerary-edit'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 B · AC-1 완료조건 — shared 직계에 도메인 컴포넌트 0', () => {
  it('itinerary·stay·place·trip 접두 디렉토리 0 (부정) + shared 실디렉토리 존재 (긍정 짝)', () => {
    const sharedDirs = listDirNames(path.join(ROOT, 'shared'));

    // 긍정 짝 — shared 층 자체는 살아 있다(빈 shared 에서 공허 통과 방지).
    expect(sharedDirs).toEqual(expect.arrayContaining(['api', 'ui']));

    // 부정 — 도메인명 디렉토리 0(itinerary-edit 이 유일했고 widgets 로 이동).
    const domain = sharedDirs.filter((name) =>
      /^(itinerary|stay|place|trip)/.test(name)
    );
    expect(domain).toEqual([]);
  });
});

describe('🔴 C · AC-1 경계 — features/planb 는 @/widgets 를 안 물고, ManualEditScreen 은 어디에도 없다', () => {
  it('features/planb @/widgets 0 · features 판·pages 판 부재 (부정) + planb 모집단 실재 (긍정 짝)', () => {
    const planbSources = readAll(
      listSourceFiles(path.join(ROOT, 'features/planb'))
    );

    // 긍정 짝 — planb 모집단이 비어 있지 않다(공허 통과 방지).
    expect(planbSources.length).toBeGreaterThan(0);

    // 부정 — features/planb 는 상위층(widgets)을 역참조하지 않고, 화면은 features 에도 pages 에도 없다
    // (TRIP-753 — i07 이 h12 편집기(ItineraryEditPage + EditorView)를 재사용해 옛 화면이 사라졌다).
    expect(exists('features/planb/ui/ManualEditScreen.tsx')).toBe(false);
    expect(exists('pages/planb-manual/ui/ManualEditScreen.tsx')).toBe(false);
    const offenders = planbSources
      .filter(({ source }) => source.includes('@/widgets'))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 E · AC-2 — SlotTimeSheet 소멸 + 소비처가 @/widgets/time-sheet 소비', () => {
  it('SlotTimeSheet.tsx 부재·전 소스 옛 경로 0 (부정) + 소비처 위젯 import (긍정 짝, ★4)', () => {
    const sources = allSources();
    const consumers = TIME_SHEET_CONSUMERS.map((c) => ({
      ...c,
      source: readOne(c.rel),
    }));

    // 긍정 짝 — 소비처(PlaceAddPage 포함)가 위젯을 소비하고, 각자의 라벨·제목을 실제로 넘긴다
    // (seed 누락분 ★4 + 03b 경고-1 회귀 사각을 여기서 강제).
    consumers.forEach(({ rel, source, labels, title }) => {
      expect({
        rel,
        importsWidget: source.includes('@/widgets/time-sheet'),
        labelsOk: labels.test(source),
        titleOk: title ? title.test(source) : true,
      }).toEqual({ rel, importsWidget: true, labelsOk: true, titleOk: true });
    });

    // 부정 — SlotTimeSheet 소스가 사라졌고, 어떤 소스도 옛 경로를 참조하지 않는다(preview 포함).
    expect(exists('features/itinerary/ui/SlotTimeSheet.tsx')).toBe(false);
    const offenders = sources
      .filter(({ source }) =>
        source.includes('features/itinerary/ui/SlotTimeSheet')
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('🔴 F · AC-4/AC-5 — 위젯은 상위층·raw hex 를 안 물고, 상태는 소비처가 쥔다', () => {
  it('위젯 UI 소스에 expo-router·@/features·@/pages·raw hex 0 (부정) + 3위젯 실재 (긍정 짝)', () => {
    const sources = widgetUiSources();

    // 긍정 짝 — 모집단에 두 위젯이 실재한다(빈 widgets 층에서 공허 통과 방지). TRIP-753 으로 옛 셸이
    // 사라져 대표를 map-sheet-shell 로 옮겼다.
    // TRIP-919: 새 폴백 바(MapFallbackBar)도 이 모집단에 들어와 같은 스캔을 받는다.
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining([
        'widgets/map-sheet-shell/ui/MapSheetShell.tsx',
        'widgets/map-sheet-shell/ui/MapFallbackBar.tsx',
        'widgets/time-sheet/ui/TimeSheet.tsx',
      ])
    );

    // 부정 — 위젯은 상위층·라우터·raw hex 를 물지 않는다(통과형 목·토큰 규약).
    const offenders = sources.flatMap(({ file, source }) => {
      const hits: string[] = [];
      if (source.includes('expo-router')) hits.push(`${file}: expo-router`);
      if (source.includes('@/features/')) hits.push(`${file}: @/features/`);
      if (source.includes('@/pages/')) hits.push(`${file}: @/pages/`);
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).forEach(
        (hex) => hits.push(`${file}: ${hex}`)
      );
      return hits;
    });
    expect(offenders).toEqual([]);
  });

  it('위젯 UI 에 useState 0 (부정, STATE_EXEMPT 예외) + 예외 파일은 등재한 개수만큼만 상태를 쥔다 (긍정 짝)', () => {
    const sources = widgetUiSources();

    // 탐지기 자가검사 — import 줄은 안 세고, 제네릭 호출은 세고, 주석(전처리로 걷힘)은 안 센다.
    expect(
      countUseStateCalls(
        stripComments(
          [
            "import { useState } from 'react';",
            '// const [x] = useState(0);',
            'const [a, setA] = useState(false);',
            "const [b, setB] = useState<'start' | 'end'>('start');",
          ].join('\n')
        )
      )
    ).toBe(2);

    // 긍정 짝 ① — 예외 파일마다 실물이고 useState 호출 수가 **등재한 개수와 정확히 같다**. 모자라면
    //   유령 예외(02a ★8), 넘치면 허락 안 된 상태가 들어온 것이다(03b 경고-1 — 파일 단위 예외는 셸을
    //   통째로 가드 밖으로 뺐다).
    expect(
      STATE_EXEMPT.map(({ rel }) => ({
        rel,
        exists: exists(rel),
        count: countUseStateCalls(readOne(rel)),
      }))
    ).toEqual(
      STATE_EXEMPT.map(({ rel, count }) => ({ rel, exists: true, count }))
    );
    // 긍정 짝 ② — props-only 위젯이 모집단에 있다. 재시도 상태는 셸이 쥐고 폴백 바는 그리기만 한다
    //   (TRIP-919 — 셸이 예외가 돼 앵커를 MapFallbackBar 로 옮겼다, 02a ★9).
    expect(sources.map((s) => s.file)).toEqual(
      expect.arrayContaining(['widgets/map-sheet-shell/ui/MapFallbackBar.tsx'])
    );

    // 부정 — 예외 외 위젯은 useState 를 쥐지 않는다(상태는 소비처 소유).
    const offenders = sources
      .filter(({ file }) => !STATE_EXEMPT_FILES.includes(file))
      .filter(({ source }) => /\buseState\b/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
