import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-335 · 후보 카드(h12 시트·h18 화면 공용) — 두 진입이 같은 표면을 그린다(AC6). 왼쪽 표면
 * (알파벳 배지 · 사진 자리 · 이름 · 근거 · 거리)은 여기서 그리고, 오른쪽 컨트롤(선택 버튼/라디오)은
 * 시트·화면이 `trailing` 슬롯으로 넣어 조합한다.
 *
 * 미확보 표기(AC6 · INV-1):
 *  - 이름 자리는 **poiId 원문을 노출하지 않고** 중립 플레이스홀더("이름 준비 중")만 — candidates 에
 *    아직 nameKo 가 안 실린다(BE 후속). 각 leaf 는 값 하나만 담는다(RNTL `toHaveTextContent` 완전
 *    일치 계약) — 그래서 "이동" 라벨은 거리 leaf 와 **다른 Text** 로 뗀다(거리 leaf 는 서버 원문뿐).
 *  - 사진 자리는 회색 박스(빈 View) — 이미지 URL 이 아직 없다.
 *  - `distanceRange`·`rationale` 은 실데이터로 그대로 렌더(거리만 · 소요시간 문자열 0 · INV-3).
 *
 * 배지 문자는 **위치 문자**(current='A', 첫 후보='B'…)라 poiId 원문과 다르다 — poiId 가 알파벳이어도
 * 카드 안 보이는 텍스트로 새지 않는다(시트·화면이 `badge` 로 내려준다).
 */

const NAME_PLACEHOLDER = '이름 준비 중';
const DISTANCE_LABEL = '이동';

/**
 * 후보 카드 배지 문자. 현 슬롯이 'A' 를 쓰므로 첫 후보가 'B' 부터 시작한다(Figma h12·h18). 위치
 * 문자라 poiId 원문과 겹치지 않는다 — poiId 가 알파벳이어도 카드 텍스트로 새지 않는다(AC6 비노출).
 */
export function candidateBadge(index: number): string {
  return String.fromCharCode('B'.charCodeAt(0) + index);
}

// 카드 그림자(h25 `PoiSlotCard`·`ItineraryEditScreen` 와 동일 Figma 값). RN 은 box-shadow 가 없어
// 스타일 프로퍼티로 옮긴다. `#000000` 은 브랜드 팔레트(토큰) 색이 아니라 그림자 색이라 정당하다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

export interface SlotCandidateCardProps {
  candidate: SlotCandidatesCandidatesItem;
  /** 알파벳 배지 문자(A/B/C…) — poiId 원문이 아닌 위치 문자. */
  badge: string;
  /** h18 라디오 선택 시 강조 테두리(색만이 아니라 컨트롤의 접근성 상태로도 관찰된다). */
  selected?: boolean;
  /** 오른쪽 컨트롤 — h12 "선택" 버튼 또는 h18 라디오(시트·화면이 넣는다). */
  trailing: ReactNode;
}

export function SlotCandidateCard({
  candidate,
  badge,
  selected = false,
  trailing,
}: SlotCandidateCardProps): ReactElement {
  const { poiId } = candidate;
  const fieldId = (role: string): string =>
    `itinerary-candidate-${role}-${poiId}`;

  return (
    <View
      testID={`itinerary-candidate-${poiId}`}
      style={cardShadow}
      className={`w-full flex-row items-center gap-md rounded-card border bg-canvas p-md ${
        selected ? 'border-primary' : 'border-hairline'
      }`}
    >
      <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary">
        <Text className="font-inter-bold text-caption font-bold text-on-primary">
          {badge}
        </Text>
      </View>

      <View
        testID={fieldId('image')}
        className="h-[56px] w-[56px] rounded-thumb bg-surface-soft"
      />

      <View className="flex-1 gap-[3px]">
        <Text
          testID={fieldId('name')}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {NAME_PLACEHOLDER}
        </Text>

        <Text
          testID={fieldId('rationale')}
          className="font-noto text-caption text-muted"
        >
          {candidate.rationale}
        </Text>

        <View className="flex-row items-center gap-xs">
          <Text className="font-noto text-caption text-muted-soft">
            {DISTANCE_LABEL}
          </Text>
          <Text
            testID={fieldId('distance')}
            className="font-noto-bold text-caption font-bold text-ink"
          >
            {candidate.distanceRange}
          </Text>
        </View>
      </View>

      {trailing}
    </View>
  );
}
