import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { guardPress } from '@/shared/lib/pressGuard';

import { TOUR_PAGE_COUNT, TOUR_PAGES } from '../model/tourPages';

import {
  TourAssistantFragment,
  TourPlacesFragment,
  TourPlanFragment,
  TourRecordFragment,
  TourStayFragment,
  TourTripFragment,
} from './TourFragments';
import { TourProgressDots } from './TourGlyphs';
import { TourStage } from './TourStage';

/**
 * c10 기능 안내 6장 순수 뷰(TRIP-1595 · S1 정지 화면) — 라우터·api 를 모른다(프리뷰가 이 파일만 문다).
 * 가로 페이저(`ScrollView pagingEnabled`)가 장(무대 + 카피)을 넘기고, 진행 점·건너뛰기·다음/시작하기는 페이저 **밖** 고정 크롬이다.
 * 현재 장은 상태로 쥔다 — S2 모션이 "보이는 장"만 재생하는 근거다.
 */
export interface OnboardingTourViewProps {
  /** 1~6, 기본 1. testID·프리뷰 키와 같은 1부터 세는 번호. */
  initialPage?: number;
  onSkip: () => void;
  onStart: () => void;
}

const FRAGMENTS: Record<number, () => ReactElement> = {
  1: TourPlacesFragment,
  2: TourStayFragment,
  3: TourPlanFragment,
  4: TourTripFragment,
  5: TourRecordFragment,
  6: TourAssistantFragment,
};

function clampPage(page: number): number {
  return Math.min(TOUR_PAGE_COUNT, Math.max(1, page));
}

export function OnboardingTourView({
  initialPage = 1,
  onSkip,
  onStart,
}: OnboardingTourViewProps): ReactElement {
  const { width } = useWindowDimensions();
  const pagerRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(clampPage(initialPage));
  // 시작 위치는 처음 한 번만 정한다 — `page` 를 그대로 물리면 스와이프마다 prop 이 바뀌어 스크롤이 되감긴다.
  const [startOffset] = useState(() => ({
    x: (clampPage(initialPage) - 1) * width,
    y: 0,
  }));
  const isLast = page === TOUR_PAGE_COUNT;

  // 상태와 스크롤을 같이 갱신한다 — 프로그램 스크롤이 `onMomentumScrollEnd` 를 모든 플랫폼에서 부른다는 보장이 없다.
  const goTo = (next: number): void => {
    setPage(next);
    pagerRef.current?.scrollTo({ x: (next - 1) * width, animated: true });
  };

  // 손가락으로 넘긴 정지 위치 → 가장 가까운 장(안드로이드는 정수 배수에서 소수점만큼 어긋난다).
  const handleMomentumEnd = (
    event: NativeSyntheticEvent<NativeScrollEvent>
  ): void => {
    setPage(
      clampPage(Math.round(event.nativeEvent.contentOffset.x / width) + 1)
    );
  };

  // 1장에서 `다음` 이후 낡은 장 번호로 계산하지 않도록 `page` 는 렌더마다 읽는다. 연타는 `guardPress` 400ms 창이 막는다
  // (취향 2/2 `완료` 와 같은 자리라 그 연타의 둘째 탭이 1장을 건너뛰지 못하게).
  const handleNext = guardPress(() => goTo(page + 1));

  // 안드로이드 하드웨어 뒤로: 이전 장, 1장에선 소비만(앱 종료·온보딩 복귀 없음 — D5). 렌더마다 다시 걸어 낡은 `page` 를 쥐지 않는다.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (page > 1) goTo(page - 1);
        return true;
      }
    );
    return () => subscription.remove();
  });

  return (
    <View className="flex-1 bg-canvas">
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="h-[44px] flex-row items-center justify-between pl-2xl pr-lg">
          <View
            testID="onboarding-tour-progress"
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="기능 안내 진행"
            accessibilityValue={{ min: 1, max: TOUR_PAGE_COUNT, now: page }}
          >
            <TourProgressDots now={page} />
          </View>
          {isLast ? null : (
            <Pressable
              testID="onboarding-tour-skip"
              accessibilityRole="button"
              onPress={() => onSkip()}
              className="h-[44px] items-center justify-center px-sm"
            >
              <Text className="font-noto text-body text-muted">건너뛰기</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          ref={pagerRef}
          testID="onboarding-tour-pager"
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={startOffset}
          onMomentumScrollEnd={handleMomentumEnd}
          style={{ flex: 1 }}
        >
          {TOUR_PAGES.map((spec) => {
            const Fragment = FRAGMENTS[spec.page];
            return (
              <View
                key={spec.page}
                testID={`onboarding-tour-page-${spec.page}`}
                style={{ width }}
              >
                <TourStage spec={spec}>
                  <Fragment />
                </TourStage>
                <View className="gap-md px-2xl pb-3xl pt-sm">
                  <Text
                    testID={`onboarding-tour-title-${spec.page}`}
                    accessibilityRole="header"
                    className="font-noto-bold text-display font-bold text-ink"
                  >
                    {spec.title}
                  </Text>
                  <Text
                    testID={`onboarding-tour-body-${spec.page}`}
                    className="font-noto text-body text-muted"
                  >
                    {spec.body}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View className="border-t border-hairline bg-canvas px-2xl pb-[26px] pt-md">
          {isLast ? (
            <Pressable
              testID="onboarding-tour-start"
              accessibilityRole="button"
              onPress={() => onStart()}
              className="h-[52px] items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                시작하기
              </Text>
            </Pressable>
          ) : (
            <Pressable
              testID="onboarding-tour-next"
              accessibilityRole="button"
              onPress={handleNext}
              className="h-[52px] items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                다음
              </Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
