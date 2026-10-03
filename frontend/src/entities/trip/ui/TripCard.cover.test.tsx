import { render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { TripCard } from './TripCard';
import { COVER_GRADIENTS } from '../config/coverGradients';
import type { MyTripCardVM } from '../model';

/**
 * TRIP-1208 · h06 카드 커버 — 회색 박스 대신 가로 그라데이션 + 도시 이름(Figma 4828:2737).
 * 실제 색감·글자 대비는 jest 사각(6-b 실기). 여기는 구조·분기·폴백만 잠근다.
 */

function vm(over: Partial<MyTripCardVM> = {}): MyTripCardVM {
  return {
    tripId: 't1',
    title: '부산 여행',
    metaLine: '6월 10일 ~ 12일 · 2박 3일 · 2명',
    badge: 'done',
    extra: null,
    coverCity: '부산',
    coverTone: 'upcoming',
    ...over,
  };
}

const renderCard = (v: MyTripCardVM) =>
  render(<TripCard vm={v} onPress={() => {}} testIDPrefix="my-trip" />);

describe('TC1 · 사진이 없으면 그라데이션 커버 + 도시 이름', () => {
  it('그라데이션이 그려지고 도시 이름이 노출된다', () => {
    renderCard(vm());
    expect(screen.UNSAFE_getByType(LinearGradient)).toBeTruthy();
    expect(screen.getByTestId('my-trip-city-t1')).toHaveTextContent('부산');
    expect(screen.getByTestId('my-trip-city-t1').props.className).toContain(
      'text-on-primary'
    );
    expect(screen.queryByTestId('my-trip-photo-t1')).toBeNull();
  });

  it('회색 박스(bg-surface-soft)가 커버에 남지 않는다', () => {
    renderCard(vm());
    expect(
      screen
        .getByTestId('my-trip-card-t1')
        .findAll(
          (n) =>
            typeof n.props.className === 'string' &&
            n.props.className.includes('bg-surface-soft')
        )
    ).toHaveLength(0);
  });

  it.each(['live', 'upcoming', 'ended'] as const)(
    '%s 톤은 그 톤의 stop 두 개를 가로로 잇는다',
    (tone) => {
      renderCard(vm({ coverTone: tone }));
      const g = screen.UNSAFE_getByType(LinearGradient);
      expect(g.props.colors).toEqual([...COVER_GRADIENTS[tone]]);
      expect(g.props.start.y).toBe(g.props.end.y);
      expect(g.props.start.x).toBeLessThan(g.props.end.x);
    }
  );

  it('톤이 안 오면 upcoming 으로 그린다', () => {
    renderCard(vm({ coverTone: undefined }));
    expect(screen.UNSAFE_getByType(LinearGradient).props.colors).toEqual([
      ...COVER_GRADIENTS.upcoming,
    ]);
  });
});

describe('TC2 · imageUrl 이 있으면 지금처럼 Image', () => {
  it('사진을 그리고 그라데이션은 안 그린다', () => {
    renderCard(vm({ imageUrl: 'https://example.com/a.jpg' }));
    expect(screen.getByTestId('my-trip-photo-t1')).toBeTruthy();
    expect(screen.UNSAFE_queryByType(LinearGradient)).toBeNull();
  });
});

describe('TC3 · 도시 이름 폴백', () => {
  it.each([[null], [undefined], ['   ']])(
    'coverCity=%j 이면 글자 없이 그라데이션만(빈 글자·undefined 없음)',
    (city) => {
      renderCard(vm({ coverCity: city as string | null | undefined }));
      expect(screen.UNSAFE_getByType(LinearGradient)).toBeTruthy();
      expect(screen.queryByTestId('my-trip-city-t1')).toBeNull();
      expect(screen.queryByText('undefined')).toBeNull();
    }
  );
});
