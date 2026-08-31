import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoThumbStrip, type PhotoThumbVM } from './PhotoThumbStrip';

/**
 * TRIP-566 · AC-3·AC-4·AC-5(다건 UI) — 사진 썸네일 스트립(VM 주입, 재판정 없음).
 *
 * 무엇을 보장하나:
 *  - 자산 실패('unavailable') → "사진을 불러올 수 없어요", 깨진 Image 0.
 *  - 타 기기('other-device') → "다른 기기에서 찍은 사진", 깨진 썸네일 0.
 *  - ★ 상태를 fill 색이 아니라 **상태별 distinct testID**(available/other-device/unavailable)로 렌더한다
 *    — 상호배타 present/absent 짝으로 구조를 잠근다(repo-traps 글리프 fill 사각 회피).
 *  - 실제 `<Image>`(record-photo-thumb-image)는 **available + uri 있을 때만** 렌더 → 나머지 상태에서
 *    그 testID 부재가 "깨진 Image 0"의 직접 증거(2중 그물).
 *  - `+` 추가 타일(record-trip-photo-add) 은 항상 있고, press → onPressAdd.
 *
 * (개념) availability 는 상위 페이지가 `photoAvailability` 로 선판정해 VM 으로 준다 — 스트립은 순수
 *   프레젠테이션(카드/VisitRecordCard 규율 계승). `queryByTestId(...)`=없으면 null(부재 단언).
 */

const cell = (over: Partial<PhotoThumbVM>): PhotoThumbVM => ({
  visitPhotoMetaId: 'ph1',
  availability: 'available',
  uri: 'file:///local/x.jpg',
  ...over,
});

describe('🔴 AC-3·4 · 상태별 distinct 셀 + 깨진 Image 0', () => {
  const cases: Array<{
    name: string;
    vm: PhotoThumbVM;
    present: string;
    image: boolean;
    label: string | null;
    absent: string[];
  }> = [
    {
      name: 'available + uri → 셀 + 실제 Image',
      vm: cell({ availability: 'available', uri: 'file:///x.jpg' }),
      present: 'record-photo-available-ph1',
      image: true,
      label: null,
      absent: ['record-photo-other-device-ph1', 'record-photo-unavailable-ph1'],
    },
    {
      name: 'available + uri 없음(네이티브 스텁) → 셀만, 깨진 Image 없음',
      vm: cell({ availability: 'available', uri: null }),
      present: 'record-photo-available-ph1',
      image: false,
      label: null,
      absent: ['record-photo-other-device-ph1', 'record-photo-unavailable-ph1'],
    },
    {
      name: 'other-device → "다른 기기에서 찍은 사진", Image 없음',
      vm: cell({ availability: 'other-device', uri: null }),
      present: 'record-photo-other-device-ph1',
      image: false,
      label: '다른 기기에서 찍은 사진',
      absent: ['record-photo-available-ph1', 'record-photo-unavailable-ph1'],
    },
    {
      name: 'unavailable → "사진을 불러올 수 없어요", Image 없음',
      vm: cell({ availability: 'unavailable', uri: null }),
      present: 'record-photo-unavailable-ph1',
      image: false,
      label: '사진을 불러올 수 없어요',
      absent: ['record-photo-available-ph1', 'record-photo-other-device-ph1'],
    },
  ];

  it.each(cases)('$name', ({ vm, present, image, label, absent }) => {
    render(<PhotoThumbStrip photos={[vm]} />);

    // 준비된 상태 셀만 present, 나머지 상태 셀은 부재(상호배타).
    expect(screen.getByTestId(present)).toBeTruthy();
    for (const a of absent) {
      expect(screen.queryByTestId(a)).toBeNull();
    }
    // 깨진 Image 0 — available+uri 에서만 실제 Image.
    const img = screen.queryByTestId('record-photo-thumb-image-ph1');
    if (image) {
      expect(img).toBeTruthy();
    } else {
      expect(img).toBeNull();
    }
    // 상태 문구(정본) — other-device/unavailable 만.
    if (label != null) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});

describe('🔴 add 타일 — record-trip-photo-add', () => {
  it('추가 타일 present + press → onPressAdd 1회', () => {
    const onPressAdd = jest.fn();
    render(<PhotoThumbStrip photos={[]} onPressAdd={onPressAdd} />);

    fireEvent.press(screen.getByTestId('record-trip-photo-add'));

    expect(onPressAdd).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 AC-5(다건 UI) — 사진 여러 장 렌더', () => {
  it('3건 VM → 3 상태 셀이 모두 그려진다', () => {
    render(
      <PhotoThumbStrip
        photos={[
          cell({ visitPhotoMetaId: 'a', availability: 'available' }),
          cell({ visitPhotoMetaId: 'b', availability: 'other-device' }),
          cell({ visitPhotoMetaId: 'c', availability: 'unavailable' }),
        ]}
      />
    );

    expect(screen.getByTestId('record-photo-available-a')).toBeTruthy();
    expect(screen.getByTestId('record-photo-other-device-b')).toBeTruthy();
    expect(screen.getByTestId('record-photo-unavailable-c')).toBeTruthy();
  });
});
