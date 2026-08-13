/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * S1~S7 (TRIP-339 · AC-6 · AC-7 · AC-8 · AC-13 · AC-16 · AC-17) — 지도 표면 **소스 층 가드**.
 * 렌더로도 대본 실행으로도 못 보는 것만 본다.
 *
 * 무엇을 보장하나:
 *  - 지도 고정은 **옵트인**이다 — h05·h11만 켜고 숙소 등록 3 · 거점 확정 1 · 프리뷰 지도 1은 안 켠다.
 *  - 사진 도입이 **픽스처 안에서만** 끝났다 — 화면·계약 파일로 새지 않았다.
 *  - 프리뷰 픽스처가 **실재하는 로컬 파일**에서 사진을 얻고 외부 URL을 지어내지 않았다.
 *  - 프리뷰 h11 좌표가 **한 화면에 들어오는 간격**이다.
 *  - 지도 대본의 raw hex가 **팔레트 밖으로 벗어나지 않았다**(브리프 §8 ⑤ 사각지대).
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
 * **A. 영구 규칙** — S2(옵트인 경계) · S4(외부 URL 금지) · S7(색 팔레트)은 규칙이라 화면이 늘어도
 * 그대로 선다.
 * **B. 이행 체크포인트 — 한시적.** S3의 `DraftScreenProps` 필드 목록과 S6의 픽스처 상수 이름은
 * 이번 칸의 계약 스냅숏이라 정당한 리네임·필드 추가에 red를 낸다. **B 카운터 = 1**(2026-08-10
 * TRIP-298 이 `DraftScreenProps.demoted` 를 더하면서 S3가 red — 목록을 갱신했다). 정당한 작업이
 * 이 두 단언 때문에 red를 낸 것이 2회 누적되면 해당 단언만 뗀다.
 */

const ROOT = path.resolve('src');

/** 지도 고정을 **켜야 하는** 화면(h05·h11). */
const LOCKED_CALLERS = [
  'features/itinerary/ui/DraftScreen.tsx',
  'features/itinerary/ui/MustVisitPickerScreen.tsx',
];

/** 지도 고정을 **켜면 안 되는** 호출부. 앞의 넷은 지도를 움직여 좌표를 확정하는 것이 기능 자체라
 * 잠기면 저장할 방법이 사라지고, 프리뷰 단독 지도는 브리지가 조작 가능한지 보는 자리다
 * (사용자 결정 2026-08-10 — 고정 안 함). */
const OPEN_CALLERS = [
  'features/stay/ui/StayRegisterScreen.tsx',
  'features/trip/ui/TripBaseFixSheet.tsx',
  'app/_dev/preview.tsx',
];

/** 완성·확정 일정 화면(h25/h34 · TimelineScreen). **지도 호출부가 둘이다**(TRIP-354 · Q5 정정):
 *  ① **인라인 글랜스 지도**(기본 · 작은 것) — viewOnly **켠다**(잠긴 미리보기). "지도 크게 보기"가
 *     있는 이유가 인라인은 잠긴 글랜스라서다. connectPins 기본값(동선 선).
 *  ② **h26 확대 오버레이 지도**(제스처 탐색 · TRIP-301) — viewOnly **끈다**(D6: 제스처 + setMaxLevel).
 *     connectPins 기본값.
 * 한 파일에 **잠긴 태그와 안 잠긴 태그가 공존하는 첫 자리**라, 아래 S2가 파일이 아니라 **태그 단위로**
 * 둘을 각각 명시한다(AC-8: "새 지도 호출부가 생기면 사람이 잠금 여부를 명시"의 이행 자리). */
const EXPLORE_CALLERS = ['features/itinerary/ui/TimelineScreen.tsx'];
/** TimelineScreen 태그 분포 — 사람이 의도적으로 등재한다(그냥 통과시키기 금지). */
const ITINERARY_GLANCE_LOCKED_TAGS = 1; // 인라인 글랜스: viewOnly ON
const ITINERARY_EXPLORE_OPEN_TAGS = 1; // h26 확대: viewOnly OFF

