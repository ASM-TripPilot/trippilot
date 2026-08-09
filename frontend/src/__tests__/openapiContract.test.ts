/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-179 AC-1 · AC-2 준비(D2) — `backend/docs/design/openapi.yaml` 계약 회귀 가드.
 *
 * 무엇을 보장하나: 손으로 관리되는 계약 파일이 성한 상태인가를 잠근다. 이 파일은 코드젠의
 * **입력**을 검사한다 — 생성물(`src/shared/api/generated/`)은 커밋되어 있으므로, 입력이
 * 조용히 뒤집혀도 재생성 전까지는 아무 테스트도 안 깨진다. 이 파일이 그 사각지대를 메운다.
 *
 * 리포에 YAML 파서 의존이 없다(`package.json` deps·devDeps에 yaml 계열 0건) — orval의 전이
 * 의존을 끌어 쓰지 않고, 파일을 글자로 읽어 정규식으로 훑는다(`homeStructure.test.ts`·
 * `noMswInStaticGraph.test.ts`와 같은 `@jest-environment node` + fs 소스 스캔 형태).
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** (이 파일의 단언 전부가 A다.)
 *   - AC-1: `/stays/search` 경로 실재 + `servers` 2개 모두 `/api/v1`로 끝난다.
 *     ⚠️ **선제 green** — 실측(HEAD `ecbd63b`)으로 이미 충족돼 있어 이 단언은 지금 red를
 *     낼 수 없다. 그래도 남기는 이유: 이 브랜치가 `openapi.yaml`을 아래에서 직접 고치는
 *     자리라(D2), 백엔드 쪽 변경이 같은 파일을 조용히 뒤집어도 재생성 전까지 아무 테스트도
 *     안 깨지는 사각지대를 이 회귀 앵커가 메운다. 이름을 stays로 좁히지 않았으므로 앞으로
 *     어떤 태그가 추가돼도 유효하다.
 *   - AC-2 준비(D2): `components.responses`에 참조되는 이름이 전부 정의돼 있다 — 지금은
 *     `RateLimited`·`ModerationUnavailable` 정의가 없어 **이 파일의 진짜 red**다.
 *   - TRIP-294: itinerary 4오퍼레이션의 경로·메서드·응답 코드(201 포함)와 `Itinerary`·
 *     `GenerateItineraryRequest`·`EditItineraryRequest` 스키마의 required·enum·INV-3(C-1·C-2).
 */

const FRONTEND_SRC = path.resolve('src');
const REPO_ROOT = path.resolve(FRONTEND_SRC, '..', '..');
const OPENAPI_PATH = path.join(
  REPO_ROOT,
  'backend',
  'docs',
  'design',
  'openapi.yaml'
);

/** 방어적 읽기를 일부러 쓰지 않는다(`tabbarVisual.test.ts` §T-9 관례) — 경로가 틀리면
 * `readFileSync`가 `ENOENT`로 죽는 것이 옳다. 이 파일은 백엔드가 소유한 정본이라 존재를
 * 가정해도 된다. */
function readOpenapiSource(): string {
  return fs.readFileSync(OPENAPI_PATH, 'utf8');
}

/** `paths:` 아래 2칸 들여쓰기 경로 키 전부. */
const PATH_KEY_PATTERN = /^ {2}(\/[^\s:]+):/gm;
function extractPaths(source: string): string[] {
  return [...source.matchAll(PATH_KEY_PATTERN)].map((match) => match[1]);
}

/** `servers:` 블록의 `- url:` 값 전부. */
const SERVER_URL_PATTERN = /^ {2}- url: (\S+)/gm;
function extractServerUrls(source: string): string[] {
  return [...source.matchAll(SERVER_URL_PATTERN)].map((match) => match[1]);
}

/** `components:` 아래 `  responses:` 블록만 잘라낸다. 시작 = `\n  responses:\n`,
 * 끝 = 그다음에 나오는 2칸 들여쓰기 키(`\n  [a-z]`) — 없으면(이 블록이 파일의 마지막
 * 최상위 키인 경우) 파일 끝까지를 블록으로 본다. */
const RESPONSES_BLOCK_START = '\n  responses:\n';
const NEXT_TOP_LEVEL_KEY_PATTERN = /\n {2}[a-z]/;
function extractResponsesBlock(source: string): string {
  const startIdx = source.indexOf(RESPONSES_BLOCK_START);
  if (startIdx === -1) {
    return '';
  }
  const bodyStart = startIdx + RESPONSES_BLOCK_START.length;
  const rest = source.slice(bodyStart);
  const nextKeyMatch = rest.match(NEXT_TOP_LEVEL_KEY_PATTERN);
  const bodyEnd =
    nextKeyMatch && typeof nextKeyMatch.index === 'number'
      ? bodyStart + nextKeyMatch.index
      : source.length;
  return source.slice(bodyStart, bodyEnd);
}

