import { Text } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { SlotCandidateCard } from './SlotCandidateCard';

/**
 * TRIP-806 · AC-M2·M5·M6 — 슬롯 후보 카드를 entities 로 모은다. 두 소비처(itinerary h08·h10 · planb i14)
 * 를 **하나의** 카드가 옵셔널 슬롯 + `testIDPrefix` 로 재현한다.
 *
 * ★ 실측 발견(02a ★6): 두 소비처는 접두만 다른 게 아니라 **구조가 갈린다** —
 *   - itinerary: `-image-` 회색박스 · `-name-` testID · 배지(A/B/C) · trailing 선택버튼 · selected 테두리 ·
 *     거리 라벨 "이동".
 *   - planb: `-slack-` leaf 있음 · `-image-`/`-name-` testID **없음** · 배지·trailing·selected 없음 ·
 *     거리 라벨 "지금 위치서".
 *   그래서 entities 카드는 `showImage?`·`showNameTestId?`·`badge?`·`slack?`·`trailing?`·`selected?`·
 *   `distanceLabel`(주입) 옵셔널 슬롯으로 둘 다 그린다.
 *
 * ★ planb 무수정 테스트의 루트 정규식(`CANDIDATE_ROOT`)이 `image-`·`name-` 를 제외하지 않아(02a ★6-a),
 *   planb 구성에선 이 두 testID 를 그리면 안 된다 → CC2 가 그 부재를 잠근다.
 *
 * 무엇을 보장하나:
 *  - 🔴 값 leaf(EXACT): `{prefix}-rationale-{poiId}`·`{prefix}-distance-{poiId}` · (planb) `{prefix}-slack-{poiId}`.
 *  - 🔴 이름은 항상 중립 플레이스홀더 "이름 준비 중"(candidates 에 nameKo 없음, BE 후속 — poiId 원문 비노출 INV-1).
 *  - 🔴 거리·근거 leaf 에 소요시간 단위 0(INV-3, slack 은 두 고정시각 차라 예외).
 *
 * 3동작 뼈대: 준비=candidate + 구성 → 실행=렌더 → 단언=leaf 값·부재·콜백 슬롯.
 */

const CAND: SlotCandidatesCandidatesItem = {
  poiId: 'p1',
  distanceRange: '차량 6.4km',
  rationale: '비 예보에도 실내라 그대로 갈 수 있어요',
};

describe('🔴 SlotCandidateCard — itinerary 구성(h08·h10)', () => {
  it('CC1 · 배지·이미지·이름 testID·trailing + 거리 라벨 "이동"', () => {
    render(
      <SlotCandidateCard
        candidate={CAND}
        testIDPrefix="itinerary-candidate"
        distanceLabel="이동"
        showNameTestId
        showImage
        badge="B"
        trailing={<Text testID="cc-trail">선택</Text>}
      />
    );

    expect(screen.getByTestId('itinerary-candidate-p1')).toBeTruthy();
    expect(screen.getByTestId('itinerary-candidate-name-p1')).toHaveTextContent(
      '이름 준비 중'
    );
    expect(screen.getByTestId('itinerary-candidate-image-p1')).toBeTruthy();
    expect(
      screen.getByTestId('itinerary-candidate-rationale-p1')
    ).toHaveTextContent(CAND.rationale);
    expect(
      screen.getByTestId('itinerary-candidate-distance-p1')
    ).toHaveTextContent(CAND.distanceRange);
    expect(screen.getByText('이동')).toBeTruthy(); // 거리 라벨은 별도 Text
    expect(screen.getByText('B')).toBeTruthy(); // 배지
    expect(screen.getByTestId('cc-trail')).toBeTruthy(); // trailing 슬롯
    expect(screen.queryByTestId('itinerary-candidate-slack-p1')).toBeNull();
  });
});

describe('🔴 SlotCandidateCard — planb 구성(i14)', () => {
  it('CC2 · slack leaf 있음, image·name testID 없음(★6-a) + 거리 라벨 "지금 위치서"', () => {
    render(
      <SlotCandidateCard
        candidate={CAND}
        testIDPrefix="planb-candidate"
        distanceLabel="지금 위치서"
        slack={{ label: '다음 고정까지', value: '여유 1시간 20분' }}
      />
    );

    expect(screen.getByTestId('planb-candidate-p1')).toBeTruthy();
    expect(
      screen.getByTestId('planb-candidate-rationale-p1')
    ).toHaveTextContent(CAND.rationale);
    expect(screen.getByTestId('planb-candidate-distance-p1')).toHaveTextContent(
      CAND.distanceRange
    );
    expect(screen.getByTestId('planb-candidate-slack-p1')).toHaveTextContent(
      '여유 1시간 20분'
    );

    // ★6-a — planb 루트 집합 정규식이 이 두 testID 를 후보 루트로 오계수하지 않도록 아예 안 그린다.
    expect(screen.queryByTestId('planb-candidate-image-p1')).toBeNull();
    expect(screen.queryByTestId('planb-candidate-name-p1')).toBeNull();

    // 이름 텍스트 자체는 여전히 뜬다(testID 만 없다).
    expect(screen.getByText('이름 준비 중')).toBeTruthy();
    expect(screen.getByText('지금 위치서')).toBeTruthy();
  });
});

describe('🔴 SlotCandidateCard — 불변식(INV-3·INV-1)', () => {
  it('CC3 · 거리·근거 leaf 에 소요시간 단위 0(INV-3)', () => {
    render(
      <SlotCandidateCard
        candidate={CAND}
        testIDPrefix="itinerary-candidate"
        distanceLabel="이동"
        showNameTestId
        showImage
        badge="B"
        trailing={<Text testID="cc-trail">선택</Text>}
      />
    );

    expect(
      screen.getByTestId('itinerary-candidate-distance-p1')
    ).not.toHaveTextContent(/분|시간|소요/);
    expect(
      screen.getByTestId('itinerary-candidate-rationale-p1')
    ).not.toHaveTextContent(/분|시간|소요/);
  });

  it('CC4 · poiId 원문은 카드 텍스트로 새지 않는다(INV-1)', () => {
    render(
      <SlotCandidateCard
        candidate={{ ...CAND, poiId: 'hidden-poi' }}
        testIDPrefix="planb-candidate"
        distanceLabel="지금 위치서"
        slack={{ label: '다음 고정까지', value: '여유 1시간 20분' }}
      />
    );

    const card = within(screen.getByTestId('planb-candidate-hidden-poi'));
    expect(card.queryByText(/hidden-poi/)).toBeNull();
  });
});
