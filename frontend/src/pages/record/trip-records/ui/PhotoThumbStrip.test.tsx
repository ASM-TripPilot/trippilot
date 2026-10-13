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
 *  - `+` 추가 타일(record-trip-photo-add)은 onPressAdd 가 **주입될 때만** 있고 press → onPressAdd.
 *    미주입이면 없다(TRIP-939 B-7 — 사진 선택 미개통, 눌러도 반응 없는 타일 제거). 스트립 루트는
 *    `record-trip-photo-strip`(사진 0장·타일 없음이어도 "스트립이 슬롯에 들어갔다"는 신호).
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
    // 🔴 TRIP-760 · AC-2 · ★catch-all 회귀 잠금(옛 별 describe 를 이 행으로 합쳤다 — TRIP-1354) — upload-failed(POST 실패
    // 별축)가 else(=unavailable) 로 새면 tsc·다른 행이 전부 green 인 채 "사진을 불러올 수 없어요" 셀로 흡수된다. 다른 3상태 testID 상호배타 부재로
    // ★catch-all(else=unavailable) 흡수를 잡는다: unavailable testID 가 absent 에 있어, upload-failed 가
    // else 로 새면 record-photo-unavailable-ph1 이 present 가 돼 red.
    {
      name: 'upload-failed → "업로드 실패", Image 없음(unavailable 로 안 샘)',
      vm: cell({ availability: 'upload-failed', uri: null }),
      present: 'record-photo-upload-failed-ph1',
      image: false,
      label: '업로드 실패',
      absent: [
        'record-photo-available-ph1',
        'record-photo-other-device-ph1',
        'record-photo-unavailable-ph1',
      ],
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
  it('TRIP-939 B-7: onPressAdd 미주입 → 추가 타일이 없고 스트립 루트는 있다', () => {
    // 준비·실행: 방문 기록 카드 컨테이너의 현재 모양(사진 선택 미주입).
    render(<PhotoThumbStrip photos={[cell({ visitPhotoMetaId: 'a' })]} />);

    // 단언: + 타일 부재 + 짝 앵커(스트립 루트·사진 셀은 그대로).
    expect(screen.queryByTestId('record-trip-photo-add')).toBeNull();
    expect(screen.getByTestId('record-trip-photo-strip')).toBeTruthy();
    expect(screen.getByTestId('record-photo-available-a')).toBeTruthy();
  });

  it('추가 타일 present + press → onPressAdd 1회(개통 짝)', () => {
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
