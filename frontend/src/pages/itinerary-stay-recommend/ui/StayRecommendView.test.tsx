import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

// 뷰모델 타입과 뷰 컴포넌트가 같은 이름이라 타입 쪽을 별칭으로 들인다.
import type {
  StayRecommendCandidate,
  StayRecommendView as StayRecommendViewModel,
} from '@/features/itinerary/model/stayRecommend';
import type { MapPin } from '@/shared/map';

import { StayRecommendView } from './StayRecommendView';

/**
 * TRIP-800 · h15 동선 기준 숙소 추천 pages 순수 뷰(`StayRecommendView`, presentation-only) — AC-1~7 · AC-12 · INV-3.
 *
 * 왜 pages 층인가(02a D12 · ★21): 이 뷰는 지도+시트 셸(`widgets/map-sheet-shell`)을 조립한다. 층 방향이
 *   app → pages → widgets → features 라 features 는 widgets 를 못 문다(eslint 층 zone). 셸 조립은 리포 전례대로
 *   pages 순수 뷰가 진다(`pages/planb-draft/ui/ReplanDraftView.tsx`). 뷰는 api·라우터를 모른다 — 프리뷰가 이
 *   파일을 경로로 직접 import 한다(페이지 배럴을 거치면 useAssignBase 가 딸려 온다).
 *
 * 무엇을 보장하나(화면은 props 만 받는다 — 요청·라우터·선택 state 는 페이지 몫):
 *  - 🔴 헤더: `동선 기준 숙소 추천` · `{N}곳` · `{요약} · 이동 합계가 짧은 순`(AC-1).
 *  - 🔴 카드: 이름 · `평균 {formatDistance}` · `최대 {formatDistance}` · `{구} · {가격대}` · `{formatPrice}`(AC-2).
 *  - 🔴 소요시간 문자열 0(INV-3).
 *  - 🔴 `추천` 배지는 **입력 순서 첫 카드**에만, 화면은 재정렬하지 않는다(AC-3 · INV-2 결).
 *  - 🔴 선택 = `accessibilityState.selected` + 선택 테두리(`border-primary`), 누르면 `onSelect(savedStayId)`(AC-4).
 *  - 🔴 CTA `{이름}을/를 거점으로`(AC-5) · 비활성이면 눌러도 `onConfirm` 0(AC-12) · 인라인 안내(INV-4).
 *  - 🔴 링크·뒤로 콜백(AC-6) · 지도 핀 조립(동선 그대로 / 선택=숙소 핀 / 나머지=아웃라인 후보 / 번호 유일 / 반경 원, AC-7).
 *  - 🔴 시트는 셸 기본 3스냅의 peek(45%)로 연다(02a D4).
 *
 * ⚠️ 함정(02a §4): ★3 배지≠최소거리 재판정 · ★4 배지≠선택 · ★5 a11y+테두리 짝 · ★6·★7·★8 핀 조립 ·
 *   ★10 비활성은 press→콜백 0 짝 · ★18 스냅은 칸 값.
 * ⚠️ 지도는 얇은 관찰 목(`map-root` host 에 props 통과)이라 핀 모양·원 점선은 못 본다(6-b).
 *
 * (개념) `rerender` — 같은 화면에 새 props 를 넣어 다시 그린다. 페이지가 선택 state 를 바꿔 내려 주는 순간을
 *   흉내낸다(화면은 제어형이라 스스로 선택을 바꾸지 않는다).
 *
 * 3동작 뼈대: 준비=뷰모델·선택 id → 실행=렌더/누르기/rerender → 단언=문구·선택 상태·콜백·지도 props.
 */

// 셸이 `<MapView>` 를 마운트하므로 관찰 목으로 바꾼다(`map-root` host 에 pins·radiusCircle 이 실린다).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));
// 통과형 시트 목(__mocks__/@gorhom/bottom-sheet.tsx) — devPreview 계열과 같은 장치.
jest.mock('@gorhom/bottom-sheet');

const HAEUNDAE: StayRecommendCandidate = {
  savedStayId: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: '해운대 그랜드 호텔',
  avgDistanceM: 900,
  maxDistanceM: 1400,
  district: '해운대구',
  priceTier: '중간가',
  price: { amount: 120000, currency: 'KRW' },
  lat: 35.1631,
  lng: 129.1636,
};

