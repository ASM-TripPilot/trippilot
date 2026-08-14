import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';

import { REGIONS } from '@/features/explore/model/regions';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { postTripsTripIdMustVisits } from '@/shared/api/generated/trips/trips';
import type { CompanionType } from '@/shared/api/generated/schemas';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { getAccessToken } from '@/shared/api/tokenManager';

import {
  formatBudgetAmount,
  parseBudgetAmount,
} from '@/features/trip/model/budgetAmount';
import {
  buildCreateTripRequest,
  type CreateTripInput,
} from '@/features/trip/model/createTripRequest';
import {
  nightsSum,
  tripLength,
  validateTripDraft,
  type TripDraft,
} from '@/features/trip/model/tripDraft';
import {
  mustVisitFailureNotice,
  resolveMustVisitSection,
  seedMustVisits,
} from '@/features/trip/model/mustVisitSeed';
import { resolveStayImport } from '@/features/trip/model/stayDateImport';
import {
  presetRange,
  type PeriodPresetCode,
} from '@/features/trip/model/tripWizardStep1';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { useCreateTrip } from '@/features/trip/model/useCreateTrip';
import { usePreferencePrefill } from '@/features/trip/model/usePreferencePrefill';
import { useSavedStays } from '@/features/trip/model/useSavedStays';
import { TripWizardStep1Screen } from '@/features/trip/ui/TripWizardStep1Screen';

/**
 * TRIP-205/206 g01 1/2 배선 — 스토어 ↔ 화면 ↔ 라우터 ↔ 서버를 한 줄기로 잇는다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다(프리뷰·경계 제약, AC-14):
 *  1. `[다음]` 게이트 판정 — `validateTripDraft`(TRIP-204, 동결)를 여기서만 부른다.
 *     `destinations.length>0 && startDate·endDate 모두 있음 && validateTripDraft(...)===0`
 *     (01b §6.3) — 앞 두 조건이 "아직 안 고름"을, 마지막이 "잘못 고름"을 가른다.
 *  2. 기준일 주입 — `baseDate` prop이 없으면 `todayIso()`로 채운다(`StayRegisterPage`
 *     선례와 동형). 프리셋 → 날짜 범위 계산(`presetRange`)도 여기서 하고 화면엔 결과만 내린다.
 *  3. `REGIONS`를 읽어 `regions` prop으로 내린다 — 화면이 `features/explore`를 직접 import하면
 *     features 간 import가 된다(리포 관례 금지). `RegionPickerPage`가 `regions={filterRegions(...)}`로
 *     내리는 형태와 같다.
 *  4. **제출과 오류 매핑(TRIP-206, 01b D1·D4)** — 클라 위반은 `touched`가 켜진 축만 문구로
 *     내려보내고(§클라 오류 절), 서버 400은 알려진 형태만 인라인/다이얼로그로 골라내고
 *     **나머지 전부(미상 코드·미상 필드·응답 자체 없음)는 배너로 떨어뜨린다** — 이것이
 *     INV-4 페일세이프다. 화면은 완성된 문자열만 받으므로 이 매핑이 화면에 새어 나가면
 *     `tripWizardStep1Boundary.test.ts`가 막는다(위반 코드 리터럴 0건 유지).
 *  5. **예산 프리필·파싱·게이트(TRIP-207, 01b 불변식)** — 프리필은 스토어에 쓰지 않는
 *     **파생값**이다(`touched`에 `'budget'`이 없는 동안만 취향 값을 보여준다). 이 파일
 *     하나가 "프리필 쓰기가 사용자 입력과 같은 경로를 타면 자기 자신을 잠근다"는 불변식을
 *     구조적으로 지킨다 — `setBudgetText`(사람 경로)는 `onChangeBudget`·blur 재포맷에서만
 *     불리고, 프리필 표시는 그 액션을 거치지 않는다.
 *  6. **등록 숙소 날짜 연계(TRIP-208, 01b D4·D10)** — `GET /saved-stays` 조회, 얼굴 판정
 *     (`resolveStayImport`), 가져오기 → `setPeriod`, `/stays/register` 이동이 전부 여기다.
 *     조회 실패는 얼굴을 갈아 끼우지 않고 별개 축(`stayImportFailed`)으로 내려간다.
 *  7. **'꼭 갈 곳' 시드와 등록(TRIP-209, 01b D1~D6)** — `GET /saved-places` 조회 → 위저드
 *     드래프트로 복사(TRIP-288부터 **더하기만** 하는 재시드다 — 사용자가 뺀 항목이
 *     되살아나지 않게 막는 것은 스토어의 제외 기억이다) → 생성 성공
 *     **뒤에** `POST /trips/{tripId}/must-visits` N건. 계약에 꼭 갈 곳을 생성 요청에 실을
 *     필드가 없어 2단이 강제된다. 등록은 여행 생성 `try` **바깥**이다 — 한 블록으로 묶으면
 *     등록 실패가 "여행 생성 실패"로 둔갑하고 사용자가 [다시 시도]로 여행을 하나 더 만든다.
 */

