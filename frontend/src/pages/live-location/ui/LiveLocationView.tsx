/**
 * i20(수동 위치 입력)·i21(위치 권한 거부) origin 수집 화면의 **순수 뷰** — 한 컴포넌트를 `state` prop
 * 하나로 두 얼굴로 그린다(LocationPreprompt state-param 선례, US-PLANB-10 · BR-U4-19 · TRIP-442).
 * 일정 조회·재계획 요청·라우터는 컨테이너(`LiveLocationPage`)가 하고, 이 뷰는 받은 값만 그린다 —
 * 프리뷰가 네트워크 계층 없이 이 파일만 태운다(TRIP-979 B, traps-shell TRIP-610).
 *
 * 무엇을 보장하나:
 *  - GPS 를 못 쓸 때(권한 거부·측위 불가) 재계획을 **막지 않고** 위치를 손으로 정하는 표면이다.
 *  - i20/i21 은 배너·힌트 카피만 다르고, 지도 중심·선택 위치 라벨은 받은 값(`center`·`placeName`)이다.
 *  - `center` 가 null(일정 미도착)이면 지도를 마운트하지 않는다 — CenterPinPicker 는 첫 center 만
 *    포획하므로 먼저 띄우면 늦게 온 좌표를 못 받는다.
 *  - 확정은 좌표만 올린다 — 역지오코딩 없음(AC-9).
 */
import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { isEstimatedOrigin } from '@/features/planb/model/replanOrigin';
import {
  LocationBackChevronGlyph,
  LocationInfoGlyph,
} from '@/shared/location/LocationGlyphs';
import { CenterPinPicker, type MapCenter } from '@/shared/map';

export type LiveLocationState = 'manual' | 'permission-denied';

export interface LiveLocationViewProps {
  /** URL `?state=` 원문 — 'permission-denied' 만 i21, 그 외(미지정·미지 값·배열)는 전부 manual 얼굴로
   *  폴백한다(TRIP-979 AC-A7 · INV-4). */
  state?: string | string[];
  /** 지도 중심. null 이면 아직 모른다(일정 조회 중) — 지도 대신 로딩 자리를 그린다. */
  center: MapCenter | null;
  /** 중심을 고른 일정 슬롯 이름. 없으면(세션 좌표·상수 폴백) "여행지 기준". */
  placeName: string | null;
  /** "이 위치로 계속" — 지도를 움직여 맞춘 중심(안 움직였으면 받은 center). */
  onConfirm?: (center: MapCenter) => void;
  /** 재계획 요청 실패 안내 문구(컨테이너가 정한다). */
  errorText?: string | null;
}

/** soft shadow(Figma `0px 2px 10px rgba(0,0,0,0.06)`) — 반투명이라 토큰이 아니고, shadowColor 는
 * className 을 못 받는 raw 값이다. `#000000` 은 토큰화 9색 밖이라 raw-hex 가드 사정거리 밖(홈
 * fabShadow·탭바 PILL_SHADOW 선례). */
const CARD_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

interface FaceConfig {
  rootTestID: string;
  /** 안내 배너 첫 줄 — 권한 거부(i21)와 측위 불가(i20)를 가르는 카피 차이. */
  banner: string;
  /** 지도 아래 안내 힌트. */
  mapHint: string;
}

const FACES: Record<LiveLocationState, FaceConfig> = {
  manual: {
    rootTestID: 'live-location-manual',
    banner: '위치를 확인할 수 없어 현재 위치를 직접 입력해 주세요',
    mapHint: '지도를 길게 눌러 원하는 위치를 지정할 수 있어요',
  },
  'permission-denied': {
    rootTestID: 'live-location-permission-denied',
    banner: '위치 권한이 꺼져 있어 현재 위치를 직접 입력해 주세요',
    mapHint:
      '현재 위치 대신 일정 속 장소를 기준으로 잡았어요. 핀을 옮겨 직접 지정할 수 있어요',
  },
};