const SEOMYEON: StayRecommendCandidate = {
  savedStayId: 'aaaaaaaa-0000-4000-8000-000000000002',
  name: '서면 시티 호텔',
  avgDistanceM: 1200,
  maxDistanceM: 2000,
  district: '부산진구',
  priceTier: '중간가',
  price: { amount: 89000, currency: 'KRW' },
  lat: 35.1578,
  lng: 129.0592,
};

const GWANGALLI: StayRecommendCandidate = {
  savedStayId: 'aaaaaaaa-0000-4000-8000-000000000003',
  name: '광안리 오션뷰',
  avgDistanceM: 1300,
  maxDistanceM: 1800,
  district: '수영구',
  priceTier: '중간가',
  price: { amount: 145000, currency: 'KRW' },
  lat: 35.1532,
  lng: 129.1188,
};

/** 동선 핀 3개 — 번호 1·2·3(카드 번호와 대응, 화면이 바꾸면 안 된다). */
const ROUTE_PINS: MapPin[] = [
  { number: 1, lat: 35.1587, lng: 129.1604 },
  { number: 2, lat: 35.156, lng: 129.145 },
  { number: 3, lat: 35.1575, lng: 129.06 },
];

function view(candidates: StayRecommendCandidate[]): StayRecommendViewModel {
  return {
    summary: '이틀 동선이 해운대·서면 중심이에요',
    center: { lat: 35.157, lng: 129.13 },
    radiusM: 1500,
    routePins: ROUTE_PINS,
    candidates,
  };
}

const DEFAULT_VIEW = view([HAEUNDAE, SEOMYEON, GWANGALLI]);

interface Handlers {
  onSelect: jest.Mock;
  onConfirm: jest.Mock;
  onBrowseOther: jest.Mock;
  onBack: jest.Mock;
}

function makeHandlers(): Handlers {
  return {
    onSelect: jest.fn(),
    onConfirm: jest.fn(),
    onBrowseOther: jest.fn(),
    onBack: jest.fn(),
  };
}

function ui(
  handlers: Handlers,
  props: {
    view?: StayRecommendViewModel;
    selectedId?: string;
    confirmDisabled?: boolean;
    notice?: string | null;
  } = {}
) {
  return (
    <StayRecommendView
      view={props.view ?? DEFAULT_VIEW}
      selectedId={props.selectedId ?? HAEUNDAE.savedStayId}
      confirmDisabled={props.confirmDisabled}
      notice={props.notice}
      {...handlers}
    />
  );
}

/** 입력 순번 카드 루트들(렌더 트리 순서). 카드 안쪽 testID(`…-0-photo` 등)는 `\d+$` 에 안 걸린다. */
function cards() {
  return screen.getAllByTestId(/^stay-recommend-card-\d+$/);
}

/** 렌더된 문자열 전부를 공백으로 잇는다(INV-3 스캔 모집단, h11·h14 선례). */
function renderedText(): string {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out.join(' ');
}

/** 지도 관찰 목이 받은 핀 배열. */
function mapPins(): MapPin[] {
  return screen.getByTestId('map-root').props.pins as MapPin[];
}

/** 시트가 받은 snapPoints 배열에서 index 가 가리키는 칸 값들(합성·호스트 3겹 — 개수는 안 센다). */
function sheetSnapValues(): unknown[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map(
      (node) => (node.props.snapPoints as unknown[])[node.props.index as number]
    );
}

/** className 토큰 하나가 공백 단위로 있는가(`border-primary-pale` 같은 접두 오탐 차단). */
function hasClass(node: { props: { className?: unknown } }, token: string) {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .includes(token);
}

describe('🔴 S1 · AC-1 — 헤더: 제목 · N곳 · 요약 + 정렬 꼬리', () => {
  it('후보 3개 → 제목·3곳·부제가 정확히 보인다', () => {
    // 준비·실행
    render(ui(makeHandlers()));

    // 단언 — 세 문구 완전일치.
    expect(screen.getByTestId('stay-recommend-title')).toHaveTextContent(
      '동선 기준 숙소 추천'
    );
    expect(screen.getByTestId('stay-recommend-count')).toHaveTextContent('3곳');
    expect(screen.getByTestId('stay-recommend-subtitle')).toHaveTextContent(
      '이틀 동선이 해운대·서면 중심이에요 · 이동 합계가 짧은 순'
    );
  });

  it('후보 2개면 2곳 — 개수는 후보 수에서 온다(하드코딩 차단)', () => {
    render(ui(makeHandlers(), { view: view([HAEUNDAE, SEOMYEON]) }));

    expect(screen.getByTestId('stay-recommend-count')).toHaveTextContent('2곳');
    expect(cards()).toHaveLength(2);
  });
});

