import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { ReplanSlotVM } from '@/entities/itinerary-slot/model';

import { ReplanDraftView } from './ReplanDraftView';

/**
 * TRIP-751 · AC-1·2·4·5·6·7·13 · Seed Q3·Q6·Q8 — i06 재계획안 **순수 뷰**(pages · api import 0).
 * Figma `4314:1923`(펼침)·`4335:1923`(대안 없음).
 *
 * 무엇을 보장하나:
 *  - 지도+시트 셸 위에 헤더 `AI 재계획안 · 2일차 · 6월 11일(목)` + `5곳 · 6.3km`, 번호 행 5개,
 *    행 사이 거리 커넥터(다음 행의 거리), 하단 [직접 수정]/[적용하기]를 그린다. 시트는 펼침(index 1).
 *  - 대안 없음·실패는 같은 화면의 상태다 — 헤더 아래 안내 2줄, 버튼 교체, (대안 없음이면) 예정 행 흐림.
 *  - 확정 요청 중에는 [적용하기]가 잠기고, 확정 실패는 같은 안내 자리에 뜬다(Q6).
 *  - 라이브 degrade(Q8)면 제목만 남고 일차·날짜·곳 수·칩·행이 없다.
 *
 * ⚠️ 원리적 사각: 시트 88% 스냅·CTA 가림·흐림 정도·번호 색은 통과형 목/클래스 문자열까지만 본다(AC-V1·V2).
 */

const photo = (name: string) => ({ uri: `file:///${name}.jpg` });

const SLOTS: ReplanSlotVM[] = [
  {
    slotKey: 's1',
    placeName: '감천문화마을',
    tone: 'visited',
    photo: photo('gamcheon'),
    category: 'SIGHT',
    timeLabel: '09:30 방문',
    categoryLabel: '마을 · 벽화',
    distanceRange: null,
    isFixed: false,
  },
  {
    slotKey: 's2',
    placeName: '광안리 해변',
    tone: 'visited',
    photo: photo('gwangalli'),
    category: 'NATURE',
    timeLabel: '11:00 방문',
    categoryLabel: '바다 · 산책',
    distanceRange: '1.4km',
    isFixed: false,
  },
  {
    slotKey: 's3',
    placeName: '부산시립미술관',
    tone: 'visited',
    photo: photo('museum'),
    category: 'CULTURE',
    timeLabel: '13:00 도착 · 관람 중',
    categoryLabel: '미술 · 실내',
    distanceRange: '3.2km',
    isFixed: false,
  },
  {
    slotKey: 's4',
    placeName: '전포 카페거리',
    tone: 'planned',
    photo: photo('cafe'),
    category: 'CAFE',
    timeLabel: '15:00–16:30',
    categoryLabel: '카페 · 실내',
    distanceRange: '600m',
    isFixed: false,
  },
  {
    slotKey: 's5',
    placeName: 'F1963 복합문화공간',
    tone: 'planned',
    photo: photo('f1963'),
    category: 'CULTURE',
    timeLabel: '17:00–18:30',
    categoryLabel: '전시 · 실내',
    distanceRange: '1.1km',
    isFixed: false,
  },
];

const NAMES = SLOTS.map((slot) => slot.placeName);

const NOSOLUTION_DESC =
  '17시 이후 실내 후보가 근처에 없어요 · 조건을 줄이거나 직접 고쳐 주세요';

type Overrides = Record<string, unknown>;

function renderView(overrides: Overrides = {}) {
  const handlers = {
    onBack: jest.fn(),
    onManualEdit: jest.fn(),
    onApply: jest.fn(),
    onReopenRequest: jest.fn(),
    onPressCandidates: jest.fn(),
  };
  render(
    <ReplanDraftView
      variant="draft"
      center={{ lat: 35.1587, lng: 129.1604 }}
      days={[{ label: '1일차' }, { label: '2일차' }, { label: '3일차' }]}
      selectedDayIndex={1}
      dayLabel="2일차"
      dateLabel="6월 11일(목)"
      meta="5곳 · 6.3km"
      slots={SLOTS}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

function classTokens(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '').split(/\s+/);
}

function textsOf(pattern: RegExp): string[] {
  return screen
    .queryAllByTestId(pattern)
    .map((node) => String(node.props.children));
}

/** 시트가 받은 초기 스냅 **칸 값**들 — snapPoints[index](TRIP-920: 숫자 index 는 셸 배열이 바뀌면 뜻이 밀린다). */
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

const DIMMED = /^opacity-(45|\[0\.45\])$/;

function dimmedSlotKeys(): string[] {
  return SLOTS.map((slot) => slot.slotKey).filter((key) =>
    classTokens(screen.getByTestId(`planb-draft-slot-${key}`)).some((token) =>
      DIMMED.test(token)
    )
  );
}

describe('🔴 V1 · AC-2 — 펼침 헤더·일차 칩·시트 스냅', () => {
  it('셸 위에 헤더 4 leaf 가 주입값과 완전히 같고, 칩 2일차가 선택, 시트는 펼침(88%) 칸이다', () => {
    renderView();

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '5곳 · 6.3km'
    );
    expect(screen.getByTestId('sheet-daychip-1')).toBeSelected();

    // TRIP-920 심판 수정 — 숫자 index 가 아니라 그 index 가 가리키는 칸 값(펼침 = 88%).
    const values = sheetSnapValues();
    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => expect(value).toBe('88%'));

    expect(screen.queryByTestId('planb-draft-notice')).toBeNull();
  });
});

