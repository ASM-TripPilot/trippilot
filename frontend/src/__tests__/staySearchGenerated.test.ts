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
 *   - `places/places.ts`가 장소 4오퍼레이션의 함수·훅·쿼리키 헬퍼를 갖는다
 *     (TRIP-220 AC-1, B-10)
 *   - `place.ts`의 `tags`가 필수이고 `imageUrl`이 선택·nullable이다
 *     (TRIP-220 AC-2, B-11)
 *   - `trips/trips.ts`가 일정 4오퍼레이션의 함수·훅·쿼리키 헬퍼를 갖는다
 *     (TRIP-294 AC-1, B-12)
 *   - 응답 슬롯 6필드가 전부 필수이고 요청 슬롯은 4필수+1선택이다(TRIP-294 AC-3, B-13)
 *   - 일정 enum 4종의 값 목록이 정확하다(TRIP-294 AC-3, B-14)
 *   - `trips/trips.ts`의 재생성 前 export 심볼 69개가 전부 보존된다
 *     (TRIP-294 AC-4③, B-15)
 *   - 일정 생성물 12파일에 duration 계열 식별자 0건(INV-3, B-16)
 *   - `package.json`의 `codegen` 스크립트가 포매터를 이어 돌린다(TRIP-294 AC-6, B-17)
 *
 * **B. 이행 체크포인트 — 한시적이다.** 생성 파일 **목록**을 동결 8경로로 정확히 고정한다
 * (B-1). 다른 태그를 `orval.config.ts`의 `filters.tags`에 추가하는 정당한 후속 티켓이 이
 * 숫자를 8 → N으로 만든다. 완화형: **"8경로를 부분집합으로 포함하고, `stays/stays.ts`가
 * 목록에 있다"**(개수 앵커와 엔드포인트 파일 존재는 그대로 지킨다).
 *
 * **B 카운터**: 이 파일 전용. 현재값 = **5**.
 * ⚠️ **TRIP-294(20260808)에서 `4` → `5`로 올렸다.** itinerary 4오퍼레이션 재생성이 목록을
 * 56 → 67로 만들어 B-1이 또 red를 냈다 — 제외구 AND 조건에 걸린다(① 이 단언을 만든 사이클
 * 밖의 작업 ② 목록을 갱신하지 않고는 통과 불가). 이번에도 **격하하지 않고 갱신만 한다**
 * (01b Seed 확정 2) — 격하는 가드를 약화시키는 방향이라 사용자 판정 사안이고, 이번 칸의
 * 스코프 밖으로 미뤘다. 판정 자체는 여전히 미결이다.
 * ⚠️ **TRIP-220(20260803)에서 `0` → `4`로 정정했다.** 숫자만 0에 멈춰 있었을 뿐 실적은
 * 처음부터 0이 아니었다 — TRIP-203 devlog가 이미 "헤더는 0이라 적었는데 실적은 3건
 * (TRIP-183·TRIP-202·TRIP-211재생성)"을 실측으로 남겼고, 여기에 이번 TRIP-220(places 태그
 * 추가로 49→56)이 더해져 4다. 넷 다 제외구 AND 조건에 걸린다 — ① 이 단언을 만든 사이클
 * 밖의 작업이고 ② 목록을 갱신하지 않고는 통과할 수 없다.
 * 즉 아래 "2회 누적 시 격하" 시점은 **이미 지났다.** 그런데도 이번에도 **격하하지 않고
 * 갱신만 한다**(01b Seed §3): 격하는 가드를 약화시키는, 덜 되돌리기 쉬운 방향이라 사용자
 * 판정 사안이고 사용자 부재 중 대신 정하지 않는다. 숫자가 틀린 채로 두면 다음 사람도 같은
 * 판정을 또 미루므로 **카운터만 실적값으로 고친다.** 격하/존치 판정은 여전히 미결이다.
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
 * 동결 67경로(02a §0 실측 그대로 — 재타이핑 금지).
 *
 * 순서는 JS `Array.prototype.sort()`(UTF-16 코드 단위) 기준이다. 셸 `sort`는 로케일 정렬이라
 * `prefScalarAxis.ts`의 자리가 달라진다 — 목록을 셸에서 뽑아 붙이면 완전 일치가 깨진다.
 * TRIP-220이 더한 두 경로가 같은 함정의 또 다른 예다: `savePlaceRequest.ts`가
 * `savedPlace.ts`**보다 앞**이다(`'P'`=80 < `'d'`=100 — 셸 정렬이면 뒤집힌다).
 *
 * 8 → 12 → 17 → 18 → 49 → 56 → 67로 여섯 번 늘었고 전부 의도된 계약 변경이다.
 * - **TRIP-294**(67): 태그 추가가 아니라 **openapi가 먼저 나아간 것을 따라잡는 재생성**이다.
 *   itinerary 4오퍼레이션은 이미 `tags: [trips]`였으므로 `orval.config.ts`는 수정하지
 *   않았다 — 낡은 명세 위에서도 orval이 종료 코드 0으로 "성공"하는 탓에 생성물에
 *   `itinerary` 문자열이 0건인 채로 아무 테스트도 빨개지지 않던 상태를 메운다(티켓의
 *   "조용한 실패"). 스키마 11개가 함께 생성된다.
 * - **TRIP-220**(56): `orval.config.ts` 태그에 `places` 추가. 장소 4오퍼레이션
 *   (`GET /places`·`POST /saved-places`·`GET /saved-places`·`DELETE /saved-places/{id}`)과
 *   스키마 6개가 함께 생성된다. d04 탐색·d02 담은 장소 두 화면의 공통 선행 칸이다.
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
  'shared/api/generated/places/places.ts',
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
  'shared/api/generated/schemas/editItineraryRequest.ts',
  'shared/api/generated/schemas/editItineraryRequestDaysItem.ts',
  'shared/api/generated/schemas/editItineraryRequestDaysItemSlotsItem.ts',
  'shared/api/generated/schemas/editSavedStayRequest.ts',
  'shared/api/generated/schemas/editTripRequest.ts',
  'shared/api/generated/schemas/errorResponse.ts',
  'shared/api/generated/schemas/errorResponseError.ts',
  'shared/api/generated/schemas/errorResponseErrorExistingProvider.ts',
  'shared/api/generated/schemas/errorResponseErrorFieldsItem.ts',
  'shared/api/generated/schemas/generateItineraryRequest.ts',
  'shared/api/generated/schemas/generateItineraryRequestGenerationMode.ts',
  'shared/api/generated/schemas/geocodeCandidate.ts',
  'shared/api/generated/schemas/getPlacesParams.ts',
  'shared/api/generated/schemas/getStaysGeocodeParams.ts',
  'shared/api/generated/schemas/getStaysSearchParams.ts',
  'shared/api/generated/schemas/index.ts',
  'shared/api/generated/schemas/itinerary.ts',
  'shared/api/generated/schemas/itineraryDaysItem.ts',
  'shared/api/generated/schemas/itineraryDaysItemSlotsItem.ts',
  'shared/api/generated/schemas/itineraryGenerationState.ts',
  'shared/api/generated/schemas/itinerarySolveMode.ts',
  'shared/api/generated/schemas/itineraryStatus.ts',
  'shared/api/generated/schemas/mustVisit.ts',
  'shared/api/generated/schemas/mustVisitType.ts',
  'shared/api/generated/schemas/place.ts',
  'shared/api/generated/schemas/placeDataStatus.ts',
  'shared/api/generated/schemas/poiCategory.ts',
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
  'shared/api/generated/schemas/savePlaceRequest.ts',
  'shared/api/generated/schemas/savedPlace.ts',
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
  // TRIP-294에서 places·preferences로 넓혔다(01b Seed 확정 6). 근거는 문제로그
  // `2026-08-02 TRIP-211이 openapi만 고치고 재생성 없이 머지됐다` — 밀린 코드젠 빚이
  // 무관한 티켓의 diff에 섞여 들어오는 사고가 실제로 있었다. 사정거리가 넓을수록 그
  // 섞임을 기계가 먼저 본다. 두 값 다 재생성 후에도 바이트 동일함을 사전 확인했다(02a §0).
  //
  // ⚠️ `trips/trips.ts`에는 해시를 걸지 않는다 — 이번 재생성이 **바꾸는 대상** 파일이라
  // 자기모순이다. 그 파일은 대신 B-15(심볼 보존)가 "줄지 않았다"만 골라 잰다.
  'places/places.ts':
    '7e5363ebd511f108209de46f425f93c148fe29df84cff0c6be691ac007dbe2ca',
  'preferences/preferences.ts':
    'c583726ab8b40694c99f5b3cc54d5da91a3b0bd0bd83f1b692ee9435e129a6fc',
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

