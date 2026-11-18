import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { coverFor, UUID_V2, UUID_V3 } from '@/test-support/placeCoverFixtures';

import { PoiPhoto } from './PoiPhoto';

/**
 * TRIP-1740 · 서버 POI 사진 전용 부품 `PoiPhoto` — 관광공사 사진을 이용 조건대로 그린다(AC-4·AC-5·AC-6·AC-8).
 *
 * 무엇을 보장하나:
 *  - 서버 사진이 TYPE3(변경금지)이거나 유형을 모르면(null·undefined) 자르지 않고(`contain`), TYPE1 만 꽉 채운다(`cover`).
 *  - 서버 사진이면 유형과 무관하게 출처 글자가 사진 칸에 있다 — 큰 칸(`card`·`overlay`)은 「사진: 한국관광공사」,
 *    작은 칸(`thumb`)은 「한국관광공사」, 낭독 문구는 둘 다 「사진 출처 한국관광공사」.
 *  - 사진이 없거나(null·''·공백) 로드가 실패하면 번들 표지로 바뀌고, 그때는 유형이 TYPE3 이어도 `cover` + 출처 없음.
 *    실패는 URL 로 기억해 같은 칸에 다른 URL 이 오면 다시 서버 사진·출처가 돌아온다.
 *  - 호출부가 `contentFit` 을 줄 수 없고(타입), 몰래 넘겨도 판정이 이긴다. `imageLicense` 는 필수 prop 이다(타입).
 *
 * 3동작 뼈대: 준비=(`imageUrl`, `imageLicense`, `surface`) → 실행=렌더(+ `onError` 발화) → 단언=사진 노드의 `source`·`contentFit` 과 출처 글자.
 * (개념) `contentFit` = 사진을 칸에 맞추는 방식. `cover` 는 칸을 꽉 채우며 넘치는 가장자리를 자르고, `contain` 은 사진 전체를
 * 비율대로 넣고 남는 곳을 빈칸(레터박스)으로 둔다. expo-image 호스트 노드에 이 prop 이 그대로 남는다(실측 — 02a §5).
 * (개념) `@ts-expect-error` = "이 줄은 타입 에러여야 한다"는 선언. 에러가 안 나면 오히려 `pnpm tsc` 가 실패한다 — 타입 규칙 테스트.
 *
 * `contentFit` 노드 읽기는 README 「출시 게이트로 남기는 생김새 검사」 6번째(이용 조건 준수)다. 이 읽기는 표시 취향이 아니라
 * 법적 이용 조건(변경금지)을 지키는 유일한 렌더 심판이라 jest 에 남긴다. 여백색·칩 위치·글자 축소는 jest 사각 → 기능 지도(6-b).
 *
 * 서버 URL 은 문자열 리터럴이다 — jest 에서 `resolveAssetSource(require()).uri` 는 undefined 라 번들 표지로 간다(브리프 §10).
 */

const URL_A = 'https://tong.visitkorea.or.kr/cms/resource/a.jpg';
const URL_B = 'https://tong.visitkorea.or.kr/cms/resource/b.jpg';
const FULL = '사진: 한국관광공사';
const SHORT = '한국관광공사';
const A11Y = '사진 출처 한국관광공사';

type Props = ComponentProps<typeof PoiPhoto>;

function renderPhoto(props: Partial<Props> = {}) {
  return render(
    <PoiPhoto
      testID="pp"
      imageUrl={URL_A}
      imageLicense="TYPE3"
      surface="card"
      category="맛집"
      poiId={UUID_V2}
      {...props}
    />
  );
}

function photo() {
  return screen.getByTestId('pp');
}

function failLoad(): void {
  fireEvent(photo(), 'error', { nativeEvent: { error: 'load failed' } });
}

describe('PoiPhoto · 유형별 fit (AC-4)', () => {
  it.each([
    ['TYPE3', 'TYPE3', 'contain'],
    ['TYPE1', 'TYPE1', 'cover'],
    ['null (유형 미수집)', null, 'contain'],
    ['undefined (키 누락)', undefined, 'contain'],
  ] as const)(
    '서버 사진 + 유형 %s → contentFit %s',
    (_name, imageLicense, expected) => {
      renderPhoto({ imageLicense });

      // 긍정 앵커 — 지금 그리는 것이 번들 표지가 아니라 서버 사진이다(번들이어도 cover 라 구별되지 않는다).
      expect(photo().props.source).toEqual([{ uri: URL_A }]);
      expect(photo().props.contentFit).toBe(expected);
    }
  );

  it('호출부가 주는 이미지 옵션(recyclingKey·cachePolicy)은 사진 노드로 그대로 간다', () => {
    renderPhoto({
      recyclingKey: 'rk-1',
      cachePolicy: 'memory-disk',
    });

    expect(photo().props.recyclingKey).toBe('rk-1');
    expect(photo().props.cachePolicy).toBe('memory-disk');
  });
});