/** `responses:` 블록 안의 4칸 들여쓰기 키(정의된 응답 이름) 전부. */
const RESPONSE_DEFINITION_KEY_PATTERN = /^ {4}([A-Za-z0-9_]+):/gm;
function extractDefinedResponseNames(responsesBlock: string): string[] {
  return [...responsesBlock.matchAll(RESPONSE_DEFINITION_KEY_PATTERN)].map(
    (match) => match[1]
  );
}

/** 파일 전체에서 `$ref: '#/components/responses/<이름>'`의 `<이름>` 전부. */
const RESPONSE_REF_PATTERN =
  /\$ref:\s*'#\/components\/responses\/([A-Za-z0-9_]+)'/g;
function extractReferencedResponseNames(source: string): string[] {
  return [...source.matchAll(RESPONSE_REF_PATTERN)].map((match) => match[1]);
}

/** 경로 키 하나의 블록만 잘라낸다(`extractResponsesBlock`과 같은 슬라이싱 방식) —
 * 시작 = `\n  <경로>:\n`, 끝 = 그다음 2칸 들여쓰기 경로 키(`PATH_KEY_PATTERN`과 같은
 * 모양) 또는 없으면 파일 끝. 다른 경로(`/stays/geocode` 등)에도 `- { name: ..., in: query`
 * 꼴 파라미터가 있으므로, 블록을 자르지 않고 파일 전체를 훑으면 남의 파라미터가 섞인다.
 *
 * TRIP-220에서 `/places`에도 같은 슬라이싱이 필요해져 경로를 인자로 받게 일반화했다
 * (같은 파일 안에 같은 함수를 두 벌 두지 않는다). 시작 문자열이 `\n` + 2칸 + 경로 + `:` +
 * `\n` 전체를 요구하므로 **`/places`가 `/saved-places`를 오탐하지 않는다** — 실측으로
 * 확인했다(02a §5-④: `/places` → [region, category], `/saved-places` → []). 기존
 * `/stays/search` 결과도 일반화 전후가 같다(같은 실측). */
const NEXT_PATH_KEY_PATTERN = /\n {2}\/[^\s:]+:/;
function extractPathBlock(source: string, pathKey: string): string {
  const start = `\n  ${pathKey}:\n`;
  const startIdx = source.indexOf(start);
  if (startIdx === -1) {
    return '';
  }
  const bodyStart = startIdx + start.length;
  const rest = source.slice(bodyStart);
  const nextKeyMatch = rest.match(NEXT_PATH_KEY_PATTERN);
  const bodyEnd =
    nextKeyMatch && typeof nextKeyMatch.index === 'number'
      ? bodyStart + nextKeyMatch.index
      : source.length;
  return source.slice(bodyStart, bodyEnd);
}

/**
 * `components.schemas` 아래 이름 하나의 블록만 잘라낸다. 스키마 키는 4칸 들여쓰기이고 그
 * 내용은 6칸 이상이므로, **다음 4칸 키**가 나오는 곳이 블록의 끝이다. 파일 전체를 훑으면
 * 이웃 스키마의 문장이 섞인다 — 예컨대 `EditTripRequest`도 `CreateTripRequest`와 똑같은
 * `required: [startDate, endDate, destinations]` 줄을 갖고 있어, 자르지 않으면 한쪽이
 * 지워져도 다른 쪽 때문에 통과한다.
 */
const NEXT_SCHEMA_KEY_PATTERN = /\n {4}[A-Za-z]/;
function extractSchemaBlock(source: string, name: string): string {
  const start = `\n    ${name}:\n`;
  const startIdx = source.indexOf(start);
  if (startIdx === -1) {
    return '';
  }
  const bodyStart = startIdx + start.length;
  const rest = source.slice(bodyStart);
  const nextKeyMatch = rest.match(NEXT_SCHEMA_KEY_PATTERN);
  const bodyEnd =
    nextKeyMatch && typeof nextKeyMatch.index === 'number'
      ? bodyStart + nextKeyMatch.index
      : source.length;
  return source.slice(bodyStart, bodyEnd);
}

/** 경로 블록 안 `- { name: X, ...}` 파라미터 항목의 `name` 값 전부(등장 순서
 * 그대로 — 순서가 뒤집혀도 잡히도록 완전 일치로 비교한다). */
