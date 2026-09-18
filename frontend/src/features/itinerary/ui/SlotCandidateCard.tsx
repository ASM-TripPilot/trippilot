import type { ReactElement, ReactNode } from 'react';

import { SlotCandidateCard as PlaceSlotCandidateCard } from '@/entities/place/ui/SlotCandidateCard';
import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-335 · 후보 카드(h12 시트·h18 화면 공용) → TRIP-806 으로 entities/place 카드에 위임.
 *
 * 표면(배지·회색 사진자리·"이름 준비 중"·rationale·distance leaf·"이동" 라벨)은 이제 공용
 * `entities/place/ui/SlotCandidateCard` 가 그린다 — 여기선 itinerary 구성(showImage·showNameTestId·
 * 배지·거리 라벨 "이동")을 주입하는 얇은 위임만 한다. testID·표시는 그대로다(회귀 0).
 * 오른쪽 컨트롤(선택 버튼/라디오)은 소비처가 `trailing` 으로 넣는다.
 */

const DISTANCE_LABEL = '이동';

/**
 * 후보 카드 배지 문자. 현 슬롯이 'A' 를 쓰므로 첫 후보가 'B' 부터 시작한다(Figma h12·h18). 위치
 * 문자라 poiId 원문과 겹치지 않는다 — poiId 가 알파벳이어도 카드 텍스트로 새지 않는다(AC6 비노출).
 */
export function candidateBadge(index: number): string {
  return String.fromCharCode('B'.charCodeAt(0) + index);
}

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
  return (
    <PlaceSlotCandidateCard
      candidate={candidate}
      testIDPrefix="itinerary-candidate"
      distanceLabel={DISTANCE_LABEL}
      showNameTestId
      showImage
      badge={badge}
      selected={selected}
      trailing={trailing}
    />
  );
}