describe('🔴 S2 · AC-2 — 카드 내용: 이름 · 평균/최대 거리 · 구 · 가격대 · 가격', () => {
  it.each([
    [
      0,
      '해운대 그랜드 호텔',
      '평균 900m',
      '최대 1.4km',
      '해운대구 · 중간가',
      '120,000원~',
    ],
    [
      1,
      '서면 시티 호텔',
      '평균 1.2km',
      '최대 2.0km',
      '부산진구 · 중간가',
      '89,000원~',
    ],
    [
      2,
      '광안리 오션뷰',
      '평균 1.3km',
      '최대 1.8km',
      '수영구 · 중간가',
      '145,000원~',
    ],
  ])(
    'card-%i → %s / %s / %s / %s / %s',
    (index, name, avg, max, sub, price) => {
      render(ui(makeHandlers()));

      // 단언 — 카드 안에서 각 줄을 완전일치로 찾는다(평균·최대는 각각 따로, 02a §5).
      const card = screen.getByTestId(`stay-recommend-card-${index}`);
      expect(within(card).getByText(name)).toBeOnTheScreen();
      expect(within(card).getByText(avg)).toBeOnTheScreen();
      expect(within(card).getByText(max)).toBeOnTheScreen();
      expect(within(card).getByText(sub)).toBeOnTheScreen();
      expect(within(card).getByText(price)).toBeOnTheScreen();
    }
  );

  it('가격이 없으면 가격 미확인 (formatPrice 규칙 재사용)', () => {
    render(ui(makeHandlers(), { view: view([{ ...HAEUNDAE, price: null }]) }));

    const card = screen.getByTestId('stay-recommend-card-0');
    expect(within(card).getByText('가격 미확인')).toBeOnTheScreen();
  });
});

describe('🔴 S3 · INV-3 — 소요시간 문자열 0 (거리만)', () => {
  it('화면 전체 텍스트에 N분·N시간·소요가 없다', () => {
    render(ui(makeHandlers()));

    // 도달 앵커 — 스캔 모집단이 실제 화면 문구를 담았다(빈 문자열 공허 통과 차단).
    const text = renderedText();
    expect(text).toContain('평균 900m');
    expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
  });
});

describe('🔴 S4 · AC-3 — 추천 배지는 입력 순서 첫 카드에만, 재정렬 없음', () => {
  it('기본 순서 → card-0 에만 추천 배지', () => {
    render(ui(makeHandlers()));

    const [first, second, third] = cards();
    expect(within(first).getByText('추천')).toBeOnTheScreen();
    expect(within(second).queryByText('추천')).toBeNull();
    expect(within(third).queryByText('추천')).toBeNull();
  });

  it('평균 거리가 가장 짧지 않은 서면을 첫 입력으로 → 서면이 첫 카드이고 배지도 서면(★3)', () => {
    // 준비 — 서버 순서가 서면·해운대·광안리라고 가정(해운대가 평균 900m 로 가장 짧다).
    render(
      ui(makeHandlers(), {
        view: view([SEOMYEON, HAEUNDAE, GWANGALLI]),
        selectedId: SEOMYEON.savedStayId,
      })
    );

    // 단언 — 트리 순서 = 입력 순서, 배지 = 입력 첫 카드.
    const [first, second, third] = cards();
    expect(within(first).getByText('서면 시티 호텔')).toBeOnTheScreen();
    expect(within(second).getByText('해운대 그랜드 호텔')).toBeOnTheScreen();
    expect(within(third).getByText('광안리 오션뷰')).toBeOnTheScreen();
    expect(within(first).getByText('추천')).toBeOnTheScreen();
    expect(within(second).queryByText('추천')).toBeNull();
  });
});

