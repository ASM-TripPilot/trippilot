/**
 * @jest-environment node
 */
import crypto from 'crypto';
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
 *   - `trips/trips.ts`·`preferences/preferences.ts`가 여행 생성·취향 조회 심볼을 갖는다
 *     (TRIP-203 AC-1, B-6)
 *   - `createTripRequest.ts`의 startDate·endDate·destinations가 옵셔널이 아니다
 *     (TRIP-203 AC-3 런타임 짝, B-7)
 *   - `companionType.ts`가 혼자·친구·연인·가족 4값이고 `커플`이 없다
 *     (TRIP-203 AC-4 런타임 짝 · BR-U1-39, B-8)
 *   - `stays/stays.ts`·`saved-stays/saved-stays.ts` 원본 바이트가 흔들리지 않는다
 *     (TRIP-203 AC-7, B-9)
 *
 * **B. 이행 체크포인트 — 한시적이다.** 생성 파일 **목록**을 동결 8경로로 정확히 고정한다
 * (B-1). 다른 태그를 `orval.config.ts`의 `filters.tags`에 추가하는 정당한 후속 티켓이 이
 * 숫자를 8 → N으로 만든다. 완화형: **"8경로를 부분집합으로 포함하고, `stays/stays.ts`가
 * 목록에 있다"**(개수 앵커와 엔드포인트 파일 존재는 그대로 지킨다).
 *
 * **B 카운터**: 이 파일 전용. 현재값 = **0**.
 * TRIP-203(20260802)의 red는 제외구 AND 조건 둘 다에 걸린다 — ① 이 단언을 만든 사이클
 * 밖의 작업이고 ② 목록을 갱신하지 않고는 통과할 수 없다. 그런데도 **격하하지 않고 갱신만
 * 한다**(01b Seed D2): 선례 2건(TRIP-183·TRIP-202)이 모두 갱신을 택했고, 격하는 가드를
 * 약화시키는 덜 되돌리기 쉬운 방향이라 사용자 판정 사안이다. 카운터를 어떻게 읽을지(위
 * 현재값 0이 실적과 어긋나 보인다) 자체가 이 사이클의 미결 1순위로 올라가 있다.
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
 * 동결 49경로(02a §6-③ 실측 그대로 — 재타이핑 금지).
 *
 * 순서는 JS `Array.prototype.sort()`(UTF-16 코드 단위) 기준이다. 셸 `sort`는 로케일 정렬이라
 * `prefScalarAxis.ts`의 자리가 달라진다 — 목록을 셸에서 뽑아 붙이면 완전 일치가 깨진다.
 *
 * 8 → 12 → 17 → 18 → 49로 네 번 늘었고 전부 의도된 계약 변경이다.
 * - **TRIP-203**(49): `orval.config.ts` 태그에 `trips`·`preferences` 추가. orval에는 오퍼레이션
 *   단위 필터가 없고 태그 단위뿐이라, 여행 12개·취향 2개 오퍼레이션이 통째로 딸려 오면서
 *   스키마 31개가 함께 생성된다(01b Seed D3에서 수용 — `saved-stays` CRUD 5종이 TRIP-183
 *   이후 같은 "소비자 0" 상태로 존치돼 온 선례가 있다).
 * - **TRIP-211**(18): `ErrorResponse.error`에 `existingProvider`가 추가되면서 그 enum 스키마
 *   파일이 함께 생성. 이 티켓은 openapi만 고치고 재생성하지 않은 채 머지돼(PR #61) 생성물이
 *   계약보다 낡아 있었고, TRIP-203이 재생성하며 드러났다.
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
  'shared/api/generated/preferences/preferences.ts',
  'shared/api/generated/saved-stays/saved-stays.ts',
  'shared/api/generated/schemas/addMustVisitRequest.ts',
  'shared/api/generated/schemas/assignBaseRequest.ts',
  'shared/api/generated/schemas/baseAssignment.ts',
  'shared/api/generated/schemas/companionType.ts',
  'shared/api/generated/schemas/coverage.ts',
  'shared/api/generated/schemas/createTripRequest.ts',
  'shared/api/generated/schemas/createTripRequestPreferenceSnapshot.ts',
  'shared/api/generated/schemas/dayCoverage.ts',
  'shared/api/generated/schemas/dayCoverageStatus.ts',
  'shared/api/generated/schemas/editSavedStayRequest.ts',
  'shared/api/generated/schemas/editTripRequest.ts',
  'shared/api/generated/schemas/errorResponse.ts',
  'shared/api/generated/schemas/errorResponseError.ts',
  'shared/api/generated/schemas/errorResponseErrorExistingProvider.ts',
  'shared/api/generated/schemas/errorResponseErrorFieldsItem.ts',
  'shared/api/generated/schemas/geocodeCandidate.ts',
  'shared/api/generated/schemas/getStaysGeocodeParams.ts',
  'shared/api/generated/schemas/getStaysSearchParams.ts',
  'shared/api/generated/schemas/index.ts',
  'shared/api/generated/schemas/mustVisit.ts',
  'shared/api/generated/schemas/mustVisitType.ts',
  'shared/api/generated/schemas/prefArrayAxis.ts',
  'shared/api/generated/schemas/prefScalarAxis.ts',
  'shared/api/generated/schemas/preferenceInput.ts',
  'shared/api/generated/schemas/preferenceInputActivitiesItem.ts',
  'shared/api/generated/schemas/preferenceInputBudgetTier.ts',
  'shared/api/generated/schemas/preferenceInputCompanionTypesItem.ts',
  'shared/api/generated/schemas/preferenceInputFoodTastesItem.ts',
  'shared/api/generated/schemas/preferenceInputPace.ts',
  'shared/api/generated/schemas/preferenceInputStylesItem.ts',
  'shared/api/generated/schemas/preferenceInputTransportModesItem.ts',
  'shared/api/generated/schemas/preferenceView.ts',
  'shared/api/generated/schemas/preferenceViewBudget.ts',
  'shared/api/generated/schemas/preferenceViewCompanion.ts',
  'shared/api/generated/schemas/registerRoute.ts',
  'shared/api/generated/schemas/registerSavedStayRequest.ts',
  'shared/api/generated/schemas/savedStay.ts',
  'shared/api/generated/schemas/stayItem.ts',
  'shared/api/generated/schemas/stayPrice.ts',
  'shared/api/generated/schemas/staySearchResponse.ts',
  'shared/api/generated/schemas/trip.ts',
  'shared/api/generated/schemas/tripDestination.ts',
  'shared/api/generated/schemas/tripPreferenceSnapshot.ts',
  'shared/api/generated/schemas/tripStatus.ts',
  'shared/api/generated/schemas/validationErrorResponse.ts',
  'shared/api/generated/stays/stays.ts',
  'shared/api/generated/trips/trips.ts',
];

