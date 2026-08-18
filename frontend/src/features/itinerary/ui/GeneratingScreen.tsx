import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

import {
  AlertCircleGlyph,
  BackChevronGlyph,
  FullAiGlyph,
} from './ItineraryGlyphs';

/**
 * h09 [완전AI] "AI가 일정 짜는 중" 화면 — Figma `1905:1083`. 프레젠테이션(props만, 재판정 금지).
 *
 * 이 화면은 언제나 "생성 중"이다 — 진행 여부를 스스로 판정하지 않고(`generating` prop 없음) 진행
 * 표면을 상시 그린다. `failed` 일 때만 실패 표면으로 갈아 낀다(배선의 `isError`).
 *
 * **지어낸 진척을 그리지 않는다(⚑C)**: in-flight 엔 세션 데이터가 없어 단계 완료를 알 수 없다.
 * Figma 의 "완료 체크 / 반채움 / 대기" 고정 표기 대신 3단계를 **균일 진행 중**으로만 그리고,
 * 진행 바도 채움률(48%) 대신 **비결정형**(좌우로 미끄러지는 세그먼트)으로 "도는 중"만 표현한다.
 * 그래서 화면에 퍼센트·`N초`·소요시간(`N분`/`N시간`) 문자열이 하나도 없다(AC-1·AC-2 · INV-3).
 *
 * **Figma 보다 짧다**: 미니 지도(day1 실핀은 h10=TRIP-337 몫)는 이번 범위 밖이라 그리지 않는다.
 * **Figma 프레임에 없는 것**: [취소]/[백그라운드로] 두 버튼은 요구사항(BR-U3-05)이지 Figma 프레임에
 * 없다 — 프레임 미반영은 [기록]에서 드리프트로 보고한다.
 */

const SCREEN_TITLE = 'AI 일정 생성';
const PROGRESS_HEADING = 'AI가 일정을 짜고 있어요';
/** Figma 부제에서 숫자·시간 어휘(`· 보통 10초쯤 걸려요`)를 뗀 것 — `초` 는 렌더 심판이 잠근다. */
const PROGRESS_NOTE = '취향·거리·동선까지 맞추는 중';
/** 3단계 라벨은 Figma 정본(정확 문자열). 완료 여부는 표시하지 않는다(⚑C). */
const STEPS = ['장소 수집', '동선 계산', '시간 배치'] as const;
const FOOTER_NOTE =
  '완성되면 마음에 안 드는 곳만 바꾸면 돼요 · 고정한 곳은 유지돼요';
const CANCEL_LABEL = '생성 취소';
const BACKGROUND_LABEL = '백그라운드로 전환';
const FAILED_TITLE = '일정을 만들지 못했어요';
const FAILED_NOTE = '네트워크를 확인하고 다시 시도해 주세요';
const RETRY_LABEL = '다시 시도';

// 카드 그림자(Figma `0px 2px 10px rgba(0,0,0,0.06)`). RN 은 box-shadow 가 없어 스타일
// 프로퍼티로 옮긴다. `#000000` 은 raw-hex 가드의 브랜드 팔레트에 없어 그림자 색으로 정당하다
// (`MethodPickerScreen.tsx` 선례).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

/**
 * 비결정형 진행 바 — 완료율을 모르므로 채움률 대신 좌우로 미끄러지는 세그먼트로 "도는 중"만
 * 표현한다. RN `Animated`(네이티브 드라이버) 라 **자체 타이머가 없다** — `setInterval`/`setTimeout`
 * 은 features/pages 타이머 금지 심판에 걸린다. 트랙 폭은 `onLayout` 으로 재 세그먼트 이동 범위를
 * 픽셀로 잡는다(레이아웃 전엔 폭 0 이라 정지, 첫 레이아웃 후 흐른다).
 */