/** 게이트①-2 — 연결선을 **끄는** 유일한 자리(h05). 나머지 여섯 태그는 아무 말도 하지 않고
 * 기본값(`connectPins` = 잇는다)을 받는다 — h11(일정 초안)이 그 여섯 안에 있다. */
const NO_LINE_CALLER = 'features/itinerary/ui/MustVisitPickerScreen.tsx';

const SCREEN_REL = 'features/itinerary/ui/DraftScreen.tsx';
const MAP_HTML_REL = 'shared/map/mapHtml.ts';
const PREVIEW_REL = 'app/_dev/preview.tsx';
const MAP_DIR_REL = 'shared/map';

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
 * 그 전제는 아래 S1 자가검사와 S2의 태그 총수 앵커가 함께 지킨다. */
const MAP_TAG = /<KakaoMapView\b[^>]*>/g;

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

/** `#abc` → `#AABBCC`, `#AABBCCDD` → `#AABBCC`. 자릿수 표기가 달라도 같은 색으로 비교한다. */
function normalizeHex(hex: string): string {
  const body = hex.slice(1).toUpperCase();
  if (body.length === 3) {
    return `#${body
      .split('')
      .map((char) => char + char)
      .join('')}`;
  }
  return `#${body.slice(0, 6)}`;
}

const HEX_LITERAL = /#[0-9a-fA-F]{3,8}\b/g;

