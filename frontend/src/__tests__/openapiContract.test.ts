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