describe('PoiPhoto · 출처 글자 (AC-5)', () => {
  it.each(['TYPE1', 'TYPE3', null, undefined] as const)(
    '서버 사진이면 유형(%s)과 무관하게 출처가 있다 — 큰 칸 card 는 긴 문구',
    (imageLicense) => {
      renderPhoto({ imageLicense, surface: 'card' });

      expect(screen.getByText(FULL)).toBeOnTheScreen();
      expect(screen.getByTestId('pp-credit')).toBeOnTheScreen();
    }
  );

  it('overlay(어두운 여백 위 큰 칸)도 긴 문구다', () => {
    renderPhoto({ surface: 'overlay' });

    expect(screen.getByText(FULL)).toBeOnTheScreen();
  });

  it('thumb(작은 칸)은 짧은 문구만 — 긴 문구는 없다', () => {
    renderPhoto({ surface: 'thumb' });

    expect(screen.getByText(SHORT)).toBeOnTheScreen();
    expect(screen.queryByText(FULL)).toBeNull();
  });

  it.each(['card', 'overlay', 'thumb'] as const)(
    '%s 의 출처는 낭독 문구 「사진 출처 한국관광공사」 로 읽힌다',
    (surface) => {
      renderPhoto({ surface });

      expect(screen.getByLabelText(A11Y)).toBeOnTheScreen();
    }
  );
});

describe('PoiPhoto · 사진이 없거나 로드가 실패하면 번들 표지 — 유형과 무관 (AC-3·AC-4·AC-5)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['빈 문자열', ''],
    ['공백만', '  \t\n '],
  ])(
    'imageUrl 이 %s 이면 TYPE3 여도 번들 표지 + cover + 출처 없음',
    (_name, imageUrl) => {
      renderPhoto({ imageUrl, imageLicense: 'TYPE3', surface: 'thumb' });

      // 긍정 앵커 — 같은 칸에 사진 노드가 있고 그것이 이 장소의 번들 표지다.
      expect(photo().props.source).toEqual([coverFor('맛집', UUID_V2)]);
      expect(photo().props.contentFit).toBe('cover');
      expect(screen.queryByTestId('pp-credit')).toBeNull();
      expect(screen.queryByText(/한국관광공사/)).toBeNull();
    }
  );

  it('서버 사진이 로드에 실패하면 같은 칸이 번들 표지 + cover 가 되고 출처가 사라진다', () => {
    renderPhoto({ imageLicense: 'TYPE3', category: '카페', poiId: UUID_V3 });
    // 실패 전 앵커 — 서버 사진·contain·출처가 있었다.
    expect(photo().props.source).toEqual([{ uri: URL_A }]);
    expect(photo().props.contentFit).toBe('contain');
    expect(screen.getByText(FULL)).toBeOnTheScreen();

    failLoad();

    expect(photo().props.source).toEqual([coverFor('카페', UUID_V3)]);
    expect(photo().props.contentFit).toBe('cover');
    expect(screen.queryByTestId('pp-credit')).toBeNull();
    expect(screen.queryByText(FULL)).toBeNull();
  });

  it('실패한 칸에 다른 URL 이 오면 다시 서버 사진 + 유형대로 fit + 출처가 돌아온다', () => {
    const { rerender } = renderPhoto({ imageLicense: 'TYPE3' });
    failLoad();
    expect(photo().props.contentFit).toBe('cover');

    rerender(
      <PoiPhoto
        testID="pp"
        imageUrl={URL_B}
        imageLicense="TYPE3"
        surface="card"
        category="맛집"
        poiId={UUID_V2}
      />
    );

    expect(photo().props.source).toEqual([{ uri: URL_B }]);
    expect(photo().props.contentFit).toBe('contain');
    expect(screen.getByText(FULL)).toBeOnTheScreen();
  });

  it('실패한 URL 로 다시 그려져도 서버 사진·출처로 되돌아가지 않는다', () => {
    const { rerender } = renderPhoto({ imageLicense: 'TYPE3' });
    failLoad();

    rerender(
      <PoiPhoto
        testID="pp"
        imageUrl={URL_A}
        imageLicense="TYPE3"
        surface="card"
        category="맛집"
        poiId={UUID_V2}
      />
    );

    expect(photo().props.source).toEqual([coverFor('맛집', UUID_V2)]);
    expect(screen.queryByText(FULL)).toBeNull();
  });
});

describe('PoiPhoto · 호출부가 판정을 바꿀 수 없다 (AC-6·AC-8)', () => {
  it('contentFit 을 몰래 넘겨도(타입 우회) 유형 판정이 이긴다 — TYPE3 은 contain', () => {
    const smuggled = { contentFit: 'cover' } as unknown as Partial<Props>;

    renderPhoto({ imageLicense: 'TYPE3', ...smuggled });

    expect(photo().props.source).toEqual([{ uri: URL_A }]);
    expect(photo().props.contentFit).toBe('contain');
  });

  // 아래 두 줄은 런타임이 아니라 `pnpm tsc` 가 검증한다 — 지시문이 가리킨 줄에 타입 에러가 없으면 tsc 가 실패한다.
  it('타입: imageLicense 를 빼먹거나 contentFit 을 주면 컴파일되지 않는다', () => {
    const probe = (): void => {
      // @ts-expect-error AC-8 — imageLicense 는 필수 prop 이다(null·undefined 는 값으로 줘야 한다)
      void (<PoiPhoto imageUrl={URL_A} surface="card" />);
      void (
        <PoiPhoto
          imageUrl={URL_A}
          imageLicense="TYPE1"
          surface="card"
          // @ts-expect-error AC-6 — contentFit 은 부품이 정한다(호출부가 줄 수 없다)
          contentFit="cover"
        />
      );
    };
    expect(typeof probe).toBe('function');
  });
});
