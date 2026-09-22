/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * S1~S6 (TRIP-339 · AC-6 · AC-7 · AC-8 · AC-13 · AC-16 · AC-17 · TRIP-864 공급자 전환) —
 * 지도 표면 **소스 층 가드**. 렌더로 못 보는 것만 본다.
 *
 * 무엇을 보장하나:
 *  - 지도 고정은 **옵트인**이다 — LOCKED 화면만 viewOnly 를 켜고 좌표 확정·자유 탐색은 안 켠다.
 *  - 사진 도입이 **픽스처 안에서만** 끝났다 — 화면·계약 파일로 새지 않았다.
 *  - 프리뷰 픽스처가 **실재하는 로컬 파일**에서 사진을 얻고 외부 URL을 지어내지 않았다.
 *  - 프리뷰 h11 좌표가 **한 화면에 들어오는 간격**이다.
 *
 * ── TRIP-864 공급자 전환(카카오 WebView → 네이버 네이티브) 반영 ────────────────
 *  - 지도 태그 탐지 `<KakaoMapView>` → `<MapView>`(S1·S2·S8). shared/map 은 census 제외(코어·
 *    별칭 shim 이지 소비처가 아니다). StayRegister L327 별칭은 `<MapView\b` 밖이라 카운트 6→5·14→13.
 *  - S3 의 지도 계약 앵커(MapPin)는 삭제된 mapHtml.ts → 네이버 코어 MapView.tsx 로 이관.
 *  - **S7(지도 대본 raw hex 팔레트 부분집합) 삭제** — 네이티브 MapView 는 className 토큰만 쓰고
 *    shared/map raw hex 0건이라 심판 대상 소멸(파일 끝 주석 참조).
 *
 * **전제 — 모든 스캔은 주석을 걷어낸 소스를 본다**(`stripComments`, 파일마다 각자 갖는 것이 리포
 * 관례). 줄 주석 규칙에서 **바로 앞 글자가 `:` 이면 주석으로 보지 않는다** — 그 방어가 없으면
 * `'https://…'` 의 슬래시가 주석 시작으로 오인되어 ⓐ S4가 어떤 구현으로도 통과 불가가 되고
 * ⓑ URL로 적힌 위반이 스캔에서 조용히 사라진다(리포 실측 2건). S1이 그 조합을 기계로 잠근다.
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 도달 앵커와
 * 같은 it 안에서 짝을 이룬다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md 「장치 판정 규칙」) ──────────────────────
 * **A. 영구 규칙** — S2(옵트인 경계) · S4(외부 URL 금지)는 규칙이라 화면이 늘어도 그대로 선다.
 * **B. 이행 체크포인트 — 한시적.** S3의 `DraftScreenProps` 필드 목록과 S6의 픽스처 상수 이름은
 * 이번 칸의 계약 스냅숏이라 정당한 리네임·필드 추가에 red를 낸다. **B 카운터 = 2**(2026-08-10
 * TRIP-298 이 `demoted` 를 더하며 red[1회], 2026-08-18 TRIP-304 가 `demoted`→`fallbackNotice`
 * 리네임하며 red[2회] — 둘 다 목록을 갱신했다). **2회 누적으로 졸업 조건 도달** — S3 필드목록
 * 단언 제거 여부는 [기록]/하네스 판정 몫으로 넘긴다(이번 사이클은 갱신 유지).
 */

const ROOT = path.resolve('src');

