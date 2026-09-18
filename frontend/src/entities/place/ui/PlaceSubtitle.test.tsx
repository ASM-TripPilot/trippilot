import { render, screen } from '@testing-library/react-native';

import { PlaceSubtitle } from './PlaceSubtitle';

/**
 * TRIP-806 · AC-M2·M4·M5·M7 — 장소 "부제 조각" 을 entities 로 모은다.
 *
 * 3-a 결정(01b §1): 부제 조각은 `parts: string[]` 를 ' · ' 로 **잇기만** 한다 — 어떤 조각을 넣을지는
 * 화면이 정한다(d04·d06 `카테고리·지역` / i10 `tags` / h13 `#tags·카테고리` 그대로). 나이브 통합해
 * 세 화면 표시가 바뀌는 걸 막는 설계다.
 *
 * 무엇을 보장하나:
 *  - 🔴 `parts` 를 ' · ' 로 이어 한 줄로 그린다(getByText EXACT).
 *  - 🔴 조각이 하나면 구분자 없이 그 하나만.
 *
 * 3동작 뼈대: 준비=parts 배열 → 실행=렌더 → 단언=이어진 한 줄 텍스트.
 */

describe('🔴 PlaceSubtitle (AC-M2 부제 조각)', () => {
  it('S1 · 두 조각을 " · " 로 잇는다(d04·d06 카테고리·지역)', () => {
    render(<PlaceSubtitle parts={['맛집', '부산 해운대구']} />);

    expect(screen.getByText('맛집 · 부산 해운대구')).toBeTruthy();
  });

  it('S2 · 조각이 하나면 구분자 없이 그 하나만', () => {
    render(<PlaceSubtitle parts={['명소']} />);

    expect(screen.getByText('명소')).toBeTruthy();
  });

  it('S3 · tags 여러 개도 같은 방식으로 잇는다(i10 tags.join)', () => {
    render(<PlaceSubtitle parts={['해변', '포토스팟']} />);

    expect(screen.getByText('해변 · 포토스팟')).toBeTruthy();
  });
});