const PARAM_NAME_PATTERN = /- \{ name: (\w+),/g;
function extractParamNames(pathBlock: string): string[] {
  return [...pathBlock.matchAll(PARAM_NAME_PATTERN)].map((match) => match[1]);
}

/** 경로 블록 안 HTTP 메서드 키(4칸 들여쓰기, 등장 순서 그대로). */
const HTTP_METHOD_KEY_PATTERN = /^ {4}(get|post|put|patch|delete):$/gm;
function extractMethodNames(pathBlock: string): string[] {
  return [...pathBlock.matchAll(HTTP_METHOD_KEY_PATTERN)].map(
    (match) => match[1]
  );
}

/** 경로 블록 안 응답 코드 키(`'201':`)를 **등장 순서 그대로** 모은다. 순서가 코드를 메서드에
 * 묶는 유일한 수단이다 — 블록을 메서드별로 다시 자르지 않고도 "201이 post 자리에 있다"를
 * 잴 수 있다. `\s+`가 아니라 ` +`인 것이 중요하다: `\s`는 줄바꿈을 삼켜 매치 시작 위치가
 * 앞줄로 밀린다. */
const RESPONSE_CODE_KEY_PATTERN = /^ +'(\d{3})':/gm;
function extractResponseCodes(pathBlock: string): string[] {
  return [...pathBlock.matchAll(RESPONSE_CODE_KEY_PATTERN)].map(
    (match) => match[1]
  );
}

/** 스키마 블록 안 `required: [...]` 줄 전부(중첩 깊이 무시, 등장 순서 그대로). 중첩 객체가
 * 있는 스키마는 required 줄이 여러 개다 — `Itinerary`는 최상위·day·slot 세 층이다. */
const REQUIRED_LINE_PATTERN = /^ *required: \[[^\]]*\]/gm;
function extractRequiredLines(schemaBlock: string): string[] {
  return [...schemaBlock.matchAll(REQUIRED_LINE_PATTERN)].map((match) =>
    match[0].trim()
  );
}

/**
 * `required: [a, b, c]` 줄에서 **필드 이름만** 원소 단위로 뽑는다(모든 층을 합쳐서).
 *
 * ⚠️ 부분 문자열로 재면 안 된다 — `'hasViolation'.includes('lat')` 가 **참**이다
 * (hasVio·**lat**·ion). "선택 필드가 required 로 승격되지 않았다"를 `줄.includes(이름)` 으로
 * 재면 `lat` 이 영구 오탐으로 걸린다(실측 — 02a ★1). 목록을 쪼개 원소로 비교하면 그 구멍이
 * 없다: 현행 `[]`, `nameKo` 를 승격시킨 뮤테이션에서는 `['nameKo']` 만 잡힌다.
 */
function extractRequiredFieldNames(requiredLines: string[]): string[] {
  return requiredLines.flatMap((line) =>
    line
      .replace(/^required: \[/, '')
      .replace(/\]$/, '')
      .split(', ')
  );
}

/** 스키마 블록 안에 **YAML 키로 선언된** 이름 중 없는 것을 모은다. 줄 앵커(`^ *이름:`)를
 * 쓰는 이유는 위와 같다 — 짧은 이름(`lat`·`lng`)이 남의 식별자 안에 박혀 있어도 오탐하지
 * 않는다. `category` 가 `shortfallCategories` 에 걸리지 않는 것도 실측 확인(02a V-2). */
function findMissingSchemaKeys(block: string, names: string[]): string[] {
  return names.filter((name) => !new RegExp(`^ *${name}:`, 'm').test(block));
}

/** 스키마 블록 안 `enum: [...]` 조각 전부(등장 순서 그대로). */
const ENUM_LIST_PATTERN = /enum: \[[^\]]*\]/g;
function extractEnumLists(schemaBlock: string): string[] {
  return [...schemaBlock.matchAll(ENUM_LIST_PATTERN)].map((match) => match[0]);
}

/**
 * TRIP-307·308·306 이 슬롯에 더한 **선택 9필드**(`tags` 는 required 라 여기 없다).
 * 근거: BR-U2-04(`placementReason`) · BR-U2-08(`distanceRange`) · BR-U3-09(POI 표면 5종) ·
 * `openingHours`/`openingHoursKnown`(영업시간 원문·확인 여부 — **소요시간이 아니다**).
 * 전부 nullable 이고 동시에 전부 null 일 수 있다("정본·동결본 모두 없으면 전부 null").
 */
const OPTIONAL_SLOT_FIELDS = [
  'placementReason',
  'distanceRange',
  'nameKo',
  'lat',
  'lng',
  'category',
  'openingHours',
  'openingHoursKnown',
  'imageUrl',
];

/** BR-U2-05 `candidatesSummary` 의 선택 2필드. `poolSize` 는 AI 가 안 주면 **없다**(0으로
 * 채우지 않는다 — 0은 "후보 0건"이라는 판정이라서). */
const OPTIONAL_CANDIDATES_SUMMARY_FIELDS = ['poolSize', 'shortfallCategories'];

/**
 * INV-3 — duration 계열이 **YAML 키로 선언된 자리**만 잡는다(글자 등장이 아니다).
 *
 * ⚠️ 이 구분이 이 파일에서 반드시 필요하다. `Itinerary` 스키마 블록 안에는
 * `# INV-3: 소요시간(duration) 필드 없음 — 거리만(후속)` 이라는 **수호 주석**이 실재한다.
 * "블록에 duration 글자가 없다"로 재면 INV-3을 지킨다고 선언하는 그 줄 때문에 영구 red가
 * 되고, 통과시키려면 정본에서 수호 주석을 지워야 하는 거꾸로 된 압력이 생긴다.
 *
 * "그럼 YAML 주석을 걷어내면 되지 않나" — 안 된다. `#`부터 줄 끝까지 지우는 전처리는
 * `$ref: '#/components/schemas/Itinerary'` 를 반으로 잘라먹는다(같은 유형의 실측 사고가
 * 이 리포에 있다 — 주석 제거가 `//`를 지워 URL 단언을 통과 불가로 만든 건).
 *
 * 그래서 전처리를 만들지 않고 **탐지 대상을 키로 좁혔다.** 주석줄은 첫 비공백 문자가 `#`
 * 이므로 이 패턴에 걸리지 않고, `durationMin:`·`travelDurationMinutes:` 같은 진짜 필드는
 * 걸린다(둘 다 뮤테이션으로 확인 — 02a ★2).
 */
