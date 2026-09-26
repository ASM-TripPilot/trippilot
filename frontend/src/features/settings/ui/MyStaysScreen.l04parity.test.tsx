import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import tailwindConfig from '../../../../tailwind.config.js';
import { MyStaysScreen, type MyStayRowVM } from './MyStaysScreen';
import { ChevronRightGlyph, MUTED_SOFT } from './SettingsGlyphs';

/**
 * TRIP-777 · l04 등록 숙소 — 라이브 Figma(default 1604:2440 · empty 1605:2440 · dialog 1606:2440) 값 정렬.
 *
 * 무엇을 보장하나:
 *  - AC-1: "출발점" 배지 모서리 8, "출발점 변경"은 13 Regular body + muted chevron 글리프.
 *    미등록 행의 "출발점 지정" 점선 배지는 TRIP-989(D13)로 사라졌다 — 없음을 잠근다.
 *  - AC-2: 칩 모서리 8·글자색(날짜 body / 출처·메모 muted), 카드 r12·카드 간 16, 주소 줄 유무, 구분선 막대.
 *  - AC-3: empty 는 제목 없이 96 회색 원 + Figma 침대 + 설명 14 + 내용 폭 CTA h44.
 *  - AC-4: 출발점 다이얼로그 딤 55%·카드 330·제목 19·본문 body색·버튼 h44.
 *  - AC-7: `ChevronRightGlyph` 기본색(다른 화면 4곳이 기대는 값)은 그대로.
 *
 * 게이트(확정 전 콜백 0회·행당 토글 1개·disabled)는 `MyStaysScreen.test.tsx`(무수정)가 잠근다.
 * 그림자·딤 실제 덮임·점선 간격·세부 여백은 jest 사각 — [검증] 스크린샷·6-b 몫.
 */

const COLORS = (
  tailwindConfig as unknown as {
    theme: { extend: { colors: Record<string, string> } };
  }
).theme.extend.colors;

/** Figma 침대(24 viewBox 환산) — 브리프 empty 절. */
const BED_PATHS = [
  'M2 4V20',
  'M2 8H20a2 2 0 0 1 2 2V20',
  'M2 17H22',
  'M6 8V17',
];

const EMPTY_DESCRIPTION = '숙소를 탐색하고 등록하면\n일정을 만들 수 있습니다';

function assignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
  return {
    savedStayId: 's1',
    name: '부산 그랜드 호텔',
    location: '부산 해운대구 우동',
    dateRangeLabel: '6.10 ~ 6.13',
    sourceLabel: 'OTA 예약',
    memoLabel: null,
    linkedTripLabel: '연결 여행 · 부산 여행',
    baseState: 'assigned',
    canAssignBase: true,
    tripId: 't1',
    baseAssignmentId: 'ba1',
    ...over,
  };
}

function unassignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
  return {
    savedStayId: 's2',
    name: '○○ 게스트하우스',
    location: '부산 중구 남포동',
    dateRangeLabel: '6.14 ~ 6.15',
    sourceLabel: '앱 저장',
    memoLabel: '예약번호 미입력',
    linkedTripLabel: '연결된 여행 없음',
    baseState: 'unassigned',
    canAssignBase: true,
    tripId: null,
    baseAssignmentId: null,
    ...over,
  };
}

function renderRows(rows: MyStayRowVM[]) {
  render(
    <MyStaysScreen
      rows={rows}
      isEmpty={false}
      onConfirmBaseToggle={jest.fn()}
      onPressExplore={jest.fn()}
    />
  );
}

function renderEmpty() {
  render(
    <MyStaysScreen
      rows={[]}
      isEmpty
      onConfirmBaseToggle={jest.fn()}
      onPressExplore={jest.fn()}
    />
  );
}

/** className 을 토큰 배열로 — 부분 문자열 비교(`h-12` ⊂ `h-120`)를 피한다. */
function tokens(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let cur = node.parent;
  while (cur) {
    out.push(cur);
    cur = cur.parent;
  }
  return out;
}

/** 글자를 감싼 가장 가까운 host(View 등) — 배지·칩처럼 testID 없는 상자를 글자로 찾는다. */
function nearestHost(node: ReactTestInstance): ReactTestInstance {
  const found = ancestorsOf(node).find((n) => typeof n.type === 'string');
  if (!found) throw new Error('host 조상이 없다');
  return found;
}

/** 두 노드를 모두 품는 가장 가까운 host 조상 — "몇 칸 위"로 세지 않아 wrapper 하나에 안 깨진다. */
function nearestCommonHost(
  a: ReactTestInstance,
  b: ReactTestInstance
): ReactTestInstance {
  const ofB = new Set(ancestorsOf(b));
  const found = ancestorsOf(a).find(
    (n) => typeof n.type === 'string' && ofB.has(n)
  );
  if (!found) throw new Error('공통 host 조상이 없다');
  return found;
}

