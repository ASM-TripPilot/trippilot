/**
 * 위치 권한 프리프롬프트 프레임 (US-ONB-04 **축소분** · BR-U0-30 · AC D1~D3 ·
 * Figma 1296:1208 / 1297:1208 전체화면 정합 TRIP-162).
 *
 * ⚠️ 이 컴포넌트는 US-ONB-04 를 **완료시키지 않는다.** BR-U0-30 이 요구한 U0 몫(프레임 정의)만
 *    충족한다 — 실제 발화 지점('내 주변 숙소 탐색'·'여행 중 실행') 배선과 숙소 위치 폴백은
 *    해당 화면을 만드는 후속 유닛의 몫이다.
 * ⚠️ 라우트로 등록하지 않는다(D7) — 라우트 없는 재사용 컴포넌트다.
 * ⚠️ OS 다이얼로그를 직접 부르지 않는다 — 콜백만 올려보낸다(D2). 발화 시점은 호출자가 정한다.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  LocationBackChevronGlyph,
  LocationCloseGlyph,
  LocationInfoGlyph,
  LocationOffGlyph,
  LocationRadarHero,
} from './LocationGlyphs';
import { LOCATION_ICON_COLORS } from './lib/locationColors';

export type LocationPrepromptState = 'default' | 'permission-denied';

export interface LocationPrepromptProps {
  /** 왜 지금 위치가 필요한지 — 발화 맥락마다 다른 문구가 들어온다. default 상태의 설명
   * 문단으로 표시된다(denied 는 Figma 에 그 자리가 없어 표시하지 않는다). */
  purposeContext: string;
  state?: LocationPrepromptState;
  onProceed: () => void;
  onDefer: () => void;
  onOpenSettings?: () => void;
  /** denied 안내 줄 닫기(×) 콜백. 컴포넌트는 무상태(D2)라 콜백만 올려보내고, 1회성 숨김
   * 상태는 부모가 소유한다. 미전달이면 × 를 그리지 않는다(무회귀). */
  onDismissNotice?: () => void;
  /** 부모가 소유한 1회성 상태 — true 면 denied 안내 줄을 그리지 않는다(기본 false = 표시). */
  noticeDismissed?: boolean;
}

export function LocationPreprompt({
  purposeContext,
  state = 'default',
  onProceed,
  onDefer,
  onOpenSettings,
  onDismissNotice,
  noticeDismissed = false,
}: LocationPrepromptProps): ReactElement {
  const denied = state === 'permission-denied';

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="onboarding-location-root" className="flex-1 bg-canvas">
        <View className="h-[56px] flex-row items-center border-b border-hairline px-lg">
          <LocationBackChevronGlyph />
        </View>

        {denied ? (
          <View className="flex-1 items-center justify-center gap-lg px-2xl">
            <View className="h-[80px] w-[80px] items-center justify-center rounded-[22px] bg-surface-strong">
              <LocationOffGlyph />
            </View>
            <Text className="font-noto-bold text-center text-hero font-bold text-ink">
              위치 권한이 꺼져 있어요
            </Text>
            <Text className="font-noto text-center text-body text-muted">
              {
                '등록한 숙소를 기준으로 탐색·동선을 안내해 드릴게요.\n온보딩은 그대로 계속할 수 있어요.'
              }
            </Text>
            {noticeDismissed ? null : (
              // TRIP-592: 청록 pale 카드 → 상하 hairline 인라인 줄 + 뉴트럴 텍스트 + 닫기(×).
              // 코랄 1볼티지 원칙(kit §1) 강화 — 위치 안내는 강조가 아니라 뉴트럴 신호다.
              <View className="w-full flex-row items-center gap-sm border-t border-b border-hairline pl-lg pr-md py-md">
                <LocationInfoGlyph color={LOCATION_ICON_COLORS.mutedSoft} />
                {/* D3 — 거부돼도 진행을 막지 않는다. toHaveTextContent 는 기본이 **완전 일치**라
                    (RNTL matches() exact:true 기본값) testID 요소는 '설정에서' 조각만 감싸야 한다
                    — 동결 테스트와 같은 앵커 패턴(원본 LocationPreprompt.tsx 의 방식을 그대로 유지). */}
                <Text className="flex-1 font-noto text-label text-muted">
                  현재 위치 기능은 언제든{' '}
                  <Text testID="onboarding-location-denied-notice">
                    설정에서
                  </Text>{' '}
                  켤 수 있어요
                </Text>
                {onDismissNotice ? (
                  <Pressable
                    testID="onboarding-location-notice-dismiss"
                    onPress={onDismissNotice}
                    hitSlop={8}
                  >
                    <LocationCloseGlyph />
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
        ) : (
          <View className="flex-1 gap-lg px-2xl pt-xl">
            <LocationRadarHero testID="onboarding-location-hero" />
            <Text className="font-noto-bold text-[24px] font-bold text-ink">
              {'현재 위치를 켜면\n여행이 더 똑똑해져요'}
            </Text>
            <Text
              testID="onboarding-location-purpose"
              className="font-noto text-body text-ink"
            >
              {purposeContext}
            </Text>
            <Text className="font-noto text-label text-muted-soft">
              {
                '위치 정보는 추천·길안내에만 사용되며,\n언제든 설정에서 끌 수 있어요'
              }
            </Text>
          </View>
        )}

        <View className="gap-sm px-2xl pb-2xl pt-lg">
          {denied ? (
            <>
              <Pressable
                testID="onboarding-location-continue"
                onPress={onProceed}
                className="h-[52px] items-center justify-center rounded-button bg-primary"
              >
                <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                  계속
                </Text>
              </Pressable>
              <Pressable
                testID="onboarding-location-settings"
                onPress={onOpenSettings}
                className="h-[46px] items-center justify-center"
              >
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  위치 설정 열기
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                testID="onboarding-location-allow"
                onPress={onProceed}
                className="h-[52px] items-center justify-center rounded-button bg-primary"
              >
                <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                  위치 사용 허용
                </Text>
              </Pressable>
              <Pressable
                testID="onboarding-location-later"
                onPress={onDefer}
                className="h-[46px] items-center justify-center"
              >
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  나중에 하기
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
