import fs from 'fs';
import path from 'path';

/**
 * TRIP-1012 #074 — 여행 만들기 위저드(`/trips/new/step1`)로 가는 **모든 호출처**를 잠근다.
 *
 * 무엇을 보장하나: 위저드로 들어가는 곳은 둘로 갈린다. **새 진입점**(홈·탐색 FAB 등)은 이동
 * 직전에 드래프트를 비우고, **위저드 안**(더 담기 완료·2/4 '처음부터')은 비우지 않는다. 어느
 * 쪽인지는 호출처마다 사람이 정해야 해서, 호출처가 하나 늘면 이 표가 red 가 되어 분류를
 * 강제한다 — 새 진입점이 비우기를 빠뜨리는 회귀를 여기서 먼저 멈춘다.
 *
 * 새 호출처가 생겼다면: ① 새 진입점이면 이동 직전 `reset()` + 그 화면 테스트에 1012-B1 케이스
 * (`test-support/wizardDraftFixture`의 `captureDraftAtNextCall`)를 더하고, ② 위저드 안이면 보존
 * 케이스를 더한 뒤, 아래 표에 그 파일을 적는다.
 *
 * 왜 개수까지 세나: 파일만 보면 이미 표에 있는 화면에 두 번째 버튼이 생겨도 못 잡는다.
 *
 * ── 졸업 조건 ── **A. 영구 규칙 — 유지한다.** 위저드 드래프트가 모듈 싱글턴으로 사는 한
 * "진입 = 비움"의 판정은 호출처에 있다.
 */

const ROOT = path.resolve('src');

/** 새 진입점 6곳(비움) + 위저드 안 2곳(보존). SavedPlacesPage 는 둘 다 가진다.
 * TRIP-1123 — 마이페이지 [새 여행 만들기]가 사라져 `pages/my-page/ui/MyPage.tsx` 항목을 뺐다(8→7).
 * TRIP-1105 — 목적지 상세(d03 FAB)는 d01 지역 필터로 합쳐져 탐색 d01 1곳에 들어갔다(두 칸 합산 8→6). */
const EXPECTED: Record<string, number> = {
  'pages/home/ui/HomePage.tsx': 1, // 홈 FAB — 새 진입(TRIP-1142 로 (tabs)/index.tsx 에서 이동)
  'pages/explore-landing/ui/ExploreLandingPage.tsx': 1, // 탐색 FAB — 새 진입(TRIP-1142)
  'pages/place-explore/ui/PlaceExplorePage.tsx': 1, // d04 FAB — 새 진입
  'pages/itinerary-list/ui/MyTripsListPage.tsx': 1, // 내 여행 목록 — 새 진입
  'pages/records-calendar/ui/RecordsCalendarPage.tsx': 1, // 기록 빈 상태 — 새 진입
  // select 완료(위저드 안 — 보존) + '이 장소들로 여행 만들기'(새 진입 — 비운 뒤 시드)
  'pages/saved-places/ui/SavedPlacesPage.tsx': 2,
  'pages/trip-new-step2/ui/TripNewStep2Page.tsx': 1, // '처음부터' — 위저드 안(보존)
};

const STEP1_LITERAL = /['"`]\/trips\/new\/step1['"`?]/g;

/** 블록 주석과 줄 주석을 걷는다 — `https://` 같은 URL 의 `//` 는 남긴다(앞 글자가 `:`). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['__tests__', 'generated', 'test-support', 'mocks'].includes(
        entry.name
      )
        ? []
        : listSourceFiles(full);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

function countLiterals(source: string): number {
  return (stripComments(source).match(STEP1_LITERAL) ?? []).length;
}

describe('탐지기 자가검사 — 이게 통과해야 아래 표가 의미를 갖는다', () => {
  it('주석 속 리터럴은 걷히고, 코드 리터럴과 URL 은 살아남는다', () => {
    const sample = [
      '/**',
      " * d02 CTA 는 push('/trips/new/step1')을 동반한다.",
      ' */',
      "// router.push('/trips/new/step1');",
      "const figma = 'https://www.figma.com/design/x';",
      "onPress={() => router.push('/trips/new/step1')} // 새 진입",
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석 2곳은 세지 않고 코드 1곳만 센다 — 조합(전처리+탐지)을 실제 문자열로 태운다.
    expect(countLiterals(sample)).toBe(1);
    expect(stripped).toContain("router.push('/trips/new/step1')");
    expect(stripped).toContain("'https://www.figma.com/design/x'");
  });
});

describe('🟢 1012 · /trips/new/step1 호출처 전수 (새 진입 7 · 위저드 안 2)', () => {
  it('리터럴을 가진 파일과 파일별 개수가 분류 표와 정확히 같다', () => {
    const files = listSourceFiles(ROOT);
    const found: Record<string, number> = {};
    files.forEach((full) => {
      const count = countLiterals(fs.readFileSync(full, 'utf8'));
      if (count > 0) {
        found[path.relative(ROOT, full).split(path.sep).join('/')] = count;
      }
    });

    // 모집단 앵커 — 스캔이 실제로 src 전체를 훑는다(경로 오류면 0개라 아래가 공허해진다).
    expect(files.length).toBeGreaterThan(100);
    expect(
      files.some((full) =>
        full.endsWith(path.join('app', '(tabs)', 'index.tsx'))
      )
    ).toBe(true);

    expect(found).toEqual(EXPECTED);
  });
});