const FORBIDDEN_DURATION_KEY_PATTERN = /^ *\w*[Dd]uration\w*\s*:/gm;
function extractDurationKeys(block: string): string[] {
  return [...block.matchAll(FORBIDDEN_DURATION_KEY_PATTERN)].map((match) =>
    match[0].trim()
  );
}

describe('AC-1 · 계약 회귀 — /stays/search 실재 + servers base (A-1, 선제 green)', () => {
  it('경로 목록에 /stays/search가 있고, servers 2개가 모두 /api/v1로 끝난다', () => {
    const source = readOpenapiSource();
    const paths = extractPaths(source);
    const servers = extractServerUrls(source);

    // 앵커 — 정규식이 실제로 뭔가를 모았다는 증거. 없으면 오타난 정규식이 조용한 빈손을
    // 만들고 아래 포함 단언이 공허해진다.
    expect(paths.length).toBeGreaterThan(0);

    expect(paths).toContain('/stays/search');

    // 긍정 — 두 값을 한 객체로 묶어 실패 diff에서 개수·형태를 한 번에 본다.
    expect({
      serverCount: servers.length,
      allEndWithApiV1: servers.every((url) => url.endsWith('/api/v1')),
    }).toEqual({ serverCount: 2, allEndWithApiV1: true });
  });
});

describe('BR-U1-10 · BR-U1-15 · /stays/search 파라미터 이름 잠금 — 스펙 드리프트 가드 (게이트①-2 보정 W-3, A-1의 연장)', () => {
  it('파라미터 이름이 region·amenity·stayType·lat·lng·radiusKm 순서로만 있고, 다른 이름이 섞이면 즉시 잡힌다', () => {
    const source = readOpenapiSource();
    const block = extractPathBlock(source, '/stays/search');
    const paramNames = extractParamNames(block);

    // 앵커 — 블록 슬라이싱·정규식이 실제로 뭔가를 모았다는 증거. 없으면 블록이 빈손이어도
    // 아래 완전 일치가 공허하게 통과해 sort·page 같은 신규 파라미터가 안 잡힌다.
    expect(paramNames.length).toBeGreaterThan(0);

    // 완전 일치(순서 포함) — sort·page 등 새 파라미터가 추가되면 즉시 red. 정렬은 서버
    // 고정(BR-U1-15)·날짜·인원 없이 탐색(BR-U1-10)을 어기는 스펙 개정을 여기서 잠근다.
    //
    // TRIP-202에서 lat·lng·radiusKm 3개가 붙었다('내 주변' 좌표 스코프 · US-STAY-01 · BR-U1-11).
    // 이 셋은 BR-U1-10/15와 충돌하지 않는다 — 날짜·인원이 아니고 정렬을 바꾸지도 않는다
    // (금지 목록 FORBIDDEN_PARAM_NAMES는 staySearchGenerated 쪽에서 그대로 잠근다).
    expect(paramNames).toEqual([
      'region',
      'amenity',
      'stayType',
      'lat',
      'lng',
      'radiusKm',
    ]);
  });
});

describe('TRIP-210 AC-1·AC-2 · SDK 토큰 경로 계약 앵커 (선제 green)', () => {
  it('/auth/social/{provider}/token 경로가 실재하고 SocialTokenLoginRequest 가 accessToken 을 필수로 요구한다', () => {
    // ⚠️ **선제 green** — 실측으로 이미 충족돼 있어 지금 red 를 낼 수 없다. 그래도 남기는
    // 이유: 이 경로 문자열이 TRIP-210 프론트 구현 전체의 근거인데, openapi.yaml 은 이 리포
    // 안의 파일이라 백엔드 머지가 조용히 뒤집을 수 있다. 뒤집혀도 재생성 전까지는 아무
    // 테스트도 안 깨지는 사각지대를 이 회귀 앵커가 메운다(같은 파일 AC-1 앵커와 같은 취지).
    const source = readOpenapiSource();
    const paths = extractPaths(source);

    // 앵커 — 정규식이 실제로 뭔가를 모았다는 증거.
    expect(paths.length).toBeGreaterThan(0);

    // code 경로와 token 경로가 **둘 다** 있다(D3: google 은 code 경로에 남는다).
    expect(paths).toContain('/auth/social/{provider}');
    expect(paths).toContain('/auth/social/{provider}/token');

    // 본문 계약 — accessToken 이 필수다. 프론트가 그 한 필드만 실어 보내는 근거(AC-1).
    expect(source).toContain('SocialTokenLoginRequest:');
    const schemaIdx = source.indexOf('    SocialTokenLoginRequest:');
    expect(schemaIdx).toBeGreaterThan(-1);
    const schemaBlock = source.slice(schemaIdx, schemaIdx + 400);
    expect(schemaBlock).toContain('required: [accessToken]');
  });
});

