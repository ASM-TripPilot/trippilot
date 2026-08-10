import {
  buildMapHtml,
  MAP_LOAD_FAILED_MESSAGE,
  type MapCenter,
  type MapPin,
} from './mapHtml';

/**
 * X0~X6 (TRIP-339 · AC-1·3·4′·5·9·12·13·15·16·19·20) — 조립된 대본을 **가짜 카카오 SDK 위에서
 * 실제로 한 번 실행하고**, 그 대본이 무엇을 만들었는지 센다.
 *
 * 왜 문자열 검사가 아닌가(02a ★5): 이번 칸에서 분홍 `#FF385C`가 대본 안 네 곳(핀 채움·핀 테두리
 * 짝·선 케이싱·선 본선)으로 늘어난다. "문서 어딘가에 `#FF385C`가 있다"는 단언은 **핀은 여전히
 * 동그라미인데 선만 분홍으로 그린 구현**을 그대로 통과시킨다. 조각별로 재려면 조각이 만들어지는
 * 것을 봐야 한다.
 *
 * 무엇을 보장하지 **못**하나: 이 층은 "대본이 SDK에 무엇을 시켰나"까지다. 그 지시가 브라우저에서
 * 물방울로 그려지는지 · 선 굵기가 눈에 보이는지 · 드래그가 실제로 막히는지 · 픽셀 일치율은
 * 전부 6-b 실기 몫이다(브리프 §5 R1~R9).
 *
 * `new Function(...)`은 기존 M-8(`mapHtml.test.ts`)이 문법만 재던 것과 같은 도구다 — 실행하면
 * 파싱은 자동으로 포함되므로 AC-9의 새 갈래(선 든 형태·`viewOnly` 형태)도 X0이 함께 덮는다.
 * 그래서 이 칸은 **승인 동결분을 한 글자도 열지 않는다**(02a §3-2).
 */

/** `viewOnly`는 이 칸에서 새로 생기는 5번째 인자라 아직 타입에 없다. TS는 **인자가 적은 함수를
 * 인자가 많은 함수 타입에 대입할 수 있으므로**(파라미터 반공변) 캐스트 없이 넓힐 수 있다 —
 * 구현 전에도 후에도 컴파일되고, 구현 후 이 별칭이 곧 실제 시그니처가 된다(02a ★8). */
type BuildMapHtmlWithViewOnly = (
  center: MapCenter,
  jsKey: string,
  enablePin?: boolean,
  pins?: MapPin[],
  viewOnly?: boolean
) => string;

const build: BuildMapHtmlWithViewOnly = buildMapHtml;

const CENTER: MapCenter = { lat: 33.4996, lng: 126.5312 };
const JS_KEY = 'test-js-key';

/** 제주 시내 3점 — 이 파일은 좌표의 현실성을 재지 않는다(그것은 AC-17·S6 몫). */
const PINS_3: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52 },
  { number: 3, lat: 33.515, lng: 126.526 },
  { number: 4, lat: 33.52, lng: 126.531 },
];

/** AC-20 — 2·3번 핀의 좌표가 **완전히 같다**. 인터뷰 ③이 "건너뛰지 않는다"로 확정한 갈래라
 * 길이 0 세그먼트가 선분 목록에 그대로 남아야 한다. */
const PINS_WITH_DUPLICATE: MapPin[] = [
  { number: 1, lat: 33.51, lng: 126.52 },
  { number: 2, lat: 33.515, lng: 126.526 },
  { number: 3, lat: 33.515, lng: 126.526 },
  { number: 4, lat: 33.52, lng: 126.531 },
];

// ── 가짜 카카오 SDK ────────────────────────────────────────────────────────────

interface Point {
  lat: number;
  lng: number;
}

interface OverlayRecord {
  content: string;
  yAnchor: unknown;
  position: Point | null;
}

interface PolylineRecord {
  /** 문자열·숫자·불리언 옵션만 — 색·굵기가 여기 있다. `path`는 아래 필드로 따로 뽑는다. */
  scalars: Record<string, string | number | boolean>;
  path: Point[];
}

