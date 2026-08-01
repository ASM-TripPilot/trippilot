/**
 * e05 숙소 직접 등록 · 무상태 프레젠테이션 화면(Figma default 1703:1183 골격 + 3탭 셸 절충안,
 * 01b Seed §1~§3-6). `flow`·`today` 2개 prop과 콜백 11개만 받는다 — 상태·네트워크·라우팅을
 * 전혀 모른다(FSD 경계, `pages/stay-register/ui/StayRegisterPage.tsx`가 진다). 지도는
 * `@/shared/map`(`KakaoMapView`)을 그대로 쓴다 — 후보 N핀·재구현은 이번 범위 밖이다(Seed §3-3).
 *
 * 지도 시트가 열려 있을 때는 지도 검색 탭의 인라인 미리보기를 숨긴다(Seed §3-3 "실질 1개").
 * 핀 지정 탭의 지도는 예외다 — 시트가 열려도 계속 그린다(5-b 2차 B-2, PinPanel의
 * `ponytail:` 주석 참고). 5-c(W-10) 정정 — 시트가 그 위를 덮지 않는다(콘텐츠 높이만큼만
 * 올라오는 시트라 화면 위쪽 핀 지도는 그대로 보인다). WebView 2개가 잠깐 공존하는 것은
 * 여전히 사실이고, 뒤 지도가 눌리지 않게 막는 일은 배경막(MapSheet의 `backdropComponent`)이
 * 진다 — 화면이 "안 보이니 무해하다"고 가정하지 않는다.
 *
 * 픽셀 충실도(간격·그림자·앱바)는 이 계약이 잠그지 않는다(02a §3-3) — figma-screen-impl
 * 루프 몫으로 남긴다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';
import { KakaoMapView, type KakaoMapMessage } from '@/shared/map';

import {
  daysInMonth,
  firstWeekdayOfMonth,
  nightsBetween,
} from '../model/stayDates';
import {
  canSubmitStayRegister,
  resolveName,
  type StayRegisterFlow,
  type StayRegisterTab,
} from '../model/stayRegisterForm';

export interface StayRegisterScreenProps {
  flow: StayRegisterFlow;
  /** 'YYYY-MM-DD' — 과거 날짜 비활성 기준. 주입해야 테스트가 결정론적이다. */
  today: string;
  onSelectTab: (tab: StayRegisterTab) => void;
  onChangeQuery: (value: string) => void;
  onChangeName: (value: string) => void;
  onSubmitQuery: () => void;
  onRetrySearch: () => void;
  onSelectCandidate: (candidate: GeocodeCandidate) => void;
  /** 지도(핀 지정 탭 미리보기·검색 미리보기)가 올려보낸 메시지를 그대로 위로 넘긴다(G-2 —
   * 화면은 해석하지 않는다. AC-3~5 판단은 이 메시지를 받는 쪽(페이지)이 진다). */
  onPinMessage: (message: KakaoMapMessage) => void;
  onOpenMapSheet: () => void;
  onConfirmCoord: () => void;
  onCloseMapSheet: () => void;
  onOpenDateSheet: () => void;
  onPickDate: (date: string) => void;
  onCloseDateSheet: () => void;
  onSubmit: () => void;
  /** 목적지(뒤로가기 chevron)는 잠그지 않는다(02a §3-4) — 미지정이어도 화면은 그대로 동작한다. */
  onBack?: () => void;
  /**
   * 달력이 보여줄 달 'YYYY-MM'. 미지정이면 `checkIn ?? today`의 달을 쓴다(5-b W-1 이전 동작).
   * 아래 `onShiftCalendarMonth`와 함께 **옵셔널이어야 한다** — 승인된
   * `StayRegisterScreen.test.tsx`가 화면을 prop 11개로 부르므로 필수로 만들면 그쪽이 깨진다.
   */
  calendarMonth?: string;
  /** 달 이동. 미지정이면 이동 버튼이 잠긴다(한 달만 그리던 기존 동작으로 정확히 되돌아간다). */
  onShiftCalendarMonth?: (delta: number) => void;
}