describe('TRIP-203 AC-3 · AC-4 · 여행 생성 계약 앵커 (A-3, 선제 green)', () => {
  /**
   * ⚠️ **선제 green** — openapi가 이미 이렇게 적혀 있어 지금 red를 낼 수 없다. 그래도 남기는
   * 이유는 이 파일의 존재 이유 그대로다: **생성물은 리포에 커밋돼 있다.** 백엔드가 여기서
   * `required`를 지우거나 enum에 `커플`을 넣어도, 누가 `pnpm codegen`을 돌리기 전까지는
   * 생성물을 보는 테스트(`staySearchGenerated.test.ts` B-7·B-8)도 타입 테스트
   * (`features/trip/model/tripContract.test.ts`)도 **아무 말도 하지 않는다.** 그 사각지대를
   * 이 회귀 앵커가 메운다.
   *
   * 근거: US-TRIP-01(여행지·날짜 범위 필수) · BR-U1-34 · BR-U1-39(온보딩 `커플`은 `연인`으로
   * 매핑 — 서버 여행 enum에 `커플`은 없다).
   */
  it('CreateTripRequest가 startDate·endDate·destinations를 required로 요구한다', () => {
    const source = readOpenapiSource();
    const block = extractSchemaBlock(source, 'CreateTripRequest');

    // 앵커 — 블록 슬라이싱이 실제로 뭔가를 잡았다는 증거. 없으면 아래 포함 단언이 빈
    // 문자열을 상대로 공허하게 실패/통과한다.
    expect(block.length).toBeGreaterThan(0);

    expect(block).toContain('required: [startDate, endDate, destinations]');

    // 긍정(대조군) — 선택 필드는 required 줄 밖에 있어야 한다. 이게 없으면 required를
    // 통째로 넓히는 방향의 계약 개정을 못 잡는다.
    expect(block).toContain('budgetTotal:');
    expect(block).not.toContain(
      'required: [startDate, endDate, destinations, budgetTotal]'
    );
  });

  it('CompanionType enum이 혼자·친구·연인·가족 4값이고 커플이 없다', () => {
    const source = readOpenapiSource();
    const block = extractSchemaBlock(source, 'CompanionType');

    // 앵커 — 슬라이싱이 실제로 뭔가를 잡았다.
    expect(block.length).toBeGreaterThan(0);

    // 완전 일치(줄 전체) — 값 하나가 추가·삭제·개명되면 즉시 red.
    expect(block).toContain('enum: [혼자, 친구, 연인, 가족]');

    // 부정 짝 — 온보딩 축의 값이 여행 축으로 새어 들어오지 않았다.
    expect(block).not.toContain('커플');
    expect(block).not.toContain('부모님');
  });
});

describe('TRIP-220 AC-10 · 장소 계약 앵커 (A-4, 선제 green)', () => {
  /**
   * ⚠️ **선제 green** — openapi가 이미 이렇게 적혀 있어 지금 red를 낼 수 없다. 그런데 이
   * 앵커가 **가장 필요한 시점**이 지금이다: TRIP-219(`c5139e9`)가 방금 `Place`에 `imageUrl`·
   * `tags`를 넣었고, 그 두 필드가 d04·d02 화면의 유일한 데이터 원본이다. 생성물은 리포에
   * 커밋되므로 백엔드가 이 계약을 되돌려도 **누가 `pnpm codegen`을 돌리기 전까지는 생성물을
   * 보는 테스트(B-10·B-11)도 아무 말을 하지 않는다.** 그 사각지대를 여기서 메운다
   * (같은 파일 A-1·A-3 앵커와 같은 취지 · 01b Seed Q5).
   */
  it('/places의 쿼리 파라미터가 region·category 정확히 둘뿐이다', () => {
    const source = readOpenapiSource();
    const block = extractPathBlock(source, '/places');
    const paramNames = extractParamNames(block);

    // 앵커 — 블록 슬라이싱·정규식이 실제로 뭔가를 모았다는 증거. 없으면 빈손이어도 아래
    // 완전 일치가 공허하게 통과해 sort·q 같은 신규 파라미터가 안 잡힌다.
    expect(paramNames.length).toBeGreaterThan(0);

    // 완전 일치(순서 포함) — 탐색 파라미터는 이 둘뿐이라는 것이 티켓·브리프가 함께 실측한
    // 계약이다(sort·q·좌표 없음). 하나라도 늘면 즉시 red.
    expect(paramNames).toEqual(['region', 'category']);
  });

  it('Place가 tags를 required로 요구하고 imageUrl은 선택으로 남는다', () => {
    const source = readOpenapiSource();
    const block = extractSchemaBlock(source, 'Place');

    // 앵커 — 슬라이싱이 실제로 뭔가를 잡았다는 증거. 이웃 스키마(SavePlaceRequest)로 새지
    // 않는 것은 실측으로 확인했다(02a §5-④).
    expect(block.length).toBeGreaterThan(0);

    // 완전 일치(줄 전체) — 필드 하나가 추가·삭제·개명되면 즉시 red.
    expect(block).toContain(
      'required: [poiId, nameKo, category, lat, lng, savedCount, dataStatus, tags]'
    );

    // 긍정(대조군) — 선택 필드가 실재한다. 이게 없으면 required만 보는 단언이 "imageUrl을
    // 통째로 지우는" 방향의 계약 개정을 못 잡는다.
    expect(block).toContain('imageUrl:');

    // 부정 짝 — imageUrl이 required 줄로 옮겨간 흔적. NULL=미확보가 정상값이므로 필수가
    // 되면 서버가 기본 이미지를 지어내야 한다(BR-U1-06 취지에 반한다).
    expect(block).not.toContain('imageUrl]');
  });
});