/**
 * 두 카드 사이 간격 토큰(`gap-*`). 공통 host 조상부터 위로 올라가며 className 과 ScrollView 의
 * `contentContainerClassName`(host RCTScrollView 에 남는다) 둘 다 본다. 못 찾으면 throw — 빈 배열 green 방지.
 */
function gapTokensBetween(a: ReactTestInstance, b: ReactTestInstance) {
  const common = nearestCommonHost(a, b);
  for (const n of [common, ...ancestorsOf(common)]) {
    if (typeof n.type !== 'string') continue;
    const all = [
      ...tokens(n),
      ...String(n.props.contentContainerClassName ?? '')
        .split(/\s+/)
        .filter(Boolean),
    ];
    const gaps = all.filter((t) => t.startsWith('gap-'));
    if (gaps.length > 0) return gaps;
  }
  throw new Error('카드 사이 gap 토큰을 찾지 못했다');
}

/** 색 토큰 → react-native-svg 가 렌더 트리에 남기는 stroke 값(ARGB 정수, 02a §5-A). */
function svgColor(hex: string): number {
  return 0xff000000 + parseInt(hex.slice(1), 16);
}

/** 노드 아래에서 stroke 를 가진 SVG host 노드(RNSVGPath·RNSVGLine 등). */
function svgStrokes(node: ReactTestInstance): ReactTestInstance[] {
  return node.findAll(
    (n) =>
      typeof n.type === 'string' &&
      n.type.startsWith('RNSVG') &&
      n.props.stroke !== undefined
  );
}

function strokeOf(n: ReactTestInstance): unknown {
  return (n.props.stroke as { payload?: unknown }).payload;
}

function hostTextCount(node: ReactTestInstance): number {
  return node.findAll((n) => String(n.type) === 'Text').length;
}

describe('🔴 TRIP-777 · l04 default — 출발점 배지·링크 (AC-1)', () => {
  it('등록 행의 "출발점" 배지는 모서리 8 이고 알약(pill)이 아니다', () => {
    renderRows([assignedRow()]);

    const row = screen.getByTestId('my-stays-row-s1');
    const badge = nearestHost(within(row).getByText('출발점'));
    expect(tokens(badge)).toContain('bg-primary');
    expect(tokens(badge)).toContain('rounded-[8px]');
    expect(tokens(badge)).not.toContain('rounded-pill');
  });

  it('미등록 행에는 점선 "출발점 지정" 배지도 "출발점" 배지도 없다 (TRIP-989 D13 — Figma 1604 와 다름)', () => {
    renderRows([unassignedRow()]);

    // 행 자체는 그려진다 — 아래 "없음" 단언이 빈 화면으로 통과하지 않게.
    const row = screen.getByTestId('my-stays-row-s2');
    expect(within(row).getByText('○○ 게스트하우스')).toBeOnTheScreen();

    expect(within(row).queryByText('출발점 지정')).toBeNull();
    expect(within(row).queryByText('출발점')).toBeNull();
    // 문구만 지우고 점선 상자를 남기는 우회도 잡는다.
    expect(
      row.findAll(
        (n) => typeof n.type === 'string' && tokens(n).includes('border-dashed')
      )
    ).toHaveLength(0);
  });

  it('"출발점 변경" 글자는 정확히 "출발점 변경"(› 문자 없음)이고 13 Regular body색이다', () => {
    renderRows([assignedRow()]);

    const toggle = screen.getByTestId('my-stays-base-toggle-s1');
    const label = within(toggle).getByText('출발점 변경');
    expect(tokens(label)).toEqual(
      expect.arrayContaining(['font-noto', 'text-label', 'text-body'])
    );
    expect(tokens(label)).not.toContain('font-noto-bold');
    expect(tokens(label)).not.toContain('text-primary');
    // "›" 를 별도 <Text> 조각으로 남기는 우회도 잡는다.
    expect(screen.queryAllByText(/›/)).toHaveLength(0);
  });

  it('"출발점 변경" 옆 chevron 은 muted 색 오른쪽 꺾쇠 글리프 하나다', () => {
    renderRows([assignedRow()]);

    const toggle = screen.getByTestId('my-stays-base-toggle-s1');
    const strokes = svgStrokes(toggle);
    expect(strokes.map((n) => n.props.d)).toEqual(['M9 6L15 12L9 18']);
    expect(strokeOf(strokes[0] as ReactTestInstance)).toBe(
      svgColor(COLORS.muted as string)
    );
  });
});