/**
 * TRIP-203 AC-7 — 재생성이 기존 엔드포인트 파일을 흔들지 않는다. **원본 바이트**의 sha256을
 * 동결한다(주석 제거를 거치지 않는다 — 가공하면 "바이트 동일"이라는 뜻 자체가 사라진다).
 * 값은 HEAD `df43082` 시점 커밋본 실측이고, 4태그 재생성 + prettier 후에도 같은 값이 나오는
 * 것을 사전에 확인했다(02a §6-③).
 *
 * **실패했을 때 원인이 둘이다.** `git diff --stat src/shared/api/generated/stays` 로 가른다:
 *   ⓐ 진짜 드리프트 — openapi의 stays·saved-stays 오퍼레이션이 바뀌었다(정당한 계약 변경이면
 *      이 상수를 갱신한다).
 *   ⓑ **prettier 미실행** — `pnpm codegen`은 리포 prettier 설정을 거치지 않는다. 재생성 직후
 *      포매터를 안 돌리면 순수 포맷 차이로 어긋난다(02a ★1).
 */
const ENDPOINT_FILE_SHA256: Record<string, string> = {
  'stays/stays.ts':
    '0d599afe660ac5b9f64255911cd5b514d71b585211bf5830cd8e34cedfa5f307',
  'saved-stays/saved-stays.ts':
    '79fe27571bb827aaa31a24849ed111b87ef260341bf6769bf43bea5d15a44a46',
};

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

