import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  ChevronRightGlyph,
  CloseGlyph,
  WarningTriangleGlyph,
} from './ExecutionGlyphs';

/**
 * TRIP-561 · TriggerChip(i08) — 여행 중 화면 상단 상주 트리거 스트립.
 *
 * `[아이콘][제목+부제 열][chevron=대안 보기][×=끄기]`. **순수 프레젠테이션**이다 — props 만
 * 받아 그리고, 재판정·데이터 조회를 하지 않는다(발화 판정·문구 조립은 페이지 소관). 시각을
 * 만들거나 계산하지 않는다(문구는 서버 reason 을 페이지가 넘긴 완성값, BR-U4-35 · liveTimeStructure).
 *
 * chevron/× press 는 콜백으로만 나간다(실제 라우팅·억제는 페이지·6-b 실기 소관). 색은 raw hex 가
 * 아니라 토큰(`bg-primary-pale`·`text-primary-text`) — 아이콘 색은 글리프가 raw 로 진다(SVG 는
 * className 을 못 받는 리포 관례).
 */

export interface TriggerChipProps {
  title: string;
  subtitle: string;
  onPressAlternative: () => void;
  onDismiss: () => void;
  /** kind 별 leading 아이콘(페이지가 iconKey 로 매핑해 주입). 없으면 경고삼각형 폴백. */
  icon?: ReactNode;
}

export function TriggerChip({
  title,
  subtitle,
  onPressAlternative,
  onDismiss,
  icon,
}: TriggerChipProps) {
  return (
    <View
      testID="execution-live-trigger-chip"
      className="mx-lg flex-row items-center gap-[10px] rounded-button bg-primary-pale px-md py-md"
    >
      {icon ?? <WarningTriangleGlyph size={24} />}
      <View className="flex-1 gap-[2px]">
        <Text className="font-noto-bold text-label font-bold text-primary-text">
          {title}
        </Text>
        <Text className="font-noto text-micro text-primary-text">
          {subtitle}
        </Text>
      </View>
      <Pressable
        testID="execution-live-trigger-alternative"
        onPress={onPressAlternative}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="대안 보기"
      >
        <ChevronRightGlyph size={22} />
      </Pressable>
      <Pressable
        testID="execution-live-trigger-dismiss"
        onPress={onDismiss}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="끄기"
      >
        <CloseGlyph size={18} />
      </Pressable>
    </View>
  );
}
