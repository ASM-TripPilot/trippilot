import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AppliedBackGlyph, AppliedCheckGlyph } from './PlanbGlyphs';

/**
 * TRIP-441 · AC-2·8 — i19 **반영 완료** 화면(순수, props+콜백만, 라우팅·훅 모름).
 *
 * 확정(apply)이 성공하면 뜨는 성공 확인 화면의 **buildable 서브셋**이다. 헤더(뒤로·제목) +
 * 성공 원 체크 + `새 일정이 반영됐어요` + `[여행 계속하기]` 만 그린다. 지표 chip·전후 항목 배지·
 * 특정 변경 부제·[되돌리기]는 **이번 범위 밖**이다 — `ReplanSession` 에 draft(after) payload 가
 * 없어 지표·배지를 조립할 데이터 자체가 없다(01 §5). 그래서 그 표면들을 "준비 중" 자리표시로
 * 그리지 않고 아예 두지 않는다(S4 가 부재를 잠근다, D2 거짓 자리표시 금지).
 *
 * ★ 계약 최소화: props 는 `onBack`·`onContinue` 둘뿐 — 데이터 prop 을 필수로 만들지 않는다.
 * ★ INV-3: 소요시간 리터럴(`N분`/`N시간`/`소요`) 0(항목 리스트가 draft 부재로 미착수).
 * ★ 체크 원 배경은 `bg-primary` 토큰, 흰 체크 획만 인라인 SVG — 브랜드색을 raw hex 로 안 쓴다.
 */

const TITLE = '변경 반영됨';
const SUCCESS_HEADLINE = '새 일정이 반영됐어요';
const CONTINUE_LABEL = '여행 계속하기';

export interface ReplanAppliedScreenProps {
  onBack: () => void;
  onContinue: () => void;
}

export function ReplanAppliedScreen({
  onBack,
  onContinue,
}: ReplanAppliedScreenProps): ReactElement {
  return (
    <View className="flex-1 bg-canvas">
      {/* 헤더 — 뒤로 + 제목 */}
      <View className="flex-row items-center gap-sm px-lg pt-2xl">
        <Pressable
          testID="planb-applied-back"
          accessibilityRole="button"
          onPress={onBack}
          hitSlop={8}
          className="h-9 w-9 items-center justify-center"
        >
          <AppliedBackGlyph />
        </Pressable>
        <Text className="font-noto-bold text-[20px] font-bold text-ink">
          {TITLE}
        </Text>
      </View>

      {/* 성공 블록 — 체크 원 + 헤드라인(세로 중앙) */}
      <View className="flex-1 items-center justify-center gap-[14px] px-lg">
        <View
          testID="planb-applied-check"
          className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-primary"
        >
          <AppliedCheckGlyph size={36} />
        </View>
        <Text className="text-center font-noto-bold text-hero font-bold text-ink">
          {SUCCESS_HEADLINE}
        </Text>
      </View>

      {/* CTA — 여행 계속하기(primary bg · rounded-button · 흰 텍스트) */}
      <View className="px-lg pb-2xl">
        <Pressable
          testID="planb-applied-continue"
          accessibilityRole="button"
          onPress={onContinue}
          className="items-center justify-center rounded-button bg-primary py-[15px]"
        >
          <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
            {CONTINUE_LABEL}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
