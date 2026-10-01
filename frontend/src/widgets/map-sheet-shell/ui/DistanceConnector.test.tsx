import fc from 'fast-check';
import { render, screen } from '@testing-library/react-native';

import { DistanceConnector, isZeroDistance } from './DistanceConnector';
import { CarGlyph, WalkGlyph } from './MapSheetGlyphs';

/**
 * TRIP-783 · AC-3·AC-4·E3 — 카드 사이 거리 커넥터(widgets). 서버 `distanceRange` 문자열을
 * 가공 없이 그대로 나른다(BR-U3-08, INV-3 — 소요시간 필드 없음).
 * TRIP-1054 — 값이 없으면(null·undefined·'') 글리프 줄만 남기고 문구 칸을 그리지 않는다(QA #038,
 * 결정 1b). `약 0.0km` 로 시작하는 문자열은 `바로 옆`으로 바꾼다(QA #035, 결정 2b).
 * 이동수단 아이콘은 `자가용` 포함 여부로 고른다(TRIP-1076, 옛 키 `차량` 폐기) — 어느 글리프 컴포넌트인지까지만 보고, 색·모양은
 * SVG 라 jest 원리적 사각(6-b 육안). 점선·[길찾기]는 신 설계에서 제거 — 그 부재를 잠근다.
 *
 * 3동작 뼈대: 준비=거리 문자열/null 로 렌더 → 실행=렌더만 → 단언=문구 칸 완전일치·부재·소요시간 0.
 */

// 소요시간 표기 탐지기(TimeSheet CS6·executionDurationStructure 이식). HH:mm(숫자 뒤 `:`)·bare km 은 안 걸린다.
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/**
 * 렌더된 문자열 전부 — INV-3 부정 스캔 모집단(TimeSheet CS6 헬퍼 이식). 호스트 노드(type 이 문자열)만
 * 훑는다 — 합성 `Text` 와 그 안의 호스트 `Text` 가 같은 children 을 둘 다 들고 있어 전부 훑으면 한 글자가
 * 두 번 잡힌다(02a §5 실측). 개수·순서를 `toEqual` 로 단정하므로 한 번씩만 센다.
 */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll((node) => typeof node.type === 'string')
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

/** 이동수단 글리프 개수 — 컴포넌트 타입까지만 본다(02a ★7). */
function glyphCount(): { car: number; walk: number } {
  return {
    car: screen.UNSAFE_queryAllByType(CarGlyph).length,
    walk: screen.UNSAFE_queryAllByType(WalkGlyph).length,
  };
}

const SLOT_KEY = '2026-06-10#poi-hwangnyeongsan';

describe('🔴 DistanceConnector · C1 — 거리 통과 렌더(AC-3 완전일치)', () => {
  it('distanceRange 를 leaf 하나에 값 그대로 담는다', () => {
    render(<DistanceConnector slotKey={SLOT_KEY} distanceRange="2.1km" />);

    expect(screen.getByTestId(`sheet-connector-${SLOT_KEY}`)).toBeOnTheScreen();
    expect(
      screen.getByTestId(`sheet-connector-distance-${SLOT_KEY}`)
    ).toHaveTextContent('2.1km');
    // 완전일치 잠금(02a ★1) — 부분포함이면 통과, exact 라 실패.
    expect(
      screen.getByTestId(`sheet-connector-distance-${SLOT_KEY}`)
    ).not.toHaveTextContent('2.1');
  });
});

describe('🔴 DistanceConnector · C2 — 거리 없음 → 글리프 줄만, 문구 칸 없음(TRIP-1054 AC-1·AC-2)', () => {
  it.each([null, undefined, ''])(
    'distanceRange=%p 이면 줄과 글리프 1개만 남고 문구 칸·"이동 거리 계산 중"이 없다',
    (distanceRange) => {
      render(
        <DistanceConnector slotKey={SLOT_KEY} distanceRange={distanceRange} />
      );

      // 줄은 남는다 — 카드 사이 간격·이동 흐름은 유지.
      expect(
        screen.getByTestId(`sheet-connector-${SLOT_KEY}`)
      ).toBeOnTheScreen();
      // 문구 칸 자체가 없다(02a D2 — 빈 Text 가 아니라 부재).
      expect(
        screen.queryByTestId(`sheet-connector-distance-${SLOT_KEY}`)
      ).toBeNull();
      // 옛 거짓 신호 "계산 중" 0.
      expect(screen.queryByText(/이동 거리 계산 중/)).toBeNull();
      // 대체 문구('거리 정보 없음' 등)도 없다 — 글자는 한 줄도 안 그린다(02a ★3).
      expect(renderedTexts()).toEqual([]);
      // 글리프는 정확히 1개 남는다(결정 1b "글리프만").
      const { car, walk } = glyphCount();
      expect(car + walk).toBe(1);
    }
  );
});