describe('🔴 S5 · AC-4 — 선택 표식: accessibilityState + 선택 테두리 (같은 루트)', () => {
  it('선택이 두 번째면 card-1 만 selected·border-primary, 배지는 여전히 card-0(★4·★5)', () => {
    render(ui(makeHandlers(), { selectedId: SEOMYEON.savedStayId }));

    const [first, second, third] = cards();
    // 관측 가능한 선택 상태.
    expect(second).toBeSelected();
    expect(first).not.toBeSelected();
    expect(third).not.toBeSelected();
    // 선택 테두리 — 선택 카드에만.
    expect(hasClass(second, 'border-primary')).toBe(true);
    expect(hasClass(first, 'border-primary')).toBe(false);
    expect(hasClass(third, 'border-primary')).toBe(false);
    // 배지는 선택을 따라가지 않는다.
    expect(within(first).getByText('추천')).toBeOnTheScreen();
    expect(within(second).queryByText('추천')).toBeNull();
  });
});

describe('🔴 S6 · AC-4 — 카드를 누르면 onSelect(savedStayId)', () => {
  it('card-2 press → onSelect(광안리 id) 1회', () => {
    const handlers = makeHandlers();
    render(ui(handlers));

    fireEvent.press(screen.getByTestId('stay-recommend-card-2'));

    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).toHaveBeenCalledWith(GWANGALLI.savedStayId);
  });
});

describe('🔴 S7 · AC-4·AC-5 — CTA 라벨은 선택 이름 + 을/를, 누르면 onConfirm', () => {
  it('선택 해운대 → "해운대 그랜드 호텔을 거점으로", 광안리로 바꾸면 "광안리 오션뷰를 거점으로"', () => {
    const handlers = makeHandlers();
    const { rerender } = render(ui(handlers));

    // 받침 있음 → 을.
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '해운대 그랜드 호텔을 거점으로'
    );

    // 실행 — 페이지가 선택을 광안리로 바꿔 내려 준 상황.
    rerender(ui(handlers, { selectedId: GWANGALLI.savedStayId }));

    // 받침 없음 → 를.
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '광안리 오션뷰를 거점으로'
    );
  });

  it('CTA press → onConfirm 1회', () => {
    const handlers = makeHandlers();
    render(ui(handlers));

    fireEvent.press(screen.getByTestId('sheet-cta-button-0'));

    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 S8 · AC-12 — confirmDisabled 면 CTA 비활성 + 눌러도 onConfirm 0 (★10)', () => {
  it('비활성 표시 그리고 press 무반응 — 둘 다', () => {
    const handlers = makeHandlers();
    render(ui(handlers, { confirmDisabled: true }));

    const cta = screen.getByTestId('sheet-cta-button-0');
    expect(cta).toBeDisabled();
    fireEvent.press(cta);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });
});

describe('🔴 S9 · INV-4 — 인라인 안내(실패·지정 불가 사유)', () => {
  it('notice 를 주면 그 문구가 stay-recommend-notice 에 보인다', () => {
    render(
      ui(makeHandlers(), {
        notice: '거점으로 지정하지 못했어요. 다시 시도해 주세요.',
      })
    );

    expect(screen.getByTestId('stay-recommend-notice')).toHaveTextContent(
      '거점으로 지정하지 못했어요. 다시 시도해 주세요.'
    );
  });

  it('notice 가 없으면 안내 자리도 없다(짝)', () => {
    render(ui(makeHandlers(), { notice: null }));

    expect(screen.queryByTestId('stay-recommend-notice')).toBeNull();
  });
});

describe('🔴 S10 · AC-6 — 다른 숙소 둘러보기 · 뒤로', () => {
  it('링크 press → onBrowseOther 1회, 링크 문구가 보인다', () => {
    const handlers = makeHandlers();
    render(ui(handlers));

    const link = screen.getByTestId('stay-recommend-browse');
    // 쉐브론 › 은 SVG 글리프라 텍스트가 아니다(02a 2-5).
    expect(within(link).getByText('다른 숙소 둘러보기')).toBeOnTheScreen();
    fireEvent.press(link);

    expect(handlers.onBrowseOther).toHaveBeenCalledTimes(1);
  });

  it('좌상단 back press → onBack 1회, 일차 칩은 없다(Figma: back 만)', () => {
    const handlers = makeHandlers();
    render(ui(handlers));

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sheet-daychip-0')).toBeNull();
  });
});