/**
 * 파일이 **밖으로 내보내는 이름**만 모은다(중복 제거 후 정렬). orval 생성물은 한 이름을
 * `export function` 오버로드로 여러 번 선언하므로 중복 제거가 필요하다.
 *
 * 왜 `toContain('export const 이름')` 대신 이름 목록을 쓰는가: **접두 충돌** 때문이다.
 * `'export const postTripsTripIdItineraryConfirm'` 은 `'export const postTripsTripIdItinerary'`
 * 로 시작하므로, 문자열 포함으로 재면 확정 오퍼레이션만 생성돼도 생성 오퍼레이션 단언이
 * 통과한다(실측 확인 — 02a ★3). 이름 목록의 정확 일치는 그 구멍이 없다.
 */
const EXPORT_SYMBOL_PATTERN =
  /^export (?:const|function|type) ([A-Za-z0-9_]+)/gm;
function extractExportSymbols(source: string): string[] {
  return [
    ...new Set([...source.matchAll(EXPORT_SYMBOL_PATTERN)].map((m) => m[1])),
  ].sort();
}

/**
 * TRIP-294 AC-4③ — 재생성 **前** 커밋본 `trips/trips.ts`의 export 심볼 전부(69개).
 * 추출 시점이 중요하다: 재생성 후에 뽑으면 itinerary 신규 심볼이 섞여 기준선이 무의미해진다.
 *
 * ⚠️ **01b Seed는 "36개"라 적었다.** 36은 `export const`만 센 수이고(브리프 각주가 스스로
 * 인정한다 — `useGetTripsTripIdItinerary` 가 `export function` 이라 diff에 안 잡혔다는 대목),
 * 실제 export 심볼은 `const` 36 + `function` 5 + `type` 28 = **69**다. 69를 쓰는 이유는 Seed가
 * 개수 하한을 기각할 때 든 바로 그 근거다 — openapi에 `operationId`가 0건이라 orval이
 * method+path로 이름을 짓고, 경로가 조금만 바뀌면 이름이 통째로 바뀌므로 **개명이 실제
 * 위험**이다. 36 목록은 화면이 실제로 import 하는 조회 훅 5개(`useGetTrips`·
 * `useGetTripsTripIdCoverage` 등, 전부 `export function` 오버로드)를 통째로 놓친다.
 *
 * **부분집합 포함 검사이지 완전 일치가 아니다** — 재생성으로 늘어나는 itinerary 신규 심볼
 * 23개는 허용된다. 이 단언이 잡는 것은 오직 "줄었다 / 이름이 바뀌었다"다.
 */
