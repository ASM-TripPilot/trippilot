import { fireEvent, render, screen } from '@testing-library/react-native';

import type { CuratedStay } from '@/shared/api/index.schemas';

import { BrowseAllButton } from './BrowseAllButton';
import { CuratedStayCard } from './CuratedStayCard';

/**
 * TRIP-1579 — 인기 숙소 카드(사진·이름·하트, 주소는 있을 때만 한 줄)와 전체 보기 버튼. 순수 뷰 — 저장 상태·
 * 핸들러는 props. 평점·가격은 그리지 않는다(BR-U1-18 — 계약에 필드가 없다).
 */

const STAY: CuratedStay = {
  rank: 1,
  stayId: 'TRIPCOM:123',
  name: '롯데호텔 서울',
  address: '서울 중구 을지로 30',
  imageUrl: 'https://ak-d.tripcdn.com/images/a.jpg',
};

function renderCard(
  overrides: Partial<Parameters<typeof CuratedStayCard>[0]> = {}
) {
  const onPress = jest.fn();
  const onToggleSave = jest.fn();
  render(
    <CuratedStayCard
      stay={STAY}
      saved={false}
      onPress={onPress}
      onToggleSave={onToggleSave}
      {...overrides}
    />
  );
  return { onPress, onToggleSave };
}

describe('V1 · 카드 내용', () => {
  it('이름·주소 한 줄을 그리고, 사진 자리가 있다', () => {
    renderCard();

    const card = screen.getByTestId('curated-stay-card-123');
    expect(card).toBeOnTheScreen();
    expect(screen.getByText('롯데호텔 서울')).toBeOnTheScreen();
    expect(screen.getByText('서울 중구 을지로 30')).toBeOnTheScreen();
    expect(screen.getByTestId('curated-stay-photo-123')).toBeOnTheScreen();
  });

  it.each([null, undefined, ''])('주소가 %p 면 주소 줄이 없다', (address) => {
    renderCard({ stay: { ...STAY, address } });

    expect(screen.getByText('롯데호텔 서울')).toBeOnTheScreen();
    expect(screen.queryByTestId('curated-stay-address-123')).toBeNull();
  });
});

describe('V2 · 누름', () => {
  it('하트 누름은 onToggleSave 만, 카드 누름은 onPress 만 부른다', () => {
    const { onPress, onToggleSave } = renderCard();

    fireEvent.press(screen.getByTestId('curated-stay-heart-123'));
    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('curated-stay-card-123'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onToggleSave).toHaveBeenCalledTimes(1);
  });

  it('담김은 selected 상태 + 찬 하트 글리프다', () => {
    renderCard({ saved: true });

    expect(screen.getByTestId('curated-stay-heart-123')).toBeSelected();
    expect(
      screen.getByTestId('curated-stay-heart-123-filled')
    ).toBeOnTheScreen();
  });
});

describe('V3 · 전체 보기 버튼', () => {
  it('문구 「Trip.com에서 전체 숙소 보기」, 누르면 onPress', () => {
    const onPress = jest.fn();
    render(<BrowseAllButton onPress={onPress} />);

    const button = screen.getByTestId('curated-stay-browse-all');
    expect(screen.getByText('Trip.com에서 전체 숙소 보기')).toBeOnTheScreen();
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