describe('🔴 S11 · AC-7 — 지도 입력 조립 (★6·★7)', () => {
  it('동선 핀 그대로 · 선택=숙소 핀 · 나머지=아웃라인 후보 · 번호 유일 · 반경 원 · 중심', () => {
    render(ui(makeHandlers()));

    const pins = mapPins();

    // ① 동선 핀(kind 없음 = 경로선 대상)은 입력 그대로 — 후보가 kind 없이 끼면 동선 선에 들어간다.
    expect(pins.filter((pin) => pin.kind === undefined)).toEqual(ROUTE_PINS);

    // ② 선택 후보(해운대) = 숙소 핀 1개.
    const stayPins = pins.filter((pin) => pin.kind === 'stay');
    expect(stayPins).toHaveLength(1);
    expect(stayPins[0]).toMatchObject({ lat: HAEUNDAE.lat, lng: HAEUNDAE.lng });

    // ③ 나머지 후보 = 아웃라인 후보 핀(좌표 집합으로 비교 — 순서는 안 본다).
    const candidatePins = pins.filter((pin) => pin.kind === 'candidate');
    expect(candidatePins.map((pin) => `${pin.lat},${pin.lng}`).sort()).toEqual(
      [SEOMYEON, GWANGALLI].map((c) => `${c.lat},${c.lng}`).sort()
    );

    // ④ 그 밖의 핀은 없다(동선 3 + 숙소 1 + 후보 2).
    expect(pins).toHaveLength(ROUTE_PINS.length + 1 + 2);

    // ⑤ 번호는 전부 다르다 — React key·map-marker-pin-{n} testID 충돌 금지.
    const numbers = pins.map((pin) => pin.number);
    expect(new Set(numbers).size).toBe(numbers.length);

    // ⑥ 반경 원 = 무게중심 + 반경.
    expect(screen.getByTestId('map-root').props.radiusCircle).toEqual({
      center: DEFAULT_VIEW.center,
      radiusM: DEFAULT_VIEW.radiusM,
    });

    // ⑦ 지도 중심 — 관찰 목이 center 를 "lat,lng" 텍스트로 노출한다.
    expect(screen.getByTestId('map-root')).toHaveTextContent('35.157,129.13');
  });
});

describe('🔴 S12 · AC-7 — 선택을 바꾸면 숙소 핀이 옮겨간다 (★8)', () => {
  it('서면으로 rerender → 숙소 핀 = 서면, 해운대는 후보 핀으로', () => {
    const handlers = makeHandlers();
    const { rerender } = render(ui(handlers));

    rerender(ui(handlers, { selectedId: SEOMYEON.savedStayId }));

    const pins = mapPins();
    const stayPins = pins.filter((pin) => pin.kind === 'stay');
    expect(stayPins).toHaveLength(1);
    expect(stayPins[0]).toMatchObject({ lat: SEOMYEON.lat, lng: SEOMYEON.lng });
    expect(
      pins
        .filter((pin) => pin.kind === 'candidate')
        .map((pin) => `${pin.lat},${pin.lng}`)
        .sort()
    ).toEqual([HAEUNDAE, GWANGALLI].map((c) => `${c.lat},${c.lng}`).sort());
  });
});

describe('🔴 S13 · 02a D4 — 셸 기본 3스냅의 peek(45%)로 연다 (★18)', () => {
  it('시트가 받은 배열은 기본 [28, 45%, 88%] 이고 진입 칸 값은 45%', () => {
    render(ui(makeHandlers()));

    // 기본 배열 그대로 — 화면이 snapPoints 를 직접 주면 "닫힘에서만 지도 열림·CTA 숨김"이 꺼진다.
    const hosts = screen.root.findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    );
    expect(hosts.length).toBeGreaterThan(0);
    hosts.forEach((node) =>
      expect(node.props.snapPoints).toEqual([28, '45%', '88%'])
    );

    // 칸 값 — 숫자 index 가 아니라 그 index 가 가리키는 값.
    const values = sheetSnapValues();
    values.forEach((value) => expect(value).toBe('45%'));
  });
});