interface MapScriptLog {
  overlays: OverlayRecord[];
  polylines: PolylineRecord[];
  mapOptions: Record<string, unknown>;
  /** 지도 인스턴스에 불린 메서드 전부 — `setBounds`도, 폴백 경로의 `setDraggable(false)`도 여기 남는다. */
  mapCalls: { name: string; args: unknown[] }[];
  /** `MAP_LOAD_FAILED_MESSAGE`가 여기 들어오면 대본이 중간에 터졌다는 뜻이다(INV-4 통로). */
  posts: string[];
  /** 이 하네스가 만들지 않은 카카오 API를 대본이 불렀다면 이름이 남는다 — 안쪽 try/catch가
   * 삼켜서 조용해지는 것을 막는 진단 통로다. */
  unknownApis: string[];
}

class FakeLatLng {
  constructor(
    readonly lat: number,
    readonly lng: number
  ) {}
  getLat(): number {
    return this.lat;
  }
  getLng(): number {
    return this.lng;
  }
}

class FakeLatLngBounds {
  extended = 0;
  extend(): void {
    this.extended += 1;
  }
}

function toPoint(value: unknown): Point | null {
  return value instanceof FakeLatLng
    ? { lat: value.lat, lng: value.lng }
    : null;
}

function scalarsOf(
  options: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  Object.entries(options).forEach(([key, value]) => {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    }
  });
  return out;
}

/** 우리가 안 만든 API를 대본이 부를 때 돌려주는 허용 스텁 — 무엇을 하든 터지지 않는다.
 * 터지면 대본의 안쪽 catch가 삼켜서 "왜 아무것도 안 만들어졌나"가 안 보인다. */
function anyStub(): unknown {
  const fn = function (): unknown {
    return anyStub();
  };
  return new Proxy(fn, {
    get: (_target, prop) => (typeof prop === 'string' ? anyStub() : undefined),
    apply: () => anyStub(),
    construct: () => anyStub() as object,
  });
}

function runMapScript(html: string): MapScriptLog {
  const open = html.lastIndexOf('<script>');
  const close = html.lastIndexOf('</script>');
  const source = html.slice(open + '<script>'.length, close);

  const log: MapScriptLog = {
    overlays: [],
    polylines: [],
    mapOptions: {},
    mapCalls: [],
    posts: [],
    unknownApis: [],
  };

  class FakeMap {
    constructor(_element: unknown, options: Record<string, unknown>) {
      log.mapOptions = options;
      return new Proxy(this, {
        get(target, prop) {
          if (typeof prop !== 'string') return undefined;
          // 화면 픽셀→좌표 변환만 실제 객체가 필요하다(롱프레스 대본이 잡는다).
          if (prop === 'getProjection') {
            return () => ({
              coordsFromContainerPoint: () => new FakeLatLng(0, 0),
            });
          }
          void target;
          return (...args: unknown[]) => {
            log.mapCalls.push({ name: prop, args });
          };
        },
      });
    }
  }

  class FakeCustomOverlay {
    constructor(options: Record<string, unknown>) {
      log.overlays.push({
        content: String(options.content ?? ''),
        yAnchor: options.yAnchor,
        position: toPoint(options.position),
      });
    }
    setMap(): void {
      /* 얹는 대상은 이 하네스가 구분하지 않는다 — 생성 자체가 기록이다. */
    }
  }

  class FakePolyline {
    constructor(options: Record<string, unknown>) {
      const rawPath = Array.isArray(options.path) ? options.path : [];
      log.polylines.push({
        scalars: scalarsOf(options),
        path: rawPath
          .map(toPoint)
          .filter((point): point is Point => point !== null),
      });
    }
    setMap(): void {
      /* 위와 같다. */
    }
  }

  class FakeMarker {
    setMap(): void {
      /* 롱프레스 핀 — 이 칸의 관심사가 아니다. */
    }
    setPosition(): void {
      /* 위와 같다. */
    }
  }

  const known: Record<string, unknown> = {
    load: (callback: () => void) => callback(),
    LatLng: FakeLatLng,
    LatLngBounds: FakeLatLngBounds,
    Map: FakeMap,
    CustomOverlay: FakeCustomOverlay,
    Polyline: FakePolyline,
    Marker: FakeMarker,
    Point: class {},
    services: {
      Geocoder: class {
        coord2Address(): void {
          /* 역지오코딩은 사용자 조작 뒤에만 불린다 — 로드 시점에는 안 온다. */
        }
      },
      Status: { OK: 'OK' },
    },
  };

  const maps = new Proxy(known, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop in target) return target[prop];
      log.unknownApis.push(prop);
      return anyStub();
    },
  });

  const fakeDocument = {
    getElementById: () => ({
      addEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    }),
  };
  const fakeWindow = {
    ReactNativeWebView: {
      postMessage: (message: string) => log.posts.push(message),
    },
  };

  const run = new Function('kakao', 'document', 'window', source) as (
    kakao: unknown,
    document: unknown,
    window: unknown
  ) => void;
  run({ maps }, fakeDocument, fakeWindow);

  return log;
}