describe('🔴 TRIP-777 · l04 default — 칩·카드·주소·구분선 (AC-2)', () => {
  const withMemo = () => assignedRow({ memoLabel: '예약번호 미입력' });

  it('칩 3종(날짜·출처·메모)은 모두 모서리 8 이다', () => {
    renderRows([withMemo()]);

    const row = screen.getByTestId('my-stays-row-s1');
    for (const label of ['6.10 ~ 6.13', 'OTA 예약', '예약번호 미입력']) {
      const chip = nearestHost(within(row).getByText(label));
      expect(tokens(chip)).toContain('rounded-[8px]');
      expect(tokens(chip)).not.toContain('rounded-pill');
    }
  });

  it('날짜 칩 글자는 body색, 출처·메모(아웃라인) 칩 글자는 둘 다 muted색이다', () => {
    renderRows([withMemo()]);

    const row = screen.getByTestId('my-stays-row-s1');
    const date = within(row).getByText('6.10 ~ 6.13');
    expect(tokens(date)).toContain('text-body');
    expect(tokens(date)).not.toContain('text-muted');
    for (const label of ['OTA 예약', '예약번호 미입력']) {
      const text = within(row).getByText(label);
      expect(tokens(text)).toContain('text-muted');
      expect(tokens(text)).not.toContain('text-body');
    }
  });

  it('카드는 모서리 12 이고, 카드 사이 간격은 16(gap-lg)이다', () => {
    renderRows([assignedRow(), unassignedRow()]);

    const first = screen.getByTestId('my-stays-row-s1');
    const second = screen.getByTestId('my-stays-row-s2');
    expect(tokens(first)).toContain('rounded-[12px]');
    expect(tokens(first)).not.toContain('rounded-card');

    const gaps = gapTokensBetween(first, second);
    expect(gaps).toContain('gap-lg');
    expect(gaps).not.toContain('gap-md');
  });

  it('주소가 있으면 13 muted 한 줄이 생기고, 비어 있으면 그 줄이 없다(짝)', () => {
    renderRows([
      assignedRow(),
      assignedRow({ savedStayId: 's5', location: '' }),
    ]);

    const address = within(screen.getByTestId('my-stays-row-s1')).getByText(
      '부산 해운대구 우동'
    );
    expect(tokens(address)).toEqual(
      expect.arrayContaining(['text-label', 'text-muted'])
    );

    // 주소만 다른 두 카드 — 글자 조각 수가 정확히 1 차이(빈 줄을 그리면 차이가 0).
    const withAddress = hostTextCount(screen.getByTestId('my-stays-row-s1'));
    const without = hostTextCount(screen.getByTestId('my-stays-row-s5'));
    expect(withAddress - without).toBe(1);
  });

  it('카드 안 구분선은 border-hairline 한 변 테두리가 아니라 1px 막대(h-px bg-hairline)다', () => {
    renderRows([assignedRow()]);

    const row = screen.getByTestId('my-stays-row-s1');
    const hosts = row.findAll((n) => typeof n.type === 'string');
    // 긍정 짝 — 막대가 실제로 있다(아무것도 안 그려서 아래 0 이 되는 공짜 통과 차단).
    expect(
      hosts.some(
        (n) => tokens(n).includes('h-px') && tokens(n).includes('bg-hairline')
      )
    ).toBe(true);
    // 부정 — `border-hairline` 은 네 변 두께를 함께 건드려 모서리가 각진다(repo-traps).
    const oneSide = /^border-[tblr]$/;
    const offenders = hosts.filter(
      (n) =>
        tokens(n).includes('border-hairline') &&
        tokens(n).some((t) => oneSide.test(t))
    );
    expect(offenders.map((n) => tokens(n).join(' '))).toEqual([]);
  });
});

