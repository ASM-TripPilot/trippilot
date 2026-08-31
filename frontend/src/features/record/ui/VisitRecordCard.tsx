import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { deriveVisitStatus } from '../model/visitStatus';
import {
  PlusGlyph,
  VisitCheckActiveGlyph,
  VisitCheckDoneGlyph,
  VisitCheckSkippedGlyph,
  VisitCheckUpcomingGlyph,
} from './RecordGlyphs';

/**
 * TRIP-565 · j01 방문 기록 카드(순수 프레젠테이션 — VM 주입, 재판정 없음).
 *
 * 상태를 prop 으로 받지 않는다 — 세 timestamp 를 `deriveVisitStatus` 로 **카드 내부에서 파생**한다
 * (INV-U5-01). 그리고 상태별로 **서로 다른 testID** 의 체크서클을 렌더한다:
 *   COMPLETED → -done- (비발화 마커) · IN_PROGRESS → -active- (Pressable, 완료 발화) ·
 *   UPCOMING → -upcoming- (accessibilityState.disabled, 완료 배선 없음) · SKIPPED → -skipped-.
 *
 * ★ 이 distinct-testID 설계가 두 함정을 막는다(02a §4):
 *  1. 체크서클 fill 색은 jest 사각(repo-traps 글리프) → 완료↔미완료를 색이 아니라 testID 로 가른다.
 *  2. "도착 없는 슬롯은 완료 불가"(AC-3)를 disabled 에 기대지 않는다 — 완료를 발화하는 Pressable 이
 *     IN_PROGRESS 에만 존재해, UPCOMING press 는 발화할 핸들러 자체가 없어 **구조적으로** 0회다.
 *
 * 사진/메모는 정적 스캐폴딩(testID·배선·데이터 없음)이다 — US-REC-02 소관(범위 밖). 카드는 도착
 * 시각(arrivedLabel, 이미 HH:mm 포맷)만 표시하고 체류시간은 표시하지 않는다(INV-3).
 */

export interface VisitRecordCardVM {
  visitCheckId: string;
  slotKey?: string | null;
  poiId: string;
  nameKo: string;
  arrivedAt?: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
  /** 이미 포맷된 도착시각(HH:mm) — 없으면 미표시. 소요시간 아님(INV-3). */
  arrivedLabel?: string | null;
}

export interface VisitRecordCardProps {
  card: VisitRecordCardVM;
  onPressComplete?: (visitCheckId: string) => void;
  onPressSkip?: (visitCheckId: string) => void;
}

function StatusCircle({
  status,
  visitCheckId,
  onPressComplete,
}: {
  status: ReturnType<typeof deriveVisitStatus>;
  visitCheckId: string;
  onPressComplete?: (visitCheckId: string) => void;
}): ReactElement {
  const hit = { top: 8, bottom: 8, left: 8, right: 8 } as const;

  if (status === 'COMPLETED') {
    return (
      <View testID={`record-visit-check-done-${visitCheckId}`}>
        <VisitCheckDoneGlyph size={22} />
      </View>
    );
  }
  if (status === 'IN_PROGRESS') {
    // 완료 발화는 여기(active)에만 있다 — UPCOMING/COMPLETED/SKIPPED 엔 배선이 없다(AC-3 구조).
    return (
      <Pressable
        testID={`record-visit-check-active-${visitCheckId}`}
        hitSlop={hit}
        onPress={() => onPressComplete?.(visitCheckId)}
      >
        <VisitCheckActiveGlyph size={22} />
      </Pressable>
    );
  }
  if (status === 'SKIPPED') {
    return (
      <View testID={`record-visit-check-skipped-${visitCheckId}`}>
        <VisitCheckSkippedGlyph size={22} />
      </View>
    );
  }
  // UPCOMING — 도착 전이라 완료 불가. 상태 표식만 비활성으로 노출(발화 배선 없음).
  return (
    <View
      testID={`record-visit-check-upcoming-${visitCheckId}`}
      accessibilityState={{ disabled: true }}
    >
      <VisitCheckUpcomingGlyph size={22} />
    </View>
  );
}

export function VisitRecordCard({
  card,
  onPressComplete,
  onPressSkip,
}: VisitRecordCardProps): ReactElement {
  const status = deriveVisitStatus(card);
  const canSkip = status === 'UPCOMING' || status === 'IN_PROGRESS';

  return (
    <View
      testID={`record-trip-visit-card-${card.visitCheckId}`}
      className="w-full gap-md rounded-card border border-hairline bg-canvas px-[15px] py-[14px]"
    >
      <View className="w-full flex-row items-center justify-between">
        <View className="flex-row items-center gap-sm">
          <StatusCircle
            status={status}
            visitCheckId={card.visitCheckId}
            onPressComplete={onPressComplete}
          />
          <Text className="font-noto-bold text-card-title text-ink">
            {card.nameKo}
          </Text>
        </View>
        <View className="flex-row items-center gap-md">
          {card.arrivedLabel != null && card.arrivedLabel !== '' ? (
            <Text className="text-label text-muted">{card.arrivedLabel}</Text>
          ) : null}
          {canSkip ? (
            <Pressable
              testID={`record-visit-skip-${card.visitCheckId}`}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => onPressSkip?.(card.visitCheckId)}
            >
              <Text className="text-label text-muted-soft">건너뜀</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 사진/메모 정적 스캐폴딩(US-REC-02 소관 — 데이터·배선·testID 없음). */}
      <View className="flex-row items-start gap-sm">
        <View className="size-[66px] items-center justify-center rounded-[10px] border-[1.4px] border-dashed border-hairline-strong">
          <PlusGlyph size={22} />
        </View>
      </View>
      <Text className="text-label text-muted-soft">메모를 남겨보세요</Text>
    </View>
  );
}
