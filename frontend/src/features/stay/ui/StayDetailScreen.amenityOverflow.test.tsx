import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { StayDetail } from '@/shared/api/generated/schemas';
import { StayDetailScreen } from './StayDetailScreen';

/**
 * TRIP-918 (부모 TRIP-723) — e03 편의시설이 5개 이상일 때의 배치 계약.
 *
 * 무엇을 보장하나: 4개 이하는 지금처럼 한 줄 균등(flex-1, 무wrap)이고, 5개 이상은 행이 줄바꿈을
 * 허용하며 칩이 Figma 4칸 폭 격자(65.2 < 폭 ≤ 83.5, 늘어나지 않음)를 가진다. 어느 경우든 칩은
 * 하나도 숨기지 않는다. 실제 줄바꿈 픽셀은 jest 사각이라 [검증] 캡처가 본다(02a §4).
 */

const CLIENT_ID_KEY = 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID';
let ORIGINAL_CLIENT_ID: string | undefined;
ORIGINAL_CLIENT_ID = process.env[CLIENT_ID_KEY];

beforeEach(() => {
  process.env[CLIENT_ID_KEY] = 'test-naver-client-id';
});

afterEach(() => {
  if (ORIGINAL_CLIENT_ID === undefined) {
    delete process.env[CLIENT_ID_KEY];
  } else {
    process.env[CLIENT_ID_KEY] = ORIGINAL_CLIENT_ID;
  }
});

const DETAIL: StayDetail = {
  stayId: 'NAVER:s1',
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean', 'wifi'],
  stayType: 'HOTEL',
  price: { amount: 145000, currency: 'KRW' },
  address: '부산 해운대구 우동 1411-1',
  phone: '051-749-7000',
  rooms: 120,
};

// 앞 4개는 아이콘 매핑이 있는 코드, 뒤 4개는 모르는 코드(폴백 아이콘, INV-1).
const AMENITY_POOL = [
  '주차',
  '조식',
  '와이파이',
  '오션뷰',
  '사우나',
  '수영장',
  '피트니스',
  '바베큐',
];

// Figma e03 편의시설 행(1700:1213) — 폭 358, 간격 8, 4칸.
const ROW_WIDTH = 358;
const GAP = 8;
const COLS = 4;
const MAX_CHIP_WIDTH = (ROW_WIDTH - (COLS - 1) * GAP) / COLS; // 83.5 — 한 줄에 4개가 들어가는 최대
const FIVE_FIT_WIDTH = (ROW_WIDTH - COLS * GAP) / (COLS + 1); // 65.2 — 이하면 한 줄에 5개가 들어간다

const ROW_ID = 'stay-detail-amenities';
const CHIP_ID = /^stay-detail-amenity-(?!icon-)/; // 칩만(아이콘 leaf 제외, 02a ★3)
// 02c: 폭은 고정 `w-[Npx]` 하나만 인정한다 — `min-w`는 라벨 길이만큼 늘어날 수 있다(03b 경고-1).
const FIXED_WIDTH_TOKEN = /^w-\[(\d+(?:\.\d+)?)px\]$/;
const OTHER_WIDTH_TOKEN = /^(?:min-w|max-w|basis)-/;
// grow 계열 전부: flex-1·flex-2·flex-auto·flex-[1]·grow·grow-2·grow-[2]·flex-grow·flex-grow-[2].
// grow-0·flex-row·flex-wrap·flex-none 은 안 걸린다(늘어나지 않음).
const GROW_TOKEN =
  /^(?:flex-(?:\d+|auto|\[[^\]]+\])|(?:flex-)?grow(?:-[1-9]\d*|-\[[^\]]+\])?)$/;
// className 밖의 우회로 — style prop 으로 늘리거나 폭을 덮으면 className 단언이 못 본다.
const LAYOUT_STYLE_KEYS = [
  'flex',
  'flexGrow',
  'flexBasis',
  'width',
  'minWidth',
  'maxWidth',
];
const OFF_START_JUSTIFY = [
  'justify-center',
  'justify-between',
  'justify-around',
  'justify-evenly',
  'justify-end',
];

function noop(): void {}

function renderWith(amenities: string[]): void {
  render(
    <StayDetailScreen
      state={{ kind: 'ready', detail: { ...DETAIL, amenities } }}
      saved={false}
      onToggleSave={noop}
      onPressBook={noop}
      onPressAddToTrip={noop}
      onPressBack={noop}
      onPressPhone={noop}
      onRetry={noop}
    />
  );
}

function tokens(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className).split(/\s+/);
}

/** 호스트 View 의 style prop 을 한 객체로 편다(배열·중첩 배열도). style 이 없으면 빈 객체. */
function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}