describe('🔴 DistanceConnector · C3 — INV-3 렌더 스캔(소요시간 0)', () => {
  it.each([
    '2.1km',
    '차량 · 15.0km',
    '약 0.0km · 대중교통 추정',
    '약 1.2km · 도보 추정',
    '약 3.4km · 자가용 추정',
    null,
    undefined,
    '',
  ])(
    'distanceRange=%p 어떤 값에도 소요시간 표기가 렌더되지 않는다',
    (distanceRange) => {
      render(
        <DistanceConnector slotKey={SLOT_KEY} distanceRange={distanceRange} />
      );

      // 긍정 앵커 — 커넥터 줄이 실제로 있다(값 없음이면 글자가 0개라 "문자열 개수" 앵커는 못 쓴다).
      expect(
        screen.getByTestId(`sheet-connector-${SLOT_KEY}`)
      ).toBeOnTheScreen();
      // 부정 — 소요시간 표기 0(분·시간·소요).
      expect(renderedTexts().filter((t) => DURATION_TEXT.test(t))).toEqual([]);
    }
  );
});

describe('🔴 DistanceConnector · C4 — 점선/[길찾기] 스텁 제거', () => {
  it('신 설계는 [길찾기] 어포던스를 그리지 않는다', () => {
    render(<DistanceConnector slotKey={SLOT_KEY} distanceRange="2.1km" />);

    expect(screen.queryByText('길찾기')).toBeNull();
  });
});

describe('🔴 DistanceConnector · C5 — "약 0.0km…" → "바로 옆"(TRIP-1054 AC-3)', () => {
  it.each(['약 0.0km · 대중교통 추정', '약 0.0km · 도보', '약 0.0km'])(
    'distanceRange=%p 이면 문구 칸이 정확히 "바로 옆"이고 원문 조각이 남지 않는다',
    (distanceRange) => {
      render(
        <DistanceConnector slotKey={SLOT_KEY} distanceRange={distanceRange} />
      );

      expect(
        screen.getByTestId(`sheet-connector-distance-${SLOT_KEY}`)
      ).toHaveTextContent('바로 옆');
      // 화면 글자 전체가 '바로 옆' 하나 — '0.0km'·'대중교통' 이 덧붙으면 red.
      expect(renderedTexts()).toEqual(['바로 옆']);
    }
  );
});

describe('🔴 DistanceConnector · C6 — 그 밖의 문자열은 원문 그대로(TRIP-1054 AC-4 · BR-U3-08)', () => {
  it.each([
    '약 1.2km · 도보 추정',
    '차량 · 2.1km',
    '약 0.05km',
    '약 10.0km · 자가용 추정',
    '600m',
    // 5-b 경고-1 — 화면 분기가 판정 함수를 거치는지 잠근다(fake 백엔드 '약 0km'·AI '약 0m' 는 900m 일 수도 있다).
    '약 0km · 도보 추정',
    '약 0m',
  ])('distanceRange=%p 는 한 글자도 바꾸지 않고 그린다', (distanceRange) => {
    render(
      <DistanceConnector slotKey={SLOT_KEY} distanceRange={distanceRange} />
    );

    expect(
      screen.getByTestId(`sheet-connector-distance-${SLOT_KEY}`)
    ).toHaveTextContent(distanceRange);
    // 공백 정규화 없는 바이트 비교(02a ★1) — '약 0.05km' 가 '바로 옆'으로 새면 red.
    expect(renderedTexts()).toEqual([distanceRange]);
  });
});