/** 지도 고정을 **켜야 하는** 화면(h05·h11). */
const LOCKED_CALLERS = [
  'features/itinerary/ui/DraftScreen.tsx',
  'features/itinerary/ui/MustVisitPickerScreen.tsx',
  // TRIP-563 i13·i16 재계획 글랜스 지도 — h05·h11 과 같은 인라인 잠금 미리보기(viewOnly ON).
  'features/planb/ui/NoAlternativeScreen.tsx',
  'features/planb/ui/ReplanDraftScreen.tsx',
  // TRIP-565 j01 방문 기록 히어로 지도 — 방문 동선 글랜스(viewOnly ON, 인터랙티브 요소는 형제).
  'features/record/ui/TripRecordsScreen.tsx',
  // TRIP-571 j03 오늘의 회고 지도 — 방문 동선 글랜스(viewOnly ON). 실 좌표 있을 때만 렌더(계약에
  // 좌표 부재라 오늘은 placeholder 로 접힘)이나 소스에 태그가 있어 옵트인 명부에 등재.
  'features/reflection/ui/DailyReflectionScreen.tsx',
  // TRIP-572 j04 여행 요약 지도 — 방문 순서 글랜스(viewOnly ON). DailyReflectionScreen 동형(좌표
  // 있을 때만 렌더, 없으면 placeholder). test-designer 가 처음부터 등재(571·563·442 3번째 재발 방지).
  'features/reflection/ui/TripSummaryScreen.tsx',
  // TRIP-783 h공통 지도+시트 셸 — 전면 지도가 시트 뒤 전면에 깔린 잠긴 글랜스(viewOnly ON,
  // connectPins 기본=선). h07·h08·h11·h14·h16 결과 6종이 이 셸을 소비하는 부품이다. 셸이
  // `<MapView>` 를 렌더하므로 census fail-closed 를 피하려 test-designer 가 착수 단계에서 선반영
  // (571·563·442 재발 방지 · TRIP-572 선례). 실개폐·2스냅은 통과형 목 사각(6-b 실기).
  'widgets/map-sheet-shell/ui/MapSheetShell.tsx',
  // TRIP-710 d06 장소 상세 미니맵 — 정적 placeholder → 실 MapView(viewOnly ON, 단일 핀).
  // connectPins 미전달(단일 핀→경로선 없음, 아래 S8 ③ 강제). test-designer 착수 단계 선반영이라
  // 구현(placeholder→MapView) 전엔 `<MapView` 0건이라 S2 집합 불일치·S8 카운트로 red(정상).
  'features/explore/ui/PlaceDetailScreen.tsx',
  // TRIP-727 e03 숙소 상세 미니맵 — 정적 자리(MapPinGlyph) → 실 MapView(viewOnly ON, 단일 핀).
  // connectPins 미전달(단일 핀→경로선 없음, 아래 S8 ③ 강제). d06 PlaceDetailScreen(TRIP-710) 동형 —
  // test-designer 착수 단계 선반영이라 구현(placeholder→MapView) 전엔 `<MapView` 0건이라 S2 집합
  // 불일치·S8 카운트로 red(정상, 442·563·571 3회 재발 방지).
  'features/stay/ui/StayDetailScreen.tsx',
  // TRIP-789 h07 생성 loading 지도 카드 — 진행 카드와 체크리스트 사이의 꼭 갈 곳 글랜스(viewOnly ON,
  // connectPins={false} — 미검증 동선 선 금지 INV-2). pins·center 둘 다 있을 때만 렌더(정직 폴백),
  // 프리뷰만 주입(Q1-B). MustVisitPickerScreen 에 이은 **2번째** no-line caller 라 아래 NO_LINE_CALLERS
  // 에도 등재된다. test-designer 착수 단계 선반영이라 구현(map card 추가) 전엔 `<MapView` 0건이라
  // S2 집합 불일치·S8 lineOffTags 카운트로 red(정상, 442·563·571 3회+ 재발 방지).
  'features/itinerary/ui/GeneratingScreen.tsx',
  // TRIP-791 h07 폴백 인터스티셜 지도 카드 — 성공(폴백) 변형이 "기본 동선"(핀 route)을 그려
  // viewOnly ON + connectPins 기본(=선). **line caller**(no-line 아님) — h11 DraftScreen 과 동형이라
  // 이 배열에만 등재하고 NO_LINE_CALLERS 엔 안 넣는다. test-designer 착수 단계 선반영이라 구현
  // (GenerationFallbackScreen 신설) 전엔 `<MapView` 0건이라 S2 집합 불일치·S8 defaultTags 카운트로
  // red(정상, 442·563·571 3회 재발 방지 · 01b ★2).
  'features/itinerary/ui/GenerationFallbackScreen.tsx',
  // TRIP-795 h10 후보 선택 지도 카드 — 반경 점선 원 + 현재위치 핀 + 후보 letter 핀을 얹은 잠긴
  // 글랜스(viewOnly ON, connectPins={false} — "보여주기 전용, 검증된 동선 아님"). 좌표는 계약 밖이라
  // 프로덕션은 지도 미표시(degrade), 프리뷰 픽스처만 렌더. GeneratingScreen 에 이은 **3번째** no-line
  // caller 라 아래 NO_LINE_CALLERS 에도 등재. test-designer 착수 단계 선반영이라 구현(map 카드 추가)
  // 전엔 SlotFillScreen 에 `<MapView` 0건이라 S2 집합 불일치·S8 lineOffTags 카운트로 red(정상, 01b D7).
  'features/itinerary/ui/SlotFillScreen.tsx',
];