describe('🔴 TRIP-777 · l04 empty (AC-3)', () => {
  it('제목 없이 설명만 있고, 설명은 14 muted 가운데 정렬이다', () => {
    renderEmpty();

    const empty = screen.getByTestId('my-stays-empty');
    const description = within(empty).getByText(EMPTY_DESCRIPTION);
    expect(tokens(description)).toEqual(
      expect.arrayContaining(['text-body', 'text-muted', 'text-center'])
    );
    expect(tokens(description)).not.toContain('text-label');
    expect(screen.queryByText('아직 등록된 숙소가 없어요')).toBeNull();
  });

  it('아이콘 원은 96 · surface-strong 바탕이고 연핑크(primary-pale)가 아니다', () => {
    renderEmpty();

    const icon = within(screen.getByTestId('my-stays-empty')).getByTestId(
      'my-stays-empty-icon'
    );
    expect(tokens(icon)).toEqual(
      expect.arrayContaining([
        'h-[96px]',
        'w-[96px]',
        'rounded-full',
        'bg-surface-strong',
      ])
    );
    expect(tokens(icon)).not.toContain('bg-primary-pale');
  });

  it('침대 글리프는 Figma 선 4개이고, 선 색은 모두 muted-soft · 굵기 2 다', () => {
    renderEmpty();

    const strokes = svgStrokes(screen.getByTestId('my-stays-empty-icon'));
    expect(strokes).toHaveLength(BED_PATHS.length);
    expect(strokes.map((n) => n.props.d).sort()).toEqual([...BED_PATHS].sort());
    strokes.forEach((n) => {
      expect(strokeOf(n)).toBe(svgColor(MUTED_SOFT));
      expect(n.props.strokeWidth).toBe(2);
    });
  });

  it('"숙소 탐색" 버튼은 내용 폭(가로 여백 22) · 높이 44 · 모서리 12 이고 고정 폭이 없다', () => {
    renderEmpty();

    const cta = screen.getByTestId('my-stays-explore');
    expect(tokens(cta)).toEqual(
      expect.arrayContaining([
        'h-[44px]',
        'rounded-button',
        'bg-primary',
        'px-[22px]',
      ])
    );
    expect(tokens(cta)).not.toContain('h-12');
    expect(tokens(cta).filter((t) => t.startsWith('w-'))).toEqual([]);

    const label = within(cta).getByText('숙소 탐색');
    expect(tokens(label)).toEqual(
      expect.arrayContaining([
        'font-noto-bold',
        'text-card-title',
        'text-on-primary',
      ])
    );
  });

  it('안내 묶음은 가운데 정렬이고 요소 사이 간격은 16(gap-lg)이다', () => {
    renderEmpty();

    const empty = screen.getByTestId('my-stays-empty');
    expect(tokens(empty)).toEqual(
      expect.arrayContaining(['items-center', 'gap-lg'])
    );
    expect(tokens(empty)).not.toContain('gap-md');
  });
});

describe('🔴 TRIP-777 · l04 출발점 다이얼로그 (AC-4)', () => {
  function openDialog() {
    renderRows([assignedRow()]);
    fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));
  }

  it('딤은 화면 전체를 덮는 검정 55% 오버레이다', () => {
    openDialog();

    const dim = screen.getByTestId('my-stays-base-dialog');
    expect(tokens(dim)).toEqual(
      expect.arrayContaining(['absolute', 'inset-0', 'bg-scrim/55'])
    );
    expect(tokens(dim)).not.toContain('bg-scrim/40');
  });

  it('카드는 폭 330 · 모서리 20 이다', () => {
    openDialog();

    const card = nearestCommonHost(
      screen.getByText('출발점을 바꿀까요?'),
      screen.getByTestId('my-stays-base-cancel')
    );
    expect(tokens(card)).toEqual(
      expect.arrayContaining(['w-[330px]', 'rounded-[20px]'])
    );
    expect(tokens(card)).not.toContain('w-[320px]');
  });

  it('제목은 19 Bold ink 이고, 본문은 body색(muted 아님)이다', () => {
    openDialog();

    const title = screen.getByText('출발점을 바꿀까요?');
    expect(tokens(title)).toEqual(
      expect.arrayContaining(['text-[19px]', 'font-noto-bold', 'text-ink'])
    );
    expect(tokens(title)).not.toContain('text-[18px]');

    const body = screen.getByText(/처음부터 다시 생성/);
    expect(tokens(body)).toContain('text-body');
    expect(tokens(body)).not.toContain('text-muted');
  });

  it('버튼 둘은 높이 44 이고, 취소 글자는 body색 · 확정 글자는 흰색이다', () => {
    openDialog();

    for (const id of ['my-stays-base-cancel', 'my-stays-base-confirm']) {
      const button = screen.getByTestId(id);
      expect(tokens(button)).toContain('h-[44px]');
      expect(tokens(button)).not.toContain('h-12');
    }

    const cancel = within(screen.getByTestId('my-stays-base-cancel')).getByText(
      '취소'
    );
    expect(tokens(cancel)).toContain('text-body');
    expect(tokens(cancel)).not.toContain('text-ink');

    const confirm = within(
      screen.getByTestId('my-stays-base-confirm')
    ).getByText('일정 다시 생성');
    expect(tokens(confirm)).toContain('text-on-primary');
  });
});

describe('TRIP-777 · ChevronRightGlyph 기본색 무회귀 (AC-7, 선제 green 앵커)', () => {
  it('color 를 안 넘기면 여전히 hairline-strong 색이다(다른 화면 4곳이 기대는 값)', () => {
    const { root } = render(<ChevronRightGlyph />);

    const strokes = svgStrokes(root);
    expect(strokes).toHaveLength(1);
    expect(strokeOf(strokes[0] as ReactTestInstance)).toBe(
      svgColor(COLORS['hairline-strong'] as string)
    );
  });
});
