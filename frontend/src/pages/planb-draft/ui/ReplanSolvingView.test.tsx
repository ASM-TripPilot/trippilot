import { fireEvent, render, screen } from '@testing-library/react-native';

import type { ReplanSlotVM } from '@/entities/itinerary-slot/model';

import { ReplanSolvingView } from './ReplanSolvingView';

/**
 * TRIP-752 · AC-2·3·4·5·14 · Seed Q8 — i05 "다시 짜는 중" **순수 뷰**(pages · api import 0).
 * Figma `4341:1957`.
 *
 * 무엇을 보장하나:
 *  - 전면 지도 + 좌상단 진행 카드(제목·[취소]·2칸 막대·캡션 2개) + 하단 peek 시트(40%에서 시작).
 *  - 시트는 헤더 `AI 재계획안 · 2일차 · 6월 11일(목)` + `방문한 3곳 그대로`, 방문 완료 행, 행 사이 거리 커넥터.
 *  - 방문 행은 초록 번호·"다른 후보" 없음. 하단 CTA 바는 없다.
 *  - 옛 i12 화면의 부제·체크리스트·안심 노트·[백그라운드로]는 사라졌다.
 *  - [취소]는 onCancel 만, ‹ 는 onBack 만 부른다(옛 i12 S2·S3 계약 계승).
 *
 * ⚠️ 원리적 사각: 40% 높이·지도 핀·경로선·현재위치 점은 통과형 시트 목·네이버 목이 못 본다(AC-V1 육안).
 */

const photo = (name: string) => ({ uri: `file:///${name}.jpg` });

const SLOTS: ReplanSlotVM[] = [
  {
    slotKey: 'v1',
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
    slotKey: 'v2',
    placeName: '광안리 해변',
    tone: 'visited',
    photo: photo('gwangalli'),
    category: 'NATURE',
    timeLabel: '11:00 방문',
    categoryLabel: '바다 · 산책',
    distanceRange: '1.4km',
    isFixed: false,
  },
];

/** 옛 i12 화면에만 있던 문구 — 새 화면 어디에도 없어야 한다(AC-5). */
const REMOVED_TEXTS = [
  '백그라운드로',
  '5초쯤',
  '비 예보·남은 시간 반영',
  '대안 후보 거리·동선 계산',
  '대안 영업시간 확인 중',
  '새 동선 완성',
  '바뀌는 건 남은 일정 뿐',
];

function renderView(overrides: Record<string, unknown> = {}) {
  const handlers = { onBack: jest.fn(), onCancel: jest.fn() };
  render(
    <ReplanSolvingView
      center={{ lat: 35.1587, lng: 129.1604 }}
      solvingLabel="17시 이후 다시 짜는 중"
      dayLabel="2일차"
      dateLabel="6월 11일(목)"
      meta="방문한 3곳 그대로"
      slots={SLOTS}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

function classTokens(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);
}

function textsOf(pattern: RegExp): string[] {
  return screen
    .queryAllByTestId(pattern)
    .map((node) => String(node.props.children));
}

/** 셸이 BottomSheet 에 넘긴 props(통과형 목이 View 에 그대로 펼친다 — 02a ★14). */
function sheetProps(): { index: number; snapPoints: unknown }[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.props?.index === 'number' &&
        Array.isArray(node.props?.snapPoints)
    )
    .map((node) => ({
      index: node.props.index as number,
      snapPoints: node.props.snapPoints as unknown,
    }));
}

describe('🔴 VS1 · AC-2·3 · Q8 — 진행 카드 + 헤더 + peek 시트', () => {
  it('카드 제목·칸 2개(라벨·트랙 톤)·헤더 4칸이 Figma 와 같고, 시트는 40% 에서 시작하며 일차 칩은 없다', () => {
    renderView();

    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    expect(screen.getByText('AI가 일정을 다시 짜고 있어요')).toBeOnTheScreen();
    expect(
      screen.getByTestId('generation-gauge-cell-1-done')
    ).toHaveTextContent('방문한 곳 그대로');
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toHaveTextContent('17시 이후 다시 짜는 중');
    expect(classTokens('generation-gauge-track-1')).toContain('bg-primary');
    expect(classTokens('generation-gauge-track-2')).toContain(
      'bg-surface-strong'
    );

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.getByTestId('sheet-header-day')).toHaveTextContent('2일차');
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 11일(목)'
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent(
      '방문한 3곳 그대로'
    );

    const sheets = sheetProps();
    expect(sheets.length).toBeGreaterThan(0);
    sheets.forEach((sheet) => {
      expect(sheet.index).toBe(0);
      expect(sheet.snapPoints).toEqual(['40%', '88%']);
    });

    // 진행 카드가 셸 overlay 자리를 차지했다 — 일차 칩 오버레이는 그려지지 않는다(02a ★15).
    expect(screen.queryByTestId('sheet-daychip-back')).toBeNull();
  });
});