// ── 판정 도구 ─────────────────────────────────────────────────────────────────

/** AC-4′가 요구하는 핀 그림 조각의 요소들. 각 항목은 **못 지킨 것만** 이름으로 남는다 —
 * 실패했을 때 diff에 "무엇이 빠졌나"가 그대로 찍힌다.
 *
 * 숫자 단언에 `\b`를 쓰지 않는다: `28px`·`13px`·`1.5px`에서는 숫자와 `p`가 둘 다 단어문자라
 * 경계가 서지 않아 `\b28\b`가 매치되지 않는다(리포 실측 함정). 앞뒤가 **숫자가 아님**으로 잰다. */
const PIN_SHAPE_REQUIREMENTS: {
  id: string;
  ok: (content: string) => boolean;
}[] = [
  { id: 'svg', ok: (c) => /<svg\b/i.test(c) },
  {
    id: 'path-curve',
    ok: (c) => {
      const match = /<path[^>]*\bd\s*=\s*"([^"]{20,})"/i.exec(c);
      return match !== null && /[Cc]/.test(match[1]);
    },
  },
  { id: 'fill-primary', ok: (c) => /fill\s*[:=]\s*"?\s*#ff385c\b/i.test(c) },
  {
    id: 'stroke-white',
    ok: (c) => /stroke\s*[:=]\s*"?\s*(white|#fff|#ffffff)\b/i.test(c),
  },
  {
    id: 'stroke-width-2',
    ok: (c) => /stroke-width\s*[:=]\s*"?\s*2(?![\d.])/i.test(c),
  },
  {
    id: 'width-28',
    ok: (c) => /(width|viewbox)\s*[:=]\s*"?[^;"]*(?<!\d)28(?!\d)/i.test(c),
  },
  {
    id: 'height-36',
    ok: (c) => /(height|viewbox)\s*[:=]\s*"?[^;"]*(?<!\d)36(?!\d)/i.test(c),
  },
  {
    id: 'shadow',
    ok: (c) =>
      /drop-shadow|fedropshadow|box-shadow/i.test(c) &&
      /(?<!\d)1\.5(?!\d)/.test(c) &&
      /(?<!\d)0\.2(?!\d)|20\s*%/.test(c),
  },
  {
    id: 'number-white',
    ok: (c) => /(fill|color)\s*[:=]\s*"?\s*(white|#fff|#ffffff)\b/i.test(c),
  },
  {
    id: 'label-13-bold',
    ok: (c) => /(?<!\d)13(?!\d)/.test(c) && /\b(700|bold)\b/i.test(c),
  },
];

function pinShapeFindings(content: string): string[] {
  return PIN_SHAPE_REQUIREMENTS.filter((req) => !req.ok(content)).map(
    (req) => req.id
  );
}