describe('TRIP-294 AC-1 · AC-5 · 일정 4오퍼레이션 경로·메서드·응답 코드 (A-5, 선제 green)', () => {
  /**
   * ⚠️ **선제 green** — openapi가 이미 이렇게 적혀 있어 지금 red를 낼 수 없다. 그런데 이
   * 앵커가 **가장 필요한 시점**이 지금이다: 브랜치를 딴 직후에도 백엔드 머지 두 건
   * (#118 `generation_state` · #120 자정 넘김 회귀)이 이 블록을 흔들었다. 생성물은 리포에
   * 커밋되므로, 백엔드가 여기서 경로를 옮기거나 201을 200으로 바꿔도 **누가 `pnpm codegen`
   * 을 돌리기 전까지는 생성물을 보는 테스트도 아무 말을 하지 않는다.** 그 사각지대를 이
   * 회귀 앵커가 메운다(같은 파일 A-1·A-3·A-4와 같은 취지).
   *
   * 추적: US-SCHED-01(생성)·06(조회)·07/08(편집)·12(확정) · 01b Seed AC-1·AC-5.
   * 201의 근거는 openapi 원문뿐이다 — construction 문서에는 상태 코드 서술이 전무하고,
   * 루트 CLAUDE.md가 "구현 결정은 소유 패키지 canon이 정본"이라 정했다.
   */
  it('두 itinerary 경로가 실재하고, GET/POST/PUT과 POST의 201이 정확한 자리에 있다', () => {
    const source = readOpenapiSource();
    const paths = extractPaths(source);
    const itineraryBlock = extractPathBlock(
      source,
      '/trips/{tripId}/itinerary'
    );
    const confirmBlock = extractPathBlock(
      source,
      '/trips/{tripId}/itinerary/confirm'
    );

    // 앵커 — 정규식·블록 슬라이싱이 실제로 뭔가를 모았다는 증거. 없으면 아래 완전 일치가
    // 빈 배열끼리 비교되며 공허하게 통과한다.
    expect(paths.length).toBeGreaterThan(0);
    expect(itineraryBlock.length).toBeGreaterThan(0);
    expect(confirmBlock.length).toBeGreaterThan(0);

    expect(paths).toContain('/trips/{tripId}/itinerary');
    expect(paths).toContain('/trips/{tripId}/itinerary/confirm');

    // 완전 일치(순서 포함) — 조회·생성·편집 세 메서드가 한 경로를 공유한다.
    expect(extractMethodNames(itineraryBlock)).toEqual(['get', 'post', 'put']);

    // 완전 일치(순서 포함) — 순서가 코드를 메서드에 묶는다: get(200·404) → post(201·404)
    // → put(200·404·409). 세 번째 원소가 '201'이라는 것이 AC-5의 실질이다. "블록 어딘가에
    // 201이 있다"보다 강하다 — 조회가 201을 내도록 뒤집히는 개정도 여기서 잡힌다.
    expect(extractResponseCodes(itineraryBlock)).toEqual([
      '200',
      '404',
      '201',
      '404',
      '200',
      '404',
      '409',
    ]);

    // 확정은 POST 하나뿐이고 생성이 아니라 상태 전이라 200이다(PLANNED→CONFIRMED 단방향
    // 잠금, US-SCHED-12). 409는 이미 확정됨·생성 진행 중(generationState=PARTIAL) 등.
    expect(extractMethodNames(confirmBlock)).toEqual(['post']);
    expect(extractResponseCodes(confirmBlock)).toEqual(['200', '404', '409']);
  });
});

