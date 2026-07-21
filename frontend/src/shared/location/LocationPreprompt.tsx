/**
 * 위치 권한 프리프롬프트 프레임 (US-ONB-04 **축소분** · BR-U0-30 · AC D1~D3).
 *
 * ⚠️ 이 컴포넌트는 US-ONB-04 를 **완료시키지 않는다.** BR-U0-30 이 요구한 U0 몫(프레임 정의)만
 *    충족한다 — 실제 발화 지점('내 주변 숙소 탐색'·'여행 중 실행') 배선과 숙소 위치 폴백은
 *    해당 화면을 만드는 후속 유닛의 몫이다.
 * ⚠️ 라우트로 등록하지 않는다(D7) — 라우트 없는 재사용 컴포넌트다.
 * ⚠️ OS 다이얼로그를 직접 부르지 않는다 — 콜백만 올려보낸다(D2). 발화 시점은 호출자가 정한다.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

export type LocationPrepromptState = 'default' | 'permission-denied';

export interface LocationPrepromptProps {
  /** 왜 지금 위치가 필요한지 — 발화 맥락마다 다른 문구가 들어온다. */
  purposeContext: string;
  state?: LocationPrepromptState;
  onProceed: () => void;
  onDefer: () => void;
  onOpenSettings?: () => void;
}

export function LocationPreprompt({
  purposeContext,
  state = 'default',
  onProceed,
  onDefer,
  onOpenSettings,
}: LocationPrepromptProps): ReactElement {
  const denied = state === 'permission-denied';

  return (
    <View
      testID="onboarding-location-root"
      className="gap-lg rounded-card bg-canvas p-2xl"
    >
      <Text
        testID="onboarding-location-purpose"
        className="font-noto text-body text-ink"
      >
        {purposeContext}
      </Text>

      {denied ? (
        <View className="gap-md">
          {/* D3 — 거부돼도 진행을 막지 않는다. 설정 안내 + 계속 진행 수단을 함께 준다.
              testID 요소는 '설정에서'만 감싸 안내 문구 안에서 그 조각을 앵커한다(D3 계약). */}
          <Text className="font-noto text-label text-muted">
            위치 권한이 꺼져 있어요.{' '}
            <Text
              testID="onboarding-location-denied-notice"
              className="text-ink"
            >
              설정에서
            </Text>{' '}
            다시 켤 수 있어요.
          </Text>
          <Pressable
            testID="onboarding-location-settings"
            onPress={onOpenSettings}
            className="items-center rounded-button border-[1.5px] border-hairline-strong py-md"
          >
            <Text className="font-noto-medium text-card-title font-medium text-ink">
              설정 열기
            </Text>
          </Pressable>
          <Pressable
            testID="onboarding-location-continue"
            onPress={onProceed}
            className="items-center rounded-button bg-primary py-md"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              계속 진행
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="gap-md">
          <Pressable
            testID="onboarding-location-allow"
            onPress={onProceed}
            className="items-center rounded-button bg-primary py-md"
          >
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              계속
            </Text>
          </Pressable>
          <Pressable
            testID="onboarding-location-later"
            onPress={onDefer}
            className="items-center rounded-button border-[1.5px] border-hairline-strong py-md"
          >
            <Text className="font-noto-medium text-card-title font-medium text-muted">
              나중에
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