/** 서버 400의 `error.code`가 국내 밖 목적지를 가리키는 값. openapi에 enum이 없어
 * **발명값**이다(01b D4, 아침 확인 1번) — BE 확인 뒤 이 상수 한 줄만 바꾸면 된다. */
const OVERSEAS_DESTINATION_ERROR_CODE = 'OVERSEAS_DESTINATION';

/** 종료일 역전 문구 — 클라 검증이 쓴다(Figma `2226:2119`). */
const PERIOD_ERROR_MESSAGE = '종료일이 시작일보다 빨라요';

/** 예산 파싱 실패 문구 — Figma에 오류 프레임이 없어 이 칸의 발명이다(02a §2-4, 게이트①
 * 사용자 판단 보류 항목). 뒤집히면 이 상수 한 줄만 바꾸면 된다. */
const BUDGET_ERROR_MESSAGE = '숫자만 입력해 주세요';

/** 제출 실패 배너 본문 — Figma가 확정한 유일한 문구다(`2226:2128`). 미상 코드·미상 필드처럼
 * Figma가 문구를 안 정해 준 갈래도 이 문구로 떨어진다(그 밖 갈래의 본문은 정본이 없다,
 * 브리프 §2.3) — 새 문구를 발명하는 대신 확정된 문구 하나를 재사용한다. */
const SUBMIT_ERROR_MESSAGE = '네트워크를 확인하고 다시 시도해주세요';

/** touched 게이트를 타지 않는 서버 400 → 화면 표면 갈래(01b D4 §2.4②). `overseas`만 아는
 * 코드로 걸러내고, **원인을 확신할 수 없는 나머지 전부(미상 코드·필드 오류 포함)는 배너로
 * 떨어뜨린다** — 5-c W-1: `fields[].field`로 "기간 오류"를 추측해 인라인 문구를 다는 것은
 * 계약이 말하지 않은 원인을 화면이 단정하는 것이라 거짓 설명이 된다. */
type ServerSubmitFailure = 'overseas' | 'banner';

function classifyServerFailure(error: unknown): ServerSubmitFailure {
  if (!isAxiosError(error) || !error.response) {
    // 응답 자체가 없다 — 네트워크 실패(02a ★6). Figma 배너 본문이 정확히 이 갈래의 문구다.
    return 'banner';
  }
  const body = error.response.data as { error?: { code?: string } } | undefined;
  if (body?.error?.code === OVERSEAS_DESTINATION_ERROR_CODE) {
    return 'overseas';
  }
  return 'banner';
}

export interface TripNewStep1PageProps {
  /** 프리셋 계산 기준일('YYYY-MM-DD'). 미지정이면 오늘. 화면·순수 함수는 시계를 읽지
   * 않으므로(AC-5) 이 값을 페이지가 대신 계산해 내려준다. */
  baseDate?: string;
}