const TRIPS_EXPORT_SYMBOLS_BEFORE = [
  'DeleteTripsTripIdBasesBaseAssignmentIdMutationError',
  'DeleteTripsTripIdBasesBaseAssignmentIdMutationResult',
  'DeleteTripsTripIdMustVisitsMustVisitIdMutationError',
  'DeleteTripsTripIdMustVisitsMustVisitIdMutationResult',
  'DeleteTripsTripIdMutationError',
  'DeleteTripsTripIdMutationResult',
  'GetTripsQueryError',
  'GetTripsQueryResult',
  'GetTripsTripIdBasesQueryError',
  'GetTripsTripIdBasesQueryResult',
  'GetTripsTripIdCoverageQueryError',
  'GetTripsTripIdCoverageQueryResult',
  'GetTripsTripIdMustVisitsQueryError',
  'GetTripsTripIdMustVisitsQueryResult',
  'GetTripsTripIdQueryError',
  'GetTripsTripIdQueryResult',
  'PatchTripsTripIdMutationBody',
  'PatchTripsTripIdMutationError',
  'PatchTripsTripIdMutationResult',
  'PostTripsMutationBody',
  'PostTripsMutationError',
  'PostTripsMutationResult',
  'PostTripsTripIdBasesMutationBody',
  'PostTripsTripIdBasesMutationError',
  'PostTripsTripIdBasesMutationResult',
  'PostTripsTripIdMustVisitsMutationBody',
  'PostTripsTripIdMustVisitsMutationError',
  'PostTripsTripIdMustVisitsMutationResult',
  'deleteTripsTripId',
  'deleteTripsTripIdBasesBaseAssignmentId',
  'deleteTripsTripIdMustVisitsMustVisitId',
  'getDeleteTripsTripIdBasesBaseAssignmentIdMutationOptions',
  'getDeleteTripsTripIdMustVisitsMustVisitIdMutationOptions',
  'getDeleteTripsTripIdMutationOptions',
  'getGetTripsQueryKey',
  'getGetTripsQueryOptions',
  'getGetTripsTripIdBasesQueryKey',
  'getGetTripsTripIdBasesQueryOptions',
  'getGetTripsTripIdCoverageQueryKey',
  'getGetTripsTripIdCoverageQueryOptions',
  'getGetTripsTripIdMustVisitsQueryKey',
  'getGetTripsTripIdMustVisitsQueryOptions',
  'getGetTripsTripIdQueryKey',
  'getGetTripsTripIdQueryOptions',
  'getPatchTripsTripIdMutationOptions',
  'getPostTripsMutationOptions',
  'getPostTripsTripIdBasesMutationOptions',
  'getPostTripsTripIdMustVisitsMutationOptions',
  'getTrips',
  'getTripsTripId',
  'getTripsTripIdBases',
  'getTripsTripIdCoverage',
  'getTripsTripIdMustVisits',
  'patchTripsTripId',
  'postTrips',
  'postTripsTripIdBases',
  'postTripsTripIdMustVisits',
  'useDeleteTripsTripId',
  'useDeleteTripsTripIdBasesBaseAssignmentId',
  'useDeleteTripsTripIdMustVisitsMustVisitId',
  'useGetTrips',
  'useGetTripsTripId',
  'useGetTripsTripIdBases',
  'useGetTripsTripIdCoverage',
  'useGetTripsTripIdMustVisits',
  'usePatchTripsTripId',
  'usePostTrips',
  'usePostTripsTripIdBases',
  'usePostTripsTripIdMustVisits',
];

