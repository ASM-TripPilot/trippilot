import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { coverFor, FALLBACK_COVER } from '@/test-support/placeCoverFixtures';

import type { ReplanSlotVM } from '../model';
import { ReplanSlotRow } from './ReplanSlotRow';

/**
 * TRIP-751 · AC-3 — i06 재계획안 슬롯 1행(순수 props+콜백). Figma `4314:1923` 행 계약.
 *
 * 무엇을 보장하나:
 *  - 번호 원은 index+1 이고, 톤이 색을 가른다(visited → bg-success, planned → bg-primary).
 *  - 시간 알약·장소명·카테고리 leaf 가 주입값과 완전히 같고, 없는 값은 요소째 안 그린다.
 *  - 사진이 없으면 같은 사진 칸에 카테고리 생성 이미지를 그린다(사이클 20261022-place-category-covers — 옛 틴트+아이콘
 *    플레이스홀더는 없어졌다). poiId 는 `slotKey`(`{date}#{poiId}`)에서 읽는다.
 *  - "다른 후보"는 콜백을 받았고 고정 행이 아닐 때만 뜨며, 후보 수를 적지 않고, 누르면 slotKey 로 1회.
 *
 * ⚠️ 원리적 사각: 번호 원의 실제 색·흐림 정도·글리프 모양은 클래스 문자열까지만 본다(육안 게이트).
 */

const PHOTO = { uri: 'file:///cafe.jpg' };

const PLANNED: ReplanSlotVM = {
  slotKey: 's4',
  placeName: '전포 카페거리',
  tone: 'planned',
  photo: PHOTO,
  category: 'CAFE',
  timeLabel: '15:00–16:30',
  categoryLabel: '카페 · 실내',
  distanceRange: '1.1km',
  isFixed: false,
};

function classTokens(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '').split(/\s+/);
}

describe('🔴 ReplanSlotRow · 예정 행 + 다른 후보 (AC-3)', () => {
  it('R1 · 번호 4·빨강 톤·시간/이름/카테고리·사진을 그리고, "다른 후보"를 누르면 slotKey 로 1회 부른다', () => {
    const onPressCandidates = jest.fn();
    render(
      <ReplanSlotRow
        vm={PLANNED}
        index={3}
        onPressCandidates={onPressCandidates}
      />
    );

    expect(screen.getByTestId('planb-draft-slot-s4')).toBeOnTheScreen();
    const number = screen.getByTestId('planb-draft-slot-number-s4');
    expect(number).toHaveTextContent('4');
    expect(classTokens(number)).toContain('bg-primary');
    expect(classTokens(number)).not.toContain('bg-success');

    expect(screen.getByTestId('planb-draft-slot-time-s4')).toHaveTextContent(
      '15:00–16:30'
    );
    expect(screen.getByTestId('planb-draft-slot-name-s4')).toHaveTextContent(
      '전포 카페거리'
    );
    expect(
      screen.getByTestId('planb-draft-slot-category-s4')
    ).toHaveTextContent('카페 · 실내');
    // 서버 사진이 있으면 그 사진 그대로(카테고리 'CAFE' 는 한글 정본이 아니어도 사진이 이긴다).
    expect(
      screen.getByTestId('planb-draft-slot-photo-s4').props.source
    ).toEqual([{ uri: 'file:///cafe.jpg' }]);

    const link = screen.getByTestId('planb-draft-candidates-s4');
    expect(link).toHaveTextContent(/^다른 후보/);
    expect(link).not.toHaveTextContent(/\d/);

    fireEvent.press(link);
    expect(onPressCandidates).toHaveBeenCalledTimes(1);
    expect(onPressCandidates).toHaveBeenCalledWith('s4');
  });
});

describe('🔴 ReplanSlotRow · 방문 톤 (AC-3)', () => {
  it('R2 · visited 는 번호 원이 bg-success 이고 index 0 이면 번호 1 이다', () => {
    render(
      <ReplanSlotRow
        vm={{ ...PLANNED, slotKey: 's1', tone: 'visited' }}
        index={0}
      />
    );

    const number = screen.getByTestId('planb-draft-slot-number-s1');
    expect(number).toHaveTextContent('1');
    expect(classTokens(number)).toContain('bg-success');
    expect(classTokens(number)).not.toContain('bg-primary');
  });
});