describe('TRIP-294 AC-2 · AC-3 · 일정 스키마 required·enum·INV-3 (A-6, 선제 green)', () => {
  /**
   * ⚠️ **선제 green** — 위 A-5와 같은 이유로 지금 통과한다. 남기는 이유도 같다.
   *
   * 추적: `endsNextDay`=HC4 자정 넘김 · `hasViolation`=US-SCHED-07 위반 가시화(비차단) ·
   * `startAt`/`endAt`=**INV-2**(솔버 검증값만) · duration 부재=**INV-3**·BR-U3-08·BR-U2-08
   * ("경계에 소요시간 필드를 추가하는 변경은 어떤 이유로도 금지").
   *
   * ⚠️ **2026-08-08 계약 확장 흡수** — `origin/develop` 머지(`b7baff0`)가 슬롯에 10필드
   * (`tags` 필수 + 선택 9)를, 최상위에 `candidatesSummary`(BR-U2-05)를 더했다. required 줄이
   * 3 → 4로 늘었고 슬롯 required 는 6 → 7이 됐다. 이 단언이 **이 사이클에서 유일하게 실제로
   * red 였던 자리**다 — 계약 원문을 읽는 심판이라 상류가 앞서 나가면 즉시 빨개진다(설계
   * 의도대로 작동한 것). 함께 더한 선택 필드 대조군의 이유는 아래 단언 주석에 있다.
   *
   * **값 조합은 보지 않는다** — `(solveMode, isFallback)`의 금지 짝 `(FULL_AI,true)`·
   * `(MINIMAL,false)`(BR-U2-03)는 대응 PBT `PBT-U2-B2`가 **backend 소유**로 명시돼 있다.
   * 프론트는 형태(필드가 있다/필수다/값 목록이 이것뿐이다)까지만 잠근다(01b Seed 확정 3).
   */
  it('Itinerary가 필수 7필드·후보요약 1필드·day 2필드·slot 7필드를 요구하고 duration 계열 키가 0건이다', () => {
    const source = readOpenapiSource();
    const block = extractSchemaBlock(source, 'Itinerary');

    // 앵커 — 슬라이싱이 실제로 뭔가를 잡았다는 증거. 이웃 스키마로 새지 않는 것은 실측으로
    // 확인했다 — 시작 문자열이 `\n    Itinerary:\n` 로 콜론+줄바꿈까지 요구해서
    // `ItinerarySnapshot:`(뒤가 `S`)에 안 걸린다. 이 블록에 `ItinerarySnapshot`·`ChangeLog`
    // 글자는 0건이다(02a V-4).
    expect(block.length).toBeGreaterThan(0);

    // 완전 일치(순서 포함) — 네 층의 required 줄. 필드가 하나라도 빠지거나 늘면 즉시 red.
    // `generationState`는 #118(TRIP-267 day1 선행)이 더한 축이다 — 확정 상태(status)와
    // **다른 축**이고, PARTIAL 인 동안 확정·편집이 409가 되는 근거다.
    //
    // `required: [level]` 이 **2번째 자리**라는 것도 정보다: `candidatesSummary`(BR-U2-05)가
    // `days` 보다 앞에 선언돼 있다는 사실이 순서로 함께 잠긴다. `tags` 는 슬롯 required 의
    // 마지막 원소이고 미확보 시 **빈 배열**이지 누락이 아니다.
    expect(extractRequiredLines(block)).toEqual([
      'required: [itineraryId, tripId, status, solveMode, isFallback, generationState, days]',
      'required: [level]',
      'required: [date, slots]',
      'required: [poiId, startAt, endAt, isFixed, endsNextDay, hasViolation, tags]',
    ]);

    // 완전 일치(순서 포함) — enum 값이 추가·삭제·개명되면 즉시 red.
    expect(extractEnumLists(block)).toEqual([
      'enum: [PLANNED, CONFIRMED]',
      'enum: [FULL_AI, DETERMINISTIC, MINIMAL]',
      'enum: [PARTIAL, COMPLETE, FAILED]',
    ]);

    // 부정(INV-3) — duration 계열이 **필드로** 선언된 자리. 걸린 것을 모아 실패 diff에 어떤
    // 이름이 들어왔는지 찍는다.
    expect(extractDurationKeys(block)).toEqual([]);

    // 긍정(대조군) — 위 부정 단언이 상대하는 **수호 주석**이 살아 있다. 이 줄이 없으면
    // 부정 단언은 "왜 duration 글자가 이 블록에 있는가"의 설명을 잃고, 다음 사람이 주석을
    // 지우는 것으로 red를 "고치는" 길이 열린다. 주석만 지워도 여기서 red가 난다.
    expect(block).toContain('# INV-3: 소요시간(duration) 필드 없음');

    // 긍정(대조군) — **신규 선택 필드가 실재한다.** required 줄만 보는 위 단언은 선택 필드를
    // 아무도 안 본다: 서버가 `distanceRange`·`nameKo` 를 통째로 빼도 required 4줄은 그대로라
    // 계약 테스트가 침묵한다. 없는 이름을 모아 실패 diff에 **무엇이 사라졌는지** 찍는다.
    expect(findMissingSchemaKeys(block, OPTIONAL_SLOT_FIELDS)).toEqual([]);
    expect(
      findMissingSchemaKeys(block, OPTIONAL_CANDIDATES_SUMMARY_FIELDS)
    ).toEqual([]);

    // 부정 짝 — 그 선택 필드들이 **required 로 승격되지 않았다.** 승격은 계약 위반이다:
    // 열 개 전부 nullable 이고 "정본·동결본 모두 없으면 전부 null" 이 정상값이라, 필수가
    // 되는 순간 서버가 값을 지어내야 한다(TRIP-219 `imageUrl` 과 같은 취지).
    const requiredFieldNames = extractRequiredFieldNames(
      extractRequiredLines(block)
    );
    const promoted = [
      ...OPTIONAL_SLOT_FIELDS,
      ...OPTIONAL_CANDIDATES_SUMMARY_FIELDS,
    ].filter((name) => requiredFieldNames.includes(name));
    expect(promoted).toEqual([]);
  });

  it('GenerateItineraryRequest는 generationMode가 선택이고 값이 2종뿐이다', () => {
    const source = readOpenapiSource();
    const block = extractSchemaBlock(source, 'GenerateItineraryRequest');

    expect(block.length).toBeGreaterThan(0);

    // required 줄이 하나도 없다 = 본문 전체가 선택이다(미지정 시 서버가 FULLY_AI).
    expect(extractRequiredLines(block)).toEqual([]);

    // ⚠️ u3 domain-entities는 `GenerationMode{FULLY_AI, CO_PLAN, MANUAL}` 3종으로 적었으나
    // 계약은 2종뿐이다(드리프트 A — BE 티켓 후보로 상신, 01b Seed [기록] 입력). 이 단언은
    // **계약 그대로**를 잠근다 — 문서가 아니라 openapi가 코드젠의 입력이기 때문이다.
    expect(extractEnumLists(block)).toEqual(['enum: [FULLY_AI, CO_PLAN]']);
  });

  it('EditItineraryRequest의 슬롯은 필수 4필드뿐이다(응답 슬롯보다 2개 적다)', () => {
    const source = readOpenapiSource();
    const block = extractSchemaBlock(source, 'EditItineraryRequest');

    expect(block.length).toBeGreaterThan(0);

    // 요청 슬롯과 응답 슬롯을 **뒤섞는** 오사용을 막는 대조군이다. 응답 슬롯의 필수 6종 중
    // `endsNextDay`는 여기서 선택(전체 교체 편집이라 조회 응답의 현행 값을 그대로 실어야
    // 플래그가 소실되지 않는다 — #120 TRIP-279 회귀 수정), `hasViolation`은 아예 없다
    // (서버가 재검증해 내려주는 값이지 클라가 올리는 값이 아니다).
    expect(extractRequiredLines(block)).toEqual([
      'required: [days]',
      'required: [date, slots]',
      'required: [poiId, startAt, endAt, isFixed]',
    ]);

    // 긍정(대조군) — 선택 필드가 실재한다. 이게 없으면 required만 보는 위 단언이
    // "endsNextDay를 통째로 지우는" 방향의 개정을 못 잡는다(지우면 자정 넘김 플래그가
    // 편집 왕복에서 소실된다 — #120이 고친 바로 그 회귀다).
    expect(block).toContain('endsNextDay:');

    // 부정 짝 — 서버 계산값이 요청 본문으로 새어 들어오지 않았다.
    expect(block).not.toContain('hasViolation');
  });
});

