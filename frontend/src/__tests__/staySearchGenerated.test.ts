/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-179 AC-2 ②③④ · BR-U1-10/15 · US-STAY 추적 — 생성 클라이언트 소스 스캔 가드.
 *
 * 무엇을 보장하나: 코드젠이 실제로 **무엇을** 만들었는가. `pnpm codegen`을 이 테스트가 직접
 * 돌리지 않고(orval 실행은 워킹트리에 파일을 쓰는 부작용이 있다 — 02a §7-①), **커밋된
 * 생성물을 fs로 읽어서** 확인한다. `homeStructure.test.ts`·`tabbarVisual.test.ts`와 같은
 * `@jest-environment node` + fs 소스 스캔 가드 형태다.
 *
 * **전제**: 이 파일의 모든 `it`은 **주석을 걷어낸 소스**를 스캔한다(`stripComments`,
 * `tabbarVisual.test.ts`의 것과 동형 — 공용화하지 않고 파일마다 각자 갖는다). 이유: 생성물
 * `stays/stays.ts`의 JSDoc에 openapi `/stays/search` description을 그대로 복사한 `소요` 1건이
 * 실재한다 — **INV-3을 지킨다고 선언하는 문장이지 위반이 아니다.** 주석을 걷어내지 않으면
 * B-4(아래)가 이 문구에 거짓 RED로 걸린다. (사전 신고 — qa-verifier의 수기 INV-3 grep은
 * 이 1건을 만나므로 02 매핑 표에도 같은 신고가 실려야 FAIL로 오판되지 않는다.)
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 *
 * **A. 영구 규칙 — 유지한다.** (생성물 스키마가 유지되는 한 유효.)
 *   - 스캔 전처리 자기검증(B-0) — `stripComments`가 no-op으로 퇴화하는 것을 막는 파수꾼
 *   - `stays/stays.ts`가 `/stays/search`·`useGetStaysSearch`·`getStaysSearch`·
 *     `StaySearchResponse`를 갖는다(B-2)
 *   - `getStaysSearchParams.ts`가 region·amenity·stayType만 갖고, 날짜·인원·정렬 이름은
 *     0건이다(BR-U1-10/15, B-3)
 *   - 생성물 전체에 `duration` 식별자 0건(INV-3, B-4)
 *   - `staySearchResponse.ts`·`stayItem.ts`가 US-STAY 추적 3필드(items·degraded·
 *     filterZeroReasons·price nullable)를 갖는다(B-5)
 *
 * **B. 이행 체크포인트 — 한시적이다.** 생성 파일 **목록**을 동결 8경로로 정확히 고정한다
 * (B-1). 다른 태그를 `orval.config.ts`의 `filters.tags`에 추가하는 정당한 후속 티켓이 이
 * 숫자를 8 → N으로 만든다. 완화형: **"8경로를 부분집합으로 포함하고, `stays/stays.ts`가
 * 목록에 있다"**(개수 앵커와 엔드포인트 파일 존재는 그대로 지킨다).
 *
 * **B 카운터**: 이 파일 전용. 현재값 = **0**.
 * **B 카운터 제외구**(`fsdStructure.test.ts`·`tabbarVisual.test.ts` 헤더에서 계승): 세는
 * red는 ① 이 단언을 만든 사이클 **밖**의 작업이 낸 것이고 ② B 단언 자체를 갱신하지 않고는
 * 통과할 수 없는 것이다(AND). 이번 사이클의 출생 red(B-1~B-5)는 전부 제외구에 걸려 세지
 * 않는다 — 출생 red는 마찰이 아니라 가드가 실효함을 증명하는 정반대의 증거다.
 * **B 완화 시점**: 정당한 신규 작업이 B 때문에 red를 낸 것이 2회 누적되면 즉시 위 완화형으로
 * 격하한다(사이클 종료를 기다리지 않는다).
 */

const ROOT = path.resolve('src');
const GENERATED_DIR = path.join(ROOT, 'shared', 'api', 'generated');

/**
 * 스캔 전처리 — 소스에서 주석을 걷어낸다. `tabbarVisual.test.ts`의 것과 동형인 2-regex
 * 근사이고, 완전한 파서를 만들지 않는 것이 의도다. 순서가 중요하다 — 블록 주석을 먼저
 * 지워야 `/* a // b *​/ const keep = 2;` 같은 한 줄에서 코드가 소실되지 않는다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

function listTsFilesRecursive(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTsFilesRecursive(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** 디렉토리가 없으면 빈 배열(방어) — `fsdStructure.test.ts`의 방어 근거와 같다: 없는
 * 디렉토리에 readdirSync를 걸면 예외로 죽어 "무엇이 없는가"를 읽을 diff가 안 남는다. */