describe('🔴 VS2 · AC-4 — 방문 완료 행과 거리 커넥터', () => {
  it('행 2개가 입력 순서·초록 번호·방문 시각 알약으로 그려지고, "다른 후보"는 없으며, 커넥터는 다음 행 거리 1개다', () => {
    renderView();

    expect(textsOf(/^planb-draft-slot-name-/)).toEqual([
      '감천문화마을',
      '광안리 해변',
    ]);
    const numbers = screen.getAllByTestId(/^planb-draft-slot-number-/);
    expect(numbers).toHaveLength(2);
    numbers.forEach((node) =>
      expect(String(node.props.className).split(/\s+/)).toContain('bg-success')
    );
    expect(screen.getByTestId('planb-draft-slot-time-v1')).toHaveTextContent(
      '09:30 방문'
    );
    expect(screen.getByTestId('planb-draft-slot-time-v2')).toHaveTextContent(
      '11:00 방문'
    );
    expect(screen.queryAllByTestId(/^planb-draft-candidates-/)).toHaveLength(0);

    expect(textsOf(/^sheet-connector-distance-/)).toEqual(['1.4km']);
  });
});

describe('🔴 VS3 · AC-4 — 아직 다녀온 곳이 없으면 행이 비어도 화면은 그대로', () => {
  it('slots 가 [] 이면 행·커넥터가 0건이고 진행 카드·헤더 제목은 남는다', () => {
    renderView({ slots: [] });

    expect(screen.queryAllByTestId(/^planb-draft-slot-name-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^sheet-connector-/)).toHaveLength(0);
    expect(screen.getByTestId('generation-progress-card')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
  });
});

describe('🔴 VS4 · AC-2 — [취소]와 ‹ 는 서로 섞이지 않는다', () => {
  it('[취소]를 누르면 onCancel 만 1회 불린다', () => {
    const { onBack, onCancel } = renderView();

    fireEvent.press(screen.getByTestId('generation-progress-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('‹ 를 누르면 onBack 만 1회 불린다(세션을 살린 채 나가기)', () => {
    const { onBack, onCancel } = renderView();

    fireEvent.press(screen.getByTestId('generation-progress-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('🔴 VS5 · AC-5 — 옛 i12 표면과 CTA 바가 없다', () => {
  it('CTA 바·옛 testID 3종·옛 문구가 트리에 0건이다', () => {
    renderView();

    expect(screen.queryAllByTestId(/^sheet-cta/)).toHaveLength(0);
    for (const id of [
      'planb-solving-background',
      'planb-solving-progress',
      'planb-solving-cancel',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    const tree = JSON.stringify(screen.toJSON());
    for (const text of REMOVED_TEXTS) {
      expect(tree).not.toContain(text);
    }
  });
});

describe('🔴 VS6 · AC-3 — 일차·날짜·곳 수를 모르면 제목만 남긴다', () => {
  it('빈 문자열이면 day·date 칸이 없고 meta 는 비어 있다', () => {
    renderView({ dayLabel: '', dateLabel: '', meta: '' });

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      'AI 재계획안'
    );
    expect(screen.queryByTestId('sheet-header-day')).toBeNull();
    expect(screen.queryByTestId('sheet-header-date')).toBeNull();
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('');
  });
});

describe('🔴 VS7 · AC-14 — INV-3', () => {
  it('렌더 트리에 소요시간 표기가 없다(거리는 있다)', () => {
    renderView();

    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain('1.4km');
    expect(tree).not.toMatch(/\d+\s*분|\d+\s*시간|소요/);
  });
});
