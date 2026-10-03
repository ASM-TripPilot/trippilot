import { render, screen } from '@testing-library/react-native';

import type { ReplanSlotVM } from '@/entities/itinerary-slot';

import { ReplanSolvingView } from './ReplanSolvingView';

/**
 * TRIP-1205 · i05 시트 빈 곳의 스켈레톤 슬롯 카드 2장(Figma `4817:2695`).
 * ⚠️ 원리적 사각: 펄스 움직임·회색 블록 윤곽은 jest 가 못 본다(6-b 육안) — 여기선 개수·testID·문구까지.
 */

const SLOT: ReplanSlotVM = {
  slotKey: 'v1',
  placeName: '감천문화마을',
  tone: 'visited',
  photo: { uri: 'file:///g.jpg' },
  category: 'SIGHT',
  timeLabel: '09:30 방문',
  categoryLabel: '마을 · 벽화',
  distanceRange: null,
  isFixed: false,
};

function renderView(slots: ReplanSlotVM[]) {
  render(
    <ReplanSolvingView
      center={{ lat: 35.1587, lng: 129.1604 }}
      solvingLabel="17시 이후 다시 짜는 중"
      dayLabel="2일차"
      dateLabel="6월 11일(목)"
      meta="방문한 1곳 그대로"
      slots={slots}
      onBack={jest.fn()}
      onCancel={jest.fn()}
    />
  );
}

describe('🔴 SK-1 — 스켈레톤 슬롯 카드 2장', () => {
  it.each([[[SLOT]], [[]]])(
    '방문 슬롯 %#번 경우에도 카드가 정확히 2장이고 3번째는 없다',
    (slots) => {
      renderView(slots);

      expect(screen.getByTestId('planb-skeleton-card-1')).toBeOnTheScreen();
      expect(screen.getByTestId('planb-skeleton-card-2')).toBeOnTheScreen();
      expect(screen.queryByTestId('planb-skeleton-card-3')).toBeNull();
    }
  );

  it('카드 안에는 번호 원·사진·시간·제목·보조 자리가 있고 글자가 없다', () => {
    renderView([]);

    for (const part of ['num', 'photo', 'time', 'title', 'meta']) {
      expect(
        screen.getByTestId(`planb-skeleton-card-1-${part}`)
      ).toBeOnTheScreen();
    }
    expect(screen.getByTestId('planb-skeleton-card-1')).not.toHaveTextContent(
      /\S/
    );
  });

  it('스켈레톤은 새 안내 문장·퍼센트·시간 표기를 만들지 않는다', () => {
    renderView([]);

    expect(screen.queryByText(/잠시만|기다려/)).toBeNull();
    expect(screen.queryByText(/%|남은/)).toBeNull();
  });
});
