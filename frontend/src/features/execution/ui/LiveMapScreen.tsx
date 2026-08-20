import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import { KakaoMapView, type MapCenter, type MapPin } from '@/shared/map';

import type { ActualRouteView } from '../model/actualDistance';
import type { LivePlanToggle } from '../model/liveViewStore';

/**
 * TRIP-397 · LiveMapScreen(i02·i03) — 여행 중 일정 지도.
 *
 * 계획 동선(슬롯 핀 + 자동 연결선)을 인터랙티브 지도(viewOnly 미전달 = 기본 제스처 허용 —
 * 드래그·핀치·줌, 다른 화면의 제스처 차단과 다르다)로 보이고, 계획｜실제 토글로 실제 경로를 겹친다.
 *
 * 위치 동의가 없으면 실제 경로 레이어는 **비활성 + 사유**이고 계획 동선만 보인다(BR-U4-42 ·
 * PBT-U4-F3). 실제 거리는 `actualDistance`(거리만, 소요시간·걸음 수 없음 — INV-3·BR-U4-41).
 *
 * ⚠️ 실기 전용(jest 무심판): 인터랙티브 제스처와 실제 경로 **점선 폴리라인**(shared/map 확장,
 * 별 게이트)은 여기서 그리지 않는다 — 가짜 카카오 SDK가 Proxy라 자동 심판이 없다(repo-traps).
 * 이 칸은 계획 핀·연결선·토글·gating·각주까지만 구조로 담보한다.
 */

const FOOTNOTE = '앱을 켜 둔 구간만 기록돼요';
// 좌표 슬롯이 하나도 없을 때의 지도 시작 좌표(핀이 있으면 setBounds 가 덮는다). 기존 호출부와 동일.
const DEFAULT_CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };

const TOGGLES: { key: LivePlanToggle; label: string }[] = [
  { key: 'plan', label: '계획' },
  { key: 'actual', label: '실제' },
];

function buildPins(slots: ItineraryDaysItemSlotsItem[]): MapPin[] {
  return slots.flatMap((slot, index) =>
    typeof slot.lat === 'number' && typeof slot.lng === 'number'
      ? [{ number: index + 1, lat: slot.lat, lng: slot.lng }]
      : []
  );
}

export interface LiveMapScreenProps {
  slots: ItineraryDaysItemSlotsItem[];
  toggle: LivePlanToggle;
  onToggle: (toggle: LivePlanToggle) => void;
  actualRoute: ActualRouteView;
}

export function LiveMapScreen({
  slots,
  toggle,
  onToggle,
  actualRoute,
}: LiveMapScreenProps): ReactElement {
  const pins = buildPins(slots);
  const center = pins.length > 0 ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTER;

  return (
    <View testID="execution-live-map" className="flex-1">
      {/* 인터랙티브 지도 — 계획 핀 + 자동 연결선(계획 동선). viewOnly 를 안 넘겨 기본값
          (제스처 허용)으로 둔다 — 다른 화면의 제스처 차단과 다르다(i02·i03 자유 탐색). */}
      <KakaoMapView center={center} pins={pins} />

      <View className="absolute bottom-0 left-0 right-0 gap-sm bg-canvas/90 px-lg py-md">
        <View className="flex-row gap-xs">
          {TOGGLES.map(({ key, label }) => {
            const selected = key === toggle;
            return (
              <Pressable
                key={key}
                testID={`execution-map-${key}-toggle`}
                onPress={() => onToggle(key)}
                className={`rounded-button px-lg py-sm ${
                  selected ? 'bg-ink' : 'bg-surface-soft'
                }`}
              >
                <Text
                  className={`font-noto-medium text-label ${
                    selected ? 'text-on-primary' : 'text-muted'
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {toggle === 'actual' &&
          (actualRoute.enabled ? (
            <Text
              testID="execution-map-actual-distance"
              className="font-noto-medium text-label text-body"
            >
              {`실제 이동 ${actualRoute.distanceKm.toFixed(1)}km`}
            </Text>
          ) : (
            <View testID="execution-map-actual-disabled">
              <Text className="font-noto text-label text-muted">
                {actualRoute.reason}
              </Text>
            </View>
          ))}

        <Text
          testID="execution-map-footnote"
          className="font-noto text-caption text-muted-soft"
        >
          {FOOTNOTE}
        </Text>
      </View>
    </View>
  );
}
