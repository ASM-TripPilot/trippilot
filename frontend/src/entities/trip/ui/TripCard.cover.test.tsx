import { render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { TripCard } from './TripCard';
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
    expect(screen.queryByTestId('my-trip-photo-t1')).toBeNull();
  });

  // 흰 글자 className·회색 박스 부재·톤별 stop/가로 방향·기본 톤(upcoming) 단언은 jest-cut 에서 지웠다 — 생김새라 실화면 QA 몫(my-trips.md).
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

describe('TC · 지역 커버 이미지', () => {
  it('coverSource 가 있으면 그림 + 스크림이 그려지고 도시 이름이 그 위에 남는다', () => {
    renderCard(vm({ coverSource: { uri: 'cover://26350' } }));
    expect(screen.getByTestId('my-trip-cover-t1').props.source).toEqual([
      { uri: 'cover://26350' },
    ]);
    // 남은 LinearGradient 하나는 톤 그라데이션이 아니라 제목 대비용 스크림이다.
    expect(screen.UNSAFE_getAllByType(LinearGradient)).toHaveLength(1);
    expect(screen.getByTestId('my-trip-city-t1')).toHaveTextContent('부산');
  });

  it('coverSource 가 없으면 그림 없이 톤 그라데이션만 — 서울·부산·제주 밖 폴백', () => {
    renderCard(vm({ coverSource: null }));
    expect(screen.queryByTestId('my-trip-cover-t1')).toBeNull();
    expect(screen.UNSAFE_getByType(LinearGradient)).toBeTruthy();
  });
});