describe('S1 · 조합 자가검사 — 전처리와 탐지기가 서로를 지우지 않는다', () => {
  it('주석 속 지문은 걷히고, 코드의 URL·프롭은 살아남으며, 태그 탐지기가 viewOnly 유무를 가른다', () => {
    const sample = [
      '/** 외부 URL 을 지어내지 않는다 — https://img.example.com/a.jpg 같은 값 금지. */',
      '// viewOnly 는 h05·h11 에만 켠다.',
      "const photo = 'https://cdn.example.com/a.png';",
      '<KakaoMapView',
      '  key={mapKey}',
      '  center={center}',
      '  pins={pins}',
      '  viewOnly',
      '/>',
      '<KakaoMapView center={c} />',
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
      .filter(({ source }) => source.includes('<KakaoMapView'))
      .map(({ file }) => file)
      .sort();

    // ① 도달 앵커 — 호출부가 통째로 이 심판 안에 있다. 새 호출부가 생기면 여기서 먼저 걸려
    //    "잠글 곳인가 아닌가"를 사람이 정하게 된다(모집단이 조용히 새는 것을 막는다). TimelineScreen
    //    은 지도 태그가 둘(글랜스+h26)이지만 **파일은 하나**라 이 파일 단위 열거에는 한 번만 온다 —
    //    잠금 여부는 아래 ④가 태그 단위로 가른다(Q5 · AC-8).
    expect(withTag).toEqual(
      [...LOCKED_CALLERS, ...OPEN_CALLERS, ...EXPLORE_CALLERS].sort()
    );

    // ② 잠글 두 화면 — 태그마다 viewOnly 가 있다.
    LOCKED_CALLERS.forEach((rel) => {
      const tags = mapTagsOf(readOne(rel));
      expect(tags.length).toBeGreaterThan(0);
      expect(tags.filter((tag) => /\bviewOnly\b/.test(tag))).toEqual(tags);
    });

    // ③ 열어 둘 다섯 자리 — 태그가 정확히 5개이고 그중 어느 것에도 viewOnly 가 없다.
    //    이 넷이 잠기면 지도를 움직여 좌표를 확정할 방법이 사라진다(회귀 금지).
    const openTags = OPEN_CALLERS.flatMap((rel) => mapTagsOf(readOne(rel)));
    expect(openTags).toHaveLength(5);
    expect(openTags.filter((tag) => /\bviewOnly\b/.test(tag))).toEqual([]);

    // ④ 완성·확정 일정 화면 — 지도 호출부가 **둘**이다(Q5). 파일이 아니라 **태그 단위로** 잠금
    //    여부를 사람이 명시한다: 인라인 글랜스는 viewOnly 를 **켜고**(잠긴 미리보기), h26 확대는
    //    **끈다**(제스처 탐색 · D6). 구현이 둘을 뒤바꾸거나(글랜스 열림 / h26 잠금) 태그 수가
    //    달라지면 여기서 red — "지도 크게 보기가 잠긴 글랜스를 여는" 설계가 회귀하는 것을 막는다.
    const itineraryTags = mapTagsOf(readOne(EXPLORE_CALLERS[0]));
    expect(itineraryTags).toHaveLength(
      ITINERARY_GLANCE_LOCKED_TAGS + ITINERARY_EXPLORE_OPEN_TAGS
    );
    const lockedGlance = itineraryTags.filter((tag) =>
      /\bviewOnly\b/.test(tag)
    );
    const openExplore = itineraryTags.filter(
      (tag) => !/\bviewOnly\b/.test(tag)
    );
    expect(lockedGlance).toHaveLength(ITINERARY_GLANCE_LOCKED_TAGS); // 잠긴 인라인 글랜스
    expect(openExplore).toHaveLength(ITINERARY_EXPLORE_OPEN_TAGS); // 제스처 h26 확대
  });
});

describe('S8 · h05 무선 — 연결선을 끄는 자리가 h05 하나뿐이다 (게이트①-2 추가분)', () => {
  /** 왜 소스 층인가 — **어느 호출부가 무엇을 말했나**는 여기서만 보인다. h05 태그에서
   * `connectPins={false}` 한 줄이 사라지면 "담은 순서"가 확정 동선처럼 선으로 그려지는데,
   * 대본 실행 층(X3·X7)은 `buildMapHtml`을 직접 부르지 화면을 거치지 않아 그 삭제가 안 보인다
   * (03b2 W2-1 뮤테이션 M3).
   *
   * 무엇을 보장하지 **못**하나: 태그에 적힌 **글자**까지다. 그 값이 컴포넌트를 통과해 실제 대본에
   * 닿는지는 이 층에서 볼 수 없다 — `KakaoMapView`가 그 프롭을 흘려도 여기는 초록이다.
   * 그 축은 실물 렌더 심판(`KakaoMapView.viewOnly.test.tsx` V3)이 잡는다. */
  it('h05 태그에만 connectPins={false} 가 있고 나머지 여덟은 기본값을 받는다', () => {
    const lineOffTags = mapTagsOf(readOne(NO_LINE_CALLER));
    const defaultTags = [
      ...LOCKED_CALLERS.filter((rel) => rel !== NO_LINE_CALLER),
      ...OPEN_CALLERS,
      // TRIP-301/354 완성·확정 일정 지도도 동선 선을 그린다 — 핀 번호가 솔버 확정 순서라 선이
      // 사실이다(h11 과 같은 부류). TimelineScreen 은 태그가 둘(인라인 글랜스 + h26 확대)인데
      // **둘 다** connectPins 를 무언급 = 기본값(잇는다)으로 둔다.
      ...EXPLORE_CALLERS,
    ].flatMap((rel) => mapTagsOf(readOne(rel)));

    // ① 도달 앵커 — 태그를 진짜로 떼어냈다(h05 1개 + 나머지 8개 = 총 9개).
    //    Q5 로 TimelineScreen 이 지도 태그 2개(글랜스+h26)를 가지며 둘 다 기본값이라 나머지가
    //    6→8개로 늘었다(설계된 갱신 · AC-8).
    expect(lineOffTags).toHaveLength(1);
    expect(defaultTags).toHaveLength(8);

    // ② 끄는 자리는 h05 하나뿐이고, 끈다고 **명시**한다.
    expect(lineOffTags[0]).toMatch(/\bconnectPins=\{false\}/);

    // ③ 나머지 여덟은 아무 말도 하지 않는다 = 기본값(잇는다)을 받는다. h11·인라인 글랜스·h26이
    //    여기 있다 — 이 심판이 요구하는 것은 "끄지 않았다"이고, 기본값이 정말 잇는지는 X3이 잰다.
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
  it('MapPin 은 3필드 그대로, DraftScreenProps 는 10필드 그대로, 화면에 에셋 해석 지문이 0건이다', () => {
    const mapHtmlSource = readOne(MAP_HTML_REL);
    const screenSource = readOne(SCREEN_REL);

    // 도달 앵커 — 읽은 것이 정말 그 파일들이다.
    expect(mapHtmlSource).toContain('export function buildMapHtml');
    expect(screenSource).toMatch(/export function DraftScreen\b/);

    // 지도 계약은 이 칸에서 늘지 않는다 — 핀 모양이 바뀌어도 `MapPin` 은 그대로다.
    expect(interfaceFields(mapHtmlSource, 'MapPin')).toEqual([
      'number',
      'lat',
      'lng',
    ]);
    // 화면 계약도 그대로 — 사진을 넣으려고 프롭을 늘리면 여기서 걸린다.
    expect(interfaceFields(screenSource, 'DraftScreenProps')).toEqual([
      'view',
      'tabs',
      'selectedDate',
      'pins',
      'dayHeader',
      'canRetry',
      // TRIP-298 이 더한 후보 강등 안내 스위치. 이 칸(TRIP-339)이 막으려던 것은 "사진을
      // 넣으려고 프롭이 느는 것"이고, 이것은 다른 사이클의 승인된 계약이다(02a §2.2).
      'demoted',
      'onSelectDay',
      'onRetry',
      'onBack',
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

describe('S7 · 브랜드 색 사각지대 — 지도 대본의 raw hex가 팔레트 안 값이다 (선제 green)', () => {
  /**
   * 브리프 §8 ⑤ — `shared/map` 의 raw hex는 **어느 색 가드 모집단에도 없다**.
   * `itineraryMustVisitStructure` 계열은 `features/*` 만 보고, `mapBridgeStructure` 가
   * `shared/map` 을 훑기는 하지만 잡는 것은 32자리 API 키 형태이지 색이 아니다.
   *
   * "raw hex 0건" 으로는 만들 수 없다 — WebView HTML에는 NativeWind가 닿지 않아 raw가
   * 불가피하고, 그 심판은 어떤 구현으로도 통과 불가다. 대신 **팔레트 밖 색을 금지**한다:
   * 브랜드 색을 tailwind 에서 바꾸면 지도 대본만 옛 값으로 남는 순간 red 가 난다.
   */
  it('tailwind 팔레트 밖 hex가 0건이고, primary·on-primary 가 실제로 쓰인다', () => {
    const tailwind = fs.readFileSync(
      path.resolve('tailwind.config.js'),
      'utf8'
    );
    const palette = new Set(
      [...tailwind.matchAll(/'(#[0-9a-fA-F]{3,8})'/g)].map((match) =>
        normalizeHex(match[1])
      )
    );
    const primary = /primary:\s*'(#[0-9a-fA-F]{3,8})'/.exec(tailwind);
    const onPrimary = /'on-primary':\s*'(#[0-9a-fA-F]{3,8})'/.exec(tailwind);

    // 도달 앵커 — 팔레트를 실제로 읽었다.
    expect(palette.size).toBeGreaterThan(10);
    expect(primary).not.toBeNull();
    expect(onPrimary).not.toBeNull();

    const mapSources = listSourceFiles(path.join(ROOT, MAP_DIR_REL)).map(
      (full) => ({ file: relOf(full), source: readOne(relOf(full)) })
    );
    // 도달 앵커 — 대본 파일이 모집단에 있다.
    expect(mapSources.map((entry) => entry.file)).toContain(MAP_HTML_REL);

    const used = new Set(
      mapSources.flatMap(({ source }) =>
        (source.match(HEX_LITERAL) ?? []).map(normalizeHex)
      )
    );

    // ① 팔레트 밖 색이 없다.
    expect([...used].filter((hex) => !palette.has(hex)).sort()).toEqual([]);
    // ② 짝 — 스캔이 실제로 무언가를 봤다. 핀·선이 쓰는 두 색이 그대로 있다.
    expect(used.has(normalizeHex(primary?.[1] ?? ''))).toBe(true);
    expect(used.has(normalizeHex(onPrimary?.[1] ?? ''))).toBe(true);
  });
});