/** 지도 고정을 **켜면 안 되는** 호출부. 앞의 넷은 지도를 움직여 좌표를 확정하는 것이 기능 자체라
 * 잠기면 저장할 방법이 사라지고, 프리뷰 단독 지도는 브리지가 조작 가능한지 보는 자리다
 * (사용자 결정 2026-08-10 — 고정 안 함). */
const OPEN_CALLERS = [
  'features/stay/ui/StayRegisterScreen.tsx',
  'app/_dev/preview.tsx',
  // TRIP-397 i02·i03 여행 중 지도 — 자유 탐색이라 제스처를 잠그지 않는다(viewOnly 미전달).
  'features/execution/ui/LiveMapScreen.tsx',
  // TRIP-866(S4) — pages/live-location/ui/LiveLocationPage.tsx 는 이 명부에서 빠졌다: 이제 지도를
  // `<CenterPinPicker>`(중앙 고정 핀, shared/map)로 감싸 쓰므로 `<MapView\b` census 밖이다.
  // CenterPinPicker 는 viewOnly 를 받지 않는(항상 조작 가능) 래퍼라 이 옵트인 경계의 대상이 아니다.
];

// TRIP-801 GUT — 완성·확정 일정 화면 `TimelineScreen` 이 소비처 0(CONFIRMED→셸 이관)으로 삭제되며
// `EXPLORE_CALLERS`(TimelineScreen 의 인라인 글랜스 + h26 확대 두 태그)·`ITINERARY_*_TAGS` 상수가
// 함께 제거됐다. h25/h34 는 이제 없다(CONFIRMED 도 `MapSheetShell` 이 owner, LOCKED_CALLERS 에 이미
// 등재됨). withTag 전수 동치(S2 ①)가 TimelineScreen.tsx 잔존 시 red 로 삭제를 강제한다(02a ★9).

/** 연결선을 **끄는**(`connectPins={false}`) 자리. 게이트①-2 시점엔 h05 하나뿐이었으나 TRIP-789 로
 * h07 생성 loading 지도 카드가 **2번째** no-line caller 가 됐다(미검증 동선 선 금지 INV-2 — h05 는
 * "담은 순서"일 뿐, h07 loading 은 데이터 도착 전 꼭 갈 곳 글랜스라 둘 다 확정 동선이 아니다).
 * 나머지 태그는 아무 말도 하지 않고 기본값(`connectPins` = 잇는다)을 받는다 — h11(일정 초안)이 그 안에 있다. */
const NO_LINE_CALLERS = [
  'features/itinerary/ui/MustVisitPickerScreen.tsx',
  'features/itinerary/ui/GeneratingScreen.tsx',
  // TRIP-795 h10 후보 지도 — "보여주기 전용" 글랜스라 확정 동선이 아니다(INV-2). 3번째 no-line caller.
  'features/itinerary/ui/SlotFillScreen.tsx',
];

const SCREEN_REL = 'features/itinerary/ui/DraftScreen.tsx';
// TRIP-864 — 지도 계약(MapPin)은 삭제된 mapHtml.ts 에서 네이버 코어 MapView.tsx 로 이관됐다.
const MAP_CORE_REL = 'shared/map/MapView.tsx';
const PREVIEW_REL = 'app/_dev/preview.tsx';

/** h11 프리뷰 픽스처. 이름을 못박는 것은 이 칸의 스냅숏이다(위 졸업 조건 B). */
const DRAFT_FIXTURE_CONST = 'DRAFT_PREVIEW_SLOTS';

