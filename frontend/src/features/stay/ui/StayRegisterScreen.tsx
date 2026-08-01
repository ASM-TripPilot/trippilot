/**
 * e05 숙소 직접 등록 · 무상태 프레젠테이션 화면(Figma default 1703:1183 골격 + 3탭 셸 절충안,
 * 01b Seed §1~§3-6). `flow`·`today` 2개 prop과 콜백 11개만 받는다 — 상태·네트워크·라우팅을
 * 전혀 모른다(FSD 경계, `pages/stay-register/ui/StayRegisterPage.tsx`가 진다). 지도는
 * `@/shared/map`(`KakaoMapView`)을 그대로 쓴다 — 후보 N핀·재구현은 이번 범위 밖이다(Seed §3-3).
 *
 * 지도 시트가 열려 있을 때는 인라인 미리보기를 숨긴다 — 실질적으로 지도(WebView) 마운트가
 * 항상 1개이게 한다(Seed §3-3 "실질 1개").
 *
 * 픽셀 충실도(간격·그림자·앱바)는 이 계약이 잠그지 않는다(02a §3-3) — figma-screen-impl
 * 루프 몫으로 남긴다.
 */
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import type { GeocodeCandidate } from '@/shared/api/generated/schemas';
import { KakaoMapView } from '@/shared/map';

import {
  daysInMonth,
  firstWeekdayOfMonth,
  nightsBetween,
} from '../model/stayDates';
import {
  canSubmitStayRegister,
  type StayRegisterFlow,
} from '../model/stayRegisterForm';

export interface StayRegisterScreenProps {
  flow: StayRegisterFlow;
  /** 'YYYY-MM-DD' — 과거 날짜 비활성 기준. 주입해야 테스트가 결정론적이다. */
  today: string;
  onChangeQuery: (value: string) => void;
  onSubmitQuery: () => void;
  onRetrySearch: () => void;
  onSelectCandidate: (candidate: GeocodeCandidate) => void;
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

/** 3탭 셸 — 이 칸의 범위는 지도 검색뿐이라 나머지 둘은 눌러도 반응 없는 비활성이다
 * (BR-U1-21, 브리프 AC-11 몰입 화면이라 하단 탭바는 그리지 않는다). */
function RegisterTabs(): ReactElement {
  return (
    <View className="w-full flex-row gap-sm px-lg pt-md">
      <View
        testID="stay-register-tab-mapsearch"
        accessibilityRole="tab"
        className="flex-1 items-center rounded-button bg-primary-pale py-sm"
      >
        <Text className="font-noto-bold text-label font-bold text-ink">
          지도 검색
        </Text>
      </View>
      <Pressable
        testID="stay-register-tab-linkpaste"
        accessibilityRole="tab"
        disabled
        className="flex-1 items-center rounded-button border border-hairline py-sm"
      >
        <Text className="font-noto text-label text-muted-soft">
          링크 붙여넣기
        </Text>
      </Pressable>
      <Pressable
        testID="stay-register-tab-pin"
        accessibilityRole="tab"
        disabled
        className="flex-1 items-center rounded-button border border-hairline py-sm"
      >
        <Text className="font-noto text-label text-muted-soft">핀 지정</Text>
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
}: {
  onRetrySearch: () => void;
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
      <Pressable
        testID="stay-register-pinfallback"
        accessibilityRole="button"
        disabled
        className="flex-row items-center gap-xs rounded-button border border-hairline px-md py-sm"
      >
        <Text className="font-noto text-label text-muted-soft">
          핀으로 직접 지정
        </Text>
        <Text className="font-noto text-label text-muted-soft"> · 준비 중</Text>
      </Pressable>
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
    <BottomSheet>
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
              <KakaoMapView
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
  onChangeQuery,
  onSubmitQuery,
  onRetrySearch,
  onSelectCandidate,
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

          <RegisterTabs />

          <View className="w-full gap-md px-lg pt-lg">
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
          </View>

          <View className="w-full gap-md pt-md">
            {flow.searchStatus === 'loading' ? <CandidateSkeleton /> : null}
            {flow.searchStatus === 'error' ? (
              <SearchFailBlock onRetrySearch={onRetrySearch} />
            ) : null}
            {flow.searchStatus === 'empty' ? (
              <View testID="stay-register-candidate-empty" className="px-lg">
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
                <KakaoMapView
                  center={{
                    lat: flow.selectedCandidate.lat,
                    lng: flow.selectedCandidate.lng,
                  }}
                />
              </View>
            ) : null}

            {showCoordNotice || showMapConfirm ? (
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
