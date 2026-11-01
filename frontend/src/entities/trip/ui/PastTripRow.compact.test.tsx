import { Image } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';

import { PastTripRow } from './PastTripRow';
import type { PastTripCardVM } from '../model';

/**
 * TRIP-776 · l03 마이페이지 "지난 여행" 썸네일 카드(Figma 1603:2414) — `PastTripRow` 의 l03 변형.
 *
 * 무엇을 보장하나:
 *  - `compact` 를 주면 썸네일 자리가 64×64 다(l03). 안 주면 지금처럼 72×72 다(j07 무회귀 — j07 테스트
 *    `PastTripRow.test.tsx` 는 한 줄도 고치지 않는다).
 *  - VM 에 `imageUrl` 이 있으면 썸네일 자리 안에 그 사진(`<Image>`)을 그린다(프리뷰 픽스처 전용, G7).
 *    없으면 사진 없이 회색 자리만 남는다(실앱 — 사진 원본은 기기에만 있다, INV-U5-03).
 *  - VM 에 `photoLabel`("사진 24")이 있으면 날짜 옆에 **별개 글자 조각**으로 보인다. 없으면 사진 글자가
 *    하나도 없다(가짜 숫자 금지, INV-4).
 *
 * *(개념 — 선택 prop `compact?: boolean`)* `?` 는 "안 줘도 된다"는 뜻이다. 안 주면 `undefined` 이고,
 *  카드는 그때 원래 모양(72)을 그린다. 그래서 기존 소비처(j07 `PastTripList`)는 고칠 필요가 없다.
 *
 * 3동작: 준비(VM·testID) → 실행(render) → 단언(사진·글자 조각).
 */

const noop = () => {};
const ROOT = 'my-trip-reflection-e1';

function vm(over: Partial<PastTripCardVM> = {}): PastTripCardVM {
  return {
    tripId: 'e1',
    title: '제주 여행',
    dateRangeLabel: '2026.5.1–5.3',
    nightsLabel: null,
    ...over,
  };
}

// C1(compact 64 / 기본 72 썸네일 크기 className)은 jest-cut 에서 지웠다 — 크기 토큰이라 실화면 QA 몫(README 판정 4).

describe('🔴 C2 · 썸네일 사진 — imageUrl 이 있으면 자리 안에 Image, 없으면 회색 자리만', () => {
  it('imageUrl 을 주면 썸네일 자리 안에 그 사진 Image 가 있다', () => {
    render(
      <PastTripRow
        vm={vm({ imageUrl: 'file://jeju.jpg' })}
        onPress={noop}
        testID={ROOT}
        compact
      />
    );

    // 사진은 썸네일 자리 **안**이다(카드 다른 곳에 떠 있으면 red).
    const thumb = screen.getByTestId(`${ROOT}-thumb`);
    const photo = within(thumb).getByTestId(`${ROOT}-photo`);
    // 엉뚱한 소스면 red(TripCard TC9 선례).
    expect(photo.props.source).toEqual([{ uri: 'file://jeju.jpg' }]);
  });

  it.each([
    ['null', null],
    ['미전달', undefined],
  ])(
    'imageUrl 이 %s 이면 Image 가 없고 회색 자리만 있다(실앱)',
    (_label, imageUrl) => {
      render(
        <PastTripRow
          vm={vm({ imageUrl })}
          onPress={noop}
          testID={ROOT}
          compact
        />
      );

      expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
      expect(screen.queryByTestId(`${ROOT}-photo`)).toBeNull();
      // 짝 앵커 — 자리 박스는 있다(카드째 사라져 공짜 통과하는 것을 막는다).
      expect(screen.getByTestId(`${ROOT}-thumb`)).toBeOnTheScreen();
    }
  );
});

describe('🔴 C3 · 부제 "날짜 · 사진 N" — 사진 글자는 따로 된 조각, 없으면 날짜만', () => {
  it('photoLabel 을 주면 날짜와 "사진 24" 가 각각 완전일치 조각으로 보인다', () => {
    render(
      <PastTripRow
        vm={vm({ photoLabel: '사진 24' })}
        onPress={noop}
        testID={ROOT}
        compact
      />
    );

    expect(screen.getByText('2026.5.1–5.3')).toBeOnTheScreen();
    expect(screen.getByText('사진 24')).toBeOnTheScreen();
    // 박수 자리를 빌려 쓰지 않는다 — 박수는 null 이라 박 글자가 없다.
    expect(screen.queryAllByText(/박/)).toHaveLength(0);
  });

  it.each([
    ['null', null],
    ['미전달', undefined],
  ])(
    'photoLabel 이 %s 이면 사진 글자가 하나도 없고 날짜만 남는다',
    (_label, photoLabel) => {
      render(
        <PastTripRow
          vm={vm({ photoLabel })}
          onPress={noop}
          testID={ROOT}
          compact
        />
      );

      expect(screen.queryAllByText(/사진/)).toHaveLength(0);
      // 짝 앵커 — 날짜는 그대로다.
      expect(screen.getByText('2026.5.1–5.3')).toBeOnTheScreen();
    }
  );
});

describe('🔴 C4 · 지역 커버 그림 — 사진이 없을 때만 썸네일 자리에 깐다', () => {
  const COVER = 1; // jest 에서 번들 이미지는 숫자 id

  it('imageUrl 이 없고 coverSource 가 있으면 썸네일 자리 안에 커버 Image 가 있다', () => {
    render(
      <PastTripRow
        vm={vm({ coverSource: COVER })}
        onPress={noop}
        testID={ROOT}
        compact
      />
    );
    const thumb = screen.getByTestId(`${ROOT}-thumb`);
    expect(within(thumb).getByTestId(`${ROOT}-cover`)).toBeOnTheScreen();
    expect(within(thumb).queryByTestId(`${ROOT}-photo`)).toBeNull();
  });

  it('imageUrl 과 coverSource 가 둘 다 있으면 사진이 이기고 커버는 없다', () => {
    render(
      <PastTripRow
        vm={vm({ imageUrl: 'https://example.com/a.jpg', coverSource: COVER })}
        onPress={noop}
        testID={ROOT}
        compact
      />
    );
    expect(screen.getByTestId(`${ROOT}-photo`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`${ROOT}-cover`)).toBeNull();
  });

  it('둘 다 없으면 커버도 사진도 없이 회색 자리만 남는다', () => {
    render(<PastTripRow vm={vm()} onPress={noop} testID={ROOT} compact />);
    expect(screen.queryByTestId(`${ROOT}-cover`)).toBeNull();
    expect(screen.queryByTestId(`${ROOT}-photo`)).toBeNull();
  });
});