/** 현행(TRIP-297) 핀 — 26px 단색 원. X1의 탐지기 자가검사에 쓴다. */
const CURRENT_CIRCLE_PIN =
  '<div style="width:26px;height:26px;border-radius:13px;background:#FF385C;' +
  'color:#FFFFFF;font:700 13px sans-serif;display:flex;align-items:center;' +
  'justify-content:center;">1</div>';

/** Figma `1870:1117` 실측 형태의 합성 표본 — 요구 목록이 실제로 충족 가능함을 증명한다.
 * 구현이 이 문자열과 같아야 한다는 뜻이 **아니다**(치수·배치는 구현 자유). */
const FIGMA_SHAPED_PIN =
  '<svg width="28" height="36" viewBox="0 0 34 40" ' +
  'style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.2))">' +
  '<path d="M17 3C9.8 3 4 8.5 4 15.5C4 24 17 37 17 37C17 37 30 24 30 15.5C30 8.5 24.2 3 17 3Z" ' +
  'fill="#FF385C" stroke="white" stroke-width="2"/>' +
  '<text x="17" y="19" text-anchor="middle" fill="#FFFFFF" font-weight="700" font-size="13">1</text>' +
  '</svg>';

const WHITE_VALUE = /^(white|#fff|#ffffff)$/i;
const PRIMARY_VALUE = /^#ff385c$/i;

function hasColor(record: PolylineRecord, pattern: RegExp): boolean {
  return Object.values(record.scalars).some(
    (value) => typeof value === 'string' && pattern.test(value.trim())
  );
}

function hasWeight(record: PolylineRecord, weight: number): boolean {
  return Object.values(record.scalars).some((value) => value === weight);
}

function pointKey(point: Point): string {
  return `${point.lat},${point.lng}`;
}

/** 폴리라인들이 실제로 그은 **선분 목록**. 겹당 폴리라인 1개(전체 경로)든 구간마다 2개든
 * 같은 목록이 나오므로 구현 형태를 못박지 않는다(02a ★7). */
function segmentsOf(records: PolylineRecord[]): string[] {
  return records.flatMap((record) =>
    record.path
      .slice(1)
      .map(
        (point, index) => `${pointKey(record.path[index])}->${pointKey(point)}`
      )
  );
}

/** 핀 배열이 요구하는 인접 쌍. 중복 좌표는 `A->A` 로 그대로 남는다(AC-20). */
function expectedSegments(pins: MapPin[]): string[] {
  return pins
    .slice(1)
    .map((pin, index) => `${pointKey(pins[index])}->${pointKey(pin)}`);
}

/** 지도 조작을 가리키는 이름 어휘. 옵션 이름도 메서드 이름도 이 어휘로 잰다 — 카카오가
 * `draggable:false`로 받든 `disableDoubleClickZoom:true`로 받든 `setDraggable(false)`로 받든
 * 하나에 못박으면 정당한 구현이 죽는다(02a ★9). */
const GESTURE_WORD = /drag|zoom|doubleclick|double_click|wheel|scroll/i;
const NEGATIVE_NAME = /disable|prevent|lock/i;

function gestureOptionKeys(log: MapScriptLog): string[] {
  return Object.keys(log.mapOptions).filter((key) => GESTURE_WORD.test(key));
}

/** 실제로 **막는** 지시만 모은다. `disable…: true` 와 `…able: false` 는 같은 뜻이고
 * `setDraggable(false)` 도 같은 뜻이다. */
function blockedGestures(log: MapScriptLog): string[] {
  const fromOptions = Object.entries(log.mapOptions)
    .filter(([key, value]) =>
      !GESTURE_WORD.test(key)
        ? false
        : NEGATIVE_NAME.test(key)
          ? value === true
          : value === false
    )
    .map(([key]) => key);
  const fromCalls = log.mapCalls
    .filter((call) => GESTURE_WORD.test(call.name) && call.args[0] === false)
    .map((call) => call.name);
  return [...fromOptions, ...fromCalls];
}

function countCalls(log: MapScriptLog, name: string): number {
  return log.mapCalls.filter((call) => call.name === name).length;
}

// ── 케이스 ────────────────────────────────────────────────────────────────────

describe('X0 · 도달 앵커 — 대본이 가짜 SDK 위에서 끝까지 돈다 (AC-9 · INV-4)', () => {
  /** 이 케이스가 깨지면 아래 전부가 "아무것도 안 보면서 통과"가 된다. 실행이 곧 파싱이라
   * 문법 회귀도 여기서 잡힌다 — 파싱 실패는 WebView 안에서 스크립트가 아예 실행되지 않는
   * 것이라 실패 표면조차 안 뜬다(M-8이 세운 판단). */
  const CASES: { label: string; html: string; pins: number }[] = [
    { label: '핀 0개', html: build(CENTER, JS_KEY, false), pins: 0 },
    {
      label: '핀 1개',
      html: build(CENTER, JS_KEY, true, [PINS_3[0]]),
      pins: 1,
    },
    { label: '핀 3개', html: build(CENTER, JS_KEY, true, PINS_3), pins: 3 },
    {
      label: '핀 3개 · viewOnly 켬',
      html: build(CENTER, JS_KEY, true, PINS_3, true),
      pins: 3,
    },
    {
      label: '핀 4개(중복 좌표 포함)',
      html: build(CENTER, JS_KEY, true, PINS_WITH_DUPLICATE),
      pins: 4,
    },
  ];

  it.each(CASES)(
    '$label — 실패 표식 0건 · 미스텁 API 0건 · 핀 개수가 입력과 같다',
    ({ html, pins }) => {
      const log = runMapScript(html);

      // 대본이 중간에 터지면 안쪽 catch가 이 표식을 올린다 — 조용한 실패를 막는 앵커.
      expect(log.posts).toEqual([]);
      expect(log.posts).not.toContain(MAP_LOAD_FAILED_MESSAGE);
      // 우리가 안 만든 카카오 API를 부르면 이름이 남는다(하네스가 낡았다는 신호).
      expect(log.unknownApis).toEqual([]);
      // 지도 자체는 언제나 하나 생긴다.
      expect(Object.keys(log.mapOptions)).toContain('center');
      expect(log.overlays).toHaveLength(pins);
    }
  );
});

describe('🔴 X1 · AC-4′ — 핀 대본에 물방울 SVG path·분홍 채움·흰 2px 테두리·28×36·그림자가 실린다', () => {
  /** 이름 그대로만 잰다: **대본에 무엇이 적혀 있나**. "물방울로 보이나"·"테두리가 눈에 띄나"는
   * 브라우저 렌더 결과라 6-b 실기(R1·R2) 몫이다.
   *
   * `<svg>`를 요구하는 것은 의도적 계약이다 — CSS 회전 트릭으로도 물방울 실루엣은 되지만
   * 흰 2px 테두리가 원과 꼬리의 **이음매에서 끊긴다**. Figma가 한 도형의 한 `path`로 export한
   * 이유가 그것이다(02a §7-3). */
  it('핀마다 요구 요소가 전부 있고 핀 번호가 그 조각 안에 있다', () => {
    const log = runMapScript(build(CENTER, JS_KEY, true, PINS_3));

    // 도달 앵커 — 핀 조각을 진짜로 읽었다.
    expect(log.overlays).toHaveLength(PINS_3.length);
    expect(log.overlays[0].content.length).toBeGreaterThan(20);

    log.overlays.forEach((overlay, index) => {
      expect(pinShapeFindings(overlay.content)).toEqual([]);
      // 번호는 지도가 정하지 않는다 — 호출부가 준 값을 그대로 그린다(①③④로 뛴다).
      expect(overlay.content).toContain(String(PINS_3[index].number));
    });
  });

  it('탐지기 자가검사 — 현행 원형 핀은 잡히고, Figma 형태 표본은 통과한다', () => {
    // 지금 구현(26px 단색 원)이 통과하면 이 케이스는 아무것도 요구하지 않는 셈이다.
    expect(pinShapeFindings(CURRENT_CIRCLE_PIN)).toEqual(
      expect.arrayContaining([
        'svg',
        'path-curve',
        'stroke-white',
        'stroke-width-2',
        'width-28',
        'height-36',
        'shadow',
      ])
    );
    // 반대 방향 — 요구 목록이 충족 **가능**하다. 이게 없으면 통과 불가 심판일 수 있다.
    expect(pinShapeFindings(FIGMA_SHAPED_PIN)).toEqual([]);
  });
});

describe('🔴 X2 · AC-5 — 핀 앵커가 꼬리 끝 기준이다 (yAnchor 1)', () => {
  /** `yAnchor`는 지도에 얹은 조각의 어느 세로 지점이 좌표에 붙는지다(0=위끝, 1=아래끝).
   * 물방울은 꼬리 끝이 좌표를 가리켜야 하므로 1이다. 이 값이 0.5로 남으면 꼬리를 붙인 만큼
   * 핀 전체가 반 칸 위로 어긋난다 — 그 어긋남 자체는 실기(R3)에서만 보인다. */
  it('모든 핀의 yAnchor가 1이고 좌표는 입력 그대로다', () => {
    const log = runMapScript(build(CENTER, JS_KEY, true, PINS_3));

    expect(log.overlays).toHaveLength(PINS_3.length);
    log.overlays.forEach((overlay, index) => {
      expect(overlay.yAnchor).toBe(1);
      // 짝 — 앵커를 바꾸면서 좌표를 잃지 않았다.
      expect(overlay.position).toEqual({
        lat: PINS_3[index].lat,
        lng: PINS_3[index].lng,
      });
    });
  });
});

describe('🔴 X3 · AC-1 · AC-15 · AC-20 — 선이 2겹이고 핀 인접 쌍을 빠짐없이 잇는다', () => {
  /** 케이싱(casing): 지도 위에 색 하나로만 선을 그으면 비슷한 색 도로·물 위에서 선이 사라진다.
   * 그래서 굵은 밝은 선을 먼저 깔고 그 위에 얇은 색 선을 얹는다 — Figma가 4구간을 8노드로
   * 그린 이유다. 한 겹만 그리면 Figma와 다르게 보인다.
   *
   * 선 끝 마감(`round`)은 여기서 **재지 않는다** — 카카오 `Polyline`에 그 옵션이 있는지
   * 확인할 수단이 리포에 없어(사용 0건), 단언하면 어떤 구현으로도 통과 불가가 될 수 있다.
   * 마감은 6-b 실기(R2) 몫이다(02a §3-6). */
  it('흰 6px 케이싱이 먼저 깔리고 분홍 2.8px 본선이 위에 얹히며, 중복 좌표 구간도 안 빠진다', () => {
    const log = runMapScript(build(CENTER, JS_KEY, true, PINS_WITH_DUPLICATE));

    // 도달 앵커 — 핀은 그대로 4개다(선을 넣으면서 핀을 잃지 않았다).
    expect(log.overlays).toHaveLength(PINS_WITH_DUPLICATE.length);

    const casing = log.polylines.filter((line) => hasColor(line, WHITE_VALUE));
    const main = log.polylines.filter((line) => hasColor(line, PRIMARY_VALUE));

    // ① 두 겹이 다 있다.
    expect(casing.length).toBeGreaterThan(0);
    expect(main.length).toBeGreaterThan(0);

    // ② 굵기가 겹마다 다르다. 옵션 이름을 못박지 않고 값으로 잰다.
    expect(casing.every((line) => hasWeight(line, 6))).toBe(true);
    expect(main.every((line) => hasWeight(line, 2.8))).toBe(true);

    // ③ 흰 선이 **먼저** 만들어진다 = 아래에 깔린다. 순서가 뒤집히면 케이싱이 본선을 덮는다.
    expect(hasColor(log.polylines[0], WHITE_VALUE)).toBe(true);

    // ④ 두 겹 모두 핀 인접 쌍을 그대로 잇는다. 중복 좌표(2·3번)는 길이 0 세그먼트로
    //    목록에 남아야 한다 — 인터뷰 ③이 "건너뛰지 않는다"로 확정했다.
    const expected = expectedSegments(PINS_WITH_DUPLICATE);
    expect(expected).toHaveLength(3);
    expect(segmentsOf(casing)).toEqual(expected);
    expect(segmentsOf(main)).toEqual(expected);
  });

  it('핀 3개면 구간이 2개다 (전결합이 아니라 인접 쌍만)', () => {
    const log = runMapScript(build(CENTER, JS_KEY, true, PINS_3));
    const main = log.polylines.filter((line) => hasColor(line, PRIMARY_VALUE));

    expect(main.length).toBeGreaterThan(0);
    expect(segmentsOf(main)).toEqual(expectedSegments(PINS_3));
    expect(segmentsOf(main)).toHaveLength(2);
  });
});

describe('X4 · AC-3 — 핀이 하나거나 없으면 선을 그리지 않는다 (선제 green · 부정 짝)', () => {
  it('핀 1개면 선 0개이고 setBounds도 부르지 않는다', () => {
    const log = runMapScript(build(CENTER, JS_KEY, true, [PINS_3[0]]));

    // 도달 앵커 — 핀은 그려졌다.
    expect(log.overlays).toHaveLength(1);
    expect(log.polylines).toEqual([]);
    // 현행 방어 무회귀 — 한 점짜리 bounds는 넓이가 0이라 최대 배율로 튄다.
    expect(countCalls(log, 'setBounds')).toBe(0);
  });

  it('핀이 없으면 핀도 선도 없다', () => {
    const log = runMapScript(build(CENTER, JS_KEY, true, []));

    expect(log.overlays).toEqual([]);
    expect(log.polylines).toEqual([]);
    expect(countCalls(log, 'setBounds')).toBe(0);
  });
});

describe('X5 · AC-13 · AC-16 — 고정을 안 켠 대본에는 조작 차단이 없다 (선제 green · 옵트인 무회귀)', () => {
  /** 이 부정 짝이 무너지면 숙소 등록 3곳·거점 확정 1곳에서 좌표를 확정할 방법이 사라진다.
   * 그 실패는 실기에서만 보이므로(R4) 여기서 기본값을 잠근다. */
  it.each([
    ['viewOnly 인자 자체를 안 넘긴 형태', build(CENTER, JS_KEY, true, PINS_3)],
    [
      'viewOnly=false 를 명시한 형태',
      build(CENTER, JS_KEY, true, PINS_3, false),
    ],
    [
      '핀도 안 받는 지도(검색 미리보기·확정 시트)',
      build(CENTER, JS_KEY, false),
    ],
  ])('%s — 조작 관련 옵션·메서드가 하나도 없다', (_label, html) => {
    const log = runMapScript(html);

    // 도달 앵커 — 지도 생성 옵션을 진짜로 읽었다.
    expect(Object.keys(log.mapOptions)).toEqual(
      expect.arrayContaining(['center', 'level'])
    );

    expect(gestureOptionKeys(log)).toEqual([]);
    expect(blockedGestures(log)).toEqual([]);
  });
});

describe('🔴 X6 · AC-12 · AC-19 — 고정을 켜면 제스처만 막고 카메라 이동은 통과한다', () => {
  /** Seed ①의 확정 — 프롭의 목적은 "보여주기 전용"이지 "카메라 동결"이 아니다. 완전 고정이면
   * 핀 묶음이 화면에 안 맞춰져 지도가 쓸모없어진다. 카카오가 실제로 그렇게 동작하는지는
   * 실기(R4·R5) 몫이고, 여기서는 **대본이 무엇을 시켰나**까지 잰다. */
  it('드래그 계열과 줌 계열을 둘 다 막고, setBounds는 여전히 부른다', () => {
    const log = runMapScript(build(CENTER, JS_KEY, true, PINS_3, true));

    const blocked = blockedGestures(log);

    // ① 도달 앵커 — 무엇이든 막긴 막았다(실패 시 diff에 실제 목록이 찍힌다).
    expect(blocked.length).toBeGreaterThanOrEqual(2);
    // ② 드래그와 줌을 각각 막는다. 이름은 못박지 않는다(옵션이든 setter든).
    expect(blocked.some((name) => /drag/i.test(name))).toBe(true);
    expect(blocked.some((name) => /zoom|doubleclick|wheel/i.test(name))).toBe(
      true
    );
    // ③ 프로그램 카메라 이동은 살아 있다 — 이게 막히면 핀 묶음이 화면에 안 맞는다.
    expect(countCalls(log, 'setBounds')).toBe(1);
    // ④ 고정이 핀·선을 갉아먹지 않았다.
    expect(log.overlays).toHaveLength(PINS_3.length);
    expect(log.polylines.length).toBeGreaterThan(0);
  });
});

// ── 게이트①-2 추가분 (2026-08-10) ─────────────────────────────────────────────

/** `connectPins`는 구현 수정 루프에서 생긴 **6번째** 위치 인자다(기본 `true` = 핀을 잇는다).
 * 위 `build` 별칭이 5인자까지만 선언해서 **`connectPins=false` 상태에 들어가는 통로가 아예
 * 없었고**, 그래서 그 갈래를 망가뜨리는 뮤테이션이 전수 green이었다(03b2 W2-1).
 * 기존 별칭·기존 케이스는 한 글자도 고치지 않고 6인자 별칭을 하나 더 둔다. */
type BuildMapHtmlWithConnectPins = (
  center: MapCenter,
  jsKey: string,
  enablePin?: boolean,
  pins?: MapPin[],
  viewOnly?: boolean,
  connectPins?: boolean
) => string;

const build6: BuildMapHtmlWithConnectPins = buildMapHtml;

describe('X7 · AC-1(h05 예외) — 선을 꺼도 지도는 핀 묶음에 맞춘다 (게이트①-2 추가분)', () => {
  /** `connectPins`는 **선만** 끄는 스위치다. 핀 묶음 맞추기(`setBounds`)까지 함께 꺼지면 h05
   * 지도가 초기 배율·초기 중심에 머물러, 담은 장소가 화면 밖에 있으면 지도 카드가 엉뚱한 데를
   * 비춘다. 그 실패는 **대본 문자열을 눈으로 읽어서는 안 보인다** — 문자열에는 `Polyline`도
   * `setBounds`도 그대로 실려 있고 갈리는 것은 `linkPins`의 **실행 조건**뿐이라서다. 조각이
   * 실제로 만들어지는 것을 세는 이 층에서만 보인다.
   *
   * 무엇을 보장하지 **못**하나: 여기서 재는 것은 "대본이 SDK에 무엇을 시켰나"까지다. h05 화면이
   * 실제로 이 인자를 넘기는지는 소스 층(S8)이 재고, 눈으로 선이 없는지는 6-b 실기(R9) 몫이다.
   *
   * 기본값이 `true`라는 부정 짝은 이미 X3에 있다 — X3은 6번째 인자를 안 넘기고 부르므로 그 케이스가
   * 재는 값이 곧 기본값이다. 그래서 여기서 다시 세우지 않는다. */
  it('connectPins=false 면 선이 0개인데 setBounds는 여전히 1회이고 핀은 그대로다', () => {
    const log = runMapScript(
      build6(CENTER, JS_KEY, true, PINS_3, false, false)
    );

    // ① 도달 앵커 — 선을 끄면서 핀을 잃지 않았다(핀까지 사라지면 지도가 빈 카드가 된다).
    expect(log.overlays).toHaveLength(PINS_3.length);
    // ② 선이 하나도 안 그려진다 — h05의 핀 번호는 사용자가 **담은 순서**이지 돌아볼 순서가 아니다.
    expect(log.polylines).toEqual([]);
    // ③ 그런데 카메라는 여전히 핀 묶음에 맞춘다. 선과 `setBounds`를 한 조건에 묶으면 여기서 0이 된다.
    expect(countCalls(log, 'setBounds')).toBe(1);
  });
});