/** TRIP-294 AC-1 — 일정 4오퍼레이션이 만들어 내야 할 이름. axios 함수 4 + 훅 4 + 쿼리키 1.
 * 쿼리키 헬퍼가 목록에 있는 이유는 B-6·B-10과 같다: 없으면 무효화 키를 손으로 적게 되고,
 * 생성물이 키를 바꿔도 아무도 모르게 어긋난다. */
const ITINERARY_EXPECTED_SYMBOLS = [
  'getTripsTripIdItinerary',
  'postTripsTripIdItinerary',
  'putTripsTripIdItinerary',
  'postTripsTripIdItineraryConfirm',
  'useGetTripsTripIdItinerary',
  'usePostTripsTripIdItinerary',
  'usePutTripsTripIdItinerary',
  'usePostTripsTripIdItineraryConfirm',
  'getGetTripsTripIdItineraryQueryKey',
];

/** INV-3 스캔의 모집단 — 일정 계약이 실제로 들어앉는 12파일. `itinerary/` 폴더가 아니라
 * `trips/trips.ts` 안이라는 점이 이 목록의 요지다(`tags-split` 모드 + 태그가 `trips`). */
const ITINERARY_GENERATED_FILES = [
  'trips/trips.ts',
  'schemas/itinerary.ts',
  'schemas/itineraryDaysItem.ts',
  'schemas/itineraryDaysItemSlotsItem.ts',
  'schemas/itineraryGenerationState.ts',
  'schemas/itinerarySolveMode.ts',
  'schemas/itineraryStatus.ts',
  'schemas/generateItineraryRequest.ts',
  'schemas/generateItineraryRequestGenerationMode.ts',
  'schemas/editItineraryRequest.ts',
  'schemas/editItineraryRequestDaysItem.ts',
  'schemas/editItineraryRequestDaysItemSlotsItem.ts',
];

/**
 * INV-3 — 소요시간 계열 식별자. B-4의 `/\bduration\b/i` 보다 **넓다**: 단어 경계 `\b` 는
 * `durationMin`·`durationMinutes`·`travelDuration` 을 놓친다(`duration` 뒤가 `M`이면 경계가
 * 아니다). 위반이 들어온다면 그 형태일 가능성이 높으므로 경계를 뗐다.
 *
 * B-4를 고치지 않고 여기 따로 두는 이유: B-4는 TRIP-179 가드이고 그 자리에 졸업 조건이 달려
 * 있다. 사정거리도 다르다 — B-4는 생성물 전체를 얕게, 이 목록은 일정 표면을 깊게 본다.
 * 넓힌 목록으로도 재생성 후 67파일 전부 0건임을 사전 확인했다(주석 제거 전/후 모두).
 */
const FORBIDDEN_DURATION_PATTERNS = [
  /duration/i,
  /travelTime/i,
  /elapsed/i,
  /\bminutes\b/i,
];

/** `package.json`을 읽는다. jest의 실행 기준 디렉토리가 `frontend/` 라서 상대 경로로 닿는다
 * (같은 파일의 `path.resolve('src')` 와 같은 전제). */
function readPackageJson(): { scripts: Record<string, string> } {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
}

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

