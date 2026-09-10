import { fireEvent, render, screen } from '@testing-library/react-native';

import type { MustVisitSeedItem } from '@/features/trip/model/mustVisitSeed';

import { MustVisitListScreen } from './MustVisitListScreen';

/**
 * TRIP-676 · S12 꼭 갈 곳 전용 목록 화면 — props-only 프레젠테이션 유닛 테스트.
 *
 * 무엇을 보장하나: 이 여행의 시드(`MustVisitSeedItem[]`)를 세로 목록으로 그리고(썸네일·이름),
 * 카드마다 제거 ×·목록 밖에 더 담기/뒤로를 콜백으로만 낸다. `imageUrl` 이 null 이면 회색 자리이지
 * 기본 이미지를 지어내지 않는다(INV-1). 지역(region, TRIP-685)은 값이 있으면 이름 아래 한 줄로
 * `place.region` 을 무가공 표시하고, null/빈값이면 요소를 안 만든다(SC-6 — 옛 부재 락을 뒤집은 계약 플립).
 *
 * 왜 화면 밖 콜백인가: 화면은 store·라우터를 모른다(경계 규율). 제거는 `onRemove(sourcePoiId)`,
 * 더 담기·뒤로는 인자 없는 콜백으로 넘겨 배선(`MustVisitListPage`)이 무엇을 할지 정한다.
 *
 * ⚠️ 제거 인자는 **문자열 `sourcePoiId`** 다(store `removeMustVisit(sourcePoiId: string)` 실측) —
 * seed D4 의 `seq` 는 destination 축 오기(02a §1 계약 어긋남).
 */

/** 시드 항목(`MustVisitSeedItem` 실측 shape) — region 은 기본 null(대부분 케이스는 지역선 무관). */
function seed(
  sourcePoiId: string,
  name: string,
  imageUrl: string | null = null,
  region: string | null = null
): MustVisitSeedItem {
  return { sourcePoiId, name, imageUrl, region };
}

const THREE: MustVisitSeedItem[] = [
  seed('poi-1', '감천마을'),
  seed('poi-2', '광안리'),
  seed('poi-3', '전포카페거리'),
];

function props(
  overrides: Partial<Parameters<typeof MustVisitListScreen>[0]> = {}
) {
  return {
    items: THREE,
    onRemove: jest.fn(),
    onAddMore: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  } satisfies Parameters<typeof MustVisitListScreen>[0];
}

function cards() {
  return screen.queryAllByTestId(/^trip-mustvisit-list-card-/);
}

