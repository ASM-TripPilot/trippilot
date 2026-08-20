import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';
import { KakaoMapView, type MapCenter, type MapPin } from '@/shared/map';

import type { ActualRouteView } from '../model/actualDistance';
import type { LivePlanToggle } from '../model/liveViewStore';
import type { MapPeekView } from '../model/mapPeek';

/**
 * TRIP-397 · LiveMapScreen(i02·i03) — 여행 중 일정 지도(Figma 재정합).
 *
 * 세로 컬럼: ①계획 동선｜실제 경로 토글(지도 위쪽 **형제** — 오버레이 아님) → ②지도 250px 고정
 * 블록 → ③peek 요약(남은 곳 수 또는 실제 거리 + 지금/다음 2행 + 전체 일정 링크 + 각주).
 *
 * ⚠️ 결함#2 근본 수정 — 토글을 지도(WebView) 위 절대배치 오버레이로 두면 WebView 가 터치를
 * 먹어 안 눌린다(repo-traps). 그래서 여기엔 절대배치를 쓰지 않고 지도와 세로로 나눈다. 렌더
 * 위치는 jest 가 원리적으로 못 본다(가짜 카카오 SDK Proxy) — 소스 스캔 가드 + 6-b 실기 탭이 그물.
 *
 * peek 의 진행 상태(예정/진행/완료)는 raw 슬롯이 못 가져, 부모(LiveItineraryScreen)가
 * buildMapPeek 로 도출해 `peek` prop 으로 내린다(★1). `slots` 는 핀 도출용으로 그대로 유지한다.
 *
 * 위치 동의가 없으면 실제 경로는 비활성 + 사유이고 계획 동선만 보인다(BR-U4-42 · PBT-U4-F3).
 * 실제 거리는 거리만(소요시간·걸음 수 없음 — INV-3 · BR-U4-41).
 */

const FOOTNOTE = '앱을 켜 둔 구간만 기록돼요';
// 좌표 슬롯이 하나도 없을 때의 지도 시작 좌표(핀이 있으면 setBounds 가 덮는다). 기존 호출부와 동일.
const DEFAULT_CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };

const TOGGLES: { key: LivePlanToggle; label: string }[] = [
  { key: 'plan', label: '계획 동선' },
  { key: 'actual', label: '실제 경로' },
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
  /** 사전 도출된 peek(부모가 buildMapPeek 로 만들어 주입, ★1). */
  peek: MapPeekView;
  /** "전체 일정 >" 링크 → 부모가 itinerary 세그먼트로 전환. */
  onPressFullItinerary: () => void;
}

function PeekRow({
  badge,
  testID,
  name,
}: {
  badge: string;
  testID: string;
  name: string;
}): ReactElement {
  return (
    <View className="flex-row items-center gap-sm">
      <View className="rounded-pill bg-surface-soft px-sm py-[2px]">
        <Text className="font-noto-medium text-caption text-muted">
          {badge}
        </Text>
      </View>
      <Text
        testID={testID}
        className="font-noto-medium text-label text-body"
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

export function LiveMapScreen({
  slots,
  toggle,
  onToggle,
  actualRoute,
  peek,
  onPressFullItinerary,
}: LiveMapScreenProps): ReactElement {
  const pins = buildPins(slots);
  const center =
    pins.length > 0 ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTER;

  return (
    <View testID="execution-live-map" className="flex-1">
      {/* ① 계획 동선｜실제 경로 토글 — 지도 위쪽 형제. 좌측 정렬 흰 pill 세그먼트. */}
      <View className="px-lg py-sm">
        <View className="flex-row self-start gap-[4px] rounded-button bg-surface-soft p-[4px]">
          {TOGGLES.map(({ key, label }) => {
            const selected = key === toggle;
            return (
              <Pressable
                key={key}
                testID={`execution-map-${key}-toggle`}
                onPress={() => onToggle(key)}
                className={`w-[79px] items-center rounded-button py-[6px] ${
                  selected ? 'bg-canvas' : ''
                }`}
              >
                <Text
                  className={`font-noto-medium text-label ${
                    selected ? 'text-ink' : 'text-muted'
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ② 계획 핀 + 자동 연결선 지도. 250px 고정 블록(flex-1 전체 아님) — 위 토글·아래 peek 와
          컬럼을 이룬다. viewOnly 미전달 = 기본 제스처 허용(자유 탐색, i02·i03). */}
      <View className="h-[250px]">
        <KakaoMapView center={center} pins={pins} />
      </View>

      {/* ③ peek 요약 — 지금/다음 2행은 양쪽 토글 공통, 헤더는 토글로 갈린다(상호배타 ★2). */}
      <View className="gap-sm px-lg py-md">
        <View testID="execution-map-peek" className="gap-sm">
          <View className="flex-row items-center justify-between">
            {toggle === 'plan' ? (
              <Text
                testID="execution-map-peek-remaining"
                className="font-noto-medium text-label text-ink"
              >
                {`남은 ${peek.remainingCount}곳`}
              </Text>
            ) : actualRoute.enabled ? (
              <Text
                testID="execution-map-actual-distance"
                className="font-noto-medium text-label text-ink"
              >
                {`실제 이동 ${actualRoute.distanceKm.toFixed(1)}km`}
              </Text>
            ) : (
              <View testID="execution-map-actual-disabled">
                <Text className="font-noto text-label text-muted">
                  {actualRoute.reason}
                </Text>
              </View>
            )}

            <Pressable
              testID="execution-map-peek-all"
              onPress={onPressFullItinerary}
            >
              <Text className="font-noto-medium text-label text-muted">
                전체 일정 ›
              </Text>
            </Pressable>
          </View>

          {peek.now && (
            <PeekRow
              badge="지금"
              testID="execution-map-peek-now"
              name={peek.now.name}
            />
          )}
          {peek.next && (
            <PeekRow
              badge="다음"
              testID="execution-map-peek-next"
              name={peek.next.name}
            />
          )}
        </View>

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