describe('🔴 V2 · AC-3 — 행 5개: 순서·번호·톤·다른 후보', () => {
  it('Figma 순서로 번호 1~5, 방문 3행 초록·예정 2행 빨강, "다른 후보"는 예정 2행에만 있고 누르면 slotKey 로 1회', () => {
    const { onPressCandidates } = renderView();

    expect(textsOf(/^planb-draft-slot-name-/)).toEqual(NAMES);
    const numbers = screen.getAllByTestId(/^planb-draft-slot-number-/);
    expect(numbers).toHaveLength(5);
    numbers.forEach((node, i) => expect(node).toHaveTextContent(String(i + 1)));
    expect(
      numbers.map((node) =>
        classTokens(node).includes('bg-success')
          ? 'success'
          : classTokens(node).includes('bg-primary')
            ? 'primary'
            : 'none'
      )
    ).toEqual(['success', 'success', 'success', 'primary', 'primary']);

    expect(
      screen
        .getAllByTestId(/^planb-draft-candidates-/)
        .map((node) => node.props.testID)
    ).toEqual(['planb-draft-candidates-s4', 'planb-draft-candidates-s5']);

    fireEvent.press(screen.getByTestId('planb-draft-candidates-s4'));
    expect(onPressCandidates).toHaveBeenCalledTimes(1);
    expect(onPressCandidates).toHaveBeenCalledWith('s4');

    expect(dimmedSlotKeys()).toEqual([]);
  });
});

describe('🔴 V3 · AC-4 — 커넥터는 행 N-1 개, 다음 행의 거리를 그대로', () => {
  it('거리 leaf 가 트리 순서로 [1.4km, 3.2km, 600m, 1.1km] 이다', () => {
    renderView();

    expect(textsOf(/^sheet-connector-distance-/)).toEqual([
      '1.4km',
      '3.2km',
      '600m',
      '1.1km',
    ]);
  });

  it('다음 행 거리가 null 이면 그 커넥터는 "이동 거리 계산 중" 이다', () => {
    renderView({
      slots: SLOTS.map((slot) =>
        slot.slotKey === 's5' ? { ...slot, distanceRange: null } : slot
      ),
    });

    expect(textsOf(/^sheet-connector-distance-/)).toEqual([
      '1.4km',
      '3.2km',
      '600m',
      '이동 거리 계산 중',
    ]);
  });
});

describe('🔴 V4 · AC-5 — 펼침 CTA', () => {
  it('[직접 수정](outline)·[적용하기](primary) 이고 각 버튼은 자기 콜백만 1회 부른다', () => {
    const handlers = renderView();

    const manual = screen.getByTestId('sheet-cta-button-0');
    const apply = screen.getByTestId('sheet-cta-button-1');
    expect(manual).toHaveTextContent('직접 수정');
    expect(apply).toHaveTextContent('적용하기');
    expect(classTokens(manual)).toContain('border');
    expect(classTokens(apply)).toContain('bg-primary');
    expect(screen.queryByText('이대로 적용')).toBeNull();

    fireEvent.press(manual);
    expect(handlers.onManualEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onApply).not.toHaveBeenCalled();

    fireEvent.press(apply);
    expect(handlers.onApply).toHaveBeenCalledTimes(1);
    expect(handlers.onManualEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onReopenRequest).not.toHaveBeenCalled();
  });
});

