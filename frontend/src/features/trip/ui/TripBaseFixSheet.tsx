import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import {
  KakaoMapView,
  type KakaoMapMessage,
  type MapCenter,
} from '@/shared/map';
import { WarningTriangleGlyph } from '@/features/trip/ui/TripGlyphs';

/**
 * g02 거점 보완 시트 — 좌표와 날짜를 한 자리에서 고친다(TRIP-226 · 01b D1·D2·D3).
 * Figma 전용 프레임이 없어 e05 conflict(`1358:1546`)·error-mapapi(`1359:1546`)의 패턴을
 * 가져왔다(01 브리프 §4).
 *
 * **상태를 하나도 갖지 않는다.** 핀 좌표·확정 여부·고른 날짜·저장 진행·오류를 전부 배선이
 * 쥐고 prop으로 내린다. 시트가 상태를 쥐면 D3 저장 게이트가 시트와 배선 두 곳에 살게 되고,
 * 그 순간 *"고쳤는데 여전히 막힌다"*가 층 사이 틈에서 되살아난다.
 *
 * 지도는 좌표가 **아직 미확정일 때만** 띄운다 — 날짜만 고치러 온 사용자에게 WebView를 얹지
 * 않는다. 지도를 못 띄우는 상태(env 키 부재)는 침묵하지 않고 말한다: 그때는 핀을 찍을 방법
 * 자체가 없어 저장이 영영 안 열리는데, 이유를 안 적으면 회색 버튼만 남는다(BR-U1-55 · INV-4).
 */

const SHEET_TITLE = '숙소 정보 고치기';
const CLOSE_LABEL = '닫기';
const SAVE_LABEL = '저장';
/** e05 `1358:1584`의 실측 문구를 그대로 쓴다(`StayRegisterScreen`도 같은 문자열). */
const CONFIRM_COORD_LABEL = '이 위치로 확인';
const RETRY_LABEL = '다시 시도';
const MAP_UNAVAILABLE_MESSAGE = '지도를 띄울 수 없어 위치를 확인할 수 없어요';

export interface TripBaseFixSheetProps {
  savedStayId: string;
  stayName: string;
  /** 지도의 시작 좌표. 숙소에 좌표가 없으면 배선이 대체값을 정해 내린다. */
  center: MapCenter;
  coordConfirmed: boolean;
  /** 이번 시트에서 핀을 한 번이라도 찍었나 — 확정 버튼이 열리는 조건. */
  pinDropped: boolean;
  mapUnavailable: boolean;
  /** 여행 기간의 날짜 칩. 기간 밖 날짜는 애초에 목록에 없다(기간 밖 숙소는 카드의 확장 흐름). */
  dayOptions: { date: string; label: string }[];
  checkIn: string | null;
  checkOut: string | null;
  saveDisabled: boolean;
  /** 저장이 막힌 이유. 없으면 사유 줄을 안 그린다 — 막히지도 않았는데 경고가 서면 거짓말이다. */
  saveBlockedReason?: string;
  saving: boolean;
  errorText?: string;
  onPinDrop: (lat: number, lng: number) => void;
  onConfirmCoord: () => void;
  onPickDay: (date: string) => void;
  onSave: () => void;
  onRetrySave: () => void;
  onClose: () => void;
}

function renderFixSheetBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="none"
    />
  );
}

