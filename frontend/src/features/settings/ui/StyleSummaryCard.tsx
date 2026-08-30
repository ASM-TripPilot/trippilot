import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatKoreanDate } from '@/shared/date/formatKoreanDate';

import type { StyleCardVM, StyleGauge } from '../model/styleCardModel';

/**
 * TRIP-606 · l03 스타일 요약 카드 — VM 주입 순수 프레젠테이션. 조회·조립은 페이지 몫이라 여긴
 * 완성 VM 을 받아 `kind` 로만 두 얼굴을 가른다(판정 없음).
 *
 * 정식: 디스크립터 칩 + 3축 dot 게이지 + "여행 N개 · 갱신 …" + 상세 진입.
 * 미달: "10곳 이상 쌓이면…" 안내 한 줄만(게이지·칩 없음, INV-U5-09).
 *
 * dot 게이지는 **채운/빈 dot 을 각각 다른 testID 를 단 View** 로 그린다(SVG 한 장 금지) — repo-traps 의
 * 글리프 fill 함정(색 변화는 jest 사각) 때문에, 채움 개수가 서버 값과 일치하는지를 testID 카운트로
 * 잴 수 있어야 AC-S2 가 실효한다. 빈 dot 색도 raw hex(#E4E4E4) 대신 토큰(bg-hairline).
 */

export interface StyleSummaryCardProps {
  vm: StyleCardVM;
}

const GAUGE_MAX = 5;

/** 한 축 행 — 라벨 + 채움 N개/빈 (5−N)개 dot. 채움/빈이 서로 다른 testID 라 개수로 값을 잰다. */
function GaugeRow({ label, value }: StyleGauge): ReactElement {
  return (
    <View
      testID="my-style-gauge"
      className="flex-row items-center justify-between"
    >
      <Text className="font-noto text-label text-muted">{label}</Text>
      <View className="flex-row gap-[6px]">
        {Array.from({ length: GAUGE_MAX }, (_, i) => {
          const filled = i < value;
          return (
            <View
              key={i}
              testID={filled ? 'my-style-dot-filled' : 'my-style-dot-empty'}
              className={`h-[10px] w-[10px] rounded-full ${
                filled ? 'bg-body' : 'bg-hairline'
              }`}
            />
          );
        })}
      </View>
    </View>
  );
}

export function StyleSummaryCard({ vm }: StyleSummaryCardProps): ReactElement {
  if (vm.kind === 'insufficient') {
    return (
      <View
        testID="my-style-card"
        className="gap-sm rounded-card border border-hairline bg-canvas p-lg"
      >
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          내 여행 스타일
        </Text>
        <Text className="font-noto text-label text-muted">
          10곳 이상 쌓이면 분석을 제공합니다(현재 {vm.current}곳)
        </Text>
      </View>
    );
  }

  return (
    <View
      testID="my-style-card"
      className="gap-md rounded-card border border-hairline bg-canvas p-lg"
    >
      {/* 헤더 — 제목 + 상세 진입(라우트 records/style 미존재 → real disabled, INV-4). */}
      <View className="flex-row items-center justify-between">
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          내 여행 스타일
        </Text>
        <Pressable testID="my-style-detail" accessibilityRole="button" disabled>
          <Text className="font-noto text-label text-primary">상세 분석 ›</Text>
        </Pressable>
      </View>

      {/* 디스크립터 칩 = descriptors(계산 없이 그대로). */}
      <View className="flex-row flex-wrap gap-sm">
        {vm.descriptors.map((descriptor) => (
          <View
            key={descriptor}
            testID="my-style-chip"
            className="rounded-pill bg-surface-strong px-[10px] py-[4px]"
          >
            <Text className="font-noto text-caption text-muted">
              {descriptor}
            </Text>
          </View>
        ))}
      </View>

      {/* 3축 dot 게이지. */}
      <View className="gap-sm">
        {vm.gauges.map((gauge) => (
          <GaugeRow key={gauge.label} label={gauge.label} value={gauge.value} />
        ))}
      </View>

      {/* 메타 — 분석에 쓴 여행 수 + 갱신 시점(updatedAt 은 date-time 이라 날짜만 잘라 포맷). */}
      <Text className="font-noto text-caption text-muted">
        {`여행 ${vm.sampleTripCount}개 · 갱신 ${formatKoreanDate(
          vm.updatedAt.slice(0, 10)
        )}`}
      </Text>
    </View>
  );
}