/** 브리프 §3.4 — Figma 지도 폭 358px에서 1km ≈ 52px → 한 화면 가로 약 6.9km. 여유를 두어 4km. */
const MAX_PIN_SPAN_KM = 4;
/** 브리프 §4.5가 현행 3↔4번(241m)을 "사실상 겹친다"로 판정했다. 그보다 위여야 심판이 선다. */
const MIN_PIN_GAP_KM = 0.3;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — ENOENT 예외로 죽으면 "무엇이 없는가"가 diff에 안 남는다. 빈 문자열이
 * 부정 단언을 공짜로 통과시키는 것은 같은 it 안의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function relOf(full: string): string {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

/** JSX 태그 하나를 통째로 떼어낸다. `[^>]*` 가 줄바꿈도 먹으므로 여러 줄로 포맷된 태그도 잡힌다.
 * 리포의 7개 호출부 태그에는 화살표 함수(`=>`)가 들어 있지 않아 `>` 로 끊어도 안전하다 —
 * TRIP-864 — 카카오 `<KakaoMapView>` → 네이버 `<MapView>` 로 탐지 대상 전환. 별칭
 * `<KakaoMapView>`(StayRegister L327, S4 소관)는 `<MapView\b` 에 안 잡힌다 — 그 사실을 S2·S8
 * 카운트가 정합해 반영한다. 호출부 태그에 화살표 함수(`=>`)가 없어 `>` 로 끊어도 안전하다. */
const MAP_TAG = /<MapView\b[^>]*>/g;

function mapTagsOf(source: string): string[] {
  return source.match(MAP_TAG) ?? [];
}

interface Coord {
  lat: number;
  lng: number;
}

const KM_PER_DEGREE = 111.19;

/** 등거리 근사 — 이 위도대(제주~서울)에서 수 km 판정에는 충분하다. 경도 1도의 실거리는
 * 위도에 따라 줄어들므로 두 점의 평균 위도로 보정한다. */
function distanceKm(a: Coord, b: Coord): number {
  const dLat = (a.lat - b.lat) * KM_PER_DEGREE;
  const midLat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const dLng = (a.lng - b.lng) * KM_PER_DEGREE * Math.cos(midLat);
  return Math.hypot(dLat, dLng);
}

/** `const NAME … = [` 부터 열 0의 `];` 까지. 못 찾으면 빈 문자열(도달 앵커가 잡는다). */
function constBlock(source: string, name: string): string {
  const start = source.indexOf(`const ${name}`);
  if (start === -1) return '';
  const end = source.indexOf('\n];', start);
  return end === -1 ? '' : source.slice(start, end);
}

/** 블록 안 `lat:`/`lng:` 를 등장 순서대로 짝지어 좌표로 만든다. `null` 인 쪽은 버린다
 * (좌표 없는 슬롯은 핀이 안 생기므로 축척과 무관하다). */
function coordsOf(block: string): Coord[] {
  const raw = [...block.matchAll(/\b(lat|lng):\s*(-?\d+(?:\.\d+)?|null)/g)].map(
    (match) => ({ key: match[1], value: match[2] })
  );
  const out: Coord[] = [];
  for (let i = 0; i + 1 < raw.length; i += 1) {
    if (raw[i].key !== 'lat' || raw[i + 1].key !== 'lng') continue;
    if (raw[i].value === 'null' || raw[i + 1].value === 'null') continue;
    out.push({ lat: Number(raw[i].value), lng: Number(raw[i + 1].value) });
  }
  return out;
}

/** 인터페이스 본문의 필드 이름 목록. 주석은 이미 걷혀 있다. */
function interfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`interface ${name} {`);
  if (start === -1) return [];
  const end = source.indexOf('\n}', start);
  if (end === -1) return [];
  const body = source.slice(start, end);
  return [...body.matchAll(/^\s{2}(\w+)\??\s*:/gm)].map((match) => match[1]);
}

