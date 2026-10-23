import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import {
  coverFor,
  FALLBACK_COVER,
  UUID_V2,
  UUID_V3,
} from '@/test-support/placeCoverFixtures';

import { Image } from './Image';
import { PlacePhoto } from './PlacePhoto';

/**
 * 장소 사진 칸 공용 컴포넌트 `PlacePhoto` (사이클 20261022-place-category-covers, 01b 결정 1·4·6).
 * 호출부 19곳이 제각각 반복하던 `imageUrl ? <Image uri> : 회색 View` 판단을 이 한 곳이 맡는다.
 *
 * 무엇을 보장하나:
 *  - 서버 사진(`imageUrl`)이 있으면 그 사진을 `{ uri }` 그대로 그린다(호출부가 주던 `contentFit`·`recyclingKey` 등도 그대로 전달).
 *  - 사진이 없으면 — `null`·`undefined`·`''`·공백만 있는 문자열 — 카테고리·poiId 로 고른 생성 이미지를 그린다.
 *  - 서버 사진이 로드에 실패하면(`onError`) 같은 칸이 생성 이미지로 갈아끼워진다. 리스트 재활용으로 같은 칸에 **다른**
 *    사진 URL 이 들어오면 이전 실패 상태가 남지 않고 다시 그 URL 을 그린다.
 *
 * 한 가지 testID 로 두 경우를 모두 찾는다(호출부 단언이 "사진이 있든 없든 같은 칸" 을 잰다).
 *
 * 3동작 뼈대: 준비=`imageUrl`·`category`·`poiId` → 실행=렌더(+ `onError` 발화) → 단언=칸 Image 의 `source`.
 * (개념) expo-image 는 jest 에서 호스트 노드의 `source` 를 **배열**로 바꿔 노출한다 — 서버 사진은 `[{ uri }]`,
 * 번들 그림은 `[{ testUri }]`(jest-expo 에셋 변환). `UNSAFE_getByType(Image)` 로 잡는 컴포넌트 노드는 화면이 넘긴 값 그대로다.
 * (개념) `fireEvent(노드, 'error', { nativeEvent: { error } })` = 네이티브 이미지가 로드 실패를 알리는 순간을 흉내 낸다.
 * expo-image 의 `onError` 래퍼가 `event.nativeEvent` 가 객체이길 요구해서 그 모양으로 줘야 한다(실측).
 *
 * ⚠️ jest 가 원리적으로 못 보는 것: 실제 네트워크 로드 실패, 번들 그림의 크롭 모양, 로드 중 깜빡임 — 실기(6-b) 몫.
 */

const URL_A = 'https://img.example/a.jpg';
const URL_B = 'https://img.example/b.jpg';

type PhotoProps = ComponentProps<typeof PlacePhoto>;

function renderPhoto(props: PhotoProps = {}) {
  return render(<PlacePhoto testID="pp" {...props} />);
}

function sourceOf(): unknown {
  return screen.getByTestId('pp').props.source;
}

function failLoad(): void {
  fireEvent(screen.getByTestId('pp'), 'error', {
    nativeEvent: { error: 'load failed' },
  });
}

describe('PlacePhoto · 서버 사진이 있을 때 (AC-C1·S3)', () => {
  it('서버 사진이 있으면 그 URL 을 { uri } 그대로 그리고 생성 이미지는 쓰지 않는다', () => {
    renderPhoto({ imageUrl: URL_A, category: '맛집', poiId: UUID_V2 });

    expect(sourceOf()).toEqual([{ uri: URL_A }]);
    expect(sourceOf()).not.toEqual([coverFor('맛집', UUID_V2)]);
    // 컴포넌트 노드가 받은 값도 { uri } 한 객체 그대로(호출부 기존 단언 `props.source toEqual {uri}` 와 같은 모양).
    expect(screen.UNSAFE_getByType(Image).props.source).toEqual({
      uri: URL_A,
    });
  });

  it('호출부가 주던 이미지 옵션(contentFit·recyclingKey·transition·cachePolicy)을 그대로 Image 에 넘긴다', () => {
    renderPhoto({
      imageUrl: URL_A,
      category: '맛집',
      poiId: UUID_V2,
      contentFit: 'cover',
      recyclingKey: 'rk-1',
      transition: 120,
      cachePolicy: 'memory-disk',
    });

    const props = screen.UNSAFE_getByType(Image).props;
    expect(props.contentFit).toBe('cover');
    expect(props.recyclingKey).toBe('rk-1');
    expect(props.transition).toBe(120);
    expect(props.cachePolicy).toBe('memory-disk');
  });
});

