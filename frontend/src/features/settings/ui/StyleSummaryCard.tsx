import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { StyleCardVM, StyleGauge } from '../model/styleCardModel';
import { CARD_SHADOW } from './cardShadow';
import { InfoChip } from './InfoChip';

/**
 * TRIP-606 · l03 스타일 요약 카드 — VM 주입 순수 프레젠테이션. 조회·조립은 페이지 몫이라 여긴
 * 완성 VM 을 받아 `kind` 로만 두 얼굴을 가른다(판정 없음).
 *
 * 정식: (헤드라인) + 디스크립터 칩 + 3축 dot 게이지 + 상세 진입. 메타줄("여행 N개 · 갱신")은 TRIP-775 로
 * 뺐다(Figma 1602:2388 에 없음 — 분석 여행 수·갱신 시점은 상세 화면이 보인다). VM 의 두 필드는 모델 계약이라 남는다.
 * 미달: "10곳 이상 쌓이면…" 안내 한 줄만(게이지·칩 없음, INV-U5-09).
 *
 * dot 게이지는 **채운/빈 dot 을 각각 다른 testID 를 단 View** 로 그린다(SVG 한 장 금지) — repo-traps 의
 * 글리프 fill 함정(색 변화는 jest 사각) 때문에, 채움 개수가 서버 값과 일치하는지를 testID 카운트로
 * 잴 수 있어야 AC-S2 가 실효한다. 빈 dot 색도 raw hex(#E4E4E4) 대신 토큰(bg-hairline).
 */

export interface StyleSummaryCardProps {
  vm: StyleCardVM;
  /**
   * 상세 진입 콜백(TRIP-573, prop-gated). 미주입이면 상세 진입은 real `disabled`(라우트가 없던
   * 시절의 정직 degrade 계약 — `StyleSummaryCard.test.tsx` AC-S6 무회귀). `records/style` 라우트가
   * 생긴 지금은 `MyPage` 가 `router.push('/records/style')` 를 주입해 활성화한다.
   */
  onPressDetail?: () => void;
  /**
   * 한 줄 헤드라인(Figma "바다와 미식을 천천히 즐기는 여행자"). 서버에 필드가 없는 계약 공백 슬롯이라
   * 페이지는 주입하지 않는다 — 미주입이면 줄 자체가 없다(지어내지 않는다).
   */
  headline?: string;
}

const GAUGE_MAX = 5;

/** 한 축 행 — 라벨 + 채움 N개/빈 (5−N)개 dot. 채움/빈이 서로 다른 testID 라 개수로 값을 잰다. */
function GaugeRow({ label, value }: StyleGauge): ReactElement {
  return (
    <View testID="my-style-gauge" className="flex-row items-center gap-md">
      {/* 라벨 칸 폭 고정(Figma 64) — dot 열이 세 행에서 같은 x 에 선다. */}
      <View className="w-[64px]">
        <Text className="font-noto text-label text-muted">{label}</Text>
      </View>
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

export function StyleSummaryCard({
  vm,
  onPressDetail,
  headline,
}: StyleSummaryCardProps): ReactElement {
  if (vm.kind === 'insufficient') {
    return (
      <View
        testID="my-style-card"
        style={CARD_SHADOW}
        className="gap-sm rounded-[12px] border border-hairline bg-canvas p-lg"
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
      style={CARD_SHADOW}
      className="gap-md rounded-[12px] border border-hairline bg-canvas p-lg"
    >
      {/* 헤더 — 제목 + 상세 진입(prop-gated: onPressDetail 미주입이면 real disabled, INV-4). */}
      <View className="flex-row items-center justify-between">
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          내 여행 스타일
        </Text>
        <Pressable
          testID="my-style-detail"
          accessibilityRole="button"
          disabled={onPressDetail == null}
          onPress={onPressDetail}
        >
          <Text className="font-noto text-label text-primary">상세 분석 ›</Text>
        </Pressable>
      </View>

      {headline !== undefined ? (
        <Text
          testID="my-style-headline"
          className="font-noto text-body text-body"
        >
          {headline}
        </Text>
      ) : null}

      {/* 디스크립터 칩 = descriptors(계산 없이 그대로). */}
      <View className="flex-row flex-wrap gap-sm">
        {vm.descriptors.map((descriptor) => (
          <InfoChip
            key={descriptor}
            label={descriptor}
            testID="my-style-chip"
          />
        ))}
      </View>

      {/* 3축 dot 게이지. */}
      <View className="gap-md">
        {vm.gauges.map((gauge) => (
          <GaugeRow key={gauge.label} label={gauge.label} value={gauge.value} />
        ))}
      </View>
    </View>
  );
}
