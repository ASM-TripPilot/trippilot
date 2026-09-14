import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { SlotCandidateCard } from '@/entities/place/ui/SlotCandidateCard';
import type { SlotCandidatesCandidatesItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-440 · AC-5·6·6b — i14 슬롯 후보 시트(순수 인라인 패널, 바텀시트 아님, 배지 없음).
 * TRIP-806 으로 후보 카드를 공용 `entities/place/ui/SlotCandidateCard` 에 위임한다 —
 * planb 구성(`showImage`·`showNameTestId` 미지정=false, `slack` 주입, 거리 라벨 "지금 위치서")으로.
 *
 * ★ planb 무수정 테스트의 루트 정규식(`CANDIDATE_ROOT`)이 `image-`·`name-` 를 제외하지 않으므로,
 *   planb 구성에선 그 두 testID 를 그리면 안 된다 — entities 카드가 기본 false 라 안전(★6-a).
 * ★ 인라인 View 라 열림/닫힘이 트리 존재/부재로 관찰된다(통과형 바텀시트 목 사각을 안 탄다) —
 *   그래서 바텀시트 라이브러리를 import 하지 않는다(C5 소스 스캔이 잠금). `planb-candidate` 리터럴은
 *   testIDPrefix·degraded·empty 로 이 파일에 그대로 산다(★7).
 * ★ slackLabel 은 시트 공통 1개(교체 슬롯의 "다음 고정까지 여유"라 어느 후보를 골라도 같다, BR-U4-24).
 */

const SHEET_TITLE = '슬롯 바꾸기';
const SHEET_SUBTITLE = '지금 있는 곳에서 갈 수 있는 후보예요';
const DEGRADED_NOTE = 'AI 추천 준비 중, 가까운 순';
const EMPTY_TITLE = '조건에 맞는 후보를 찾지 못했어요';
const EMPTY_HINT = '반경을 넓히거나 컨셉을 바꿔 다시 찾아보세요';
const DISTANCE_LABEL = '지금 위치서';
const SLACK_LABEL = '다음 고정까지';

export interface SlotCandidateSheetProps {
  candidates: SlotCandidatesCandidatesItem[];
  /** slackTime.ts(model)가 만든 여유 문자열 — 시트 공통(교체 슬롯 기준, 후보 무관). */
  slackLabel: string;
  /** true → 강등 고지(AI 순위가 아니라 거리순, INV-4). 기본 false. */
  degraded?: boolean;
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
            <SlotCandidateCard
              key={candidate.poiId}
              candidate={candidate}
              testIDPrefix="planb-candidate"
              distanceLabel={DISTANCE_LABEL}
              slack={{ label: SLACK_LABEL, value: slackLabel }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
