import { fireEvent, render, screen } from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';

import { StaySearchScreen } from './StaySearchScreen';
import { stayKey } from '../model/stayKey';

/**
 * TRIP-469 — e02 숙소 검색 결과에 이름·지역 검색창을 넣는다(예전엔 TextInput 자체가 없었다).
 *
 * 무엇을 보장하나:
 *  · onChangeNameQuery 를 줄 때만 검색창(stay-search-name-input)이 뜬다(미지정=무회귀).
 *  · nameQuery 로 이름/지역을 클라 부분일치로 좁힌다(카드·개수 둘 다).
 *  · results 인데 검색어가 0건을 만들면 빈 body 대신 "검색 결과가 없어요"를 낸다.
 */

const ITEMS: StayItem[] = [
  {
    externalSource: 'NAVER',
    externalId: 's1',
    name: '해운대 그랜드 호텔',
    lat: 35.1587,
    lng: 129.1604,
    region: '해운대',
    amenities: ['ocean'],
    stayType: 'HOTEL',
    price: { amount: 145000, currency: 'KRW' },
  },
  {
    externalSource: 'NAVER',
    externalId: 's2',
    name: '서면 시티 호텔',
    lat: 35.1577,
    lng: 129.0594,
    region: '서면',
    amenities: ['wifi'],
    stayType: 'HOTEL',
    price: { amount: 90000, currency: 'KRW' },
  },
];
const KEY_A = stayKey(ITEMS[0]);
const KEY_B = stayKey(ITEMS[1]);

describe('StaySearchScreen — 이름·지역 검색창(TRIP-469)', () => {
  it('onChangeNameQuery 미지정이면 검색창이 안 뜬다(무회귀)', () => {
    render(<StaySearchScreen region="부산" items={ITEMS} />);
    expect(screen.queryByTestId('stay-search-name-input')).toBeNull();
    // 두 카드 그대로.
    expect(screen.getByTestId(`stay-card-${KEY_A}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`stay-card-${KEY_B}`)).toBeOnTheScreen();
  });

  it('onChangeNameQuery 를 주면 검색창이 뜨고 입력이 콜백으로 간다', () => {
    const onChange = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        nameQuery=""
        onChangeNameQuery={onChange}
      />
    );
    fireEvent.changeText(screen.getByTestId('stay-search-name-input'), '서면');
    expect(onChange).toHaveBeenCalledWith('서면');
  });

  it('이름으로 좁힌다 — 매칭 카드만 남는다', () => {
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        nameQuery="그랜드"
        onChangeNameQuery={() => {}}
      />
    );
    expect(screen.getByTestId(`stay-card-${KEY_A}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`stay-card-${KEY_B}`)).toBeNull();
  });

  it('지역으로도 좁힌다', () => {
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        nameQuery="서면"
        onChangeNameQuery={() => {}}
      />
    );
    expect(screen.getByTestId(`stay-card-${KEY_B}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`stay-card-${KEY_A}`)).toBeNull();
  });

  it('results 인데 검색어가 0건을 만들면 "검색 결과가 없어요"를 낸다', () => {
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        nameQuery="없는숙소"
        onChangeNameQuery={() => {}}
      />
    );
    expect(screen.getByTestId('stay-search-name-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId(`stay-card-${KEY_A}`)).toBeNull();
  });

  it('빈 검색어는 전체를 그대로 둔다(no-match 아님)', () => {
    render(
      <StaySearchScreen
        region="부산"
        items={ITEMS}
        nameQuery=""
        onChangeNameQuery={() => {}}
      />
    );
    expect(screen.queryByTestId('stay-search-name-empty')).toBeNull();
    expect(screen.getByTestId(`stay-card-${KEY_A}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`stay-card-${KEY_B}`)).toBeOnTheScreen();
  });
});