export function LiveLocationView({
  state,
  center,
  placeName,
  onConfirm,
  errorText,
}: LiveLocationViewProps): ReactElement {
  const face = FACES[state === 'permission-denied' ? state : 'manual'];
  // 두 얼굴 모두 손으로 고른 위치(MANUAL)라 "(추정)"이 붙는다 — originKind 로 로컬 도출.
  const selectedValue = `${placeName ? `${placeName} 인근` : '여행지 기준'}${
    isEstimatedOrigin('MANUAL') ? '(추정)' : ''
  }`;
  // 지도를 움직여 멈추면 중심 좌표가 여기 담긴다. 아직 안 움직였으면 null 이고, 확정 시 받은
  // center 로 폴백한다.
  const [pickedCoord, setPickedCoord] = useState<MapCenter | null>(null);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID={face.rootTestID} className="flex-1 bg-canvas">
        <View className="h-[56px] flex-row items-center border-b border-hairline px-lg">
          <LocationBackChevronGlyph />
        </View>

        <View className="flex-1 gap-md px-lg pt-lg">
          <Text className="font-noto-bold text-[20px] font-bold text-ink">
            현재 위치 입력
          </Text>

          {/* 안내 배너(점선 박스 + info) — 첫 줄은 상태별, subline 은 공통. */}
          <View className="flex-row gap-sm rounded-[14px] border border-dashed border-hairline-strong bg-surface-soft px-lg py-md">
            <View className="pt-[2px]">
              <LocationInfoGlyph />
            </View>
            <View className="flex-1 gap-xs">
              <Text className="font-noto text-body text-ink">
                {face.banner}
              </Text>
              <Text className="font-noto text-label text-muted">
                입력한 위치는 추정 출발지로 사용돼요
              </Text>
            </View>
          </View>

          {/* 지도(중앙 고정 핀, TRIP-866 S4) — 사용자가 지도를 움직여 핀을 맞추면 onPick 으로 중심
              좌표가 올라온다. 실 pan·픽셀은 6-b(shared/map 의 CenterPinPicker 재사용). */}
          <View className="h-[250px] overflow-hidden rounded-[14px]">
            {center ? (
              <CenterPinPicker center={center} onPick={setPickedCoord} />
            ) : (
              <View
                testID="live-location-loading"
                className="flex-1 items-center justify-center bg-surface-soft"
              >
                <ActivityIndicator />
              </View>
            )}
          </View>
          <Text className="font-noto text-label text-muted">
            {face.mapHint}
          </Text>

          {/* 선택 위치 카드 — 값 옆 "변경"은 다시 고르는 어포던스(효과는 6-b). */}
          <View
            className="flex-row items-center justify-between rounded-[14px] border border-hairline bg-canvas px-lg py-md"
            style={CARD_SHADOW}
          >
            <View className="gap-xs">
              <Text className="font-noto text-label text-muted">
                선택한 위치
              </Text>
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {selectedValue}
              </Text>
            </View>
            <View className="rounded-pill bg-surface-strong px-md py-xs">
              <Text className="font-noto text-label text-body">변경</Text>
            </View>
          </View>
        </View>

        <View className="gap-sm px-lg pb-2xl pt-lg">
          {errorText ? (
            <Text
              testID="live-location-error"
              className="font-noto text-label text-primary-text"
            >
              {errorText}
            </Text>
          ) : null}

          {/* 주 CTA — 지도를 움직여 맞춘 중심 좌표(없으면 받은 center)를 확정 콜백으로 올린다(AC-9).
              중심을 아직 모르면(로딩) 아무것도 올리지 않는다. */}
          <Pressable
            testID="live-location-confirm"
            accessibilityRole="button"
            onPress={() => {
              if (center) onConfirm?.(pickedCoord ?? center);
            }}
            className="h-[52px] items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              이 위치로 계속
            </Text>
          </Pressable>

          {/* 건너뛰기 어포던스 — 서버 사다리(마지막 방문지/등록 숙소)로 위임, 클라가 재판정 안 함.
              중립 가정 문구를 캡션으로 밝힌다(AC-2). 배선은 범위 밖(Q8). */}
          <Pressable
            testID="live-location-use-last-visit"
            className="items-center pt-xs"
          >
            <Text className="font-noto-bold text-card-title font-bold text-muted">
              위치 입력 건너뛰기
            </Text>
          </Pressable>
          <Text className="text-center font-noto text-label text-muted">
            마지막 방문지나 등록 숙소 기준·추정 출발지로 이어져요
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