/** 로컬 달력 기준 오늘 — `StayRegisterPage.todayIso()`와 동형(선례). */
function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 프리필 신뢰 경계(5-c W-2) — `rawAmount`는 서버 응답이고 계약(`integer, nullable`)에
 * `minimum`이 없다(openapi.yaml:1032). 음수·비정수까지 그대로 채우면 파싱 불가 문자열이
 * 입력에 들어가 `[다음]`이 설명 없이 잠긴다 — 예산으로 성립하는 값(0 이상 정수)일 때만
 * 채운다. `0`도 포함한다(★2) — truthy가 아니라 `Number.isInteger` 판정이라 걸리지 않는다. */
function isPrefillableBudget(
  value: number | null | undefined
): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function TripNewStep1Page({
  baseDate,
}: TripNewStep1PageProps): ReactElement {
  const router = useRouter();
  const resolvedBaseDate = baseDate ?? todayIso();

  const destinations = useTripWizardStore((state) => state.destinations);
  const startDate = useTripWizardStore((state) => state.startDate);
  const endDate = useTripWizardStore((state) => state.endDate);
  const presetCode = useTripWizardStore((state) => state.presetCode);
  const party = useTripWizardStore((state) => state.party);
  const companionType = useTripWizardStore((state) => state.companionType);
  const budgetText = useTripWizardStore((state) => state.budgetText);
  const touched = useTripWizardStore((state) => state.touched);
  const addDestination = useTripWizardStore((state) => state.addDestination);
  const removeDestination = useTripWizardStore(
    (state) => state.removeDestination
  );
  const setPeriod = useTripWizardStore((state) => state.setPeriod);
  const setParty = useTripWizardStore((state) => state.setParty);
  const selectCompanion = useTripWizardStore((state) => state.selectCompanion);
  const setBudgetText = useTripWizardStore((state) => state.setBudgetText);
  const setCreatedTripId = useTripWizardStore(
    (state) => state.setCreatedTripId
  );
  const createdTripId = useTripWizardStore((state) => state.createdTripId);
  const mustVisits = useTripWizardStore((state) => state.mustVisits);
  const mustVisitsInitialized = useTripWizardStore(
    (state) => state.mustVisitsInitialized
  );
  const addMustVisits = useTripWizardStore((state) => state.addMustVisits);
  const removeMustVisit = useTripWizardStore((state) => state.removeMustVisit);

  const preference = usePreferencePrefill();
  const preferenceChips = [
    ...(preference.data?.styles?.value ?? []),
    ...(preference.data?.activities?.value ?? []),
  ];

  // 예산 프리필은 **파생값**이지 스토어에 쓰는 값이 아니다(TRIP-207 01b 불변식, 02a §2-4).
  // `touched`에 `'budget'`이 없는 동안만 취향 값을 보여주고, 사용자가 한 번이라도 건드리면
  // (지운 것도 포함, D6 ③) 그 뒤로는 원문(`budgetText`)이 이긴다 — 그래서 지운 상태가
  // 재진입해도 되살아나지 않는다(AC-1c).
  // 5-c W-2: 판정을 `isPrefillableBudget`(0 이상 정수)으로 좁힌다 — 음수 프리필은 "그 값이
  // 서버로 나가는 것"이 아니라 "입력에 채워지는 것 자체"가 문제라, 채우는 문 앞에서 막는다.
  const rawAmount = preference.data?.budget?.rawAmount;
  const budgetTouched = touched.includes('budget');
  const canPrefillBudget = isPrefillableBudget(rawAmount);
  const prefillBudgetText = canPrefillBudget
    ? formatBudgetAmount(rawAmount)
    : '';
  const effectiveBudgetText = budgetTouched ? budgetText : prefillBudgetText;
  const budgetPrefilled = !budgetTouched && canPrefillBudget;
  const parsedBudget = parseBudgetAmount(effectiveBudgetText);
  const budgetError =
    budgetTouched && parsedBudget.kind === 'invalid'
      ? BUDGET_ERROR_MESSAGE
      : undefined;

  // 서버 400 → 화면 표면(01b D4). `touched` 게이트를 안 탄다 — 사용자가 이미 제출을
  // 눌렀고 서버가 대답했으므로, 안 건드린 축이어도 반드시 보여야 한다(★13, INV-4).
  const [submitError, setSubmitError] = useState<string>();
  const [overseasBlocked, setOverseasBlocked] = useState(false);
  // 날짜 선택 시트 열림 상태 — 날짜 행·'날짜 직접 입력' 두 진입점이 여는 시트를 배선이 소유한다
  // (TRIP-368, 숙소 등록 CalendarSheet과 같은 배치 — 페이지가 열고 닫고, 화면이 마운트한다).
  const [dateSheetOpen, setDateSheetOpen] = useState(false);

  // 5-c N-2: 배너가 뜬 뒤 드래프트를 고치면 배너는 옛 실패를 계속 보여주면서도 [다시 시도]는
  // 새 상태 기준으로 다시 판정한다 — 화면과 배너가 서로 다른 이야기를 하게 된다. 드래프트가
  // 바뀌는 순간 배너를 걷어 그 어긋남을 없앤다. 예산 축도 같은 이유로 더한다.
  useEffect(() => {
    setSubmitError(undefined);
  }, [destinations, startDate, endDate, party, companionType, budgetText]);

  // 등록 실패 배너(TRIP-209) — 제출 실패(`submitError`)와 **다른 축**이다. 여기 값이 있다는
  // 것은 "여행은 만들어졌고 꼭 갈 곳 일부가 등록되지 않았다"는 뜻이라, 재시도의 사정거리도
  // 다르다(등록만 다시 한다). `pendingMustVisits`가 그 사정거리다 — 실패한 poiId만 남긴다.
  const [mustVisitError, setMustVisitError] = useState<string>();
  const [pendingMustVisits, setPendingMustVisits] = useState<string[]>([]);

  // 5-c W-1·N-1: **제출 경로 잠금.** 두 뜻을 겸한다 — ① 등록 요청이 지금 날아가는 중이다
  // ② 이미 성공해 이 화면의 일이 끝났다(step1은 스택에 남아 뒤로 오면 같은 버튼이 다시
  // 눌린다). 둘 중 하나라도 참이면 `[다음]`은 여행을 새로 만들지 않고, 배너 [다시 시도]도
  // 두 번째 요청을 만들지 않는다. 등록이 실패해 화면에 남을 때만 잠금을 푼다.
  // ⚠️ `useState`가 아니라 `useRef`인 이유: 상태 갱신은 다음 렌더에야 보이므로 같은 틱에
  // 연달아 들어온 두 번째 누름이 아직 옛 값을 읽는다. ref는 쓰는 즉시 보이고, 화면에
  // 그리는 값이 아니라 리렌더도 필요 없다.
  const submitLockedRef = useRef(false);

  const createTrip = useCreateTrip();
  const savedStays = useSavedStays();

  const isAuthed = getAccessToken() !== null;
  const savedPlaces = useSavedPlaces({ isAuthed });
  // ⚠️ 게스트는 `enabled: isAuthed`라 요청이 안 나가고 `isPending`이 **영원히 true**다
  // (훅 주석의 경고). 그대로 얼굴 판정에 태우면 위저드를 딥링크로 연 게스트가 끝나지 않는
  // 자리표시를 본다 — `trips/new/**`는 `Stack.Protected` 밖이라 실제로 열린다.
  const savedPlacesLoading = isAuthed && savedPlaces.isPending;
  const savedPlaceList = savedPlaces.savedPlaces;

  // 시드는 담은 목록이 **늘어날 때마다** 다시 태우되 더하기만 한다(TRIP-288 D2 · D8). "이미
  // 채웠나"로 막던 옛 가드를 풀지 않으면 더 담기로 새로 담고 돌아와도 시드에 영영 안 들어온다.
  // 가드가 하던 두 가지 일은 다른 자리가 대신한다 — 사용자가 x로 뺀 항목은 스토어의 제외
  // 기억이, 리렌더 루프는 `mergeMustVisitSeeds`의 참조 보존이 막는다.
  // ⚠️ `mustVisitsInitialized`는 몸통이 읽지 않지만 **의존성으로 남긴다**: 위저드 셸
  // (`app/trips/new/_layout.tsx`)의 진입 초기화가 이 플래그를 내리는 것이 이 효과를 다시
  // 깨우는 유일한 신호다(React는 자식 효과를 부모보다 먼저 돌리므로, 초기화는 이 효과가 이미
  // 한 번 돈 **뒤**에 온다). 빼면 새 진입이 시드를 비우기만 하고 사용자는 빈 목록을 본다.
  useEffect(() => {
    if (savedPlacesLoading || savedPlaces.isError) {
      return;
    }
    addMustVisits(seedMustVisits(savedPlaceList));
  }, [
    mustVisitsInitialized,
    savedPlacesLoading,
    savedPlaces.isError,
    savedPlaceList,
    addMustVisits,
  ]);

  // 얼굴 판정도 실패와 별개 축이다 — 잔존 시드가 있으면 실패·로딩이 그것을 덮지 않는다.
  const mustVisitSection = resolveMustVisitSection({
    seeds: mustVisits,
    loading: savedPlacesLoading,
    failed: savedPlaces.isError,
  });

  const draft: TripDraft = {
    destinations,
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    party,
  };
  const violations = validateTripDraft(draft);

  // "기간을 이미 골랐나" — `[다음]` 게이트의 "아직 안 고름" 조각이자 등록 숙소 행의 사유 ①
  // 판정(BR-U1-41 임의 덮어쓰기 금지)이 같은 뜻으로 쓴다. 빈 문자열은 안 고른 것이다.
  const periodFilled =
    startDate !== undefined &&
    startDate !== '' &&
    endDate !== undefined &&
    endDate !== '';

  // 게이트①-2 사용자 결정 ③(03b W-5): 담은 목록이 **아직 도착 전이면 잠깐 막는다.** 그때
  // 제출하면 시드가 비어 있어 꼭 갈 곳이 한 건도 등록되지 않은 여행이 만들어지고, 그 사실이
  // 화면 어디에도 안 나타난다(침묵 실패 · BR-U1-55).
  // ⚠️ `savedPlaces.isPending`을 그대로 쓰면 안 된다 — 게스트는 요청 자체가 안 나가 그 값이
  // **영원히 참**이라 비회원이 여행을 영영 못 만든다(위저드는 `Stack.Protected` 밖이라 딥링크로
  // 실제 열린다). 얼굴 판정이 이미 쓰는 `savedPlacesLoading`(= `isAuthed && isPending`)을
  // 그대로 쓴다 — 판단을 두 벌 만들지 않는다. "아직 모른다"만 막고 "정말 0곳이다"는 통과시킨다.
  const canProceed =
    destinations.length > 0 &&
    periodFilled &&
    violations.length === 0 &&
    parsedBudget.kind !== 'invalid' &&
    !savedPlacesLoading;

  // 등록 숙소 날짜 연계(TRIP-208) — 조회·판정·문구 조립이 전부 여기 있다(화면은 완성된 얼굴만
  // 받는다, AC-13). ⚠️ **실패는 얼굴과 별개 축이다**: `isError`로 얼굴을 갈아 끼우면 이미
  // 받아 둔 목록이 지워진다(미해결 문제로그 `2026-08-04` 재발 차단 · D4 · INV-4). 판정은
  // 잔존 `data`로 그대로 돌리고, 실패는 `stayImportFailed`로 따로 내려보낸다.
  const stayImport = resolveStayImport({
    stays: savedStays.data,
    loading: savedStays.isPending,
    periodFilled,
  });

  function importStayDates(): void {
    // 화면의 `disabled`는 접근성 상태만으로도 매처를 통과할 수 있으므로 배선도 스스로 문을
    // 잠근다(`submit`·`StayRegisterPage.handleSubmit`과 같은 관례). 프리셋에서 온 날짜가
    // 아니므로 코드 자리는 비운다 — 어떤 칩도 선택 표시되지 않는다(01b D10).
    // ⚠️ 지우지 마라 — 이 가드는 판별 유니온의 **타입 좁히기**를 겸한다. 화면이 이미
    // `disabled`로 막으니 중복이라 보고 지우면 아래 두 날짜 필드 접근이 `pnpm tsc`에서
    // 깨진다. jest는 이 줄이 없어도 전량 green이라 못 잡는다(5-b 뮤테이션 실측).
    if (stayImport.kind !== 'ready') return;
    setPeriod(undefined, stayImport.checkIn, stayImport.checkOut);
  }

  // 클라 검증 → 인라인 문구. **`touched`가 켜진 축만** — 아직 아무것도 안 고른 사용자에게
  // 페일클로즈 판정을 그대로 뿌리면 AC-10을 위반한다(01b D1·D3). 서버는 기간 축을 안 낸다
  // (5-c W-1) — 인라인 기간 오류는 클라 검증 하나뿐이다.
  const periodError =
    touched.includes('period') && violations.includes('END_BEFORE_START')
      ? PERIOD_ERROR_MESSAGE
      : undefined;
  // 박수 문구는 두 축이 **모두** touched일 때만 만든다 — 날짜 미선택 상태에서 조립하면
  // `tripLength`가 `NaN`이라 "여행 기간(NaN박)"이 사용자에게 보인다(02a ★7).
  const destinationError =
    touched.includes('destinations') &&
    touched.includes('period') &&
    violations.includes('NIGHTS_EXCEED_PERIOD')
      ? `숙소 박수(${nightsSum(destinations)}박)가 여행 기간(${tripLength(draft)}박)보다 많아요`
      : undefined;

  function handleSelectPreset(code: PeriodPresetCode): void {
    const range = presetRange(code, resolvedBaseDate);
    setPeriod(code, range.startDate, range.endDate);
  }

  // blur에서 콤마를 한 번만 정리한다(01b D8). **`budgetTouched` 가드가 이 설계의 급소다**
  // — 없으면 필드를 탭했다 그냥 나가기만 해도 `setBudgetText`가 불려 touched가 켜지고,
  // 프리필이 영원히 잠긴다(01b 불변식, 02a ★1-b). 파싱 실패 값은 정리하지 않고 그대로
  // 남겨 사용자가 무엇을 잘못 썼는지 볼 수 있게 한다(AC-4의 "남아 있으면").
  // 5-c W-1: `Number.isSafeInteger`를 한 번 더 건다 — 안전 정수 범위 밖은 `String(n)`이
  // 지수 표기(`1.1e+21`)로 줄여 써서 재포맷이 사용자가 친 원문을 그 표기로 덮어써 버린다.
  // 자릿수 상한을 신설하는 게 아니라(01b ★14 그대로, 큰 값은 여전히 그대로 서버로 나간다),
  // 왕복 못 하는 재포맷만 안 하는 것이다.
  function handleBlurBudget(): void {
    if (
      budgetTouched &&
      parsedBudget.kind === 'amount' &&
      Number.isSafeInteger(parsedBudget.amount)
    ) {
      setBudgetText(formatBudgetAmount(parsedBudget.amount));
    }
  }

  /**
   * 여행이 만들어진 **뒤** 남은 시드를 등록한다(TRIP-209 · BR-U1-48 `ANYTIME` 고정).
   *
   * `Promise.allSettled` — 여러 요청을 성공·실패 상관없이 전부 기다렸다가 결과 배열을 준다.
   * `Promise.all`은 하나만 실패해도 즉시 던져 나머지 결과를 잃는데, 이 자리는 "3곳 중 1곳
   * 실패"를 **세어서 문구로** 만들어야 하므로 `all`로는 만들 수 없다.
   *
   * ⚠️ 실패해도 여행을 롤백하지 않는다(BR-U1-51 입력 보존) — 이동만 멈추고 배너를 세운다.
   * 재시도는 실패분만 다시 보낸다: 이미 성공한 건을 또 보내면 요청만 늘고, `POST /trips`를
   * 다시 보내면 사용자에게 여행이 하나 더 생긴다(되돌릴 수 없다).
   */
  async function registerMustVisits(
    tripId: string,
    poiIds: string[]
  ): Promise<void> {
    if (submitLockedRef.current) return;
    submitLockedRef.current = true;

    const results = await Promise.allSettled(
      poiIds.map((poiId) =>
        postTripsTripIdMustVisits(tripId, { poiId, type: 'ANYTIME' })
      )
    );
    const stillFailed = poiIds.filter((_, index) => {
      const result = results[index];
      return (
        result.status === 'rejected' && !isAlreadyRegistered(result.reason)
      );
    });

    setPendingMustVisits(stillFailed);
    if (stillFailed.length > 0) {
      // 화면에 남아 배너를 보여준다 — 여기서만 잠금을 푼다(배너의 [다시 시도]가 다시 타야
      // 하므로). 조용히 삼키지 않는다(INV-4). 배너는 step1에만 있으므로 이동을 멈춘다.
      submitLockedRef.current = false;
      setMustVisitError(
        mustVisitFailureNotice(poiIds.length, stillFailed.length)
      );
      return;
    }

    setMustVisitError(undefined);
    // 성공 — 잠금을 **풀지 않는다**. 이 화면의 일은 끝났고, 스택에 남은 step1으로 되돌아와
    // `[다음]`을 다시 눌러도 여행이 하나 더 만들어지면 안 된다(되돌릴 수 없다).
    router.push('/trips/new/step2');
  }

  function retryMustVisits(): void {
    if (createdTripId === undefined || pendingMustVisits.length === 0) return;
    void registerMustVisits(createdTripId, pendingMustVisits);
  }

  async function submit(): Promise<void> {
    // 버튼이 비활성이면 눌리지 않지만, 배선도 스스로 판정을 다시 걷는다(`StayRegisterPage.
    // handleSubmit`과 같은 이유). `isPending`도 함께 건다 — 응답이 오기 전 두 번째 호출이
    // 두 번째 요청을 만들지 않아야 한다(AC-6). 새 상태를 따로 만들지 않고 생성 훅이 이미
    // 노출하는 값을 그대로 쓴다(01b Seed §기존 활용). 5-c W-1: `isPending`은 **생성** 요청만
    // 덮는다 — 생성이 끝나고 등록이 날아가는 창(수백 ms~수 초, 화면에 아무 변화가 없다)은
    // `submitLockedRef`가 덮는다. 그 창에서 다시 누르면 여행이 하나 더 만들어진다.
    if (!canProceed || createTrip.isPending || submitLockedRef.current) return;

    // 여행은 이미 만들어졌고 등록만 남았다 — 여기서 `POST /trips`를 다시 태우면 사용자에게
    // 여행이 하나 더 생긴다(되돌릴 수 없다). 남은 일(등록)만 이어서 한다.
    if (createdTripId !== undefined && pendingMustVisits.length > 0) {
      await registerMustVisits(createdTripId, pendingMustVisits);
      return;
    }

    setSubmitError(undefined);
    setOverseasBlocked(false);

    const input: CreateTripInput = {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      party,
      companionType,
      destinations,
      // 사용자가 넣은 값만 나간다(TRIP-207 AC-2) — 취향은 이 함수에 더 이상 안 보인다.
      // `empty`면 `undefined`라 키 자체가 안 붙는다(`buildCreateTripRequest`가 스프레드
      // 전에 떼어내 조건부로만 다시 붙인다, ★3).
      budgetTotal:
        parsedBudget.kind === 'amount' ? parsedBudget.amount : undefined,
    };

    // 5-c W-2: `try`의 사정거리를 요청 한 줄로 좁힌다. 성공 뒤 부작용(id 기록·라우팅)에서
    // 난 예외까지 여기서 받으면, 이미 만들어진 여행이 "네트워크 실패"로 보이고 사용자가
    // 다시 시도를 눌러 여행이 하나 더 만들어진다 — 되돌릴 수 없는 중복이다.
    let trip: Awaited<ReturnType<typeof createTrip.mutateAsync>>;
    try {
      trip = await createTrip.mutateAsync({
        data: buildCreateTripRequest(input),
      });
    } catch (error) {
      const failure = classifyServerFailure(error);
      if (failure === 'overseas') {
        setOverseasBlocked(true);
      } else {
        // 미상 코드·미상 필드·응답 자체 없음 — 전부 여기로 떨어진다. 조용히 삼키지 않는다.
        setSubmitError(SUBMIT_ERROR_MESSAGE);
      }
      return;
    }

    // g02(TRIP-84·TRIP-193)가 읽는 소비자다 — 라우트가 id를 안 나른다(01b D7).
    setCreatedTripId(trip.tripId);

    // ↓ 여기서부터는 위 `try` 바깥이다. 여행은 이미 만들어졌으므로 아래에서 나는 실패는
    // 등록 실패지 생성 실패가 아니다. 이동(2/2, g02 · TRIP-84)은 등록이 끝난 뒤에만 한다 —
    // 제출은 드래프트를 비우지 않는다(TRIP-209 01b D6). 드래프트를 되돌리는 자리는 위저드
    // **진입**뿐이고 거기서도 시드 3필드만이다(셸의 `resetMustVisits`, TRIP-288 D1).
    // ⚠️ 시드를 여기서 **다시 읽는다**: `mustVisits`는 `[다음]`을 누른 순간 렌더의 값이라,
    // `await` 동안 담은 목록이 도착해 시드가 늘어도 옛 값 그대로다 — 화면에 보이는 꼭 갈 곳이
    // 한 건도 등록되지 않고 조용히 2/2로 넘어간다. 위 `submitLockedRef`가 처리한 것과 같은
    // 사고("지금 값은 다음 렌더에야 보인다")다.
    await registerMustVisits(
      trip.tripId,
      useTripWizardStore.getState().mustVisits.map((seed) => seed.sourcePoiId)
    );
  }

  return (
    <TripWizardStep1Screen
      destinations={destinations}
      startDate={startDate}
      endDate={endDate}
      presetCode={presetCode}
      party={party}
      companionType={companionType}
      preferenceChips={preferenceChips}
      regions={REGIONS}
      canProceed={canProceed}
      destinationError={destinationError}
      periodError={periodError}
      submitError={submitError}
      overseasBlocked={overseasBlocked}
      stayImport={stayImport}
      stayImportFailed={savedStays.isError}
      onImportStayDates={importStayDates}
      onPressRegisterStay={() => router.push('/stays/register')}
      onRetryStayImport={() => void savedStays.refetch()}
      mustVisitSection={mustVisitSection}
      mustVisitSeedFailed={savedPlaces.isError}
      savedPlaceCount={savedPlaceList.length}
      mustVisitError={mustVisitError}
      onRemoveMustVisit={removeMustVisit}
      onPressMoreMustVisits={() =>
        // 담은 곳이 있으면 그것들을 모아 고르는 담은 장소 화면(d02)으로, 없으면 새로 담을 탐색으로
        // 보낸다 — 담아둔 게 늘수록 탐색에서 다시 찾는 비용이 커지는 것을 막는다(TRIP-367).
        router.push(
          savedPlaceList.length > 0
            ? '/explore/saved-places'
            : '/explore/places'
        )
      }
      onRetryMustVisitSeeds={() => void savedPlaces.refetch()}
      onRetryMustVisits={retryMustVisits}
      budgetText={effectiveBudgetText}
      budgetPrefilled={budgetPrefilled}
      budgetError={budgetError}
      onChangeBudget={setBudgetText}
      onBlurBudget={handleBlurBudget}
      onBack={() => router.back()}
      onAddDestination={addDestination}
      onRemoveDestination={removeDestination}
      onSelectPreset={handleSelectPreset}
      onPressPeriod={() => setDateSheetOpen(true)}
      dateSheetOpen={dateSheetOpen}
      onCloseDateSheet={() => setDateSheetOpen(false)}
      onConfirmDates={(start, end) => setPeriod(undefined, start, end)}
      baseDate={resolvedBaseDate}
      onChangeParty={setParty}
      onSelectCompanion={(type: CompanionType) => selectCompanion(type)}
      onChangePreference={() => {}}
      onNext={submit}
      onRetrySubmit={submit}
      onCloseOverseasDialog={() => setOverseasBlocked(false)}
      onPickDomesticRegion={() => setOverseasBlocked(false)}
    />
  );
}