function IndeterminateBar(): ReactElement {
  const progress = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const segmentWidth = trackWidth * 0.4;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-segmentWidth, trackWidth],
  });

  return (
    <View
      testID="itinerary-generating-progress"
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      className="h-[8px] w-full overflow-hidden rounded-pill bg-surface-strong"
    >
      <Animated.View
        style={{ width: segmentWidth, transform: [{ translateX }] }}
        className="h-full rounded-pill bg-primary"
      />
    </View>
  );
}

export interface GeneratingScreenProps {
  /** [취소] press — 배선이 뒤로 이탈(생성 폐기). */
  onCancel: () => void;
  /** [백그라운드로] press — 배선이 앞으로 이탈(여행/홈), 뮤테이션은 살아 있음. */
  onBackground: () => void;
  /** 실패 표면의 [다시 시도] press — 배선이 POST 를 재발화. */
  onRetry: () => void;
  /** POST 오류(배선의 isError) — 참이면 인라인 실패 표면 노출(INV-4, 침묵 금지). */
  failed?: boolean;
}

export function GeneratingScreen({
  onCancel,
  onBackground,
  onRetry,
  failed = false,
}: GeneratingScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View
          testID="itinerary-generating-appbar"
          className="w-full flex-row items-center gap-[6px] bg-canvas py-[14px] pl-md pr-lg"
        >
          {/* 앱바 뒤로가기 = 취소(생성 폐기) — iOS 뒤로 제스처와 같은 의미. */}
          <Pressable
            testID="itinerary-generating-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onCancel}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {SCREEN_TITLE}
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-lg px-lg pb-2xl pt-sm">
          {failed ? (
            <StateNotice
              testID="itinerary-generating-failed"
              icon={<AlertCircleGlyph />}
              title={FAILED_TITLE}
              description={FAILED_NOTE}
              actions={[
                {
                  testID: 'itinerary-generating-retry',
                  label: RETRY_LABEL,
                  variant: 'filled',
                  onPress: onRetry,
                },
              ]}
            />
          ) : (
            <>
              <View
                style={cardShadow}
                className="w-full gap-md rounded-card border border-hairline bg-canvas p-lg"
              >
                <View className="w-full flex-row items-center gap-sm">
                  <FullAiGlyph size={22} tone="primary" />
                  <Text className="flex-1 font-noto-bold text-[16px] font-bold text-ink">
                    {PROGRESS_HEADING}
                  </Text>
                </View>
                <IndeterminateBar />
                <Text className="w-full font-noto text-label text-muted">
                  {PROGRESS_NOTE}
                </Text>
              </View>

              <View
                style={cardShadow}
                className="w-full gap-[15px] rounded-card border border-hairline bg-canvas p-lg"
              >
                {STEPS.map((label, index) => (
                  <View
                    key={label}
                    testID={`itinerary-generating-step-${index + 1}`}
                    className="flex-row items-center gap-md"
                  >
                    {/* 균일한 진행 중 표식 — 단계별 완료/대기 차등을 두지 않는다(⚑C). */}
                    <View className="h-5 w-5 items-center justify-center">
                      <View className="h-[13px] w-[13px] rounded-pill border-[1.5px] border-muted-soft" />
                    </View>
                    <Text className="font-noto-bold text-[14.5px] font-bold text-ink">
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <View
            testID="itinerary-generating-footer"
            className="w-full flex-row items-center rounded-button bg-surface-soft px-lg py-[14px]"
          >
            <Text className="flex-1 font-noto text-[12.5px] text-muted">
              {FOOTER_NOTE}
            </Text>
          </View>

          <View className="w-full flex-row gap-md pt-xs">
            <Pressable
              testID="itinerary-generating-cancel"
              accessibilityRole="button"
              onPress={onCancel}
              className="h-12 flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
            >
              <Text className="font-noto-bold text-card-title font-bold text-muted">
                {CANCEL_LABEL}
              </Text>
            </Pressable>
            <Pressable
              testID="itinerary-generating-background"
              accessibilityRole="button"
              onPress={onBackground}
              className="h-12 flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
            >
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {BACKGROUND_LABEL}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