describe('AC-2 ②③ · 생성 파일 인벤토리 — 동결 67경로 (B-1, 한시 — 위 졸업 조건 B)', () => {
  it('src/shared/api/generated/ 아래 .ts 파일 목록이 동결 67경로와 정확히 같다', () => {
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
  it('stays·saved-stays·places·preferences 4파일의 원본 바이트가 동결 해시와 같다', () => {
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

describe('TRIP-220 AC-1 · 장소 클라이언트가 실제로 생성됐다 (B-10)', () => {
  /**
   * B-6(여행·취향)과 같은 이유로 파일 목록(B-1)과 별개로 필요하다: orval은 `filters.tags`에
   * 없는 태그를 **조용히 건너뛴다**(에러도 없고 종료 코드도 0). B-1이 파일의 존재를, 이
   * 단언이 그 안의 심볼을 잠근다.
   *
   * 이름은 전부 **실측한 생성 이름**이다(01c 코드젠 실측). openapi에 `operationId`가 0건이라
   * orval이 method+path로 이름을 짓는다 — 티켓 본문의 `deleteSavedPlacesSavedPlaceId` 같은
   * 긴 이름이 오기가 아니라 실제 생성 이름이다. 앱 코드는 이 이름을 몰라도 된다
   * (도메인 훅 `useSavedPlaces`가 감싼다).
   *
   * 쿼리 키 헬퍼 2개는 AC-1 본문이 명시적으로 요구한다. 이게 없으면 무효화 키를 손으로 적게
   * 되고, 생성물이 키를 바꿔도 아무도 모르게 어긋난다(`useCreateTrip`의 같은 근거).
   */
  it('places/places.ts가 장소 4오퍼레이션의 경로·함수·훅·쿼리키 헬퍼·타입 심볼을 갖는다', () => {
    const source = readGeneratedSource('places', 'places.ts');

    expect(source).toContain('/places');
    expect(source).toContain('/saved-places');

    expect(source).toContain('export const getPlaces');
    expect(source).toContain('export const postSavedPlaces');
    expect(source).toContain('export const getSavedPlaces');
    expect(source).toContain('export const deleteSavedPlacesSavedPlaceId');

    expect(source).toContain('useGetPlaces');
    expect(source).toContain('usePostSavedPlaces');
    expect(source).toContain('useGetSavedPlaces');
    expect(source).toContain('useDeleteSavedPlacesSavedPlaceId');

    expect(source).toContain('export const getGetPlacesQueryKey');
    expect(source).toContain('export const getGetSavedPlacesQueryKey');

    expect(source).toContain('Place');
    expect(source).toContain('SavedPlace');
    expect(source).toContain('SavePlaceRequest');
  });
});

describe('TRIP-220 AC-2 · Place 타입이 TRIP-219 두 필드를 그대로 집어 갔다 (B-11)', () => {
  /**
   * 티켓 본문 24행("Place: … 사진·태그 필드 없음")은 같은 브랜치의 커밋 `c5139e9`(TRIP-219)가
   * 뒤집었다. `orval.config.ts`의 input이 **워킹트리** openapi라 코드젠이 두 필드를 그대로
   * 집어 가는데, 그것이 실제로 일어났는지는 이 칸이 아니면 아무도 보지 않는다 — 두 필드는
   * 다음 칸(d04 사진 그리드 · d02 태그 칩)의 유일한 데이터 원본이다.
   *
   * 필수/선택의 방향이 서로 반대라는 점이 이 단언의 실질이다: `tags`는 required(미확보 시
   * **빈 배열**이지 누락이 아니다), `imageUrl`은 optional·nullable(NULL=미확보 — 서버가 기본
   * 이미지를 지어내지 않으므로 클라가 자리만 비운다).
   */
  it('place.ts의 tags가 필수 string[]이고 imageUrl이 선택·nullable이다', () => {
    const source = readGeneratedSource('schemas', 'place.ts');

    // 긍정 — 01c 실측 그대로의 두 줄.
    expect(source).toContain('tags: string[];');
    expect(source).toContain('imageUrl?: string | null;');

    // 긍정(대조군) — 파일이 실제로 Place다. 이게 없으면 아래 부정 짝이 빈 문자열을 상대로
    // 공허하게 통과한다.
    expect(source).toContain('poiId: string;');

    // 부정 짝 — 필수/선택이 뒤집힌 흔적. 등장하는 것을 모아 실패 diff에 어느 쪽이 뒤집혔는지
    // 찍는다. `'imageUrl:'`은 물음표 없는 필수형을 잡는다(`imageUrl?:`에는 매치되지 않는다).
    const flipped = ['tags?', 'imageUrl:'].filter((name) =>
      source.includes(name)
    );
    expect(flipped).toEqual([]);
  });
});

describe('TRIP-294 AC-1 · 일정 클라이언트가 실제로 생성됐다 (B-12)', () => {
  /**
   * B-6(여행·취향)·B-10(장소)과 같은 이유로 B-1과 별개로 필요하다: orval은 명세에 없는
   * 경로를 **조용히 건너뛴다** — 에러도 없고 종료 코드도 0이고 "🎉 성공" 메시지까지 찍는다.
   * 이 티켓의 실체가 정확히 그것이다: 생성물에 `itinerary` 문자열이 0건인데도 아무 테스트도
   * 빨개지지 않은 채 계약이 낡아 있었다. B-1이 파일의 존재를, 이 단언이 그 안의 심볼을
   * 잠근다.
   *
   * ⚠️ **`itinerary/` 폴더는 생기지 않는다.** `tags-split` 은 openapi의 **태그**별로 폴더를
   * 가르는 모드이고 이 4오퍼레이션의 태그가 `trips` 라서, 전부 기존 `trips/trips.ts` 안에
   * 들어간다. "새 폴더가 생기겠지"라는 예상이 여기서 어긋난다.
   *
   * 이름은 전부 **실측한 생성 이름**이다. openapi에 `operationId`가 0건이라 orval이
   * method+path로 이름을 짓는다 — `postTripsTripIdItineraryConfirm` 같은 긴 이름은 사람이
   * 지은 게 아니라 그 규칙의 결과다. 앱 코드는 이 이름을 몰라도 된다(도메인 훅이 감싼다).
   */
  it('trips/trips.ts가 일정 4오퍼레이션의 함수·훅·쿼리키 심볼과 두 경로를 갖는다', () => {
    const source = readGeneratedSource('trips', 'trips.ts');
    const symbols = extractExportSymbols(source);

    // 앵커 — 파일을 실제로 읽었고 심볼을 모았다는 증거. 재생성 전에는 파일이 존재하므로
    // 이 앵커는 통과하고, 아래 목록 단언이 "일정 심볼만 없다"를 정확히 가리킨다.
    expect(symbols.length).toBeGreaterThan(0);

    // 없는 것을 모아 비교한다 — 실패 diff에 **어떤 심볼이 빠졌는지**가 그대로 찍힌다.
    const absent = ITINERARY_EXPECTED_SYMBOLS.filter(
      (name) => !symbols.includes(name)
    );
    expect(absent).toEqual([]);

    // 경로 문자열. orval은 axios URL을 템플릿 리터럴로 뽑으므로 `${tripId}` 가 소스에 그대로
    // 남는다(작은따옴표 안이라 여기서는 평범한 글자다). 주석 제거 후에도 살아남는 것을
    // 확인했다 — 슬래시가 하나뿐이라 줄 주석 제거에 걸리지 않는다(02a §5).
    expect(source).toContain('`/trips/${tripId}/itinerary`');
    expect(source).toContain('`/trips/${tripId}/itinerary/confirm`');
  });
});

describe('TRIP-294 AC-3 · 슬롯 필드 계약 — 응답 6필수 vs 요청 4필수 (B-13)', () => {
  /**
   * 추적: `endsNextDay`=자정 넘김(HC4) · `hasViolation`=편집 후 위반 가시화(US-SCHED-07,
   * 비차단) · `startAt`/`endAt`=**INV-2**(솔버 검증값만 사용자에게 보인다).
   *
   * **값 조합은 보지 않는다** — `(solveMode, isFallback)` 금지 짝(BR-U2-03)의 대응 PBT
   * `PBT-U2-B2`는 정본이 **backend 소유**로 명시했고, 소스 텍스트 스캔은 원리적으로 값
   * 조합을 볼 수 없다. 프론트는 형태까지만 잠근다(01b Seed 확정 3).
   */
  it('응답 슬롯 6필드가 전부 필수이고, 옵셔널로 풀린 흔적이 없다', () => {
    const source = readGeneratedSource(
      'schemas',
      'itineraryDaysItemSlotsItem.ts'
    );

    // 긍정 — 실측 그대로의 6줄. 타입까지 함께 잠근다.
    expect(source).toContain('poiId: string;');
    expect(source).toContain('startAt: string;');
    expect(source).toContain('endAt: string;');
    expect(source).toContain('isFixed: boolean;');
    expect(source).toContain('endsNextDay: boolean;');
    expect(source).toContain('hasViolation: boolean;');

    // 부정 짝 — 옵셔널로 뒤집힌 흔적. 긍정만 두면 "전부 옵셔널로 푸는" 오생성을 못 가르고,
    // 부정만 두면 파일이 통째로 비어도 통과한다(B-7과 같은 짝 구성).
    const loosened = [
      'poiId?',
      'startAt?',
      'endAt?',
      'isFixed?',
      'endsNextDay?',
      'hasViolation?',
    ].filter((name) => source.includes(name));
    expect(loosened).toEqual([]);
  });

  it('요청 슬롯은 endsNextDay가 선택이고 hasViolation이 아예 없다 (대조군)', () => {
    const source = readGeneratedSource(
      'schemas',
      'editItineraryRequestDaysItemSlotsItem.ts'
    );

    // 긍정 — 필수 4종은 응답 슬롯과 같은 모양이다.
    expect(source).toContain('poiId: string;');
    expect(source).toContain('isFixed: boolean;');

    // 요청/응답 슬롯을 **뒤섞는** 오사용을 막는 대조군이다.
    // `endsNextDay`는 선택이되 실재해야 한다 — 전체 교체 편집이라 조회 응답의 현행 값을
    // 그대로 실어 보내지 않으면 자정 넘김 플래그가 왕복에서 소실된다.
    expect(source).toContain('endsNextDay?: boolean;');

    // `hasViolation`은 서버가 재검증해 내려주는 값이지 클라가 올리는 값이 아니다.
    expect(source).not.toContain('hasViolation');
  });

  it('Itinerary가 generationState를 필수로 갖는다 — 확정 상태와 다른 축', () => {
    const source = readGeneratedSource('schemas', 'itinerary.ts');

    // 긍정 — 최상위 필수 7필드 중 이 칸에서 처음 등장하는 축. `status`(PLANNED/CONFIRMED)와
    // 별개로 "생성이 어디까지 됐나"를 나른다. PARTIAL 인 동안 확정이 409인 근거다.
    expect(source).toContain('generationState: ItineraryGenerationState;');

    // 긍정(대조군) — 파일이 실제로 Itinerary다. 이게 없으면 위 단언이 빈 문자열을 상대로
    // 공허하게 실패/통과한다.
    expect(source).toContain('export interface Itinerary {');

    // 부정 짝 — 선택으로 풀린 흔적.
    expect(source).not.toContain('generationState?');
  });
});

describe('TRIP-294 AC-3 · 일정 enum 4종의 값 목록 (B-14)', () => {
  /**
   * orval은 openapi enum을 **타입 + `as const` 객체** 두 벌로 뽑는다. 객체 쪽은 런타임에
   * 실재하므로 `Object.keys(ItineraryStatus)` 로도 잴 수 있지만, **여기서는 import 하지
   * 않는다**: 재생성 전에는 그 모듈이 없어 import 가 모듈 해석 실패를 내고, 그러면 red가
   * 단언 1건이 아니라 **이 파일 전체(B-0~B-17) 붕괴**가 된다. `pnpm tsc` 도 함께 깨져
   * [검증] 기준선이 오염된다. 그래서 이 파일의 성질 그대로 소스 텍스트에서 값을 읽는다
   * (02a ★4).
   */
  const readEnumEntries = (fileName: string): string[] => {
    const source = readGeneratedSource('schemas', fileName);
    // `  PLANNED: 'PLANNED',` 꼴을 등장 순서 그대로. prettier 후 2칸 들여쓰기이고 마지막
    // 항목에도 쉼표가 붙는다(`.prettierrc` 의 `trailingComma: "es5"`).
    return [...source.matchAll(/^ {2}([A-Z_]+): '([^']+)',$/gm)].map(
      (match) => `${match[1]}=${match[2]}`
    );
  };

  it('status·solveMode·generationState·generationMode의 키와 값이 계약과 완전히 같다', () => {
    // 키=값 꼴로 비교한다 — 키만 보면 `PLANNED: 'CONFIRMED'` 같은 뒤바뀜을 못 잡는다.
    expect(readEnumEntries('itineraryStatus.ts')).toEqual([
      'PLANNED=PLANNED',
      'CONFIRMED=CONFIRMED',
    ]);

    expect(readEnumEntries('itinerarySolveMode.ts')).toEqual([
      'FULL_AI=FULL_AI',
      'DETERMINISTIC=DETERMINISTIC',
      'MINIMAL=MINIMAL',
    ]);

    expect(readEnumEntries('itineraryGenerationState.ts')).toEqual([
      'PARTIAL=PARTIAL',
      'COMPLETE=COMPLETE',
      'FAILED=FAILED',
    ]);

    // ⚠️ u3 domain-entities는 `MANUAL`을 포함한 3종으로 설계했으나 계약은 2종뿐이다
    // (드리프트 A — BE 티켓 후보). 생성물은 계약을 따르므로 여기도 2종이다.
    expect(
      readEnumEntries('generateItineraryRequestGenerationMode.ts')
    ).toEqual(['FULLY_AI=FULLY_AI', 'CO_PLAN=CO_PLAN']);
  });
});

describe('TRIP-294 AC-4③ · 재생성이 기존 심볼을 지우지 않았다 (B-15, 선제 green)', () => {
  /**
   * ⚠️ **선제 green** — 기준선을 지금 이 파일에서 뽑았으니 당연히 통과한다. **이 단언의
   * 심판 시점은 재생성 후**다. 지금 초록인 것이 정상이고, 재생성이 심볼을 지우거나 개명하면
   * 그때 red가 된다.
   *
   * B-9(SHA256 바이트 동결)를 `trips/trips.ts` 에 걸 수 없어서 생긴 자리다 — 이번 재생성이
   * **바꾸는 대상** 파일이라 해시를 걸면 자기모순이다. 그래서 "바이트가 같다" 대신
   * "**줄지 않았다**"만 골라 잰다.
   *
   * `pnpm tsc` 만으로는 부족하다: **소비자가 0인 심볼**(bases·coverage·must-visits 등 다수)이
   * 개명돼도 아무도 import 하지 않으므로 컴파일러가 못 잡는다. 이 단언이 그 사각지대를 메운다.
   */
  it('재생성 前 export 심볼 69개가 전부 여전히 존재한다(초과는 허용)', () => {
    const source = readGeneratedSource('trips', 'trips.ts');
    const symbols = extractExportSymbols(source);

    // 앵커 — 모집단이 실제로 채워졌다는 증거.
    expect(symbols.length).toBeGreaterThan(0);

    // 사라진 이름을 모아 비교한다 — 실패 diff에 **무엇을 잃었는지**가 그대로 찍힌다.
    // 완전 일치가 아니라 부분집합 포함이다: itinerary 신규 심볼이 늘어나는 것은 정상이다.
    const missing = TRIPS_EXPORT_SYMBOLS_BEFORE.filter(
      (name) => !symbols.includes(name)
    );
    expect(missing).toEqual([]);
  });
});

describe('TRIP-294 AC-2 · INV-3 — 일정 생성물에 소요시간 계열 0건 (B-16)', () => {
  /**
   * 추적: **INV-3**(루트 CLAUDE.md·`ai/README.md` — "duration 표시 금지, 거리만. DTO에
   * duration 필드 자체가 없어야 함") · BR-U3-08 · **BR-U2-08**("경계에 소요시간 필드를
   * 추가하는 변경은 어떤 이유로도 금지") · D-U3-12 · u3 domain-entities("duration 필드
   * 없음 — 타입으로 보장").
   *
   * B-4가 이미 생성물 전체를 훑는데 왜 또 두는가 — **B-4의 앵커가 stays 타입이라서**다.
   * 일정 파일이 아예 생성되지 않아도 B-4는 초록이다. 여기서는 앵커가 일정 타입이므로
   * "안 만들어졌다"와 "만들어졌는데 깨끗하다"를 가른다. 금칙 목록도 더 넓다(위
   * `FORBIDDEN_DURATION_PATTERNS` 주석 참조).
   *
   * ⚠️ **거짓 RED 주의(사전 신고)**: 주석을 걷어내지 않으면 걸린다. orval이 openapi의
   * `summary`를 JSDoc으로 그대로 복사하는데 그 문장이 **"소요시간 미노출(INV-3)"** 이다 —
   * INV-3을 지킨다고 **선언하는** 문장이지 위반이 아니다. 생성물의 `소요` 는 재생성 후
   * 2건 → **6건**(trips.ts에 4건 추가)이 되고, `stripComments` 후에는 **0건**이다.
   * qa-verifier의 수기 INV-3 grep이 이 6건을 만나므로 02 매핑 표에 같은 신고가 실려 있다.
   */
  it('일정 12파일을 실제로 읽었고(Itinerary·슬롯·요청 타입 존재), 소요시간 계열은 0건이다', () => {
    const sources = ITINERARY_GENERATED_FILES.map((rel) =>
      readGeneratedSource(...rel.split('/'))
    );

    // 앵커 ① — 12파일이 하나도 빠짐없이 읽혔다. 빈 문자열이 섞이면 그 경로가 diff에 찍힌다.
    const emptyFiles = ITINERARY_GENERATED_FILES.filter(
      (_rel, index) => sources[index].length === 0
    );
    expect(emptyFiles).toEqual([]);

    // 앵커 ② — 모집단이 실제로 일정 계약이다. 이게 없으면 아래 "0건"이 공허해진다.
    const combined = sources.join('\n');
    expect(combined).toContain('Itinerary');
    expect(combined).toContain('ItineraryDaysItemSlotsItem');
    expect(combined).toContain('EditItineraryRequest');

    // 부정 — 위반 파일을 모아 실패 diff에 **어느 파일이** 오염됐는지 찍는다.
    const offenders = ITINERARY_GENERATED_FILES.filter((_rel, index) =>
      FORBIDDEN_DURATION_PATTERNS.some((pattern) =>
        pattern.test(sources[index])
      )
    );
    expect(offenders).toEqual([]);
  });
});

describe('TRIP-294 AC-6 · codegen 스크립트가 포매터를 이어 돌린다 (B-17)', () => {
  /**
   * 근거는 문제로그 `2026-08-02 codegen과 prettier가 한 쌍이다` — `pnpm codegen` 은 리포
   * prettier 설정을 거치지 않아서, 재생성 직후 포매터를 안 돌리면 **순수 포맷 차이로 1,200줄
   * 가짜 diff**가 난다(실측 2회). 이번 재생성으로도 포맷 전에는 56파일 중 24개가 달라 보였고
   * 포매터를 돌리자 실제 변경은 2개로 줄었다.
   *
   * 그 문제로그가 "절차로 적어 두는 것보다 스크립트를 한 쌍으로 묶는 것이 더 근본적인
   * 해법"이라고 이미 지목했다. 절차로만 두면 이미 두 번 밟은 함정이 세 번째를 기다린다.
   * 같은 파일의 B-9 주석이 적어 둔 실패 원인 ⓑ("prettier 미실행")를 **구조적으로 없앤다**.
   *
   * 이 테스트는 `pnpm codegen` 을 실행하지 않는다 — orval 실행은 워킹트리에 파일을 쓰는
   * 부작용이 있다(이 파일 머리말의 방침). 스크립트 **문자열**만 본다.
   */
  it('codegen 스크립트가 orval 다음에 prettier --write를 생성물 글로브로 이어 돌린다', () => {
    const script = readPackageJson().scripts.codegen;

    // 앵커 — 스크립트가 실재한다. 없으면 아래 단언이 undefined를 상대로 죽는다.
    expect(typeof script).toBe('string');

    // 긍정 — 재생성 자체는 그대로 남아 있다(포매터로 대체된 것이 아니다).
    expect(script).toContain('orval --config ./orval.config.ts');

    // 긍정 — 포매터가 붙었고, 사정거리가 생성물 폴더다. 인용부호 형태는 잠그지 않는다.
    expect(script).toContain('prettier --write');
    expect(script).toContain('src/shared/api/generated/**/*.ts');
    expect(script).toContain('&&');

    // 순서 — orval이 **먼저**다. 뒤집히면 포매터 결과를 재생성이 덮어써 아무 효과가 없다.
    expect(script.indexOf('orval')).toBeLessThan(script.indexOf('prettier'));
  });
});