describe('🔴 ReplanSlotRow · "다른 후보" 부재 조건 (AC-3)', () => {
  it('R3a · 콜백을 주지 않으면 링크가 없다', () => {
    render(<ReplanSlotRow vm={PLANNED} index={3} />);

    expect(screen.getByTestId('planb-draft-slot-name-s4')).toBeOnTheScreen();
    expect(screen.queryByTestId('planb-draft-candidates-s4')).toBeNull();
  });

  it('R3b · 고정 행이면 콜백이 있어도 링크 대신 고정 pill 을 그린다', () => {
    render(
      <ReplanSlotRow
        vm={{ ...PLANNED, isFixed: true }}
        index={3}
        onPressCandidates={jest.fn()}
      />
    );

    expect(screen.getByTestId('planb-draft-fixed-s4')).toHaveTextContent(
      /고정/
    );
    expect(screen.queryByTestId('planb-draft-candidates-s4')).toBeNull();
  });
});

describe('🔴 ReplanSlotRow · 빈 값은 요소째 안 그린다 (AC-3)', () => {
  it('R4 · 사진 없음 → 같은 사진 칸에 생성 이미지, 시간·카테고리 없음 → 알약·카테고리 leaf 없음', () => {
    render(
      <ReplanSlotRow
        vm={{
          ...PLANNED,
          category: '카페',
          photo: null,
          timeLabel: null,
          categoryLabel: null,
        }}
        index={3}
      />
    );

    expect(screen.getByTestId('planb-draft-slot-name-s4')).toBeOnTheScreen();
    // slotKey 's4' 는 `{date}#{poiId}` 모양이 아니라 poiId 를 못 읽는다 → 변형 1.
    expect(
      screen.getByTestId('planb-draft-slot-photo-s4').props.source
    ).toEqual([coverFor('카페')]);
    expect(screen.queryByTestId('planb-draft-slot-time-s4')).toBeNull();
    expect(screen.queryByTestId('planb-draft-slot-category-s4')).toBeNull();
  });

  it('R4b · slotKey 가 "{date}#{poiId}" 면 poiId(poi-b → 변형 3)로 고른다 — slotKey 통째로 해시하지 않는다', () => {
    const slotKey = '2026-06-11#poi-b';
    render(
      <ReplanSlotRow
        vm={{ ...PLANNED, slotKey, category: '술집', photo: null }}
        index={3}
      />
    );

    // bar-3. slotKey 통째로 해시하면 변형 1 → bar-1 이다('2026-06-11#poi-b' → 변형 1, node 독립 계산).
    expect(
      screen.getByTestId(`planb-draft-slot-photo-${slotKey}`).props.source
    ).toEqual([coverFor('술집', 'poi-b')]);
  });

  it('R4c · 카테고리가 한글 정본이 아니면(CAFE·null) 중립 폴백이다', () => {
    const { rerender } = render(
      <ReplanSlotRow vm={{ ...PLANNED, photo: null }} index={3} />
    );
    expect(
      screen.getByTestId('planb-draft-slot-photo-s4').props.source
    ).toEqual([FALLBACK_COVER]);

    rerender(
      <ReplanSlotRow
        vm={{ ...PLANNED, category: null, photo: null }}
        index={3}
      />
    );
    expect(
      screen.getByTestId('planb-draft-slot-photo-s4').props.source
    ).toEqual([FALLBACK_COVER]);
  });
});

describe('🔴 ReplanSlotRow · INV-3 (AC-13)', () => {
  it('R6 · 렌더 트리에 소요시간 표기가 없다(시각 범위는 있다)', () => {
    render(
      <ReplanSlotRow vm={PLANNED} index={3} onPressCandidates={jest.fn()} />
    );

    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain('15:00–16:30');
    expect(tree).not.toMatch(/\d+\s*분|\d+\s*시간|소요/);
  });
});
