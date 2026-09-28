/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1072 · AC-13 · 01b E5·E8 — 즉석 방문 장소 피커의 층 배선 소스 가드.
 *
 * 무엇을 보장하나:
 *  - S1 새 라우트·배럴·페이지·이름 모듈이 정본 경로에 실재한다.
 *  - S2 라우트는 params 만 읽어 페이지에 넘긴다 — feature 를 직접 물지 않는다(recordsStructure G3 동형).
 *  - S3 페이지는 도착 기록을 `useVisitCheck` 로만 한다 — 생성 클라이언트 POST 를 직접 부르면 j01 이 보는
 *    (tripId, day) 캐시의 낙관 카드·응답 교체를 건너뛴다.
 *  - S4 이름 세션 캐시는 TanStack Query 에 둔다 — Zustand 금지(README "서버 응답을 스토어에 복사하지 않는다").
 *    `pagesLayerStructure` 의 zustand 스캔은 pages 층만 보므로 features/record/model 은 이 파일이 본다.
 *  - S5 프리뷰 `records-default` 가 [방문 추가] 콜백을 넘겨 Figma default 와 같은 얼굴을 그린다(6-b 대조용).
 *
 * pages 층 규칙(duration·zustand·URL·타이머·raw hex)은 `pagesLayerStructure` 재귀 스캔이, features/record 의
 * 타 feature import·raw HTTP 금지는 `recordsStructure` G2·G5 재귀 스캔이 새 파일을 자동으로 편입해 본다.
 *
 * 전제: 스캔은 주석을 걷은 소스를 본다(`stripComments`, 콜론 뒤 `//` 보존). 부정 단언은 같은 it 의 긍정 짝과 함께.
 */

const ROOT = path.resolve('src');

const ROUTE_REL = 'app/trips/[tripId]/records/add-visit.tsx';
const BARREL_REL = 'pages/record-add-visit/index.ts';
const PAGE_REL = 'pages/record-add-visit/ui/RecordAddVisitPage.tsx';
const NAMES_REL = 'features/record/model/spontaneousNames.ts';
const PREVIEW_REL = 'app/_dev/preview.tsx';

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

/** `key: '<key>'` 항목 하나를 다음 `key: '` 직전까지 떼어낸다(recordsMapMarkersStructure 선례). */
function fixtureBlock(source: string, key: string): string {
  const start = source.indexOf(`key: '${key}'`);
  if (start === -1) return '';
  const next = source.indexOf("key: '", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

describe('S0 · 탐지기 자가검사 — stripComments × 문자열 탐지', () => {
  it('주석 속 금칙어는 걷히고, 코드의 import·경로·콜백 이름은 살아남는다', () => {
    const sample = [
      '/** zustand 대신 @tanstack/react-query 캐시. @/features/record 는 페이지 몫. */',
      "import { useQuery } from '@tanstack/react-query'; // zustand 금지",
      "import { RecordAddVisitPage } from '@/pages/record-add-visit';",
      "router.push('/trips/t1/records/add-visit?day=2026-08-20');",
      "key: 'records-default', onPressSpontaneous={noop}",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 산문 속 금칙어는 걷힌다.
    expect(stripped).not.toContain('zustand');
    expect(stripped).not.toContain('@/features/record');
    // ② 코드 줄은 살아남는다(전처리가 탐지 대상을 지우면 아래 긍정 단언이 공허하다).
    expect(stripped).toContain("from '@tanstack/react-query'");
    expect(stripped).toContain('@/pages/record-add-visit');
    expect(stripped).toContain('/trips/t1/records/add-visit?day=2026-08-20');
    expect(fixtureBlock(stripped, 'records-default')).toContain(
      'onPressSpontaneous'
    );
  });
});

describe('🔴 S1 · 새 파일 4개가 정본 경로에 실재한다', () => {
  it.each([ROUTE_REL, BARREL_REL, PAGE_REL, NAMES_REL])(
    '%s 가 존재한다',
    (rel) => {
      expect({
        file: rel,
        exists: fs.existsSync(path.join(ROOT, rel)),
      }).toEqual({ file: rel, exists: true });
    }
  );
});

describe('🔴 S2 · 라우트는 얇다 (AC-13)', () => {
  it('라우트는 params 를 읽어 페이지에 위임하고 feature 를 직접 모른다', () => {
    const route = readOne(ROUTE_REL);

    // 긍정 — 페이지 배럴로 위임, params 는 여기서만 읽는다.
    expect(route).toContain('@/pages/record-add-visit');
    expect(route).toContain('useLocalSearchParams');
    // 부정 — feature·조회훅을 직접 물지 않는다.
    expect(route).not.toContain('@/features/');
  });

  it('배럴이 페이지를 내보낸다', () => {
    expect(readOne(BARREL_REL)).toContain('RecordAddVisitPage');
  });
});

describe('🔴 S3 · 페이지는 도착 기록을 체크 훅으로만 한다 (AC-13)', () => {
  it('useVisitCheck 를 쓰고 POST 생성 함수를 직접 부르지 않는다', () => {
    const page = readOne(PAGE_REL);

    expect(page).toContain('useVisitCheck');
    expect(page).not.toContain('postTripsTripIdVisits');
  });
});

describe('🔴 S4 · 이름 세션 캐시는 Query 캐시에 둔다 (E5)', () => {
  it('이름 모듈이 @tanstack/react-query 를 쓰고 zustand 를 안 쓴다', () => {
    const names = readOne(NAMES_REL);

    expect(names).toContain('@tanstack/react-query');
    expect(names).not.toContain('zustand');
  });
});

describe('🔴 S5 · 프리뷰 records-default 에 [방문 추가]가 선다 (E8)', () => {
  it('records-default 블록이 onPressSpontaneous 를 넘긴다', () => {
    const block = fixtureBlock(readOne(PREVIEW_REL), 'records-default');

    // 긍정 앵커 — 블록을 실제로 찾았다.
    expect(block).toContain('TripRecordsScreen');
    expect(block).toContain('onPressSpontaneous');
  });
});
