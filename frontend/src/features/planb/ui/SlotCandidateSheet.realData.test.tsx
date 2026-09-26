import { Image } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

import { SlotCandidateSheet } from './SlotCandidateSheet';

/**
 * TRIP-1024 · AC-8 — i14(Plan-B) 후보 시트는 실데이터에 이름·태그·사진이 **있어도** 표시가 안 바뀐다.
 *
 * 왜 따로 두나: 기존 `SlotCandidateSheet.test.tsx` 픽스처엔 이름·사진이 없다. 그래서 공용 카드가
 * 후보 객체의 `nameKo`·`imageUrl` 을 기본으로 읽게 바뀌어도 기존 심판은 전부 green 이다(공허 통과).
 * 여기서는 **값이 채워진** 후보로 "그래도 안 보인다"를 잰다. 공용 카드는 h08·h10 이 명시로 켤 때만
 * 이름·사진을 그려야 한다(opt-in).
 *
 * 3동작: 준비=이름·태그·사진이 다 있는 후보 props → 실행=렌더 → 단언=부재 + 긍정 짝.
 */

const CANDIDATES: SlotCandidatesCandidatesItem[] = [
  {
    poiId: 'p1',
    distanceRange: '차량 6.4km',
    rationale: '비 예보에도 실내라 그대로 갈 수 있어요',
    nameKo: '남부산교회',
    tags: ['교회', '야외'],
    imageUrl: 'https://img.example/p1.jpg',
  },
  {
    poiId: 'p2',
    distanceRange: '도보 1.3km',
    rationale: '가까운 실내 전시',
    nameKo: '해동용궁사',
    tags: ['사찰'],
    imageUrl: 'https://img.example/p2.jpg',
  },
  {
    poiId: 'p3',
    distanceRange: '차량 3.1km',
    rationale: '조용한 카페',
    nameKo: '광안리 카페',
    tags: ['카페'],
    imageUrl: 'https://img.example/p3.jpg',
  },
];

describe('🔴 TRIP-1024 i14 후보 시트 — 실데이터가 와도 불변(AC-8)', () => {
  it('P1 · AC-8 — 이름·태그·사진 leaf 0 · 이미지 0 · 이름은 플레이스홀더 그대로', () => {
    render(
      <SlotCandidateSheet
        candidates={CANDIDATES}
        slackLabel="여유 1시간 20분"
        degraded={false}
      />
    );

    // 긍정 짝 — 후보 카드는 3개 다 그려졌다(카드가 통째로 없어서 참인 게 아니다).
    for (const cand of CANDIDATES) {
      expect(screen.getByTestId(`planb-candidate-${cand.poiId}`)).toBeTruthy();
    }

    // 이름·태그·사진 leaf 는 planb 에 없다.
    // testID 문자열만 비교 — 요소 배열 통째 toEqual 은 실패 시 diff 직렬화로 jest 가 죽는다(03b 경고-1).
    expect(
      screen
        .queryAllByTestId(/^planb-candidate-(image|name|tags)-/)
        .map((el) => el.props.testID)
    ).toEqual([]);
    // testID 를 안 달고 사진만 그리는 경우까지 막는다.
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);

    // 이름 자리는 여전히 플레이스홀더 — 실이름이 새지 않는다.
    expect(screen.getAllByText('이름 준비 중')).toHaveLength(CANDIDATES.length);
    for (const cand of CANDIDATES) {
      expect(screen.queryByText(new RegExp(cand.nameKo ?? ''))).toBeNull();
    }
  });
});