function isSameCandidate(a: GeocodeCandidate, b: GeocodeCandidate): boolean {
  return (
    a.name === b.name &&
    a.address === b.address &&
    a.lat === b.lat &&
    a.lng === b.lng
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** 3탭 셸 — 지도 검색·핀 지정 둘 다 이제 열려 있다(TRIP-199 AC-1). 링크 붙여넣기는 여전히
 * 계약이 없어 잠긴 채다(BR-U1-21·D6). 몰입 화면이라 하단 탭바는 그리지 않는다(브리프 AC-11). */
function RegisterTabs({
  activeTab,
  onSelectTab,
}: {
  activeTab: StayRegisterTab;
  onSelectTab: (tab: StayRegisterTab) => void;
}): ReactElement {
  return (
    <View className="w-full flex-row gap-sm px-lg pt-md">
      <Pressable
        testID="stay-register-tab-mapsearch"
        accessibilityRole="tab"
        onPress={() => onSelectTab('mapsearch')}
        className={`flex-1 items-center rounded-button py-sm ${
          activeTab === 'mapsearch'
            ? 'bg-primary-pale'
            : 'border border-hairline'
        }`}
      >
        <Text className="font-noto-bold text-label font-bold text-ink">
          지도 검색
        </Text>
      </Pressable>
      <Pressable
        testID="stay-register-tab-linkpaste"
        accessibilityRole="tab"
        disabled
        className="flex-1 items-center rounded-button border border-hairline py-sm"
      >
        <Text className="font-noto text-label text-muted-soft">
          링크 붙여넣기 · 준비 중
        </Text>
      </Pressable>
      <Pressable
        testID="stay-register-tab-pin"
        accessibilityRole="tab"
        onPress={() => onSelectTab('pin')}
        className={`flex-1 items-center rounded-button py-sm ${
          activeTab === 'pin' ? 'bg-primary-pale' : 'border border-hairline'
        }`}
      >
        <Text className="font-noto-bold text-label font-bold text-ink">
          핀 지정
        </Text>
      </Pressable>
    </View>
  );
}

function CandidateSkeleton(): ReactElement {
  return (
    <View className="gap-sm px-lg">
      <View
        testID="stay-register-candidate-skeleton-0"
        className="h-16 w-full rounded-button bg-surface-strong"
      />
      <View
        testID="stay-register-candidate-skeleton-1"
        className="h-16 w-full rounded-button bg-surface-strong"
      />
    </View>
  );
}

function SearchFailBlock({
  onRetrySearch,
  onSelectTab,
}: {
  onRetrySearch: () => void;
  onSelectTab: (tab: StayRegisterTab) => void;
}): ReactElement {
  return (
    <View className="gap-sm px-lg">
      <View
        testID="stay-register-searchfail"
        className="flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-sm"
      >
        <View className="flex-1 gap-xs">
          <Text className="font-noto-bold text-label font-bold text-ink">
            지도 검색을 사용할 수 없어요
          </Text>
          <Text className="font-noto text-caption text-muted">
            핀으로 직접 지정해 주세요
          </Text>
        </View>
        <Pressable
          testID="stay-register-searchfail-retry"
          accessibilityRole="button"
          onPress={onRetrySearch}
        >
          <Text className="font-noto-bold text-label font-bold text-primary">
            다시 시도
          </Text>
        </Pressable>
      </View>
      {/* TRIP-199 — 이 버튼의 목적지(핀 지정 탭)가 이제 실재한다(BR-U1-23). */}
      <Pressable
        testID="stay-register-pinfallback"
        accessibilityRole="button"
        onPress={() => onSelectTab('pin')}
        className="flex-row items-center gap-xs rounded-button border border-hairline px-md py-sm"
      >
        <Text className="font-noto-bold text-label font-bold text-ink">
          핀으로 직접 지정
        </Text>
      </Pressable>
    </View>
  );
}

/** D7·S-5 공유 축 — 지도 검색 실패 화면과 핀 지정 탭이 같은 "숙소명 직접 입력" 필드를 쓴다
 * (Figma error-mapapi `1359:1546` 실측: 라벨 "숙소명" + placeholder "숙소명 직접 입력"). 한
 * 컴포넌트로 두면 두 표면이 각자 그리다 testID가 중복될 위험이 구조적으로 없어진다(P-13).
 *
 * 5-c(W-9) — "이름이 비어 등록이 잠겼다"는 안내는 여기 없다. 예전엔 이 칸 바로 아래 그렸는데,
 * 그러면 안내의 생명주기가 이 칸을 그리는 탭(핀 탭)에 묶여 탭을 옮기면 사라졌다 — 반면
 * 「등록하기」는 탭과 무관한 공통 영역에 있다. 안내는 그 버튼과 같은 자리(공통 영역)로
 * 옮겼다(아래 `StayRegisterScreen`의 `nameMissing`). */
function NameField({
  value,
  onChangeName,
  placeholder = '숙소명 직접 입력',
}: {
  value: string;
  onChangeName: (value: string) => void;
  /** 5-c 2차(W-5) — 비워 두면 저장될 이름(후보 폴백)을 사용자가 미리 볼 수 없다. */
  placeholder?: string;
}): ReactElement {
  return (
    <View className="gap-xs">
      <Text className="font-noto-bold text-label font-bold text-muted">
        숙소명
      </Text>
      <TextInput
        testID="stay-register-name-input"
        value={value}
        onChangeText={onChangeName}
        placeholder={placeholder}
        className="w-full rounded-input border border-hairline-strong px-[14px] py-[13px] font-noto text-card-title text-ink placeholder:text-muted-soft"
      />
    </View>
  );
}

/** 이번 칸이 새로 여는 표면 — Figma에 프레임이 없다(브리프 4-2 전수 실측). 기존 e05 화면의
 * 토큰·간격 관례를 따른다. 핀을 찍기 전에도 지도가 떠 있어야 롱프레스할 대상이 생긴다(D1·P-4)
 * — 아직 좌표가 없을 때는 이 상수로 지도를 띄운다(서울시청, 특별한 의미는 없다). */
const PIN_MAP_DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };

function PinPanel({
  candidate,
  pinAddressStatus,
  name,
  onPinMessage,
  onChangeName,
}: {
  candidate: GeocodeCandidate | null;
  pinAddressStatus: StayRegisterFlow['pinAddressStatus'];
  name: string;
  onPinMessage: (message: KakaoMapMessage) => void;
  onChangeName: (value: string) => void;
}): ReactElement {
  const center =
    candidate !== null
      ? { lat: candidate.lat, lng: candidate.lng }
      : PIN_MAP_DEFAULT_CENTER;

  return (
    <View
      testID="stay-register-pin-panel"
      className="w-full gap-md px-lg pt-lg"
    >
      {/* ponytail: 좌표 확정 시트가 열려 있는 동안에도 이 지도를 계속 그린다 — 예전에는
        "지도(WebView) 마운트는 실질 1개"를 지키려고 시트가 열리면 이 View를 안 그렸는데
        (기존 검색 미리보기와 같은 규율이었다), 조건부 렌더는 리액트에서 언마운트라
        진행 중이던 역지오코딩 콜백이 시트를 여는 순간 죽었다(B-2, 5-b 2차 지적). 5-c(W-10)
        정정 — 시트는 콘텐츠 높이만큼만 올라오고 배경막도 없어서, 이 지도는 시트가 열려도
        실제로 보이고 눌린다(전에 여기 적혀 있던 "시트가 덮어서 안 보인다"는 실측과
        달랐다). 진짜 천장은 "시트가 열린 동안 WebView 2개(핀 지도 + 시트 지도)가 공존하고
        뒤 지도도 살아 있다"이고, 뒤 지도가 눌려 좌표가 바뀌는 문제는 MapSheet의
        `backdropComponent`가 막는다(아래) — 메모리가 실제로 문제되면(느린 기기 스모크 등)
        시트가 이 지도를 재사용하는 구조로 승격한다. */}
      <View
        testID="stay-register-pin-map"
        className="h-[196px] w-full overflow-hidden rounded-card"
      >
        {/* key를 주지 않는다(B-1) — 재핀마다 remount하면 그때마다 새 WebView 문서가
          뜨면서 진행 중이던 역지오코딩 콜백이 죽는다. 찍힌 지점은 지도 재중심이 아니라
          WebView 안 마커로 보여준다(N-1). */}
        <KakaoMapView center={center} onMapMessage={onPinMessage} />
      </View>

      {pinAddressStatus === 'ok' && candidate !== null ? (
        <View
          testID="stay-register-pin-address"
          className="rounded-button border border-hairline bg-surface-soft px-md py-sm"
        >
          <Text className="font-noto text-body text-ink">
            {candidate.address}
          </Text>
        </View>
      ) : null}

      {pinAddressStatus === 'error' ? (
        <View
          testID="stay-register-pin-addressfail"
          className="rounded-button border border-hairline bg-surface-soft px-md py-sm"
        >
          <Text className="font-noto text-caption text-muted">
            주소를 확인하지 못했어요. 지도를 다시 길게 누르거나 숙소명을 직접
            입력해 주세요
          </Text>
        </View>
      ) : null}

      <NameField
        value={name}
        onChangeName={onChangeName}
        // 5-c 2차(W-5) — 저장될 이름(폴백)을 등록 전에 미리 보여준다. 후보 이름이
        // 없으면(공백뿐이어도) 프롬프트 기본값으로 되돌아간다.
        placeholder={
          candidate !== null && candidate.name.trim() !== ''
            ? candidate.name
            : undefined
        }
      />
    </View>
  );
}

function CandidateList({
  candidates,
  selected,
  onSelectCandidate,
}: {
  candidates: GeocodeCandidate[];
  selected: GeocodeCandidate | null;
  onSelectCandidate: (candidate: GeocodeCandidate) => void;
}): ReactElement {
  return (
    <View className="gap-sm px-lg">
      {candidates.length >= 2 ? (
        <View testID="stay-register-candidate-hint">
          <Text className="font-noto text-label text-muted">
            여러 숙소가 검색됐어요. 정확한 곳을 선택하세요
          </Text>
        </View>
      ) : null}
      {candidates.map((candidate, index) => {
        const checked =
          selected !== null && isSameCandidate(selected, candidate);
        return (
          <Pressable
            key={`${candidate.name}-${index}`}
            testID={`stay-register-candidate-${index}`}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            onPress={() => onSelectCandidate(candidate)}
            className={`gap-xs rounded-button border px-md py-sm ${
              checked ? 'border-primary bg-primary-pale' : 'border-hairline'
            }`}
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {candidate.name}
            </Text>
            <Text className="font-noto text-label text-muted">
              {candidate.address}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CalendarSheet({
  today,
  checkIn,
  calendarMonth,
  onShiftCalendarMonth,
  onPickDate,
  onCloseDateSheet,
}: {
  today: string;
  checkIn: string | null;
  calendarMonth?: string;
  onShiftCalendarMonth?: (delta: number) => void;
  onPickDate: (date: string) => void;
  onCloseDateSheet: () => void;
}): ReactElement {
  const [refYear, refMonth] = (calendarMonth ?? checkIn ?? today)
    .split('-')
    .slice(0, 2)
    .map(Number);
  const totalDays = daysInMonth(refYear, refMonth);
  const leadingBlanks = firstWeekdayOfMonth(refYear, refMonth);
  const dayNumbers = Array.from({ length: totalDays }, (_, i) => i + 1);

  // 지난 달로는 가지 않는다 — 그 달은 전 칸이 과거라 비활성이고, 빈 달을 보여줄 이유가 없다.
  const refMonthStr = `${refYear}-${pad2(refMonth)}`;
  const canGoPrev =
    onShiftCalendarMonth !== undefined && refMonthStr > today.slice(0, 7);
  const canGoNext = onShiftCalendarMonth !== undefined;

  return (
    <BottomSheet>
      <BottomSheetView testID="stay-register-datesheet" className="gap-md p-lg">
        <View className="flex-row items-center justify-between">
          <Pressable
            testID="stay-register-datesheet-prev"
            accessibilityRole="button"
            accessibilityLabel="이전 달"
            disabled={!canGoPrev}
            onPress={() => onShiftCalendarMonth?.(-1)}
            className="h-10 w-10 items-center justify-center"
          >
            <Text
              className={`font-noto-bold text-section font-bold ${
                canGoPrev ? 'text-ink' : 'text-muted-soft'
              }`}
            >
              ‹
            </Text>
          </Pressable>
          <Text className="font-noto-bold text-section font-bold text-ink">
            {refYear}년 {refMonth}월
          </Text>
          <Pressable
            testID="stay-register-datesheet-next"
            accessibilityRole="button"
            accessibilityLabel="다음 달"
            disabled={!canGoNext}
            onPress={() => onShiftCalendarMonth?.(1)}
            className="h-10 w-10 items-center justify-center"
          >
            <Text
              className={`font-noto-bold text-section font-bold ${
                canGoNext ? 'text-ink' : 'text-muted-soft'
              }`}
            >
              ›
            </Text>
          </Pressable>
        </View>
        <View className="w-full flex-row flex-wrap">
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <View key={`blank-${i}`} className="h-10 w-[14.28%]" />
          ))}
          {dayNumbers.map((day) => {
            const dateStr = `${refYear}-${pad2(refMonth)}-${pad2(day)}`;
            const disabled = dateStr < today;
            return (
              <Pressable
                key={dateStr}
                testID={`stay-register-date-cell-${dateStr}`}
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => onPickDate(dateStr)}
                className="h-10 w-[14.28%] items-center justify-center"
              >
                <Text
                  className={`font-noto text-body ${
                    disabled ? 'text-muted-soft' : 'text-ink'
                  }`}
                >
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          testID="stay-register-datesheet-close"
          accessibilityRole="button"
          onPress={onCloseDateSheet}
          className="h-12 items-center justify-center rounded-button border border-hairline-strong"
        >
          <Text className="font-noto-medium text-card-title font-medium text-ink">
            완료
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}

/** 5-c(W-10) — 배경막. 시트는 콘텐츠 높이만큼만 올라와 위쪽 핀 지도를 덮지 않으므로, 배경막
 * 없이는 그 지도가 열려 있는 동안에도 눌린다(롱프레스 → PIN_DROP → 확인하려던 좌표가
 * 바뀐다). `appearsOnIndex={0}·disappearsOnIndex={-1}`은 스냅포인트가 하나뿐인(동적 크기)
 * 시트의 표준값 — index 0이 이 시트의 유일한 "열림" 상태다. `pressBehavior="none"`으로
 * 탭해도 닫히지 않게 한다 — 닫힘은 `mapSheetState`(부모 상태) 하나가 정하는데, 배경막 탭까지
 * 내부적으로 닫히면 시트의 실제 위치와 그 상태가 따로 논다. */
function renderMapSheetBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      pressBehavior="none"
    />
  );
}

function MapSheet({
  mapSheetState,
  candidate,
  onConfirmCoord,
  onCloseMapSheet,
}: {
  mapSheetState: StayRegisterFlow['mapSheetState'];
  candidate: GeocodeCandidate;
  onConfirmCoord: () => void;
  onCloseMapSheet: () => void;
}): ReactElement {
  return (
    <BottomSheet backdropComponent={renderMapSheetBackdrop}>
      <BottomSheetView testID="stay-register-mapsheet" className="gap-md p-lg">
        <Pressable
          testID="stay-register-mapsheet-close"
          accessibilityRole="button"
          onPress={onCloseMapSheet}
          className="self-end"
        >
          <Text className="font-noto text-label text-muted">닫기</Text>
        </Pressable>

        {mapSheetState === 'open' ? (
          <>
            <View className="h-[240px] w-full overflow-hidden rounded-card">
              {/* 같은 이유로 key를 준다 — 시트가 열려 있는 동안 후보가 바뀌면(다른 후보를
                다시 고르는 경우) 지도가 새 좌표를 받아야 한다. */}
              <KakaoMapView
                key={`${candidate.lat},${candidate.lng}`}
                center={{ lat: candidate.lat, lng: candidate.lng }}
              />
            </View>
            <Pressable
              testID="stay-register-mapsheet-confirm"
              accessibilityRole="button"
              onPress={onConfirmCoord}
              className="h-12 items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                이 위치로 확인
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text className="font-noto-bold text-section font-bold text-ink">
              지도를 불러오지 못했어요
            </Text>
            <Text className="font-noto-bold text-[16px] font-bold text-ink">
              {candidate.name}
            </Text>
            <Text className="font-noto text-label text-muted">
              {candidate.address}
            </Text>
            <Pressable
              testID="stay-register-mapsheet-confirm"
              accessibilityRole="button"
              onPress={onConfirmCoord}
              className="h-12 items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-card-title font-bold text-on-primary">
                이 주소로 확인
              </Text>
            </Pressable>
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

export function StayRegisterScreen({
  flow,
  today,
  onSelectTab,
  onChangeQuery,
  onChangeName,
  onSubmitQuery,
  onRetrySearch,
  onSelectCandidate,
  onPinMessage,
  onOpenMapSheet,
  onConfirmCoord,
  onCloseMapSheet,
  onOpenDateSheet,
  onPickDate,
  onCloseDateSheet,
  onSubmit,
  calendarMonth,
  onShiftCalendarMonth,
}: StayRegisterScreenProps): ReactElement {
  const nights = nightsBetween(flow.checkIn, flow.checkOut);
  const dateSummary =
    nights !== null
      ? `${nights}박 · 나중에 바꿀 수 있어요`
      : '날짜를 선택하세요';
  const dateError =
    flow.checkIn !== null && flow.checkOut !== null && nights === null;
  const canSubmit = canSubmitStayRegister(flow);
  // AC-3 문구는 coordConfirmed 하나에만 걸린다(후보 유무를 조건에 넣지 않는다) — 재검색으로
  // 이전 후보가 풀려도(§3-2 초기화) 안내는 그대로 남아야 한다(I-5).
  const showCoordNotice = !flow.coordConfirmed;
  // 지도 확인 버튼은 확인할 좌표(후보)가 있을 때만 연다 — 없으면 시트가 아예 마운트되지 않아
  // 눌러도 반응 없는 버튼이 된다(INV-4).
  const showMapConfirm =
    flow.selectedCandidate !== null && !flow.coordConfirmed;
  const showMapPreview =
    flow.selectedCandidate !== null && flow.mapSheetState === 'closed';
  // 5-c(W-9) — 이름이 비어 「등록하기」가 잠긴 이유. 예전엔 PinPanel 지역 변수였는데, 그 칸이
  // 핀 탭에서만 렌더돼(activeTab === 'pin') 탭을 옮기면 안내가 버튼보다 먼저 사라졌다.
  // canSubmitStayRegister와 같은 식(resolveName + `.trim() === ''`, 5-c W-7)으로 판정해 버튼이
  // 잠긴 이유와 안내가 다른 답을 내는 일이 없게 한다(W-2와 같은 이유).
  const nameMissing =
    flow.selectedCandidate !== null &&
    flow.pinAddressStatus === 'ok' &&
    resolveName(flow.name, flow.selectedCandidate.name).trim() === '';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View testID="stay-register-root" className="flex-1 bg-canvas">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          <Text className="font-noto-bold text-hero font-bold text-ink px-lg pb-sm pt-lg">
            숙소 등록
          </Text>

          <RegisterTabs activeTab={flow.activeTab} onSelectTab={onSelectTab} />

          {flow.activeTab === 'mapsearch' ? (
            <>
              <View className="w-full gap-md px-lg pt-lg">
                {flow.searchStatus === 'error' ? (
                  // D7 — 지도 검색이 죽으면 검색 입력을 숙소명 직접 입력으로 바꾼다(Figma
                  // error-mapapi 실측). 이 조건 하나로만 갈린다(★18) — 넓히면 동결 4건이 깨진다.
                  <NameField value={flow.name} onChangeName={onChangeName} />
                ) : (
                  <TextInput
                    testID="stay-register-search-input"
                    value={flow.query}
                    onChangeText={onChangeQuery}
                    returnKeyType="search"
                    placeholder="숙소 이름이나 주소로 검색"
                    onSubmitEditing={() => {
                      if (flow.searchStatus !== 'loading') onSubmitQuery();
                    }}
                    className="h-12 w-full rounded-input border border-hairline-strong px-md font-noto text-body text-ink"
                  />
                )}
              </View>

              <View className="w-full gap-md pt-md">
                {flow.searchStatus === 'loading' ? <CandidateSkeleton /> : null}
                {flow.searchStatus === 'error' ? (
                  <SearchFailBlock
                    onRetrySearch={onRetrySearch}
                    onSelectTab={onSelectTab}
                  />
                ) : null}
                {flow.searchStatus === 'empty' ? (
                  <View
                    testID="stay-register-candidate-empty"
                    className="px-lg"
                  >
                    <Text className="font-noto text-body text-muted">
                      검색 결과가 없어요
                    </Text>
                  </View>
                ) : null}
                {flow.searchStatus === 'success' ? (
                  <CandidateList
                    candidates={flow.candidates}
                    selected={flow.selectedCandidate}
                    onSelectCandidate={onSelectCandidate}
                  />
                ) : null}

                {showMapPreview && flow.selectedCandidate !== null ? (
                  <View
                    testID="stay-register-map-preview"
                    className="mx-lg h-[196px] overflow-hidden rounded-card"
                  >
                    {/* KakaoMapView는 마운트 시점 center로 문서를 굳힌다(B-1) — 후보가
                      바뀌면 지도가 따라가야 하므로 좌표를 key로 줘 remount시킨다. */}
                    <KakaoMapView
                      key={`${flow.selectedCandidate.lat},${flow.selectedCandidate.lng}`}
                      center={{
                        lat: flow.selectedCandidate.lat,
                        lng: flow.selectedCandidate.lng,
                      }}
                    />
                  </View>
                ) : null}
              </View>
            </>
          ) : null}

          {flow.activeTab === 'pin' ? (
            <PinPanel
              candidate={flow.selectedCandidate}
              pinAddressStatus={flow.pinAddressStatus}
              name={flow.name}
              onPinMessage={onPinMessage}
              onChangeName={onChangeName}
            />
          ) : null}

          <View className="w-full gap-md pt-md">
            {showCoordNotice || showMapConfirm || nameMissing ? (
              <View className="gap-sm px-lg">
                {showCoordNotice ? (
                  <View
                    testID="stay-register-coordnotice"
                    className="flex-row items-center rounded-button border border-info-border bg-info-bg px-md py-sm"
                  >
                    <Text className="flex-1 font-noto text-body text-info">
                      지도에서 위치를 확인해 주세요
                    </Text>
                  </View>
                ) : null}
                {showMapConfirm ? (
                  <Pressable
                    testID="stay-register-mapconfirm"
                    accessibilityRole="button"
                    onPress={onOpenMapSheet}
                    className="h-12 items-center justify-center rounded-button border border-hairline-strong"
                  >
                    <Text className="font-noto-bold text-card-title font-bold text-ink">
                      지도에서 위치 확인
                    </Text>
                  </Pressable>
                ) : null}
                {/* 5-c(W-9) — 버튼(stay-register-submit)과 같은 자리. 탭이 무엇이든(핀 탭을
                  벗어나도) 이름이 비어 있으면 여기 뜬다. 핀 패널 안에는 더 이상 같은 문구가
                  없다(중복 금지) — 이 한 곳이 유일한 출처다. */}
                {nameMissing ? (
                  <Text className="font-noto text-caption text-primary-text">
                    등록하려면 숙소명을 입력해 주세요
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Pressable
              testID="stay-register-date-field"
              accessibilityRole="button"
              onPress={onOpenDateSheet}
              className="mx-lg gap-xs rounded-button border border-hairline-strong px-md py-sm"
            >
              <Text className="font-noto text-label text-muted">
                체크인 · 체크아웃 (선택)
              </Text>
              <Text
                testID="stay-register-date-summary"
                className="font-noto-bold text-card-title font-bold text-ink"
              >
                {dateSummary}
              </Text>
              {dateError ? (
                <Text
                  testID="stay-register-date-error"
                  className="font-noto text-caption text-primary-text"
                >
                  체크아웃은 체크인 이후 날짜를 선택하세요
                </Text>
              ) : null}
            </Pressable>

            <Pressable
              testID="stay-register-submit"
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={onSubmit}
              className={`mx-lg h-12 items-center justify-center rounded-button ${
                canSubmit ? 'bg-primary' : 'bg-surface-strong'
              }`}
            >
              <Text
                className={`font-noto-bold text-card-title font-bold ${
                  canSubmit ? 'text-on-primary' : 'text-muted-soft'
                }`}
              >
                {flow.submitStatus === 'submitting' ? '등록 중…' : '등록하기'}
              </Text>
            </Pressable>

            {flow.submitStatus === 'error' ? (
              <View
                testID="stay-register-submitfail"
                className="mx-lg flex-row items-center gap-sm rounded-button border border-hairline bg-surface-soft px-md py-sm"
              >
                <Text className="flex-1 font-noto-bold text-label font-bold text-ink">
                  등록에 실패했어요
                </Text>
                {/* 가드가 페이지에도 있지만(5-b B-1) 눌리는데 아무 일도 안 나는 버튼은
                  INV-4 위반이라, 게이트가 닫혔으면 여기서도 잠긴 것이 보이게 한다. */}
                <Pressable
                  testID="stay-register-submitfail-retry"
                  accessibilityRole="button"
                  disabled={!canSubmit}
                  onPress={onSubmit}
                >
                  <Text
                    className={`font-noto-bold text-label font-bold ${
                      canSubmit ? 'text-primary' : 'text-muted-soft'
                    }`}
                  >
                    다시 시도
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </ScrollView>

        {flow.mapSheetState !== 'closed' && flow.selectedCandidate !== null ? (
          <MapSheet
            mapSheetState={flow.mapSheetState}
            candidate={flow.selectedCandidate}
            onConfirmCoord={onConfirmCoord}
            onCloseMapSheet={onCloseMapSheet}
          />
        ) : null}

        {flow.dateSheetOpen ? (
          <CalendarSheet
            today={today}
            checkIn={flow.checkIn}
            calendarMonth={calendarMonth}
            onShiftCalendarMonth={onShiftCalendarMonth}
            onPickDate={onPickDate}
            onCloseDateSheet={onCloseDateSheet}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
