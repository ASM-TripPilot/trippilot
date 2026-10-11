import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  LocationClockGlyph,
  LocationGearGlyph,
  LocationInfoGlyph,
  LocationPinGlyph,
} from './LocationGlyphs';
import { LOCATION_ICON_COLORS } from './locationColors';

/**
 * TRIP-1339 · U10 '항상 허용' 승격 설명 1장(DEC-U10-11 · BR-U10-05·06·08 · Figma u10a 4857:2795).
 * 딤 + 하단 시트. **props 만** 받는다 — OS 대화상자는 호출부가 [켜기] 콜백에서 부른다(LocationPreprompt 와 같은 층·원칙).
 * 버튼에 "허용"을 쓰지 않는다(심사 문구 규칙). 소요시간·속도 문구 없음(INV-3).
 * ⚠️ 라이브러리 없는 오버레이 — 실제 덮임·터치 차단·열림은 jest 사각(repo-traps 바텀시트 절), 6-b.
 */
export interface LocationAlwaysExplainerProps {
  /** 여행 날짜 라벨 — 예 `10월 14일~16일`. 모르면(l06 진입) 생략 — "여행 날짜 동안만"으로. */
  dateRangeLabel?: string;
  onEnable: () => void;
  onLater: () => void;
  /** [켜기] 처리 중(연타 잠금). */
  busy?: boolean;
}

function Row({
  icon,
  title,
  body,
  testID,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  testID?: string;
}): ReactElement {
  return (
    <View className="flex-row gap-md">
      <View className="h-[36px] w-[36px] items-center justify-center rounded-[12px] bg-surface-soft">
        {icon}
      </View>
      <View className="flex-1 gap-[2px]">
        <Text className="font-noto-bold text-[14px] font-bold text-ink">
          {title}
        </Text>
        <Text
          testID={testID}
          className="font-noto text-[13px] leading-[19px] text-body"
        >
          {body}
        </Text>
      </View>
    </View>
  );
}

export function LocationAlwaysExplainer({
  dateRangeLabel,
  onEnable,
  onLater,
  busy = false,
}: LocationAlwaysExplainerProps): ReactElement {
  const ink = LOCATION_ICON_COLORS.ink;
  return (
    <View
      testID="location-explainer-root"
      className="absolute inset-0 justify-end bg-scrim/40"
    >
      <View className="rounded-t-[24px] bg-canvas px-lg pb-2xl pt-sm">
        <View className="mb-lg h-[4px] w-[40px] self-center rounded-pill bg-hairline-strong" />
        <View className="mb-md h-[48px] w-[48px] items-center justify-center rounded-pill bg-primary-pale">
          <LocationPinGlyph size={24} color={LOCATION_ICON_COLORS.primary} />
        </View>
        <Text
          testID="location-explainer-title"
          className="mb-xl font-noto-bold text-[22px] font-bold leading-[29px] text-ink"
        >
          {'앱을 닫아도 방문을\n자동으로 기록할까요?'}
        </Text>
        <View className="mb-xl gap-lg">
          <Row
            icon={<LocationPinGlyph color={ink} />}
            title="무엇을"
            body="일정 장소에 도착하고 떠나면 방문 완료까지 자동으로 남겨요. 다닌 길은 이동 경로로 기록돼요."
          />
          <Row
            icon={<LocationClockGlyph color={ink} />}
            title="언제만"
            body={`여행 날짜${dateRangeLabel ? `(${dateRangeLabel})` : ''} 동안만 기록하고, 여행이 끝나면 멈춰요.`}
          />
          <Row
            icon={<LocationInfoGlyph size={20} color={ink} />}
            title="보이는 것"
            body="기록하는 동안 화면 위 상태바에 위치 사용 표시가 떠요."
            testID="location-explainer-indicator-note"
          />
          <Row
            icon={<LocationGearGlyph color={ink} />}
            title="끄는 법"
            body="설정 › 위치정보 동의에서 언제든 끌 수 있어요."
          />
        </View>
        <Pressable
          testID="location-explainer-enable"
          accessibilityRole="button"
          disabled={busy}
          onPress={onEnable}
          className="h-[52px] items-center justify-center rounded-[12px] bg-primary"
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            자동 기록 켜기
          </Text>
        </Pressable>
        <Pressable
          testID="location-explainer-later"
          accessibilityRole="button"
          disabled={busy}
          onPress={onLater}
          className="h-[44px] items-center justify-center"
        >
          <Text className="font-noto-bold text-body font-bold text-ink">
            나중에
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