describe('S1 · 조합 자가검사 — 전처리와 탐지기가 서로를 지우지 않는다', () => {
  it('주석 속 지문은 걷히고, 코드의 URL·프롭은 살아남으며, 태그 탐지기가 viewOnly 유무를 가른다', () => {
    const sample = [
      '/** 외부 URL 을 지어내지 않는다 — https://img.example.com/a.jpg 같은 값 금지. */',
      '// viewOnly 는 h05·h11 에만 켠다.',
      "const photo = 'https://cdn.example.com/a.png';",
      '<MapView',
      '  center={center}',
      '  pins={pins}',
      '  viewOnly',
      '/>',
      '<MapView center={c} />',
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석은 걷힌다 — 걷지 않으면 "URL 금지" 라고 적은 주석 자체가 S4를 red로 만든다.
    expect(stripped).not.toContain('img.example.com');
    expect(stripped.split('viewOnly').length - 1).toBe(1);

    // ② ★ 반대 방향 — 코드의 URL은 **살아남아야** 한다. 순진한 `//.*` 제거는 이 줄을
    //    `const photo = 'https:` 로 잘라, S4가 어떤 구현으로도 통과 불가가 되는 동시에
    //    URL로 적힌 위반을 조용히 놓친다(리포 실측 2건).
    expect(stripped).toContain(
      "const photo = 'https://cdn.example.com/a.png';"
    );
    expect(/https?:\/\//.test(stripped)).toBe(true);

    // ③ 태그 탐지기 — 여러 줄 태그를 잡고, 두 태그를 각각 떼어내며, viewOnly 유무를 가른다.
    const tags = mapTagsOf(stripped);
    expect(tags).toHaveLength(2);
    expect(tags.filter((tag) => /\bviewOnly\b/.test(tag))).toHaveLength(1);
  });
});

describe('🔴 S2 · AC-13 · AC-16 — 지도 고정은 h05·h11 에만 켠다 (옵트인 경계)', () => {
  it('호출부 전수가 알려진 6파일뿐이고, h05·h11 태그에만 viewOnly 가 있다', () => {
    const withTag = listSourceFiles(ROOT)
      .map((full) => ({ file: relOf(full), source: readOne(relOf(full)) }))
      // shared/map 은 지도 인프라(코어·별칭 shim)이지 소비처가 아니다 — TRIP-864 로 kakaoCompat.tsx
      // 가 `<MapView>` 를 렌더하므로 census 에서 제외한다(옛 KakaoMapView.tsx 는 <WebView> 를
      // 렌더해 이 제외가 불필요했다).
      .filter(({ file }) => !file.startsWith('shared/map/'))
      .filter(({ source }) => source.includes('<MapView'))
      .map(({ file }) => file)
      .sort();

    // ① 도달 앵커 — 호출부가 통째로 이 심판 안에 있다. 새 호출부가 생기면 여기서 먼저 걸려
    //    "잠글 곳인가 아닌가"를 사람이 정하게 된다(모집단이 조용히 새는 것을 막는다). TRIP-801 GUT 로
    //    TimelineScreen 이 삭제돼 EXPLORE_CALLERS(태그 둘) 가 빠졌다 — TimelineScreen.tsx 가 아직
    //    디스크에 있으면 withTag 에 잡혀 이 동치가 red(삭제 강제, 02a ★9).
    expect(withTag).toEqual([...LOCKED_CALLERS, ...OPEN_CALLERS].sort());

    // ② 잠글 두 화면 — 태그마다 viewOnly 가 있다.
    LOCKED_CALLERS.forEach((rel) => {
      const tags = mapTagsOf(readOne(rel));
      expect(tags.length).toBeGreaterThan(0);
      expect(tags.filter((tag) => /\bviewOnly\b/.test(tag))).toEqual(tags);
    });

    // ③ 열어 둘 자리 — 태그가 정확히 4개이고 그중 어느 것에도 viewOnly 가 없다. 이들이 잠기면
    //    좌표 확정·여행 중 자유 탐색이 막힌다(회귀 금지). 내역: StayRegister 2(검색 미리보기+확정
    //    시트) + preview 1 + LiveMapScreen 1. TRIP-866(S4) 로 live-location 이 `<CenterPinPicker>` 로
    //    넘어가 `<MapView\b` census 밖이 되며 구 5 → 4. StayRegister 핀 지정 태그도 이제 CenterPinPicker
    //    라 여전히 `<MapView\b` 밖이고, 남은 2개는 지도 검색 흐름(핀 지정과 무관)이다.
    const openTags = OPEN_CALLERS.flatMap((rel) => mapTagsOf(readOne(rel)));
    expect(openTags).toHaveLength(4);
    expect(openTags.filter((tag) => /\bviewOnly\b/.test(tag))).toEqual([]);

    // ④(구) TimelineScreen 태그 단위(글랜스 잠금 / h26 확대 열림) 분석은 TRIP-801 GUT 로 그 파일이
    //    삭제되며 제거됐다 — CONFIRMED 도 이제 MapSheetShell(LOCKED, 단일 viewOnly 태그)이 owner다.
  });
});

describe('S8 · 무선 — 연결선을 끄는 자리가 h05·h07 loading 둘뿐이다 (게이트①-2 + TRIP-789)', () => {
  /** 왜 소스 층인가 — **어느 호출부가 무엇을 말했나**는 여기서만 보인다. no-line 태그에서
   * `connectPins={false}` 한 줄이 사라지면 "담은 순서"·"도착 전 글랜스"가 확정 동선처럼 선으로
   * 그려지는데, 대본 실행 층(X3·X7)은 화면을 거치지 않아 그 삭제가 안 보인다(03b2 W2-1 뮤테이션 M3).
   *
   * 무엇을 보장하지 **못**하나: 태그에 적힌 **글자**까지다. 그 값이 컴포넌트를 통과해 실제
   * 지도에 닿는지는 이 층에서 볼 수 없다 — `MapView`가 그 프롭을 흘려도 여기는 초록이다.
   * 그 축은 실물 렌더 심판(`shared/map/MapView.test.tsx` AC2 viewOnly·AC3 connectPins)이 잡는다. */
  it('no-line 세 자리(h05·h07 loading·h10 후보)에만 connectPins={false} 가 있고 나머지 LOCKED(+OPEN 4)은 기본값을 받는다', () => {
    const lineOffTags = NO_LINE_CALLERS.flatMap((rel) =>
      mapTagsOf(readOne(rel))
    );
    const defaultTags = [
      ...LOCKED_CALLERS.filter((rel) => !NO_LINE_CALLERS.includes(rel)),
      ...OPEN_CALLERS,
      // TRIP-801 GUT — TimelineScreen(EXPLORE_CALLERS, 태그 둘) 삭제로 이 spread 가 빠졌다.
      // CONFIRMED 동선 선은 이제 MapSheetShell(LOCKED, connectPins 기본)이 그린다.
    ].flatMap((rel) => mapTagsOf(readOne(rel)));

    // ① 도달 앵커 — 태그를 진짜로 떼어냈다(no-line 3개 + 나머지 14개 = 총 17개).
    //    TRIP-789 로 no-line 이 1→2(h07 loading 지도 카드). TRIP-795 로 3(h10 후보 지도 카드,
    //    connectPins={false}). defaultTags 는 14 불변 — SlotFillScreen 은 LOCKED 이자 NO_LINE 이라
    //    filter 에서 빠져 (LOCKED 13 − NO_LINE 3 = 10 + OPEN 4)로 상쇄된다(오갱신 금지 — 15로 올리면
    //    거짓 red). TRIP-791 로 GenerationFallbackScreen(LOCKED·line caller) 추가분은 그대로.
    expect(lineOffTags).toHaveLength(3);
    expect(defaultTags).toHaveLength(14);

    // ② 끄는 세 자리 전부 끈다고 **명시**한다(h05·h07 loading·h10 후보).
    lineOffTags.forEach((tag) =>
      expect(tag).toMatch(/\bconnectPins=\{false\}/)
    );

    // ③ 나머지(defaultTags 14개)는 아무 말도 하지 않는다 = 기본값(잇는다)을 받는다. h11 이 여기 있다 —
    //    이 심판이 요구하는 것은 "끄지 않았다"이고, 기본값이 정말 잇는지는 X3이 잰다.
    expect(defaultTags.filter((tag) => /\bconnectPins\b/.test(tag))).toEqual(
      []
    );
  });
});

describe('S3 · AC-8 — 사진 도입이 화면·계약으로 새지 않았다 (선제 green · 계약 스냅숏)', () => {
  /**
   * 티켓 원문의 AC-8은 **사진에 한정된 조건**이다("픽스처 쪽에서만 해결한다"). 지도 고정 프롭이
   * `DraftScreen.tsx` 에 한 줄 느는 것은 이 조건이 금지하는 대상이 아니다(02a §3-5) — 그래서
   * 여기서 재는 것은 "화면 파일이 안 바뀌었다"가 아니라 **"사진 해결이 화면으로 새지 않았다"**다.
   */
  it('MapPin 은 5필드(TRIP-795 label 편입), DraftScreenProps 는 14필드(TRIP-791 fallbackNotice 제거), 화면에 에셋 해석 지문이 0건이다', () => {
    const mapCoreSource = readOne(MAP_CORE_REL);
    const screenSource = readOne(SCREEN_REL);

    // 도달 앵커 — 읽은 것이 정말 그 파일들이다. TRIP-864 — 지도 계약(MapPin)은 삭제된
    // mapHtml.ts 에서 네이버 코어 MapView.tsx 로 이관됐다(buildMapHtml 은 대본이 사라져 없음).
    expect(mapCoreSource).toMatch(/export function MapView\b/);
    expect(screenSource).toMatch(/export function DraftScreen\b/);

    // TRIP-745 — 핀 3상태(done/current/upcoming)를 위해 `state?: MapPinState` 가 additive 로
    // 편입된다(옵셔널·2칸 들여쓰기 프로퍼티형이라 interfaceFields 가 4번째로 잡는다). 완료조건 #4가
    // "LOCKED_CALLERS 갱신"으로 오지정한 실제 대상이 이 스냅숏이다(01 §맹점④). 핀 모양(Circle→물방울)
    // 교체는 여기서 안 잡는다 — 필드 계약만 본다.
    // TRIP-795 — h10 후보 letter 핀을 위해 `label?: string` 이 additive 로 5번째 편입된다(카드 배지
    // A/B/C/D 와 시각 일치, 미전달 = 번호 그대로 무회귀). 정당한 계약 플립(이행 체크포인트 B) —
    // 편입 전엔 4필드라 이 스냅숏이 red(뮤테이션 실측: label 제거 시 red).
    expect(interfaceFields(mapCoreSource, 'MapPin')).toEqual([
      'number',
      'lat',
      'lng',
      'state',
      'label',
    ]);
    // 화면 계약 스냅숏 — 사진을 넣으려고 프롭을 늘리면 여기서 걸린다(이 칸 TRIP-339 의 취지).
    // 필드 추가는 **정당한 계약 변경일 때만** 이 목록을 함께 갱신해 통과시킨다(이행 체크포인트 B).
    expect(interfaceFields(screenSource, 'DraftScreenProps')).toEqual([
      'view',
      'tabs',
      'selectedDate',
      'pins',
      'dayHeader',
      'canRetry',
      // TRIP-791 — `fallbackNotice` 필드 삭제(15→14). 폴백·강등 배너가 DraftScreen 곁줄에서
      // 전용 인터스티셜 화면(GenerationFallbackScreen)으로 승격돼 이 화면은 목록만 남는다(01b D1·D2).
      // 정당한 계약 플립(뮤테이션 실측: 14 로 고친 뒤 프로퍼티형 필드 하나 더 넣으면 red). 이행
      // 체크포인트 B — 목록은 계속 갱신(졸업 도달 후에도 스냅숏 유지).
      'onSelectDay',
      'onRetry',
      'onBack',
      // TRIP-454 — h11→h25 완성 CTA 콜백. **프로퍼티형** `onComplete?: () => void` 여야
      // interfaceFields 가 잡는다(메서드 단축형 `onComplete?()` 는 미캡처 — 02a §5 node 실측).
      'onComplete',
      // TRIP-467 — h12 슬롯 교체 트리거 콜백. 비고정 슬롯 "다른 후보 ›" press → `DraftPage` 가
      // 조건부 마운트하는 `SlotCandidatePanelContainer` 로 이어진다. **프로퍼티형**
      // `onPressSlot?: (slotKey: string) => void` 여야 잡힌다(위와 동형).
      'onPressSlot',
      // TRIP-483 — h12 바텀시트→인라인 패널 이관(3종, 후방호환 옵셔널·프로퍼티형).
      //  · expandedSlotKey?: string | null — 어느 슬롯 패널이 열렸나(null=닫힘).
      //  · renderSlotPanel?: (slotKey: string) => ReactNode — DraftPage 가 공급, 화면은 매칭
      //    카드 slotKey 로만 호출(패널 조립은 배선 몫). **한 줄 유지**(여러 줄이면 내부 `slotKey:`
      //    가 2칸 들여쓰기로 오지 않게 — interfaceFields 정규식 안전, 02a §1-A).
      //  · onManualPlan?: () => void — 「처음부터 직접」·「직접 고르기」 공통(→ manual 라우트).
      // 이 순서 그대로(toEqual 순서 민감). 12→15 는 additive 계약 변경(B 카운터 이행분).
      'expandedSlotKey',
      'renderSlotPanel',
      'onManualPlan',
    ]);

    // 에셋 해석은 픽스처 몫이다 — 화면이 로컬 파일을 알면 계약이 둘로 갈린다.
    ['resolveAssetSource', 'require(', '@/assets'].forEach((needle) =>
      expect(screenSource).not.toContain(needle)
    );
  });
});

describe('S4 · AC-7 — 프리뷰 픽스처에 외부 URL 리터럴이 없다 (선제 green · INV-1 취지)', () => {
  it('preview.tsx 에 http(s) 리터럴이 0건이다', () => {
    const source = readOne(PREVIEW_REL);

    // 도달 앵커 — 파일을 실제로 읽었고 h11 픽스처가 그 안에 있다.
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain(DRAFT_FIXTURE_CONST);

    // 본체 — 죽은 링크·오프라인에서 안 뜨는 값을 픽스처에 박으면 프리뷰가 실제보다 나쁘게
    // 보이고 그 오해가 다음 디자인 판정을 오염시킨다.
    const offenders = [...source.matchAll(/https?:\/\/[^\s'"`)]+/g)].map(
      (match) => match[0]
    );
    expect(offenders).toEqual([]);
  });
});

describe('🔴 S5 · AC-6 — 프리뷰 사진이 리포에 실재하는 로컬 파일에서 온다', () => {
  /**
   * ⚠️ **"78px 썸네일이 실제로 뜬다"는 jest로 잴 수 없다**(02a §2-A 실측). jest에서
   * `require('*.png')` 는 `{ testUri }` 객체를 돌려주고 `Image.resolveAssetSource(...).uri` 는
   * `undefined` 라, **어떤 올바른 구현도 jest에서는 썸네일을 안 그린다.** 그 단언을 걸면 통과
   * 불가 심판이 된다 — 뜨는지는 6-b 실기(R7) 몫이고, 여기서는 그 앞까지를 잰다.
   */
  it('픽스처가 @/assets 이미지를 require 하고, 그 파일과 출처 표기가 디스크에 실재한다', () => {
    const source = readOne(PREVIEW_REL);

    // 도달 앵커.
    expect(source).toContain(DRAFT_FIXTURE_CONST);

    const required = [
      ...source.matchAll(/require\(\s*['"]@\/assets\/([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]);

    // ① 로컬 에셋을 실제로 가져온다.
    expect(required.length).toBeGreaterThan(0);

    // ② 가리키는 파일이 전부 디스크에 있다 — 없는 경로를 require 하면 Metro 번들이 깨진다.
    const missing = required.filter(
      (rel) => !fs.existsSync(path.join(ROOT, 'assets', rel))
    );
    expect(missing).toEqual([]);

    // ③ h11 픽스처의 사진 칸이 실제로 채워졌다(전부 null 이면 프리뷰에 썸네일이 한 장도 없다).
    const block = constBlock(source, DRAFT_FIXTURE_CONST);
    expect(block.length).toBeGreaterThan(0);
    const filled = [...block.matchAll(/imageUrl:\s*([^,\n]+)/g)]
      .map((match) => match[1].trim())
      .filter((value) => value !== 'null');
    expect(filled.length).toBeGreaterThanOrEqual(2);

    // ④ 출처 표기 — "라이선스가 분명한 것만 쓰고 출처를 파일 옆에 남긴다"(사용자 결정)의
    //    기계 번역. 폴더 이름은 못박지 않고 ① 에서 읽어낸 경로를 그대로 따라간다.
    const assetDir = path.join(ROOT, 'assets', path.dirname(required[0]));
    const entries = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : [];
    const images = entries.filter((name) =>
      /\.(png|jpe?g|webp|gif)$/i.test(name)
    );
    const notes = entries.filter((name) => /\.(md|txt)$/i.test(name));
    expect(images.length).toBeGreaterThan(0);
    expect(notes.length).toBeGreaterThan(0);
    const noteText = notes
      .map((name) => fs.readFileSync(path.join(assetDir, name), 'utf8'))
      .join('\n');
    expect(images.filter((name) => !noteText.includes(name))).toEqual([]);
  });
});

describe('🔴 S6 · AC-17 — 프리뷰 h11 좌표가 한 화면에 들어오는 간격이다', () => {
  it('핀 최장 거리가 4km 이하이고 어떤 두 핀도 300m 이상 떨어져 있다', () => {
    const coords = coordsOf(
      constBlock(readOne(PREVIEW_REL), DRAFT_FIXTURE_CONST)
    );

    // 도달 앵커 — 좌표를 실제로 뽑아냈다(못 뽑으면 아래가 빈 배열 위에서 공허하게 통과한다).
    expect(coords.length).toBeGreaterThanOrEqual(3);

    const gaps = coords.flatMap((a, i) =>
      coords.slice(i + 1).map((b) => distanceKm(a, b))
    );
    expect(gaps.length).toBeGreaterThan(0);

    // ① 너무 넓으면 축척이 Figma의 1km대에서 벗어난다(현행 최장 41km = 목표의 6배).
    expect(Math.max(...gaps)).toBeLessThanOrEqual(MAX_PIN_SPAN_KM);
    // ② 너무 좁으면 두 핀이 화면에서 겹쳐 무엇을 보여주는지 알 수 없다(현행 최단 241m).
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(MIN_PIN_GAP_KM);
  });

  it('거리 계산기 자가검사 — 서울↔부산이 실거리(약 325km)로 나온다', () => {
    const seoul = { lat: 37.5665, lng: 126.978 };
    const busan = { lat: 35.1796, lng: 129.0756 };
    const km = distanceKm(seoul, busan);

    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(350);
    // 같은 점은 0이다(중복 좌표가 하한 단언을 통과해 버리지 않는다는 확인).
    expect(distanceKm(seoul, seoul)).toBe(0);
  });
});

// TRIP-864 — S7(지도 대본 raw hex 팔레트 부분집합 가드) **삭제**. 카카오 WebView 대본은
// NativeWind 가 닿지 않아 raw hex 가 불가피했으나, 네이버 네이티브 `MapView` 는 className 토큰만
// 쓰고 shared/map 에 raw hex 가 0건이다(grep 확인). 심판 대상(팔레트 밖 색)이 소멸했고, 긍정 짝
// `used.has(primary)` 는 `used` 가 공집합이 되어 통과 불가가 되므로 케이스 자체를 뗀다.