describe('🔴 DistanceConnector · C7 — 글리프 규칙: `자가용` 포함 → 차, 아니면 도보 (TRIP-1076 AC-4 · Seed Q2)', () => {
  // 수단 어휘는 AI 가 만든다(`_TRANSPORT_LABELS` = 도보·대중교통·자가용). 옛 키 `차량`은 그 어휘에 없어
  // 차 글리프가 실데이터로 한 번도 안 떴다 — 키를 `자가용`으로 바꾸고 `차량`은 폐기한다.
  // `대중교통` 전용 글리프는 Figma 에 없어 보류 — 그동안 도보 글리프 그대로다.
  it.each([
    ['약 3.4km · 자가용 추정', { car: 1, walk: 0 }],
    ['약 10.0km · 자가용', { car: 1, walk: 0 }],
    ['차량 · 2.1km', { car: 0, walk: 1 }],
    ['약 1.2km · 도보 추정', { car: 0, walk: 1 }],
    ['약 2.0km · 대중교통 추정', { car: 0, walk: 1 }],
  ])('distanceRange=%p → 글리프 %p', (distanceRange, expected) => {
    render(
      <DistanceConnector slotKey={SLOT_KEY} distanceRange={distanceRange} />
    );

    expect(glyphCount()).toEqual(expected);
  });

  it('"약 3.4km · 자가용 추정" 은 차 글리프를 쓰면서 문구는 한 글자도 바꾸지 않는다', () => {
    render(
      <DistanceConnector
        slotKey={SLOT_KEY}
        distanceRange="약 3.4km · 자가용 추정"
      />
    );

    expect(glyphCount()).toEqual({ car: 1, walk: 0 });
    expect(renderedTexts()).toEqual(['약 3.4km · 자가용 추정']);
  });

  it('"약 0.0km · 대중교통 추정" 은 문구만 바뀌고 글리프는 도보 그대로다', () => {
    render(
      <DistanceConnector
        slotKey={SLOT_KEY}
        distanceRange="약 0.0km · 대중교통 추정"
      />
    );

    expect(glyphCount()).toEqual({ car: 0, walk: 1 });
  });
});

describe('🔴 isZeroDistance · Z1 — 경계 예시(TRIP-1054 AC-6)', () => {
  it.each(['약 0.0km · 대중교통 추정', '약 0.0km · 도보', '약 0.0km'])(
    '%p 는 "약 0.0km" 로 시작하므로 참',
    (range) => {
      expect(isZeroDistance(range)).toBe(true);
    }
  );

  it.each([
    '약 0.05km',
    '약 10.0km',
    '약 0km',
    '약 0m',
    ' 약 0.0km',
    '0.0km',
    '약 1.2km · 도보 추정',
    '',
  ])('%p 는 "약 0.0km" 로 시작하지 않으므로 거짓', (range) => {
    expect(isZeroDistance(range)).toBe(false);
  });
});

// "약 0.0km" 경계 근처의 헛갈리는 접두들 — 무작위 문자열만으로는 이 근처를 거의 못 밟는다(02a ★4).
const NEAR_PREFIXES = [
  '약 0.0km',
  '약 0.0k',
  '약 0.0',
  '약 0.05km',
  '약 00.0km',
  ' 약 0.0km',
  '약0.0km',
  '약 0.0 km',
  '약 0.0m',
];
const anyText = fc.string({ unit: 'grapheme' });

describe('🔴 isZeroDistance · Z2 — 속성(fast-check, TRIP-1054 AC-6)', () => {
  it('(a) 어떤 문자열이든 판정 결과는 startsWith("약 0.0km") 와 같다', () => {
    const input = fc.oneof(
      anyText,
      fc
        .tuple(fc.constantFrom(...NEAR_PREFIXES), anyText)
        .map(([prefix, tail]) => prefix + tail)
    );

    fc.assert(
      fc.property(input, (range) => {
        expect(isZeroDistance(range)).toBe(range.startsWith('약 0.0km'));
      })
    );
  });

  it('(b) "약 0.0km" 뒤에 무엇이 붙어도 참', () => {
    fc.assert(
      fc.property(anyText, (tail) => {
        expect(isZeroDistance(`약 0.0km${tail}`)).toBe(true);
      })
    );
  });

  it('(c) 0.1km 이상인 "약 N.Nkm…" 는 뒤에 무엇이 붙어도 거짓', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99999 }),
        anyText,
        (tenths, tail) => {
          const range = `약 ${(tenths / 10).toFixed(1)}km${tail}`;
          expect(isZeroDistance(range)).toBe(false);
        }
      )
    );
  });
});
