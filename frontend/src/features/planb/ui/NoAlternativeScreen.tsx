import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KakaoMapView, type MapCenter } from '@/shared/map';

import { AppliedAlertGlyph } from './PlanbGlyphs';

/**
 * TRIP-563 · AC-1 — i16 대안 없음 화면(순수 props+콜백, 라우팅·훅 모름).
 *
 * 재계획이 해를 못 찾은(NO_SOLUTION) 얼굴: 지도 + 경고 삼각 + 문구 + 3버튼(건너뛰기·휴식 모드·수동
 * 수정). 셋 다 눌리는 상태(disabled 미지정)이고 각 버튼은 자기 콜백만 부른다. `onManualEdit` 만 실배선
 * 되고 `onSkip`·`onRestMode` 는 아직 no-op 자리표시(계약·제품 정의 부재, FE 후속)라 페이지가 결정한다.
 *
 * ★ 경고 삼각은 같은 feature 의 `AppliedAlertGlyph`(primary 삼각, primary-pale 원 안에 놓이는 계약)를
 *   재사용한다 — 같은 그림이라 새로 그리지 않는다.
 * ★ 지도 center 는 계약 공백이라 골격 플레이스홀더 상수(ReplanDraftScreen 과 동형) — 실 지도는 6-b.
 */

// 골격 플레이스홀더 center(부산 중심) — 실 center 바인딩은 후속.
const MAP_CENTER: MapCenter = { lat: 35.1587, lng: 129.1604 };

const TITLE = '조건에 맞는 대안이 없어요';
const SUBTITLE = '남은 시간이 부족해서 새 일정을 찾지 못했어요';
const REST_LABEL = '휴식 모드로 전환';
const MANUAL_LABEL = '수동으로 일정 수정';

export interface NoAlternativeScreenProps {
  skipCount: number;
  onSkip: () => void;
  onRestMode: () => void;
  onManualEdit: () => void;
}

export function NoAlternativeScreen({
  skipCount,
  onSkip,
  onRestMode,
  onManualEdit,
}: NoAlternativeScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        {/* 지도 — 현재 위치 주변. center 골격 플레이스홀더, 실 지도는 6-b */}
        <View
          testID="planb-noalt-map"
          className="h-[230px] w-full overflow-hidden"
        >
          <KakaoMapView center={MAP_CENTER} viewOnly />
        </View>

        <View className="flex-1 items-center gap-sm px-lg pt-3xl">
          {/* 경고 삼각(primary-pale 원 안) — AppliedAlertGlyph 재사용 */}
          <View className="h-[64px] w-[64px] items-center justify-center rounded-pill bg-primary-pale">
            <AppliedAlertGlyph />
          </View>
          <Text className="font-noto-bold text-section font-bold text-ink">
            {TITLE}
          </Text>
          <Text className="font-noto text-body text-muted">{SUBTITLE}</Text>

          <View className="mt-md w-full gap-sm">
            <Pressable
              testID="planb-noalt-skip"
              accessibilityRole="button"
              onPress={onSkip}
              className="items-center justify-center rounded-button border border-hairline-strong py-[15px]"
            >
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                남은 방문지 {skipCount}개 건너뛰기
              </Text>
            </Pressable>
            <Pressable
              testID="planb-noalt-rest"
              accessibilityRole="button"
              onPress={onRestMode}
              className="items-center justify-center rounded-button border border-hairline-strong py-[15px]"
            >
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {REST_LABEL}
              </Text>
            </Pressable>
            <Pressable
              testID="planb-noalt-manual"
              accessibilityRole="button"
              onPress={onManualEdit}
              className="items-center justify-center rounded-button border border-hairline-strong py-[15px]"
            >
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {MANUAL_LABEL}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