/** 렌더 트리 전체에서 가로 스크롤(`horizontal` 참) 노드의 type 을 모은다. */
type JsonNode = {
  type?: string;
  props?: { horizontal?: unknown };
  children?: unknown[] | null;
};
function horizontalNodes(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => horizontalNodes(child, out));
  } else if (node && typeof node === 'object') {
    const { type, props, children } = node as JsonNode;
    if (props?.horizontal) out.push(String(type));
    if (children) horizontalNodes(children, out);
  }
  return out;
}

describe('O1 · 4개 이하는 현행 무변경 — 한 줄 균등 (AC-1 · D1 · Figma 1700:1213)', () => {
  it('4개면 행이 줄바꿈하지 않고 칩 4개가 모두 flex-1 이다', () => {
    const four = AMENITY_POOL.slice(0, 4);
    renderWith(four);

    const rowTokens = tokens(ROW_ID);
    expect(rowTokens).toContain('flex-row');
    expect(rowTokens).not.toContain('flex-wrap');
    expect(rowTokens).not.toContain('flex-wrap-reverse');
    four.forEach((value) => {
      expect(tokens(`stay-detail-amenity-${value}`)).toContain('flex-1');
    });
  });
});

describe('O2 · 5개 이상도 하나도 숨기지 않는다 (AC-2 · US-STAY-03)', () => {
  it.each([5, 6, 8])(
    '%i개면 행 안에 칩이 그 개수만큼 전부 있고 +N 요약·가로 스크롤이 없다',
    (n) => {
      const values = AMENITY_POOL.slice(0, n);
      renderWith(values);

      const row = screen.getByTestId(ROW_ID);
      expect(within(row).getAllByTestId(CHIP_ID)).toHaveLength(n);
      values.forEach((value) => {
        expect(
          within(row).getByTestId(`stay-detail-amenity-${value}`)
        ).toBeOnTheScreen();
      });
      expect(screen.queryAllByText(/^\+\d+$/)).toHaveLength(0);
      expect(horizontalNodes(screen.toJSON())).toEqual([]);
    }
  );
});

describe('O3 · 5개 이상은 줄바꿈 + 4칸 격자 폭 (AC-3 · D1 · D2)', () => {
  it.each([5, 6, 8])('%i개면 행이 줄바꿈을 허용하고 왼쪽부터 채운다', (n) => {
    renderWith(AMENITY_POOL.slice(0, n));

    const rowTokens = tokens(ROW_ID);
    expect(rowTokens).toEqual(
      expect.arrayContaining(['flex-row', 'flex-wrap', 'gap-sm'])
    );
    OFF_START_JUSTIFY.forEach((token) => {
      expect(rowTokens).not.toContain(token);
    });
  });

  it.each([5, 6, 8])(
    '%i개면 칩이 고정폭 w-[Npx] 하나로만 폭을 갖고(늘어나지 않음), 모두 같은 폭(한 줄 4개 격자)이다',
    (n) => {
      const values = AMENITY_POOL.slice(0, n);
      renderWith(values);

      const widths = values.map((value) => {
        const testID = `stay-detail-amenity-${value}`;
        const chipTokens = tokens(testID);

        // grow 계열 className 없음 — 있으면 마지막 줄 칩이 행 가득 벌어진다(D2).
        expect(chipTokens.filter((t) => GROW_TOKEN.test(t))).toEqual([]);
        // min-w·max-w·basis 없음 — 폭은 w 하나로만 정한다(02c).
        expect(chipTokens.filter((t) => OTHER_WIDTH_TOKEN.test(t))).toEqual([]);
        // style prop 으로 늘리거나 폭을 덮는 우회 없음.
        expect(
          LAYOUT_STYLE_KEYS.filter(
            (key) => flatStyle(testID)[key] !== undefined
          )
        ).toEqual([]);

        const fixed = chipTokens
          .map((t) => t.match(FIXED_WIDTH_TOKEN)?.[1])
          .filter((w): w is string => w !== undefined)
          .map(Number);
        expect(fixed).toHaveLength(1);
        expect(fixed[0]).toBeGreaterThan(FIVE_FIT_WIDTH);
        expect(fixed[0]).toBeLessThanOrEqual(MAX_CHIP_WIDTH);
        return fixed[0];
      });
      expect(new Set(widths).size).toBe(1);
    }
  );
});

describe('O4 · 모르는 코드가 섞여도 칩마다 아이콘 (AC-4 · INV-1 폴백)', () => {
  it('8개(모르는 코드 4개 포함)면 칩마다 자기 아이콘 leaf 를 그린다(어느 아이콘은 config 테스트)', () => {
    renderWith(AMENITY_POOL);

    AMENITY_POOL.forEach((value) => {
      expect(
        within(screen.getByTestId(`stay-detail-amenity-${value}`)).getByTestId(
          `stay-detail-amenity-icon-${value}`
        )
      ).toBeOnTheScreen();
    });
  });
});
