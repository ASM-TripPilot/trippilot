import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { MustVisitSeedItem } from '../model/mustVisitSeed';
import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-665 g01 default 재작성 — **꼭 갈 곳 가로 스트립 전담**(Figma `3742:2068`).
 *
 * 무엇을 보장하나: 스트립이 헤더("꼭 갈 곳 {N}") + 전체 보기 + 더 담기(첫 위치) + 담은 곳 카드(이름)로
 * 서고, 카운트가 `mustVisits.length` 이며, 카드 이미지는 imageUrl 이 있을 때만 그린다(없으면 회색 자리,
 * INV-1). 그리고 **옛 스트립의 개별 제거(×)·+N 오버플로우가 신 계약에서 사라졌다**(01b D3 — 제거는 S12
 * 전체 보기 몫). 0곳도 헤더+더담기+전체보기로 graceful degrade(empty 일러스트 얼굴은 S7).
 *
 * 왜 재작성인가: 옛 스트립은 4얼굴 판별 유니온(seeded/empty/failed/loading)·overflow·remove× 를 가졌다.
 * 신 스트립은 **seeded 만**(0곳 포함) 그리는 단순 배열 렌더다 — 조회 실패·로딩·0곳 일러스트 얼굴은 S7.
 *
 * 커버하지 않는 것: 카운트·카드를 **도출**하는 배선(`TripNewStep1Page.mustVisit.test.tsx`) · 등록 실패
 * 배너(`…errors.test.tsx`) · 픽셀([검증]).
 *
 * ⚠️ 매처 함정(02a §5-2): 카운트가 든 헤더는 합성 텍스트라 **정규식**(`/꼭 갈 곳\s*3/`, 공백 유무 무관)으로,
 * 카드 이름은 단일 Text 라 `getByText` 로 본다.
 *
 * 3동작 뼈대: 준비=props(mustVisits) → 실행=render(+press) → 단언=보이는 것 / 불린 콜백.
 */

function seed(
  sourcePoiId: string,
  name: string,
  imageUrl: string | null = null
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl };
}

const THREE = [
  seed('poi-1', '감천마을'),
  seed('poi-2', '광안리'),
  seed('poi-3', '전포'),
];

function props(
  over: Partial<TripWizardStep1ScreenProps> = {}
): TripWizardStep1ScreenProps {
  return {
    summaryDestinations: '부산 2박',
    summaryPeriod: null,
    summaryCompanion: null,
    summaryPreferences: null,
    summaryBudget: null,
    onPressSummaryDestination: jest.fn(),
    onPressSummaryPeriod: jest.fn(),
    onPressSummaryCompanion: jest.fn(),
    onPressSummaryPreference: jest.fn(),
    onPressSummaryBudget: jest.fn(),
    mustVisits: [],
    onPressMore: jest.fn(),
    onPressSeeAll: jest.fn(),
    canProceed: false,
    onNext: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
}

function block() {
  return screen.getByTestId('trip-wizard-mustvisit-block');
}

describe('N3 · seeded 스트립 — 담은 곳이 있을 때', () => {
  it('제목·카운트와 카드가 담은 곳 수만큼(이름) 그려진다', () => {
    render(<TripWizardStep1Screen {...props({ mustVisits: THREE })} />);

    // 카운트는 헤더 합성 텍스트라 정규식으로(★2). "3박" 등과 안 섞이게 블록 안으로 좁힌다.
    expect(block()).toHaveTextContent(/꼭 갈 곳\s*3/);

    THREE.forEach((item) => {
      const card = screen.getByTestId(
        `trip-wizard-mustvisit-${item.sourcePoiId}`
      );
      // 이름표가 카드 **안**에 있다.
      expect(within(card).getByText(item.name)).toBeOnTheScreen();
    });
  });

  it('사진이 있으면 그리고 없으면 자리만 둔다 (★6 짝 — 기본 이미지를 지어내지 않는다)', () => {
    render(
      <TripWizardStep1Screen
        {...props({
          mustVisits: [
            seed('poi-1', '감천마을', 'https://cdn.example.com/a.jpg'),
            seed('poi-2', '광안리', null),
          ],
        })}
      />
    );

    // 두 항목이 서로의 짝이다 — 하나만 두면 "이미지를 아예 안 그리는" 구현도 통과한다.
    expect(
      screen.getByTestId('trip-wizard-mustvisit-image-poi-1')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-wizard-mustvisit-image-poi-2')
    ).toBeNull();
    // 사진이 없어도 카드·이름표는 남는다.
    expect(
      within(screen.getByTestId('trip-wizard-mustvisit-poi-2')).getByText(
        '광안리'
      )
    ).toBeOnTheScreen();
  });

  it('"더 담기" 와 "전체 보기" 가 각자 제 콜백을 부른다', () => {
    const onPressMore = jest.fn();
    const onPressSeeAll = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ mustVisits: THREE, onPressMore, onPressSeeAll })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-more'));
    expect(onPressMore).toHaveBeenCalledTimes(1);
    expect(onPressSeeAll).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('trip-wizard-mustvisit-see-all'));
    expect(onPressSeeAll).toHaveBeenCalledTimes(1);
    expect(onPressMore).toHaveBeenCalledTimes(1);
  });

  it('신 계약 — 카드 개별 제거(×)·+N 오버플로우가 없다 (01b D3)', () => {
    render(<TripWizardStep1Screen {...props({ mustVisits: THREE })} />);

    // 제거는 S12 전체 보기 몫이라 카드에 × 가 없고, 3장 상한 접기(+N)도 신 스트립엔 없다.
    THREE.forEach((item) => {
      expect(
        screen.queryByTestId(`trip-wizard-mustvisit-remove-${item.sourcePoiId}`)
      ).toBeNull();
    });
    expect(screen.queryByTestId('trip-wizard-mustvisit-overflow')).toBeNull();

    // 짝(긍정) — 카드 자체는 정상적으로 그려졌다.
    expect(screen.getByTestId('trip-wizard-mustvisit-poi-1')).toBeOnTheScreen();
  });
});

describe('N3 · 0곳도 스트립을 감추지 않는다 (S7 empty 일러스트 아님)', () => {
  it('카드는 0장이고 더 담기·전체 보기·카운트 0 만 남는다', () => {
    render(<TripWizardStep1Screen {...props({ mustVisits: [] })} />);

    expect(block()).toBeOnTheScreen();
    expect(block()).toHaveTextContent(/꼭 갈 곳\s*0/);
    expect(screen.getByTestId('trip-wizard-mustvisit-more')).toBeOnTheScreen();
    expect(
      screen.getByTestId('trip-wizard-mustvisit-see-all')
    ).toBeOnTheScreen();

    // 카드가 하나도 없다(0곳). 옛 empty 일러스트 얼굴(`-empty`)도 없다(S7).
    expect(screen.queryAllByTestId(/^trip-wizard-mustvisit-poi-/)).toHaveLength(
      0
    );
    expect(screen.queryByTestId('trip-wizard-mustvisit-empty')).toBeNull();
  });
});
