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

/** `/stays/search:` 경로 블록만 잘라낸다(`extractResponsesBlock`과 같은 슬라이싱 방식) —
 * 시작 = `\n  /stays/search:\n`, 끝 = 그다음 2칸 들여쓰기 경로 키(`PATH_KEY_PATTERN`과 같은
 * 모양) 또는 없으면 파일 끝. 다른 경로(`/stays/geocode` 등)에도 `- { name: ..., in: query`
 * 꼴 파라미터가 있으므로, 블록을 자르지 않고 파일 전체를 훑으면 남의 파라미터가 섞인다. */
const STAYS_SEARCH_BLOCK_START = '\n  /stays/search:\n';
const NEXT_PATH_KEY_PATTERN = /\n {2}\/[^\s:]+:/;
function extractStaysSearchBlock(source: string): string {
  const startIdx = source.indexOf(STAYS_SEARCH_BLOCK_START);
  if (startIdx === -1) {
    return '';
  }
  const bodyStart = startIdx + STAYS_SEARCH_BLOCK_START.length;
  const rest = source.slice(bodyStart);
  const nextKeyMatch = rest.match(NEXT_PATH_KEY_PATTERN);
  const bodyEnd =
    nextKeyMatch && typeof nextKeyMatch.index === 'number'
      ? bodyStart + nextKeyMatch.index
      : source.length;
  return source.slice(bodyStart, bodyEnd);
}

/** `/stays/search` 블록 안 `- { name: X, ...}` 파라미터 항목의 `name` 값 전부(등장 순서
 * 그대로 — 순서가 뒤집혀도 잡히도록 완전 일치로 비교한다). */
const PARAM_NAME_PATTERN = /- \{ name: (\w+),/g;
function extractParamNames(staysSearchBlock: string): string[] {
  return [...staysSearchBlock.matchAll(PARAM_NAME_PATTERN)].map(
    (match) => match[1]
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
    const block = extractStaysSearchBlock(source);
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
