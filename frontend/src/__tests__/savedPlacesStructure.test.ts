/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-220 AC-9 — 담기 상태의 **소유자가 누구인가**를 소스 층에서 잠근다.
 *
 * 무엇을 보장하나: 서버 응답(`SavedPlace`·`Place`)을 Zustand 스토어에 복사하지 않는다.
 *
 * 왜 소스 스캔인가 — **렌더로는 원리적으로 볼 수 없다.** 캐시를 소유하든 스토어에 복사하든
 * 화면 출력은 똑같이 나온다. 게다가 이 규칙은 두 정본이 **서로 반대로** 적혀 있다:
 *   - `aidlc/.../frontend-components.md` §2 PlaceExplorer 행의 state 칸 = "Zustand: 담기 낙관적 업데이트"
 *   - `frontend/README.md` §66 = "서버 데이터의 단일 소유자는 TanStack Query 캐시다. 서버 응답을
 *     Zustand 스토어에 복사하지 않는다", §15 = "낙관적 업데이트는 Query가 전담"
 * 루트 CLAUDE.md 「When docs conflict」상 패키지 아키텍처는 `frontend/README.md`가 이기고,
 * 티켓 제목("담기 **서버 상태**")도 그쪽이다. **문서가 반대로 적힌 상태에서 기계 가드가 없으면
 * 다음 칸(TRIP-221~223)이 문서를 따라간다.** 이 파일이 그 자리를 메운다.
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다. 헬퍼는 공용화하지 않고 파일마다 각자 갖는다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 서버 상태 소유권 규칙(`frontend/README.md` §66)이 유지되는 한
 * 유효하다. 위 문서 드리프트가 정본에서 해소되어도 이 가드는 그대로 둔다 — 규칙이 사라진 것이
 * 아니라 문서가 규칙을 따라온 것이기 때문이다.
 */

const ROOT = path.resolve('src');
const SAVED_PLACES_HOOK = path.join(
  ROOT,
  'features',
  'explore',
  'model',
  'savedPlaces.ts'
);
const SAVED_PLACE_INDEX = path.join(
  ROOT,
  'features',
  'explore',
  'model',
  'savedPlaceIndex.ts'
);

/**
 * 서버 응답 DTO의 식별자 — 이 이름들이 **Zustand 스토어 코드에** 있으면 서버 응답을 복사한
 * 것이다. 순수 UI 상태(어느 시트가 열렸나 같은)에는 등장할 이유가 없는 이름만 골랐다.
 */
const SERVER_DTO_IDENTIFIERS = [
  'SavedPlace',
  'savedPlaceId',
  'savedAt',
  'savedCount',
  'dataStatus',
];

/**
 * 스캔 전처리 — 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가
 * 소실된다). 줄 주석 규칙에서 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** —
 * `'https://…'`의 슬래시를 주석 시작으로 오인하지 않기 위한 것이다
 * (`tripBudgetStructure.test.ts`의 것과 동형 · 완전한 파서를 만들지 않는 것이 의도다).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 생성물과 테스트 파일은 가드 대상이 아니다 — 전자는 도구가 쓰고, 후자는 이 규칙의 심판이다. */
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