function listGeneratedFiles(): string[] {
  if (!fs.existsSync(GENERATED_DIR)) {
    return [];
  }
  return listTsFilesRecursive(GENERATED_DIR)
    .map((full) => path.relative(ROOT, full).split(path.sep).join('/'))
    .sort();
}

/** 개별 생성 파일을 주석 제거 후 읽는다. 아직 없으면 빈 문자열(방어) — 그러면 아래 긍정
 * 단언이 "기대한 문자열이 빈 문자열에 없다"는 읽히는 assertion diff로 자연스럽게 실패한다. */
function readGeneratedSource(...segments: string[]): string {
  const full = path.join(GENERATED_DIR, ...segments);
  if (!fs.existsSync(full)) {
    return '';
  }
  return stripComments(fs.readFileSync(full, 'utf8'));
}

/**
 * 동결 17경로(§2-① 실측 그대로 — 재타이핑 금지).
 *
 * 8 → 12 → 17로 두 번 늘었고 둘 다 의도된 계약 변경이다.
 * - **TRIP-202**: `/stays/search`에 `'400': ValidationError`가 붙으면서 orval이 에러 봉투
 *   스키마 4종(`errorResponse`·`errorResponseError`·`errorResponseErrorFieldsItem`·
 *   `validationErrorResponse`)을 함께 생성.
 * - **TRIP-183**: `orval.config.ts` 태그에 `saved-stays` 추가(그 파일 주석이 정한 절차 —
 *   *"다른 태그가 필요해지면 그 티켓에서 tags 배열에 추가해 재생성한다"*). '내 주변' 권한
 *   거부 시 등록 숙소 좌표로 대체 조회하는 데 필요하다(BR-U1-11).
 *
 * **개수가 아니라 목록 전체를 잠그는 성질은 그대로다** — 의도치 않은 태그가 섞이면 여전히 잡힌다.
 */
const GENERATED_FILES_FROZEN = [
  'shared/api/generated/saved-stays/saved-stays.ts',
  'shared/api/generated/schemas/editSavedStayRequest.ts',
  'shared/api/generated/schemas/errorResponse.ts',
  'shared/api/generated/schemas/errorResponseError.ts',
  'shared/api/generated/schemas/errorResponseErrorFieldsItem.ts',
  'shared/api/generated/schemas/geocodeCandidate.ts',
  'shared/api/generated/schemas/getStaysGeocodeParams.ts',
  'shared/api/generated/schemas/getStaysSearchParams.ts',
  'shared/api/generated/schemas/index.ts',
  'shared/api/generated/schemas/registerRoute.ts',
  'shared/api/generated/schemas/registerSavedStayRequest.ts',
  'shared/api/generated/schemas/savedStay.ts',
  'shared/api/generated/schemas/stayItem.ts',
  'shared/api/generated/schemas/stayPrice.ts',
  'shared/api/generated/schemas/staySearchResponse.ts',
  'shared/api/generated/schemas/validationErrorResponse.ts',
  'shared/api/generated/stays/stays.ts',
];

/** BR-U1-10(날짜·인원 없이 탐색)·BR-U1-15(정렬은 서버 고정) 위반의 흔적. */
const FORBIDDEN_PARAM_NAMES = [
  'date',
  'checkIn',
  'checkOut',
  'guests',
  'adults',
  'children',
  'sort',
  'page',
  'size',
];

describe('스캔 전처리 · 주석 제거 자기검증 — B 파일 전체의 전제 (B-0)', () => {
  it('주석 안의 글자는 스캔에서 사라지고, 코드의 같은 글자는 남는다', () => {
    // 준비 — 실제 파일이 아니라 손으로 만든 표본. stripComments가 no-op으로 퇴화하거나
    // 전부 지워버리는 구현으로 바뀌면 여기서 즉시 red가 난다.
    const sample = [
      '/** 헤더 블록 주석: 소요 문구 예시 */',
      "const a = '/stays/search';",
      '// 줄 주석: 또 다른 소요 문구',
      "const b = 'StaySearchResponse';",
    ].join('\n');

    // 실행
    const stripped = stripComments(sample);

    // 단언 — 네 방향을 한 객체로 비교한다(부분만 지우는 구현도 잡는다).
    expect({
      fromBlockComment: stripped.includes('헤더 블록 주석'),
      fromLineComment: stripped.includes('또 다른 소요'),
      fromCodeString: stripped.includes('/stays/search'),
      fromCodeClass: stripped.includes('StaySearchResponse'),
    }).toEqual({
      fromBlockComment: false,
      fromLineComment: false,
      fromCodeString: true,
      fromCodeClass: true,
    });
  });
});