describe('🔴 V5 · AC-9(d) · Q6 — 확정 요청 중 잠금', () => {
  it('applyPending 이면 [적용하기]가 disabled 이고 눌러도 onApply 가 안 불린다', () => {
    const { onApply } = renderView({ applyPending: true });

    const apply = screen.getByTestId('sheet-cta-button-1');
    expect(apply).toHaveTextContent('적용하기');
    expect(apply).toBeDisabled();
    fireEvent.press(apply);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('🔴 V5b · 5-b 경고-1 — 확정 요청 중 [직접 수정]도 잠금(교차 잠금)', () => {
  it('applyPending 이면 [직접 수정]도 disabled 이고 눌러도 onManualEdit 가 안 불린다', () => {
    const { onManualEdit } = renderView({ applyPending: true });

    const manual = screen.getByTestId('sheet-cta-button-0');
    expect(manual).toHaveTextContent('직접 수정');
    expect(manual).toBeDisabled();
    fireEvent.press(manual);
    expect(onManualEdit).not.toHaveBeenCalled();
  });
});

describe('🔴 V6 · AC-9(e) · Q6 — 확정 실패 안내', () => {
  it('applyFailed 면 같은 안내 자리에 실패 문구가 뜨고, 버튼은 그대로라 [적용하기]가 재시도다', () => {
    const { onApply } = renderView({ applyFailed: true });

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '변경을 반영하지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(
      '원래 일정은 그대로 있어요. 잠시 후 다시 시도해 주세요.'
    );
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    const apply = screen.getByTestId('sheet-cta-button-1');
    expect(apply).toHaveTextContent('적용하기');

    fireEvent.press(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 V7 · AC-6 · Q3 — 대안 없음 상태', () => {
  it('안내 2줄 · meta 숨김 · 예정 행 전부 흐림 · 다른 후보 0 · [조건 바꿔 다시 짜기]가 onReopenRequest 만 1회', () => {
    const handlers = renderView({
      variant: 'noSolution',
      noSolutionDescription: NOSOLUTION_DESC,
    });

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '대안을 찾지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent(NOSOLUTION_DESC);
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.queryAllByText('5곳 · 6.3km')).toHaveLength(0);

    expect(textsOf(/^planb-draft-slot-name-/)).toEqual(NAMES);
    expect(dimmedSlotKeys()).toEqual(['s4', 's5']);
    expect(screen.queryAllByTestId(/^planb-draft-candidates-/)).toHaveLength(0);

    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    const reopen = screen.getByTestId('sheet-cta-button-1');
    expect(reopen).toHaveTextContent('조건 바꿔 다시 짜기');
    fireEvent.press(reopen);
    expect(handlers.onReopenRequest).toHaveBeenCalledTimes(1);
    expect(handlers.onApply).not.toHaveBeenCalled();
    expect(handlers.onManualEdit).not.toHaveBeenCalled();

    expect(screen.queryByTestId('planb-noalt-skip')).toBeNull();
    expect(screen.queryByTestId('planb-noalt-rest')).toBeNull();
    expect(screen.queryByText(/휴식 모드|건너뛰기/)).toBeNull();
  });
});

describe('🔴 V8 · AC-7 · E3 — 실패(FAILED) 상태', () => {
  it('안내 "다시 짜지 못했어요" 2줄 · [직접 수정]/[다시 시도] · [다시 시도]가 onReopenRequest 만 1회', () => {
    const handlers = renderView({ variant: 'failed' });

    expect(screen.getByTestId('planb-draft-notice-title')).toHaveTextContent(
      '다시 짜지 못했어요'
    );
    expect(
      screen.getByTestId('planb-draft-notice-description')
    ).toHaveTextContent('잠시 후 다시 시도하거나 직접 고쳐 주세요');
    expect(screen.getByTestId('sheet-cta-button-0')).toHaveTextContent(
      '직접 수정'
    );
    const retry = screen.getByTestId('sheet-cta-button-1');
    expect(retry).toHaveTextContent('다시 시도');

    fireEvent.press(retry);
    expect(handlers.onReopenRequest).toHaveBeenCalledTimes(1);
    expect(handlers.onApply).not.toHaveBeenCalled();
  });

  it('V8b · 5-b 참고-1 — 행이 있어도 "다른 후보"는 0건이고 흐린 행도 없다(교체할 안도, 안 없음 판정도 없는 오류 얼굴)', () => {
    renderView({ variant: 'failed' });

    expect(textsOf(/^planb-draft-slot-name-/)).toEqual(NAMES);
    expect(screen.queryAllByTestId(/^planb-draft-candidates-/)).toHaveLength(0);
    expect(dimmedSlotKeys()).toEqual([]);
  });
});

describe('🔴 V9 · Q8 · E4 — 라이브 정직 degrade', () => {
  it('일차·날짜·곳 수·칩·행이 비면 제목과 뒤로가기만 남고, 뒤로가기는 onBack 을 1회 부른다', () => {
    const { onBack } = renderView({
      dayLabel: '',
      dateLabel: '',
      meta: '',
      days: [],
      slots: [],
    });

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.queryByTestId('sheet-header-day')).toBeNull();
    expect(screen.queryByTestId('sheet-header-date')).toBeNull();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('');
    expect(screen.queryByTestId('sheet-daychip-0')).toBeNull();
    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^sheet-connector-/)).toHaveLength(0);

    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 V10 · AC-13 — INV-3', () => {
  it('렌더 트리에 소요시간 표기가 없다(거리는 있다)', () => {
    renderView();

    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain('1.4km');
    expect(tree).not.toMatch(/\d+\s*분|\d+\s*시간|소요/);
  });
});