describe('PlacePhoto · 서버 사진이 없을 때 (AC-C2·C3)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['빈 문자열', ''],
    ['공백 두 칸', '  '],
    ['탭·줄바꿈만', '\t\n '],
  ])(
    'imageUrl 이 %s 이면 카테고리·poiId 로 고른 생성 이미지를 그린다',
    (_, imageUrl) => {
      renderPhoto({ imageUrl, category: '맛집', poiId: UUID_V2 });

      expect(sourceOf()).toEqual([coverFor('맛집', UUID_V2)]);
    }
  );

  it('카테고리가 바뀌면 그림도 바뀐다 — 술집 + 변형 3 (맛집 칸에 술집 그림이 나오는 오배선 차단)', () => {
    renderPhoto({ imageUrl: null, category: '술집', poiId: UUID_V3 });

    expect(sourceOf()).toEqual([coverFor('술집', UUID_V3)]);
    expect(sourceOf()).not.toEqual([coverFor('맛집', UUID_V3)]);
  });

  it('카테고리를 모르면(null·undefined·영문 코드) 중립 폴백 place.webp 이다', () => {
    const { rerender } = renderPhoto({
      imageUrl: null,
      category: null,
      poiId: UUID_V2,
    });
    expect(sourceOf()).toEqual([FALLBACK_COVER]);

    rerender(
      <PlacePhoto testID="pp" imageUrl={null} category="FOOD" poiId={UUID_V2} />
    );
    expect(sourceOf()).toEqual([FALLBACK_COVER]);

    rerender(<PlacePhoto testID="pp" imageUrl={null} poiId={UUID_V2} />);
    expect(sourceOf()).toEqual([FALLBACK_COVER]);
  });

  it('poiId 를 안 주면 변형 1 이다', () => {
    renderPhoto({ imageUrl: null, category: '카페' });

    expect(sourceOf()).toEqual([coverFor('카페')]);
    expect(sourceOf()).not.toEqual([coverFor('카페', UUID_V2)]);
  });

  it('생성 이미지도 호출부가 준 contentFit 으로 그려진다 (가로 그림을 세로 칸에 cover 크롭)', () => {
    renderPhoto({
      imageUrl: null,
      category: '명소',
      poiId: UUID_V2,
      contentFit: 'cover',
    });

    expect(screen.UNSAFE_getByType(Image).props.contentFit).toBe('cover');
  });
});

describe('PlacePhoto · 로드 실패(onError)는 생성 이미지로 갈아끼운다 (AC-C5, 결정 4)', () => {
  it('서버 사진이 로드에 실패하면 같은 칸이 생성 이미지가 된다', () => {
    renderPhoto({ imageUrl: URL_A, category: '카페', poiId: UUID_V3 });
    expect(sourceOf()).toEqual([{ uri: URL_A }]);

    failLoad();

    expect(sourceOf()).toEqual([coverFor('카페', UUID_V3)]);
  });

  it('같은 인스턴스에 다른 사진 URL 이 들어오면 이전 실패가 남지 않고 다시 그 URL 을 그린다', () => {
    const { rerender } = renderPhoto({
      imageUrl: URL_A,
      category: '카페',
      poiId: UUID_V3,
    });
    failLoad();
    expect(sourceOf()).toEqual([coverFor('카페', UUID_V3)]);

    rerender(
      <PlacePhoto
        testID="pp"
        imageUrl={URL_B}
        category="카페"
        poiId={UUID_V3}
      />
    );

    expect(sourceOf()).toEqual([{ uri: URL_B }]);
  });

  it('실패 뒤에도 새 URL 이 또 실패하면 또 갈아끼운다 (한 번만 되는 일회용이 아니다)', () => {
    const { rerender } = renderPhoto({
      imageUrl: URL_A,
      category: '카페',
      poiId: UUID_V3,
    });
    failLoad();
    rerender(
      <PlacePhoto
        testID="pp"
        imageUrl={URL_B}
        category="카페"
        poiId={UUID_V3}
      />
    );
    expect(sourceOf()).toEqual([{ uri: URL_B }]);

    failLoad();

    expect(sourceOf()).toEqual([coverFor('카페', UUID_V3)]);
  });

  it('실패한 사진의 칸에 다른 장소(카테고리·poiId)가 들어오면 생성 이미지가 그 장소 기준으로 바뀐다', () => {
    const { rerender } = renderPhoto({
      imageUrl: URL_A,
      category: '카페',
      poiId: UUID_V3,
    });
    failLoad();

    rerender(
      <PlacePhoto
        testID="pp"
        imageUrl={URL_A}
        category="술집"
        poiId={UUID_V2}
      />
    );

    // 같은 URL 이라 실패가 기억돼 생성 이미지 — 하지만 그림은 새 장소의 것이다(실패 시점의 그림을 붙들지 않는다).
    expect(sourceOf()).toEqual([coverFor('술집', UUID_V2)]);
  });

  it('이미 생성 이미지를 그리는 중에 error 가 와도 그대로 있다 (무한 루프·깜빡임 없음)', () => {
    renderPhoto({ imageUrl: null, category: '미술', poiId: UUID_V2 });

    failLoad();

    expect(sourceOf()).toEqual([coverFor('미술', UUID_V2)]);
  });

  it('실패한 뒤 같은 URL 로 다시 그려져도 서버 사진으로 되돌아가지 않는다', () => {
    const { rerender } = renderPhoto({
      imageUrl: URL_A,
      category: '카페',
      poiId: UUID_V3,
    });
    failLoad();

    rerender(
      <PlacePhoto
        testID="pp"
        imageUrl={URL_A}
        category="카페"
        poiId={UUID_V3}
      />
    );

    expect(sourceOf()).toEqual([coverFor('카페', UUID_V3)]);
  });
});