describe('AC-2 ②③ · 생성 파일 인벤토리 — 동결 17경로 (B-1, 한시 — 위 졸업 조건 B)', () => {
  it('src/shared/api/generated/ 아래 .ts 파일 목록이 동결 17경로와 정확히 같다', () => {
    // 개수 > 0이 아니라 목록 전체를 잠근다 — 필터에 다른 태그가 섞여 들어와도 잡힌다.
    expect(listGeneratedFiles()).toEqual(GENERATED_FILES_FROZEN);
  });
});

describe('AC-2 ② · 생성 클라이언트가 /stays/search 엔드포인트를 실제로 부른다 (B-2)', () => {
  it('stays/stays.ts가 엔드포인트·훅·함수·응답 타입 심볼을 갖는다(주석 제거 후에도)', () => {
    const source = readGeneratedSource('stays', 'stays.ts');

    expect(source).toContain('/stays/search');
    expect(source).toContain('useGetStaysSearch');
    expect(source).toContain('getStaysSearch');
    expect(source).toContain('StaySearchResponse');
  });
});

describe('BR-U1-10 · BR-U1-15 · 파라미터 계약 — 날짜·인원·정렬 없음 (B-3)', () => {
  it('region·amenity·stayType만 있고, 금칙 파라미터 이름은 하나도 없다', () => {
    const source = readGeneratedSource('schemas', 'getStaysSearchParams.ts');

    // 긍정
    expect({
      hasRegion: source.includes('region'),
      hasAmenity: source.includes('amenity'),
      hasStayType: source.includes('stayType'),
    }).toEqual({ hasRegion: true, hasAmenity: true, hasStayType: true });

    // 부정 짝 — 등장하는 금칙 이름을 모아 실패 시 diff에 어떤 이름이 새로 들어왔는지 찍는다.
    const offenders = FORBIDDEN_PARAM_NAMES.filter((name) =>
      source.includes(name)
    );
    expect(offenders).toEqual([]);
  });
});

describe('AC-2 ④ · INV-3 — duration 식별자 0건 (B-4)', () => {
  it('생성물 8파일을 실제로 읽었고(StayItem·StaySearchResponse 존재), duration 식별자는 0건이다', () => {
    const files = listGeneratedFiles();
    const sources = files.map((rel) =>
      stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))
    );

    // 긍정 짝 — 모집단이 실제로 채워졌다는 증거. 디렉토리가 통째로 비어도 "위반 0건"이
    // 공허하게 통과하지 않도록 먼저 확인한다.
    expect(sources.length).toBeGreaterThan(0);
    const combined = sources.join('\n');
    expect(combined).toContain('StayItem');
    expect(combined).toContain('StaySearchResponse');

    // 부정 — DTO·식별자 수준 duration 전면 금지(INV-3). 생성물 JSDoc의 `소요` 1건은 주석
    // 제거로 이미 사라졌으므로 여기 걸리지 않는다.
    const offenders = files.filter((_rel, index) =>
      /\bduration\b/i.test(sources[index])
    );
    expect(offenders).toEqual([]);
  });
});

describe('US-STAY-01/10/11 추적 · 응답 타입 표현력 (B-5)', () => {
  it('staySearchResponse.ts가 items·degraded·filterZeroReasons를 갖고, stayItem.ts의 price가 nullable이다', () => {
    const responseSource = readGeneratedSource(
      'schemas',
      'staySearchResponse.ts'
    );
    const itemSource = readGeneratedSource('schemas', 'stayItem.ts');

    expect({
      hasItems: responseSource.includes('items'),
      hasDegraded: responseSource.includes('degraded'),
      hasFilterZeroReasons: responseSource.includes('filterZeroReasons'),
    }).toEqual({
      hasItems: true,
      hasDegraded: true,
      hasFilterZeroReasons: true,
    });

    expect({
      hasPriceOptional: itemSource.includes('price?'),
      hasNull: itemSource.includes('null'),
    }).toEqual({ hasPriceOptional: true, hasNull: true });
  });
});