describe('AC-2 ②③ · 생성 파일 인벤토리 — 동결 49경로 (B-1, 한시 — 위 졸업 조건 B)', () => {
  it('src/shared/api/generated/ 아래 .ts 파일 목록이 동결 49경로와 정확히 같다', () => {
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

describe('TRIP-203 AC-1 · 여행·취향 클라이언트가 실제로 생성됐다 (B-6)', () => {
  /**
   * 왜 따로 필요한가: orval은 `filters.tags`에 없는 태그를 **조용히 건너뛴다** — 에러도 없고
   * 종료 코드도 0이다. 태그 오타 하나로 "코드젠은 성공했는데 파일이 안 생긴" 상태가 만들어
   * 지고, 그 사실은 한참 뒤 화면을 짜다가 훅을 못 찾는 순간에야 드러난다. B-1(파일 목록)이
   * 파일의 존재를, 이 단언이 그 안의 심볼을 잠근다.
   *
   * 이름은 **실측한 생성 이름**이다(01b Seed D6). openapi에 `operationId`가 0건이라 orval이
   * method+path로 이름을 만든다 — 티켓 AC-1의 `createTrip` 표기는 티켓 오기이고 실제 이름은
   * `postTrips`다. 앱 코드는 이 이름을 몰라도 된다(도메인 훅 `useCreateTrip`이 감싼다).
   */
  it('trips/trips.ts가 POST /trips 엔드포인트·함수·훅·요청/응답 타입 심볼을 갖는다', () => {
    const source = readGeneratedSource('trips', 'trips.ts');

    expect(source).toContain('/trips');
    expect(source).toContain('export const postTrips');
    expect(source).toContain('export const usePostTrips');
    expect(source).toContain('CreateTripRequest');
    expect(source).toContain('Trip');
    // 무효화 대상 쿼리 키의 출처(01b Seed D5) — 이게 없으면 useCreateTrip이 키를 손으로
    // 적게 되고, 생성물이 키를 바꿔도 아무도 모른다.
    expect(source).toContain('export const getGetTripsQueryKey');
  });

  it('preferences/preferences.ts가 GET /me/preferences 엔드포인트·함수·훅·응답 타입 심볼을 갖는다', () => {
    const source = readGeneratedSource('preferences', 'preferences.ts');

    expect(source).toContain('/me/preferences');
    expect(source).toContain('export const getMePreferences');
    expect(source).toContain('useGetMePreferences');
    expect(source).toContain('PreferenceView');
  });
});

describe('TRIP-203 AC-3 · 여행 생성 필수 3필드가 옵셔널이 아니다 (B-7, 타입 단계의 런타임 짝)', () => {
  /**
   * AC-3의 본 심판은 타입 단계(`features/trip/model/tripContract.test.ts` + `pnpm run tsc`)다.
   * 여기서는 **도구가 실제로 무엇을 뱉었나**를 문자로 본다 — 두 층이 다른 것을 보므로 한쪽이
   * 조용히 무뎌져도 다른 쪽이 남는다.
   *
   * 근거: US-TRIP-01(여행지·날짜 범위 필수) · BR-U1-34. openapi
   * `CreateTripRequest.required = [startDate, endDate, destinations]`.
   */
  it('createTripRequest.ts의 startDate·endDate·destinations에 옵셔널 표시(?)가 없다', () => {
    const source = readGeneratedSource('schemas', 'createTripRequest.ts');

    // 긍정 — 세 필드가 "필수" 모양 그대로 실재한다. 타입까지 함께 잠근다.
    expect(source).toContain('startDate: string;');
    expect(source).toContain('endDate: string;');
    expect(source).toContain('destinations: TripDestination[];');

    // 부정 짝 — 옵셔널로 뒤집힌 흔적. 등장하는 것을 모아 실패 diff에 어느 필드가 풀렸는지
    // 찍는다. 긍정만 두면 `startDate: string;` 과 `startDate?: string;` 이 함께 있는
    // (있을 수 없지만) 상태를 못 가르고, 부정만 두면 파일이 통째로 비어도 통과한다.
    const loosened = ['startDate?', 'endDate?', 'destinations?'].filter(
      (name) => source.includes(name)
    );
    expect(loosened).toEqual([]);

    // 긍정(대조군) — 선택 필드는 그대로 선택이어야 한다. 이게 없으면 "전부 필수로 만드는"
    // 방향의 오생성도 위 단언들을 통과한다.
    expect(source).toContain('budgetTotal?: number | null;');
  });
});

describe('TRIP-203 AC-4 · 동반 유형 enum에 커플이 없다 (B-8, BR-U1-39)', () => {
  /**
   * 온보딩 취향 축(`PreferenceInput.companionTypes` = 혼자·커플·친구·가족·부모님)과 여행 축
   * (`CompanionType` = 혼자·친구·연인·가족)은 **다른 목록**이다. BR-U1-39가 "온보딩 `커플`은
   * `연인`으로 매핑한다"고 정했으므로, 온보딩 값을 여행 생성에 그대로 흘려보내는 배선이
   * 조용히 생기면 서버가 거부한다. 그 차이를 생성물 층에서도 못 박는다.
   * (매핑 함수 자체는 이 칸의 산출물이 아니다 — TRIP-204.)
   */
  it('companionType.ts가 4값을 갖고 커플은 0건이다', () => {
    const source = readGeneratedSource('schemas', 'companionType.ts');

    expect({
      혼자: source.includes('혼자'),
      친구: source.includes('친구'),
      연인: source.includes('연인'),
      가족: source.includes('가족'),
    }).toEqual({ 혼자: true, 친구: true, 연인: true, 가족: true });

    // 부정 짝 — 서버 enum에 없는 값. 위 긍정과 같은 it 안에 둔다(파일이 비면 부정만으로는
    // 공허하게 통과한다).
    expect(source).not.toContain('커플');
  });
});

describe('TRIP-203 AC-7 · 재생성이 기존 산출물을 흔들지 않는다 (B-9, 선제 green)', () => {
  /**
   * ⚠️ **선제 green** — "바뀌지 말 것"이 AC라서 지금도 통과한다. 그래도 남기는 이유: 태그를
   * 추가하는 재생성이 stays·saved-stays 엔드포인트 파일을 건드리지 않는다는 것이 이 티켓
   * DoD의 실질이고(01b Seed D1이 사정거리를 **엔드포인트 파일 2개**로 확정했다), 그 사실은
   * 사람이 `git diff`를 눈으로 볼 때만 확인되던 것이다. 여기서 기계가 본다.
   *
   * 공용 `schemas/index.ts`는 대상이 아니다 — 신규 스키마를 재수출하는 배럴이라 늘어나는
   * 것이 필연이고, 그 증가는 B-1(동결 목록)이 이미 잠근다.
   */
  it('stays/stays.ts·saved-stays/saved-stays.ts의 원본 바이트가 동결 해시와 같다', () => {
    const actual = Object.fromEntries(
      Object.keys(ENDPOINT_FILE_SHA256).map((rel) => {
        const full = path.join(GENERATED_DIR, ...rel.split('/'));
        if (!fs.existsSync(full)) {
          // 해시 대신 읽히는 문자열을 넣는다 — 16진수 두 줄을 비교하는 diff보다 원인이 보인다.
          return [rel, '(파일 없음)'];
        }
        return [
          rel,
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(full))
            .digest('hex'),
        ];
      })
    );

    expect(actual).toEqual(ENDPOINT_FILE_SHA256);
  });
});
