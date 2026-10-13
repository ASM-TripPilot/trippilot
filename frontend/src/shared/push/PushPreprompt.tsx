/**
 * 푸시 알림 사전 안내 카드 (TRIP-1108 · Figma 4774:2960 c08-push · US-NOTIF-02·03·05).
 *
 * 온보딩 위치 카드 바로 뒤에 나오는 짝 화면이라 하단 바·버튼·히어로 틀을 위치 카드(LocationPreprompt)
 * 코드와 글자까지 같게 둔다(R5 — Figma 원값 h54·pb26 등이 아니라 선례를 따른다).
 * ⚠️ OS 권한 창·토큰 등록을 직접 부르지 않는다 — 콜백만 올려보낸다. 권한 루틴은 호출자(페이지) 몫이다.
 * ⚠️ 배럴(`@/shared/push`)에서 재수출하지 않는다 — 딥 경로로만 쓴다(배럴을 통째로 목하는 테스트가 많다).
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PushBellHero } from './PushGlyphs';

export interface PushPrepromptProps {
  onProceed: () => void;
}

export function PushPreprompt({ onProceed }: PushPrepromptProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="onboarding-push-root" className="flex-1 bg-canvas">
        {/* 위치 카드와 같은 빈 머리 바 — Figma 의 뒤로 chevron 은 따르지 않는다(온보딩은 앞으로만, TRIP-1023 #005). */}
        <View className="h-[56px] flex-row items-center border-b border-hairline px-lg" />

        <View className="flex-1 gap-lg px-2xl pt-xl">
          <PushBellHero testID="onboarding-push-hero" />
          <Text className="font-noto-bold text-[24px] font-bold text-ink">
            {'알림을 켜면 여행 중 변화를\n바로 알 수 있어요'}
          </Text>
          <Text
            testID="onboarding-push-purpose"
            className="font-noto text-body text-muted"
          >
            {
              '일정 시작 전 리마인드와 여행 중 날씨·휴무 변화를\n푸시로 알려 드려요'
            }
          </Text>
          <Text className="font-noto text-label text-muted-soft">
            알림은 언제든 설정에서 끌 수 있어요
          </Text>
        </View>

        <View className="gap-sm border-t border-hairline px-2xl pb-2xl pt-lg">
          <Pressable
            testID="onboarding-push-allow"
            onPress={onProceed}
            className="h-[52px] items-center justify-center rounded-button bg-primary"
          >
            {/* TRIP-935 R8 — 권한 창 앞 안내에 "허용"을 쓰지 않는다(5.1.1(iv)). */}
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              계속
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
