import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-440 · AC-5·6·6b — i14 슬롯 후보 시트(순수 인라인 패널, 바텀시트 아님, 배지 없음).
 *
 * 후보 카드 4정보 중 세 가지(rationale·distanceRange·slackLabel)를 각자 leaf 로 그린다 — 각 leaf 는
 * 값 하나만 담는다(RNTL `toHaveTextContent` STRING 완전일치 계약, `SlotCandidateCard` 선례). 이름·
 * 사진은 candidates 응답에 필드가 없어(BE 후속) 중립 플레이스홀더만 — poiId 원문은 새지 않는다(INV-1).
 *
 * ★ 여유 숫자 두 얼굴: `slackLabel`은 slackTime.ts(model)가 만든 문자열을 **변수로만** 렌더한다 —
 *   이 ui 소스엔 `N시간`/`N분` 리터럴이 0이라 executionDurationStructure(AC-8)가 green 이다. slackLabel
 *   은 시트 공통 1개(교체 슬롯의 "다음 고정까지 여유"라 어느 후보를 골라도 같다, BR-U4-24).
 * ★ 배지("지금 제안"/"이걸로")는 안 그린다 — 채택 여부는 재계획안(draft) 계약 확장 후(D5·AC-10 막힘).
 * ★ 인라인 View 라 열림/닫힘이 트리 존재/부재로 관찰된다(통과형 바텀시트 목 사각을 안 탄다, TRIP-483
 *   itinerary 이관 선례) — 그래서 바텀시트 라이브러리를 import 하지 않는다(C5 소스 스캔이 잠금).
 */

const SHEET_TITLE = '슬롯 바꾸기';
const SHEET_SUBTITLE = '지금 있는 곳에서 갈 수 있는 후보예요';
const DEGRADED_NOTE = 'AI 추천 준비 중, 가까운 순';
const EMPTY_TITLE = '조건에 맞는 후보를 찾지 못했어요';
const EMPTY_HINT = '반경을 넓히거나 컨셉을 바꿔 다시 찾아보세요';
const NAME_PLACEHOLDER = '이름 준비 중';
const DISTANCE_LABEL = '지금 위치서';
const SLACK_LABEL = '다음 고정까지';

export interface SlotCandidateSheetProps {
  candidates: SlotCandidatesCandidatesItem[];
  /** slackTime.ts(model)가 만든 여유 문자열 — 시트 공통(교체 슬롯 기준, 후보 무관). */
  slackLabel: string;
  /** true → 강등 고지(AI 순위가 아니라 거리순, INV-4). 기본 false. */
  degraded?: boolean;
}

function CandidateCard({
  candidate,
  slackLabel,
}: {
  candidate: SlotCandidatesCandidatesItem;
  slackLabel: string;
}): ReactElement {
  const { poiId } = candidate;
  const leafId = (role: string): string => `planb-candidate-${role}-${poiId}`;

  return (
    <View
      testID={`planb-candidate-${poiId}`}
      className="w-full gap-sm rounded-card border border-hairline bg-canvas p-md"
    >
      {/* 이름 자리 — 미확보 플레이스홀더(poiId 원문 비노출, INV-1). */}
      <Text
        numberOfLines={1}
        className="font-noto-bold text-card-title font-bold text-ink"
      >
        {NAME_PLACEHOLDER}
      </Text>

      {/* 추천 이유 — 서버 원문 그대로(leaf 값 하나). */}
      <Text
        testID={leafId('rationale')}
        className="font-noto text-caption text-muted"
      >
        {candidate.rationale}
      </Text>

      {/* 거리 — 라벨은 별도 Text, 값은 자기 leaf(거리만, 소요시간 0 · INV-3). */}
      <View className="flex-row items-center gap-xs">
        <Text className="font-noto text-caption text-muted-soft">
          {DISTANCE_LABEL}
        </Text>
        <Text
          testID={leafId('distance')}
          className="font-noto-bold text-caption font-bold text-ink"
        >
          {candidate.distanceRange}
        </Text>
      </View>

      {/* 여유 — 라벨은 별도 Text, 값은 변수 leaf(숫자 포맷은 model 이 만든다). */}
      <View className="flex-row items-center gap-xs">
        <Text className="font-noto text-caption text-muted-soft">
          {SLACK_LABEL}
        </Text>
        <Text
          testID={leafId('slack')}
          className="font-noto-bold text-caption font-bold text-primary-text"
        >
          {slackLabel}
        </Text>
      </View>
    </View>
  );
}

export function SlotCandidateSheet({
  candidates,
  slackLabel,
  degraded = false,
}: SlotCandidateSheetProps): ReactElement {
  return (
    <View className="w-full gap-md rounded-sheet-top bg-canvas p-lg">
      {/* 헤더 */}
      <View className="gap-xs">
        <Text className="font-noto-bold text-section font-bold text-ink">
          {SHEET_TITLE}
        </Text>
        <Text className="font-noto text-label text-muted-soft">
          {SHEET_SUBTITLE}
        </Text>
      </View>

      {/* 강등 고지 — degraded 일 때만(취향 오인 방지, INV-4). */}
      {degraded ? (
        <View
          testID="planb-candidate-degraded"
          className="w-full rounded-button bg-surface-soft px-md py-sm"
        >
          <Text className="font-noto text-caption text-muted">
            {DEGRADED_NOTE}
          </Text>
        </View>
      ) : null}

      {candidates.length === 0 ? (
        <View
          testID="planb-candidate-empty"
          className="w-full items-center gap-xs rounded-card border border-dashed border-hairline-strong px-lg py-2xl"
        >
          <Text className="text-center font-noto-bold text-card-title font-bold text-ink">
            {EMPTY_TITLE}
          </Text>
          <Text className="text-center font-noto text-label text-muted">
            {EMPTY_HINT}
          </Text>
        </View>
      ) : (
        <View className="w-full gap-sm">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.poiId}
              candidate={candidate}
              slackLabel={slackLabel}
            />
          ))}
        </View>
      )}
    </View>
  );
}