export function TripBaseFixSheet({
  stayName,
  center,
  coordConfirmed,
  pinDropped,
  mapUnavailable,
  dayOptions,
  checkIn,
  checkOut,
  saveDisabled,
  saveBlockedReason,
  saving,
  errorText,
  onPinDrop,
  onConfirmCoord,
  onPickDay,
  onSave,
  onRetrySave,
  onClose,
}: TripBaseFixSheetProps): ReactElement {
  const saveLocked = saveDisabled || saving;

  // 지도가 올려보내는 메시지 중 이 시트가 쓰는 것은 핀 좌표 하나다 — 역지오코딩 결과는
  // 여기서 쓸 데가 없다(이름·주소를 고치는 자리가 아니다).
  function handleMapMessage(message: KakaoMapMessage): void {
    if (message.type === 'PIN_DROP') onPinDrop(message.lat, message.lng);
  }

  return (
    <BottomSheet backdropComponent={renderFixSheetBackdrop}>
      <BottomSheetView
        testID="trip-base-fixsheet"
        className="w-full gap-md px-lg pb-2xl pt-sm"
      >
        <View className="w-full flex-row items-center gap-sm">
          <Text className="flex-1 font-noto-bold text-section font-bold text-ink">
            {SHEET_TITLE}
          </Text>
          <Pressable
            testID="trip-base-fixsheet-close"
            accessibilityRole="button"
            onPress={onClose}
            hitSlop={8}
          >
            <Text className="font-noto text-label text-muted">
              {CLOSE_LABEL}
            </Text>
          </Pressable>
        </View>

        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          {stayName}
        </Text>

        {coordConfirmed ? null : (
          <View className="w-full gap-sm">
            {mapUnavailable ? (
              <View className="w-full flex-row items-center gap-[10px] rounded-button border border-hairline bg-surface-soft px-[14px] py-md">
                <WarningTriangleGlyph size={20} />
                <Text
                  testID="trip-base-fixsheet-mapfail"
                  className="flex-1 font-noto text-label text-muted"
                >
                  {MAP_UNAVAILABLE_MESSAGE}
                </Text>
              </View>
            ) : (
              <>
                {/* key를 주지 않는다 — 핀을 찍을 때마다 remount하면 진행 중이던 지도 대본이
                    죽는다(`StayRegisterScreen` PinPanel의 같은 판단). */}
                <View className="h-[220px] w-full overflow-hidden rounded-card">
                  <KakaoMapView
                    center={center}
                    onMapMessage={handleMapMessage}
                  />
                </View>
                <Pressable
                  testID="trip-base-fixsheet-confirmcoord"
                  accessibilityRole="button"
                  disabled={!pinDropped}
                  onPress={onConfirmCoord}
                  className={`h-12 w-full items-center justify-center rounded-button ${
                    pinDropped ? 'bg-primary' : 'bg-hairline-strong'
                  }`}
                >
                  <Text
                    className={`font-noto-bold text-card-title font-bold ${
                      pinDropped ? 'text-on-primary' : 'text-muted'
                    }`}
                  >
                    {CONFIRM_COORD_LABEL}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        <View className="w-full flex-row flex-wrap gap-sm">
          {dayOptions.map((option) => {
            const picked = option.date === checkIn || option.date === checkOut;
            return (
              <Pressable
                key={option.date}
                testID={`trip-base-fixsheet-day-${option.date}`}
                accessibilityRole="button"
                onPress={() => onPickDay(option.date)}
                className={`rounded-pill border px-md py-sm ${
                  picked
                    ? 'border-primary bg-primary-pale'
                    : 'border-hairline bg-canvas'
                }`}
              >
                <Text
                  className={
                    picked
                      ? 'font-noto-bold text-label font-bold text-primary-text'
                      : 'font-noto text-label text-ink'
                  }
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {saveBlockedReason === undefined ? null : (
          <Text
            testID="trip-base-fixsheet-blocked"
            className="font-noto text-caption text-muted"
          >
            {saveBlockedReason}
          </Text>
        )}

        {errorText === undefined ? null : (
          <View className="w-full flex-row items-center gap-sm">
            <Text
              testID="trip-base-fixsheet-error"
              className="flex-1 font-noto text-caption text-primary-text"
            >
              {errorText}
            </Text>
            <Pressable
              testID="trip-base-fixsheet-retry"
              accessibilityRole="button"
              onPress={onRetrySave}
              hitSlop={8}
            >
              <Text className="font-noto-bold text-caption font-bold text-primary-text">
                {RETRY_LABEL}
              </Text>
            </Pressable>
          </View>
        )}

        <Pressable
          testID="trip-base-fixsheet-save"
          accessibilityRole="button"
          disabled={saveLocked}
          onPress={onSave}
          className={`w-full items-center justify-center rounded-button p-lg ${
            saveLocked ? 'bg-hairline-strong' : 'bg-primary'
          }`}
        >
          <Text
            className={`font-noto-bold text-[16px] font-bold ${
              saveLocked ? 'text-muted' : 'text-on-primary'
            }`}
          >
            {SAVE_LABEL}
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