describe('SC-1 · 시드 전체를 세로 목록으로 렌더 (AC-1)', () => {
  it('items N개면 카드 N개가 이름과 함께 뜨고, 더 담기·뒤로가 선다', () => {
    render(<MustVisitListScreen {...props()} />);

    expect(cards()).toHaveLength(3);
    expect(screen.getByText('감천마을')).toBeOnTheScreen();
    expect(screen.getByText('광안리')).toBeOnTheScreen();
    expect(screen.getByText('전포카페거리')).toBeOnTheScreen();

    expect(screen.getByTestId('trip-mustvisit-list-more')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-mustvisit-list-back')).toBeOnTheScreen();
    // empty 안내는 항목이 있을 때 안 뜬다(부정 짝).
    expect(screen.queryByTestId('trip-mustvisit-list-empty')).toBeNull();
  });
});

describe('SC-2 · 썸네일 — imageUrl null 은 회색 자리, 있으면 이미지 (INV-1)', () => {
  it('null 항목은 이미지 대신 회색 자리, 값 있는 항목은 이미지가 뜬다', () => {
    render(
      <MustVisitListScreen
        {...props({
          items: [
            seed('poi-1', '감천마을', null),
            seed('poi-2', '광안리', 'https://cdn.example.com/gwangalli.jpg'),
          ],
        })}
      />
    );

    // null → 회색 자리 present · 이미지 absent (기본 이미지 발명 금지)
    expect(
      screen.getByTestId('trip-mustvisit-list-imageplaceholder-poi-1')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-mustvisit-list-image-poi-1')).toBeNull();

    // 값 있음 → 이미지 present · 회색 자리 absent (상호배타)
    expect(
      screen.getByTestId('trip-mustvisit-list-image-poi-2')
    ).toBeOnTheScreen();
    expect(
      screen.queryByTestId('trip-mustvisit-list-imageplaceholder-poi-2')
    ).toBeNull();
  });
});

describe('SC-3 · 카드 개별 제거 → onRemove(sourcePoiId) (AC-2)', () => {
  it('누른 카드의 × 가 그 sourcePoiId 문자열로 정확히 1회 콜백한다', () => {
    const onRemove = jest.fn();
    render(<MustVisitListScreen {...props({ onRemove })} />);

    // 매처 + press 짝 — testID 존재만이 아니라 눌러서 인자까지 본다.
    fireEvent.press(screen.getByTestId('trip-mustvisit-list-remove-poi-2'));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('poi-2');
  });
});

describe('SC-4 · 더 담기·뒤로가 각자 제 콜백을 부른다 (AC-2)', () => {
  it('더 담기 → onAddMore, 뒤로 → onBack, 제거는 안 불린다', () => {
    const onAddMore = jest.fn();
    const onBack = jest.fn();
    const onRemove = jest.fn();
    render(<MustVisitListScreen {...props({ onAddMore, onBack, onRemove })} />);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-more'));
    expect(onAddMore).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('trip-mustvisit-list-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe('SC-5 · 0곳 empty — 카드 부재 + 더 담기만 (AC-1·AC-2)', () => {
  it('items 가 비면 카드 0장, empty 안내·더 담기·뒤로만 남는다', () => {
    render(<MustVisitListScreen {...props({ items: [] })} />);

    expect(cards()).toHaveLength(0);
    expect(screen.getByTestId('trip-mustvisit-list-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-mustvisit-list-more')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-mustvisit-list-back')).toBeOnTheScreen();
  });
});

describe('SC-6 · 지역선 — 값 있으면 present, null/빈값이면 absent (TRIP-685 · 계약 플립)', () => {
  // ⚠️ 이 describe 는 옛 "region 부재 금지 락"(`queryByTestId(/^…-region-/).toBeNull()`)을
  // **의도적으로 개봉**한 것이다 — 계약 파기가 아니라 이 티켓이 부재 락을 정식으로 뒤집는다
  // (브리프 맹점② · 01b 명시 · 02a ★3). 부재 단언은 null 시드 짝으로 계승한다.

  it('SC-6a region 이 있는 카드엔 지역선을 원문 그대로 그리고, null 인 카드엔 안 그린다 (present/absent 짝)', () => {
    render(
      <MustVisitListScreen
        {...props({
          items: [
            seed('poi-1', '감천마을', null, '수영구'),
            seed('poi-2', '광안리', null, '부산 해운대구'),
            seed('poi-3', '전포카페거리', null, null),
          ],
        })}
      />
    );

    // present — 짧은 값·긴 값 모두 place.region 무가공(포맷터를 끼우면 완전 일치가 깨진다, 02a ★4).
    expect(
      screen.getByTestId('trip-mustvisit-list-region-poi-1')
    ).toHaveTextContent('수영구');
    expect(
      screen.getByTestId('trip-mustvisit-list-region-poi-2')
    ).toHaveTextContent('부산 해운대구');

    // absent — region 이 null 인 카드는 지역선을 만들지 않는다(섞인 배열이라 특정 testID 로 본다, ★5).
    expect(screen.queryByTestId('trip-mustvisit-list-region-poi-3')).toBeNull();

    // 짝(긍정) — 카드·이름은 정상.
    expect(
      screen.getByTestId('trip-mustvisit-list-card-poi-1')
    ).toBeOnTheScreen();
    expect(screen.getByText('감천마을')).toBeOnTheScreen();
  });

  it("SC-6b region 이 빈 문자열('')이어도 접는다 — 옛 부재 락을 null/빈값 짝으로 계승 (01b Q3)", () => {
    render(
      <MustVisitListScreen
        {...props({ items: [seed('poi-1', '감천마을', null, '')] })}
      />
    );

    // 긍정 — 카드·이름은 정상(카드 자체가 안 떠서 공짜 통과하는 것을 막는다).
    expect(
      screen.getByTestId('trip-mustvisit-list-card-poi-1')
    ).toBeOnTheScreen();
    expect(screen.getByText('감천마을')).toBeOnTheScreen();

    // 부재 — 빈 문자열은 지역선을 만들지 않는다(옛 SC-6 부재 락의 정규식을 그대로 계승).
    expect(screen.queryByTestId(/^trip-mustvisit-list-region-/)).toBeNull();
  });
});
