import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';

import { startUnlessReduceMotion } from '@/shared/lib/reduceMotion';

import {
  deriveVisitStatus,
  isOptimisticVisit,
} from '@/features/check-visit/index.view';
import {
  RetryGlyph,
  VisitCheckActiveGlyph,
  VisitCheckDoneGlyph,
  VisitCheckSkippedGlyph,
  VisitCheckUpcomingGlyph,
} from '@/features/record';

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
 * 사진/메모는 슬롯으로만 받는다 — 미주입이면 아무것도 그리지 않는다(TRIP-1069 D3: 눌러도 반응 없는 정적
 * '+'·메모 글자는 INV-4 무반응 버튼이라 지웠다). 카드는 도착 시각(arrivedLabel, 이미 HH:mm 포맷)만
 * 표시하고 체류시간은 표시하지 않는다(INV-3).
 *
 * TRIP-1069 — 동작 '건너뛰기'(동사·버튼)와 상태 '— 건너뜀'(건너뛴 카드의 라벨)을 문구·모양으로 가른다.
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
  /** TRIP-613 · 시각 수정 시트 진입(옵셔널 — 미제공 시 컨트롤 부재, 565 호출자 무영향). */
  onPressEditTime?: (visitCheckId: string) => void;
  /**
   * TRIP-566 · 사진/메모 슬롯(옵셔널 — 미주입 시 부재, TRIP-1069 D3).
   * 페이지가 PhotoThumbStrip·MemoInline 을 조립해 내려주면 정적 자리 대신 그것을 surface 한다.
   */
  photoSlot?: ReactNode;
  memoSlot?: ReactNode;
  /**
   * TRIP-760 · 사진 업로드 실패 시 카드 하단 재시도 버튼(옵셔널 — 미주입 시 부재, 565/613 호출자 무영향).
   * 페이지 컨테이너가 실패 자산이 있을 때만 내려준다. onPress 는 카드의 실패 자산 전체를 재발화한다
   * (01b 결정 1 — 재시도 단위=카드-레벨).
   */
  uploadRetry?: { onPress: () => void };
  /**
   * TRIP-761 · 수동 체크인 모드(옵셔널 — 미주입/false 면 부재, 565/613/760 호출자 무영향).
   * `manualCheckin && UPCOMING` 일 때만 "방문 체크" pill 을 surface 한다 — press 는 arrive(도착 생성)를
   * 올리는 `onPressManualCheck`(≠`onPressComplete`)로 흐른다. 완료 게이트(BR-U5-05)는 손대지 않는다.
   */
  manualCheckin?: boolean;
  /** TRIP-761 · "방문 체크" press 콜백(arg = card.poiId). arrive({source:'MANUAL', poiId}) 진입점. */
  onPressManualCheck?: (poiId: string) => void;
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
  // TRIP-1125 — 진행 중 → 완료로 **바뀌는 순간만** 체크가 한 번 튄다. 처음부터 완료로 마운트(j01
  // 진입·일차 전환)면 그대로 보인다. 리스트 key 가 visitCheckId 라 낙관 완료에도 이 컴포넌트는 살아 있어
  // 이전 상태를 기억할 수 있다. 등장 모양·박자는 발명값(6-b 육안 조정).
  const checkScale = useRef(new Animated.Value(1)).current;
  const prevStatus = useRef(status);
  useEffect(() => {
    const justCompleted =
      status === 'COMPLETED' && prevStatus.current === 'IN_PROGRESS';
    prevStatus.current = status;
    if (!justCompleted) return;
    // 작게 시작하지 않고 제 크기에서 부풀었다 돌아온다 — 시작 여부는 동작 줄이기 답(Promise) 뒤에야 알 수
    // 있어, 작게 시작하면 첫 프레임에 다 큰 체크가 보였다 줄어드는 번쩍임이 생긴다.
    const stop = startUnlessReduceMotion(
      Animated.sequence([
        Animated.timing(checkScale, {
          toValue: 1.25,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.spring(checkScale, {
          toValue: 1,
          friction: 4,
          useNativeDriver: true,
        }),
      ])
    );
    // 등장 도중 상태가 바뀌면 다음 완료 표시가 중간 크기로 남지 않게 되돌린다.
    return () => {
      stop();
      checkScale.setValue(1);
    };
  }, [status, checkScale]);

  // TRIP-1069 D7 — 아직 서버에 없는 낙관 카드는 완료를 쏠 수 없다(404). 표식만 그린다.
  if (status === 'IN_PROGRESS' && isOptimisticVisit(visitCheckId)) {
    return <VisitCheckActiveGlyph size={22} />;
  }
  const hit = { top: 8, bottom: 8, left: 8, right: 8 } as const;

  if (status === 'COMPLETED') {
    return (
      <Animated.View
        testID={`record-visit-check-done-${visitCheckId}`}
        style={{ transform: [{ scale: checkScale }] }}
      >
        <VisitCheckDoneGlyph size={22} />
      </Animated.View>
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
  onPressEditTime,
  photoSlot,
  memoSlot,
  uploadRetry,
  manualCheckin,
  onPressManualCheck,
}: VisitRecordCardProps): ReactElement {
  const status = deriveVisitStatus(card);
  const canSkip =
    (status === 'UPCOMING' || status === 'IN_PROGRESS') &&
    !isOptimisticVisit(card.visitCheckId);

  return (
    <View
      testID={`record-trip-visit-card-${card.visitCheckId}`}
      className="w-full gap-md rounded-card border border-hairline bg-canvas px-[15px] py-[14px]"
    >
      <View className="w-full flex-row items-center justify-between gap-sm">
        <View className="min-w-0 flex-1 flex-row items-center gap-sm">
          <StatusCircle
            status={status}
            visitCheckId={card.visitCheckId}
            onPressComplete={onPressComplete}
          />
          <Text
            numberOfLines={1}
            className="shrink font-noto-bold text-card-title text-ink"
          >
            {card.nameKo}
          </Text>
        </View>
        <View className="flex-row items-center gap-md">
          {card.arrivedLabel != null && card.arrivedLabel !== '' ? (
            <Text className="text-label text-muted">{card.arrivedLabel}</Text>
          ) : null}
          {onPressEditTime != null ? (
            <Pressable
              testID={`record-trip-visit-time-edit-${card.visitCheckId}`}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => onPressEditTime(card.visitCheckId)}
            >
              <Text className="text-label text-muted-soft">시각 수정</Text>
            </Pressable>
          ) : null}
          {canSkip ? (
            <Pressable
              testID={`record-visit-skip-${card.visitCheckId}`}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => onPressSkip?.(card.visitCheckId)}
              className="rounded-pill border border-hairline-strong bg-canvas px-md py-xs"
            >
              <Text className="text-label text-ink">건너뛰기</Text>
            </Pressable>
          ) : null}
          {status === 'SKIPPED' ? (
            <View
              testID={`record-visit-skipped-label-${card.visitCheckId}`}
              className="flex-row items-center gap-sm"
            >
              <Text className="text-label text-muted-soft">—</Text>
              <Text className="text-label text-muted-soft">건너뜀</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* TRIP-761 · "방문 체크" pill — 수동 체크인 모드 & UPCOMING(도착 전)일 때만. press 는 arrive(도착
          생성, `onPressManualCheck`)로만 흐르고 complete(`onPressComplete`)는 절대 안 쏜다 — 완료 게이트를
          구조로 유지(AC-6). pill 은 Pressable 이고 완료 발화 Pressable(StatusCircle active)과 별개 노드다.
          색·코랄 톤은 jest 사각(present/absent testID 로만 판정, Figma 1562:1963). */}
      {manualCheckin && status === 'UPCOMING' ? (
        <View className="flex-row items-center gap-[10px]">
          <Pressable
            testID={`record-visit-manual-check-${card.visitCheckId}`}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => onPressManualCheck?.(card.poiId)}
            className="flex-row items-center rounded-[8px] bg-primary px-[15px] py-sm"
          >
            <Text className="font-noto-bold text-label text-white">
              방문 체크
            </Text>
          </Pressable>
          <Text className="text-caption text-muted">
            좌표 없이 장소 직접 선택
          </Text>
        </View>
      ) : null}

      {/* 사진·메모 슬롯 — 페이지 배선(PhotoThumbStrip·MemoInline)만. 미주입이면 없다(D3). */}
      {photoSlot}
      {memoSlot}

      {/* TRIP-760 · 업로드 실패 재시도 — uploadRetry 주입 시에만. 풀폭 [↻ 다시 시도] + INV-4 안내
          (사진은 실패했어도 메모·방문 체크는 저장됐다). 미주입 시 이 블록 자체가 없다(무회귀 짝). */}
      {uploadRetry != null ? (
        <View className="w-full gap-[6px]">
          <Pressable
            testID={`record-trip-upload-retry-${card.visitCheckId}`}
            onPress={uploadRetry.onPress}
            className="w-full flex-row items-center justify-center gap-xs rounded-pill border border-primary py-[10px]"
          >
            <RetryGlyph size={16} />
            <Text className="font-noto-bold text-label text-primary">
              다시 시도
            </Text>
          </Pressable>
          <Text className="text-center text-caption text-muted-soft">
            메모와 방문 체크는 저장되었어요
          </Text>
        </View>
      ) : null}
    </View>
  );
}