describe('AC-2 준비(D2) · 참조된 응답 정의가 전부 실재한다 — 이 파일의 진짜 red (A-2)', () => {
  it('components.responses에서 참조만 있고 정의가 없는 이름이 하나도 없다', () => {
    const source = readOpenapiSource();
    const responsesBlock = extractResponsesBlock(source);
    const defined = extractDefinedResponseNames(responsesBlock);
    const referenced = extractReferencedResponseNames(source);

    // 앵커(긍정) — 블록 슬라이싱이 실제로 components.responses를 잡았다는 증거. 이게 없으면
    // 슬라이싱이 빈 문자열을 잡아도 "미정의 0건"이 공허하게 통과한다.
    expect(defined).toContain('ValidationError');

    // 앵커(긍정) — 참조가 실제로 하나 이상 모였다는 증거.
    expect(referenced.length).toBeGreaterThan(0);

    // 핵심 — 참조는 있는데 정의가 없는 이름. 지금은 RateLimited·ModerationUnavailable
    // 2건이 남아 이 배열이 비지 않는다(red).
    const undefinedRefs = [...new Set(referenced)]
      .filter((name) => !defined.includes(name))
      .sort();
    expect(undefinedRefs).toEqual([]);

    // 동결(긍정) — 위 단언만 두면 "참조 3곳을 지워 버리는" 방향으로도 통과한다.
    // D2가 고른 방향(정의를 추가)을 못 박는다.
    expect({
      hasRateLimited: defined.includes('RateLimited'),
      hasModerationUnavailable: defined.includes('ModerationUnavailable'),
    }).toEqual({ hasRateLimited: true, hasModerationUnavailable: true });
  });
});
