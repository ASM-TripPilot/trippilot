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
 * 왜 className 을 보나: 썸네일 크기는 "어느 변형을 골랐나"의 결과다. 64 를 기본값으로 바꿔 버리면
 * j07 화면이 조용히 줄어드는데, 이번 사이클 스크린샷 대조는 l03 만 찍으므로 jest 말고는 잡을 곳이 없다.
 * 토큰은 공백으로 쪼갠 배열로 비교한다(`h-[64px]` 가 다른 토큰 안에 부분 일치하지 않게).
 *
 * *(개념 — 선택 prop `compact?: boolean`)* `?` 는 "안 줘도 된다"는 뜻이다. 안 주면 `undefined` 이고,
 *  카드는 그때 원래 모양(72)을 그린다. 그래서 기존 소비처(j07 `PastTripList`)는 고칠 필요가 없다.
 *
 * 3동작: 준비(VM·testID) → 실행(render) → 단언(썸네일 토큰·사진·글자 조각).
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

function tokens(className: unknown): string[] {
  return typeof className === 'string' ? className.split(/\s+/) : [];
}

describe('🔴 C1 · 썸네일 크기 — compact 는 64, 기본은 72(j07 무회귀)', () => {
  it('compact 를 주면 썸네일 자리가 64×64 다(72 토큰은 없다)', () => {
    // 준비·실행
    render(<PastTripRow vm={vm()} onPress={noop} testID={ROOT} compact />);

    // 단언
    const thumb = tokens(screen.getByTestId(`${ROOT}-thumb`).props.className);
    expect(thumb).toEqual(expect.arrayContaining(['h-[64px]', 'w-[64px]']));
    expect(thumb).not.toContain('h-[72px]');
    expect(thumb).not.toContain('w-[72px]');
  });

  it('compact 를 안 주면 썸네일 자리는 그대로 72×72 다(j07 PastTripList 소비처)', () => {
    render(<PastTripRow vm={vm()} onPress={noop} testID={ROOT} />);

    const thumb = tokens(screen.getByTestId(`${ROOT}-thumb`).props.className);
    expect(thumb).toEqual(expect.arrayContaining(['h-[72px]', 'w-[72px]']));
    expect(thumb).not.toContain('h-[64px]');
  });
});

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
    expect(photo.props.source).toEqual({ uri: 'file://jeju.jpg' });
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