/** `zustand`를 실제로 import 하는 파일만 — 스토어가 사는 곳의 모집단이다. */
function zustandSources(): { file: string; source: string }[] {
  return listSourceFiles(ROOT)
    .map((full) => ({
      file: path.relative(ROOT, full).split(path.sep).join('/'),
      source: stripComments(fs.readFileSync(full, 'utf8')),
    }))
    .filter(({ source }) => source.includes('zustand'));
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석 속 이름은 걷히고, 코드의 이름과 URL 줄은 살아남는다', () => {
    const sample = [
      '/**',
      ' * 서버 응답(SavedPlace)을 스토어에 복사하지 않는다 — README §66.',
      ' * 참조: https://figma.com/design/x',
      ' */',
      '// const bad = { savedPlaceId: id };',
      "const url = 'https://example.com/a';",
      'const good = create(() => ({ openSheetPoiId: null }));',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 산문으로 적은 금칙 이름은 걸리지 않는다 — 걷지 않으면 이 파일들의 머리말이 스스로
    //    red 를 낸다(새 모듈이 README §66을 주석에 인용하는 것은 이 리포 관례다).
    expect(stripped).not.toContain('SavedPlace');
    expect(stripped).not.toContain('savedPlaceId');

    // ② 회귀 가드 — URL 의 `//` 를 줄 주석으로 오인하면 그 줄이 통째로 사라져 **거짓 green**
    //    이 난다(2026-07-31 실사고). 화면·모델 파일 머리말에 Figma 노드 URL 을 적는 것이 이
    //    리포 관례라 이 함정은 실제로 밟힌다.
    expect(stripped).toContain("const url = 'https://example.com/a';");
    expect(stripped).toContain('openSheetPoiId');

    // ③ **가장 중요한 짝** — 코드에 실재하는 이름은 전처리를 통과해 살아남는다. 이게 없으면
    //    "무엇이든 다 지우는" 전처리가 아래 단언 전부를 공짜로 통과시킨다.
    expect(stripComments('const s = { savedPlaceId: id };')).toContain(
      'savedPlaceId'
    );
    expect(stripComments('import type { SavedPlace } from "x";')).toContain(
      'SavedPlace'
    );
  });
});

describe('AC-9 · 서버 응답을 Zustand 스토어에 복사하지 않는다 (선제 green — 다음 칸을 위한 회귀 앵커)', () => {
  /**
   * ⚠️ **선제 green** — places 코드가 아직 없어 지금 red 를 낼 수 없다. 그래도 남기는 이유는
   * 위 머리말 그대로다: 정본 문서 한쪽이 반대로 적혀 있고, 이 규칙을 어긴 구현은 **화면
   * 출력이 똑같아서** 어떤 렌더 테스트도 잡지 못한다.
   *
   * 잠그지 않는 것(정직한 한계): `savedByPoiId: Record<string, boolean>` 처럼 DTO 이름을
   * 쓰지 않고 **파생값만** 복사한 스토어는 이 스캔이 못 잡는다. 거기까지 막으려면 `poiId` 를
   * 금칙어에 넣어야 하는데, `poiId` 는 순수 UI 상태(어느 카드의 시트가 열렸나)로 정당하게
   * 쓰일 수 있어 다음 칸에 거짓 red 를 만든다. 여기서 멈추는 것이 의도다.
   */
  it('zustand 를 쓰는 파일 어디에도 서버 DTO 식별자가 없다', () => {
    const sources = zustandSources();

    // 긍정 짝 — 모집단이 실제로 채워졌다는 증거. 없으면 "위반 0건"이 공허하게 통과한다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map(({ file }) => file)).toContain(
      'features/trip/model/tripWizardStore.ts'
    );

    // 부정 — 등장하는 것을 모아 실패 diff 에 어느 파일의 어느 이름인지 찍는다.
    const offenders = sources.flatMap(({ file, source }) =>
      SERVER_DTO_IDENTIFIERS.filter((name) => source.includes(name)).map(
        (name) => `${file}: ${name}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('담기 훅이 실재하고, 서버 상태를 Query 로 다루며 zustand 를 쓰지 않는다', () => {
    // 긍정 짝 ① — 두 모듈이 실재한다. 없으면 아래 읽기가 예외로 죽어 "무엇이 없는가"를 읽을
    // diff 가 안 남는다.
    expect({
      hook: fs.existsSync(SAVED_PLACES_HOOK),
      pure: fs.existsSync(SAVED_PLACE_INDEX),
    }).toEqual({ hook: true, pure: true });

    const hookSource = stripComments(
      fs.readFileSync(SAVED_PLACES_HOOK, 'utf8')
    );

    // 긍정 짝 ② — 훅이 실제로 Query 계층 위에 서 있다(`frontend/README.md` §15·§66).
    expect(hookSource).toContain('@tanstack/react-query');
    expect(hookSource).toContain('export function useSavedPlaces');

    // 부정 — 같은 파일이 스토어를 겸하지 않는다.
    expect(hookSource).not.toContain('zustand');
  });
});
