import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApplyReplan } from '@/features/apply-replan';
import { firstCoPickSlotKey } from '@/features/itinerary';
import { pollIntervalMs } from '@/features/itinerary';
import { useGenerationBusy } from '@/features/itinerary';
import { useStartReplan } from '@/features/request-replan';
import { GeneratingScreen, type AiLimitRetryAt } from './GeneratingScreen';
import type {
  GenerateItineraryRequestGenerationMode,
  Itinerary,
} from '@/shared/api/index.schemas';
import {
  getGetTripsTripIdItineraryQueryKey,
  resolveGenerationRefused,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
  useGetTripsTripIdReplanSessionsSessionId,
  usePostTripsTripIdItinerary,
} from '@/shared/api/index.hooks';
import { isDateInRange } from '@/shared/lib/monthGrid';
import { seoulDate, seoulTime } from '@/shared/lib/seoulDate';
import { useElapsedFlag } from '@/shared/lib/useElapsedFlag';
import {
  isNotFound,
  isGenerationDailyLimit,
  retryAfterSeconds,
} from '@/shared/api';
import { showToast } from '@/shared/ui/Toast';

const LEAVE_TOAST_MESSAGE = '백그라운드에서 계속 만들고 있어요';
const PLANB_HANDOFF_TOAST_MESSAGE = '여행 중이라 재계획으로 다시 짜요';
const NO_SOLUTION_MESSAGE =
  '지금 바꿀 수 있는 곳을 찾지 못했어요. 원래 일정을 그대로 둘게요.';
const REPLAN_STOPPED_TOAST_MESSAGE =
  '다시 짜기를 멈췄어요. 원래 일정을 그대로 둘게요.';
/**
 * 재계획 대기 상한 2분(#1235 사후 리뷰 B2). 서버엔 SOLVING 만료·스윕이 없어(`@Async` 메모리 실행 — 파드 재시작이면
 * 세션이 SOLVING 에 남는다) 클라가 끊는다(INV-4). 값 = 재계획 AI 시한 25초 + 백엔드 수집·조립·큐 여유. i12 의 8분
 * (`planb-draft/model/replanPollCap`)보다 짧은 이유: 이 화면은 생성 진행 얼굴이라 사용자가 붙잡혀 기다린다.
 */
const REPLAN_WAIT_CAP_MS = 2 * 60 * 1000;

/** 429 의 Retry-After(초) → 풀리는 KST 시각. 헤더 없음·깨진 값이면 null(시각 없이 안내, INV-4). */
function resolveRetryAt(error: unknown, now: Date): AiLimitRetryAt | null {
  const seconds = retryAfterSeconds(error);
  if (seconds === null) return null;
  const at = new Date(now.getTime() + seconds * 1000);
  return {
    day: seoulDate(at) === seoulDate(now) ? '오늘' : '내일',
    time: seoulTime(at),
  };
}

/**
 * h09 배선(TRIP-305) — 생성 POST 를 소유·발화하고 진행/성공/실패/이탈을 화면에 잇는다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **`mode` 가 있으면 마운트 시 POST 를 정확히 1회 쏜다.** `{ generationMode: mode }` 하나만 담는다
 *     (여분 키 0, BR-U3-03). 완전AI 씨앗은 `FULLY_AI`, copick 씨앗은 `CO_PLAN` 을 명시해 넘긴다
 *     (TRIP-462 · TRIP-1006 A5). **`mode` 가 없으면 관찰 모드**다(아래 `ObserveGeneration`, TRIP-1006
 *     A3·A4) — 이미 도는 생성을 다시 쏘지 않고 일정 GET 만 한다. 모드를 기본값으로 지어내면 재진입이
 *     생성을 다시 돌려 같이 짜기로 고른 슬롯을 덮는다(#083 · INV-4).
 *     `firedRef` 가드가 필요한 이유: react-query 반환 객체와 목 router 가 렌더마다 새 객체라 effect
 *     의존성이 매번 바뀌어 effect 가 재실행돼도 두 번 쏘지 않게 한다.
 *  2. **성공(201, day1 PARTIAL)이면 `successRoute` 로 `router.replace`.** 기본 draft(h11), copick
 *     씨앗은 허브(h16)를 주입받는다(TRIP-462). push 가 아니라 replace — 뒤로가면 생성 화면으로
 *     돌아오지 않게. 이후 PARTIAL→COMPLETE 폴링은 목적지 페이지 소관(중복 제거).
 *  3. **오류는 침묵하지 않는다(INV-4).** `isError` 를 화면에 내려 실패 표면을 띄우고, [다시 시도]가
 *     POST 를 재발화한다.
 *  4. **POST 경로는 자기 세션 GET 폴링·cancel 을 쓰지 않는다.** in-flight 라 sessionId 가 없다(Seed
 *     결정 3). 일정 GET 은 관찰 모드 가지(`ObserveGeneration`)에서만 부른다 — 그 가지는 mode 가 없을
 *     때만 마운트되므로 POST 경로는 여전히 GET 을 모른다. **예외(TRIP-1032)**: POST 가 409
 *     `GENERATION_IN_PROGRESS` 면 안내를 띄우고, 사용자가 [취소하고 새로 만들기]를 누를 때만 **다른
 *     여행**(`activeTripId`)의 일정 GET → cancel → 같은 body 로 재POST 한다(`useGenerationBusy`).
 *  5. **진행 중 이탈 토스트(TRIP-1046).** 화면이 트리에서 빠질 때(‹ replace·스와이프 pop 모두
 *     언마운트) 마지막 렌더가 진행 중이고 성공 콜백 전이면 한 번 알린다. 발화는 언마운트 한 곳뿐 —
 *     `goHome` 은 409 [기다리기]·관찰 모드와 공유라 거기 넣으면 거짓 토스트가 샌다. 성공 표지는
 *     호출별 onSuccess 첫 줄: replace 가 결과 재렌더보다 먼저 화면을 내릴 수 있어서다.
 *  6. **AI 일일 한도(TRIP-1314 서버 · TRIP-1368 수신).** POST 가 429 면 일반 실패가 아니라 한도 얼굴
 *     (`ai-limit-notice`, [직접 짜기 이어가기]·[닫기] — [다시 시도] 없음)을 띄운다. 429 **이면서** 오류 코드가
 *     `GENERATION_DAILY_LIMIT` 일 때만이다(`isGenerationDailyLimit`) — RATE_LIMITED 같은 짧은 429·코드 없는 429 는
 *     일반 실패(재시도 가능)로 간다. 풀리는 시각은 `Retry-After`(초)로 계산하며 헤더가 없으면 시각 없이 안내한다.
 *     한도는 서버 몫이라 클라는 세지 않는다 — 기기 로컬 카운터(TRIP-1268 임시 장치)는 이 칸에서 삭제됐다.
 *  7. **재계획 모드(`replan`, 2026-10-14 사용자 결정).** 여행 중 [다시 짜기]는 모달(i04) 없이 여기서 재계획을
 *     돌려 **확인 없이 바로 반영**하고 추천안으로 간다(`ReplanGeneration`). POST 경로·관찰 모드는 건드리지 않는다.
 */
export function GeneratingPage({
  tripId,
  mode,
  successRoute = '/trips/[tripId]/itinerary/draft',
  targetDate,
  replan = false,
}: {
  tripId: string;
  /** 생성 모드. 미지정=관찰 모드(POST 0, GET 만 — TRIP-1006). 완전AI 는 FULLY_AI, copick 씨앗은
   * CO_PLAN 을 명시해 넘긴다(TRIP-462). */
  mode?: GenerateItineraryRequestGenerationMode;
  /** 성공 후 목적지 pathname. 미지정=draft(h11). copick 씨앗(TRIP-504)은 첫 슬롯 라우트 템플릿을
   * 넘기고, 이 화면이 생성 응답의 days 로 실 slotKey 를 채워 replace 한다.
   * (허브 라우트 `copick`(index)은 TRIP-796으로 삭제됨 — 죽은 유니온 멤버도 함께 제거.) */
  successRoute?:
    | '/trips/[tripId]/itinerary/draft'
    | '/trips/[tripId]/itinerary/copick/[slotKey]';
  /** 여행 중 거절(409)로 재계획에 넘길 때 다시 짤 날. 미지정=오늘. 초안에서 오늘 뒤의 날을 보며 눌렀을 때 실린다. */
  targetDate?: string;
  /** 재계획 모드 — 생성 POST 대신 재계획 세션을 열고 초안이 나오면 바로 반영한다(`ReplanGeneration`). */
  replan?: boolean;
}): ReactElement {
  const router = useRouter();
  // 캐시 반영은 훅 옵션 자리에 둔다 — `mutate(…, { onSuccess })` 콜백은 화면이 떠나면 불리지 않아,
  // 생성 중 홈으로 이탈하면 홈이 들고 있던 404 가 남는다(TRIP-1015 A · QA #046).
  const generate = usePostTripsTripIdItinerary({
    mutation: {
      onSuccess: (data, vars, _onMutateResult, context) => {
        context.client.setQueryData(
          getGetTripsTripIdItineraryQueryKey(vars.tripId),
          data
        );
      },
    },
  });
  const firedRef = useRef(false);
  const succeededRef = useRef(false);
  const pendingRef = useRef(false);
  pendingRef.current = generate.isPending;
  useEffect(
    () => () => {
      if (pendingRef.current && !succeededRef.current) {
        showToast({
          message: LEAVE_TOAST_MESSAGE,
          testID: 'itinerary-generating-background-toast',
        });
      }
    },
    []
  );

  const fire = useCallback(() => {
    if (mode === undefined) return;
    generate.mutate(
      { tripId, data: { generationMode: mode } },
      {
        onSuccess: (data: Itinerary) => {
          succeededRef.current = true;
          // copick 씨앗은 허브가 아니라 **첫 비고정 슬롯**의 SlotFillPage 로 착지한다(01b 순회 세부,
          // AC-6). h05 는 slotKey 를 몰라 템플릿만 실어 보내므로, 채우는 것은 이 화면이다 — 생성
          // 응답이 곧 생성된 일정(days 포함, `customInstance<Itinerary>`)이라 별도 GET 불요.
          if (successRoute === '/trips/[tripId]/itinerary/copick/[slotKey]') {
            const slotKey = firstCoPickSlotKey(data.days);
            if (slotKey === null) {
              // 채울 비고정 슬롯이 하나도 없다(전부 고정) — 순회할 것이 없으니 곧장 h17(완성 확인).
              router.replace({
                pathname: '/trips/[tripId]/itinerary/copick/complete',
                params: { tripId },
              });
              return;
            }
            router.replace({
              pathname: '/trips/[tripId]/itinerary/copick/[slotKey]',
              params: { tripId, slotKey },
            });
            return;
          }
          // TRIP-1385 — 방금 만든 완성 일정을 처음 여는 순간에만 공개 모션을 켠다(관찰 모드·목록 진입은 안 싣는다).
          router.replace({
            pathname: successRoute,
            params: { tripId, reveal: '1' },
          });
        },
      }
    );
  }, [generate, router, tripId, mode, successRoute]);

  const busy = useGenerationBusy(generate.error, fire);
  // 서버 규칙 거절(여행 중·끝난 여행 재생성 409) — 다시 보내도 같은 답이다. 여행 중이면 다시 짜기는 Plan-B 의
  // 몫이라(서버 규칙의 근거, 다녀온 슬롯을 잠근다) 막다른 얼굴 대신 이 화면을 재계획 모드로 다시 연다(모달 없음).
  // 같은 라우트여도 replace 는 새 키의 화면을 만든다(StackRouter REPLACE) — 재계획 가지가 새로 마운트돼 시작한다.
  // 기간은 거절됐을 때만 묻고, 끝난 여행(재계획도 409)·기간 모름이면 서버 사유 + [닫기]만(INV-4).
  const aiLimited = isGenerationDailyLimit(generate.error);
  const refusal = resolveGenerationRefused(generate.error);
  const trip = useGetTripsTripId(tripId, {
    query: { enabled: refusal !== null, retry: false },
  });
  const inTrip =
    trip.data !== undefined &&
    isDateInRange(
      seoulDate(new Date()),
      trip.data.startDate,
      trip.data.endDate
    );
  const handOffToPlanB = refusal !== null && (trip.isPending || inTrip);
  const handedOffRef = useRef(false);
  useEffect(() => {
    if (refusal === null || !inTrip || handedOffRef.current) return;
    handedOffRef.current = true;
    showToast({
      message: PLANB_HANDOFF_TOAST_MESSAGE,
      testID: 'itinerary-generating-planb-handoff-toast',
    });
    router.replace({
      pathname: '/trips/[tripId]/itinerary/generating',
      params:
        targetDate === undefined
          ? { tripId, replan: '1' }
          : { tripId, replan: '1', targetDate },
    });
  }, [refusal, inTrip, router, tripId, targetDate]);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    fire();
  }, [fire]);

  // 앱바 뒤로 = 백그라운드 이탈(화면만 홈으로). 관찰 모드도 같은 결이다.
  const goHome = (): void => {
    // TRIP-1243 — replace 는 현재 화면 하나만 바꿔 끼워 아래 위저드 화면(3/4 등)이 스택에 남는다.
    // dismissTo 는 스택의 그 경로까지 사이 화면을 걷어낸다(없으면 현재 화면을 그 경로로 replace).
    router.dismissTo('/(tabs)');
  };

  if (replan) {
    return (
      <ReplanGeneration
        tripId={tripId}
        targetDate={targetDate}
        onClose={goHome}
      />
    );
  }

  if (mode === undefined) {
    return <ObserveGeneration tripId={tripId} onBackground={goHome} />;
  }

  return (
    <GeneratingScreen
      aiLimit={
        aiLimited
          ? {
              retryAt: resolveRetryAt(generate.error, new Date()),
              onContinueManual: () =>
                router.replace({
                  pathname: '/trips/[tripId]/itinerary/manual',
                  params: { tripId },
                }),
              onClose: goHome,
            }
          : null
      }
      refused={
        refusal && !handOffToPlanB
          ? { message: refusal.message, onClose: goHome }
          : null
      }
      // Plan-B 로 넘기는 중(기간 조회·이동)엔 실패 얼굴을 비추지 않는다 — 진행 표면 그대로 넘어간다.
      failed={generate.isError && !handOffToPlanB}
      busy={busy && { ...busy, onWait: goHome }}
      onRetry={fire}
      onBackground={() => {
        // 앱바 뒤로 = 백그라운드 이탈(화면만 홈으로). 뮤테이션은 리셋하지 않는다 — 이미 나간
        // POST 는 언마운트로 취소되지 않아(axios+react-query) 서버가 백그라운드에서 일정을 완성한다
        // (Seed·openapi 767). 홈으로 보내는 이유: 일정 탭은 trips[0] 로 리다이렉트해 생성 중인 여행이
        // 아닌 옛 일정에 착지할 수 있다(traps-itinerary ③, 팀 확정 2026-09-11). [취소]=CANCELED(구
        // BR-U3-05)는 팀 확정으로 제거 — canon BR-U3-04/05 도 "취소 없음"으로 갱신됨(TRIP-789).
        goHome();
      }}
    />
  );
}

/**
 * TRIP-1006 · 관찰 모드 — 일정 탭 카드·홈 CTA 가 완전 AI 생성 중(PARTIAL) 여행을 다시 열 때 온다(D2).
 * 생성 POST 를 **쏘지 않고** 일정 GET 한 번의 결과로만 움직인다(Q1):
 *  - 일정이 있으면(PARTIAL·COMPLETE·FAILED 전부) 곧장 초안(h11)으로 replace — 1일차가 이미 있으니
 *    스피너로 가리지 않고(BR-U3-04), 남은 폴링은 초안 화면 몫이다.
 *  - 404(관찰할 생성이 없다)면 생성 방식(h01)으로 replace.
 *  - 그 밖의 조회 실패는 실패 얼굴로 말하고(INV-4), [다시 시도]는 **GET 만** 다시 한다(A6).
 *
 * 별도 컴포넌트인 이유: 훅은 조건부로 부를 수 없다. mode 가 없을 때만 이 컴포넌트가 마운트되므로
 * 일정 GET 훅도 그때만 불린다(홈 `PlanningHome` 의 조건부 자식과 같은 패턴).
 */
function ObserveGeneration({
  tripId,
  onBackground,
}: {
  tripId: string;
  onBackground: () => void;
}): ReactElement {
  const router = useRouter();
  const itinerary = useGetTripsTripIdItinerary(tripId);
  const notFound = isNotFound(itinerary.error);
  const movedRef = useRef(false);

  useEffect(() => {
    // 목적지가 정해지는 순간 한 번만 이동한다(리렌더로 replace 가 두 번 나가지 않게).
    if (movedRef.current) return;
    if (itinerary.data !== undefined) {
      movedRef.current = true;
      router.replace({
        pathname: '/trips/[tripId]/itinerary/draft',
        params: { tripId },
      });
    } else if (notFound) {
      movedRef.current = true;
      router.replace({
        pathname: '/trips/[tripId]/itinerary/method',
        params: { tripId },
      });
    }
  }, [itinerary.data, notFound, router, tripId]);

  return (
    <GeneratingScreen
      failed={itinerary.isError && !notFound}
      onRetry={() => {
        void itinerary.refetch();
      }}
      onBackground={onBackground}
    />
  );
}

/** 시작 POST 의 규칙 거절(400·409 — 지난 날·기간 밖·일정 없는 날)이면 서버 사유. 다시 보내도 같아 [닫기]만. */
function startRefusal(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const status = error.response?.status;
  if (status !== 400 && status !== 409) return null;
  const message = (
    error.response?.data as { error?: { message?: unknown } } | undefined
  )?.error?.message;
  return typeof message === 'string' && message !== '' ? message : null;
}

/**
 * 재계획 모드(2026-10-14 사용자 결정) — 여행 중 [다시 짜기]가 모달(i04)로 가지 않고 여기로 온다.
 *  1. 마운트 때 재계획 세션을 **1회** 연다. 사유·방향은 묻지 않는다(`JUST_CHANGE` 하나). 위치도 읽지 않는다 —
 *     `originKind: null` 이면 서버가 사다리로 정한다(openapi StartReplanRequest.originKind). 보던 날이 오면 그 날 하루
 *     전체(FULL_DAY — 오늘이 아닌 날은 서버가 FULL_DAY 만 받는다), 없으면 오늘 지금 이후(PARTIAL_SLOTS).
 *  2. 세션을 COLLECTING·SOLVING 동안 폴링한다. 간격·오류 정지는 `planb-draft` 의 `useReplanSession` 과 같고,
 *     상한은 i12 의 8분(`replanPollCap`) 대신 **2분**(`REPLAN_WAIT_CAP_MS`)이다 — 넘으면 조회를 끄고 실패 얼굴로
 *     간다. 상한은 서버 `createdAt` 이 아니라 이 화면이 세션 id 를 받은 때부터 잰다(이 화면이 방금 연 세션이라 둘이
 *     거의 같고, 2분 규모에선 기기·서버 시계 차이가 판정을 흔들 수 있다). 세션 id 를 받기 전·첫 조회는 axios 15초
 *     timeout 이 끊어 실패 얼굴로 가므로 상한이 필요 없다. pages 끼리 import 금지라 이 칸에 둔다.
 *  3. DRAFT 가 되면 **확인 없이 바로** apply(세션당 1회) → 성공하면 추천안(draft)을 **다시 짠 날**(`day` = 보던 날,
 *     없으면 오늘)로 replace. 원 일정은 서버가 반영 전에 복원 지점을 남긴다(openapi apply). DRAFT 를 보기 전에 ‹ 로
 *     떠나면 폴링이 멈춰 아무것도 반영되지 않는다(원 일정 그대로 — 토스트로 말한다). apply 요청이 이미 나간 뒤에
 *     떠나면 서버엔 반영되고 화면 이동만 없다 — 그때는 "원래 일정 그대로" 토스트를 띄우지 않는다(거짓이 된다).
 *  4. 얼굴은 생성과 같은 화면이다. 시작 거절(400·409)·대안 없음 = 사유 + [닫기]. 실패(FAILED·CANCELED·조회 오류·
 *     시작 실패·반영 실패·대기 상한) = 실패 얼굴 + [다시 시도](처음부터 새 세션 — 열린 세션은 새 요청이 닫는다,
 *     INV-U4-06). INV-4.
 *  5. 시작 거절 판정(`startRefusal`)은 `shared/api` `resolveGenerationRefused` 의 근친이다. 따로 둔 이유: 재계획 409 엔
 *     `GENERATION_IN_PROGRESS` 가 없고 400(지난 날·기간 밖)도 같은 막다른 얼굴이라 코드 필터 없이 400·409 를 본다.
 */
function ReplanGeneration({
  tripId,
  targetDate,
  onClose,
}: {
  tripId: string;
  targetDate?: string;
  onClose: () => void;
}): ReactElement {
  const router = useRouter();
  const start = useStartReplan();
  const apply = useApplyReplan();
  const [sessionId, setSessionId] = useState<string | null>(null);
  // 세션을 연 지 2분이 지나면 true — 재시도(새 세션)면 0부터 다시 잰다.
  const overCap = useElapsedFlag(
    sessionId !== null,
    REPLAN_WAIT_CAP_MS,
    sessionId
  );
  const session = useGetTripsTripIdReplanSessionsSessionId(
    tripId,
    sessionId ?? '',
    {
      query: {
        // 생성 훅의 기본 enabled 는 빈 문자열도 통과시킨다 — 세션을 받기 전엔 묻지 않는다.
        // 상한에 닿으면 끈다 — 폴링도, 포커스 복귀 재조회(실패 얼굴 뒤 늦은 DRAFT 를 몰래 반영)도 멈춘다.
        enabled: sessionId !== null && !overCap,
        refetchInterval: (query) => {
          // 오류로 떨어지면 선다 — 옛 SOLVING 이 남아 서버가 죽어 있는 동안 영구 폴링하지 않게(TRIP-1348 선례).
          if (query.state.status === 'error') return false;
          const status = query.state.data?.status;
          return status === 'COLLECTING' || status === 'SOLVING'
            ? pollIntervalMs(query.state.dataUpdateCount)
            : false;
        },
      },
    }
  );
  const status = session.data?.status;
  // 상한에 닿으면 실패로 판정하기 **전에 한 번 더** 묻는다 — 앱이 뒤로 간 사이(주기 조회가 선다) 서버가 이미 끝냈으면
  // 실패 얼굴 대신 그대로 반영한다(바로 반영이 사용자 결정, #1248 리뷰 W-A). `refetch` 는 `enabled:false` 여도 나간다.
  const finalCheckRef = useRef<string | null>(null);
  const [finalChecked, setFinalChecked] = useState<string | null>(null);
  useEffect(() => {
    if (!overCap || sessionId === null || finalCheckRef.current === sessionId)
      return;
    finalCheckRef.current = sessionId;
    void session.refetch().finally(() => setFinalChecked(sessionId));
  }, [overCap, sessionId, session]);
  // 상한은 마지막 확인 뒤에도 아직 짜는 중일 때만 실패다 — 결과(DRAFT·NO_SOLUTION 등)가 왔으면 그 얼굴이 이긴다.
  const capped =
    overCap &&
    finalChecked === sessionId &&
    (status === 'COLLECTING' || status === 'SOLVING');

  const begin = useCallback(() => {
    setSessionId(null);
    apply.reset();
    start.mutate(
      {
        tripId,
        data: {
          scope: targetDate ? 'FULL_DAY' : 'PARTIAL_SLOTS',
          targetDate: targetDate ?? null,
          originKind: null,
          reasons: ['JUST_CHANGE'],
          directives: [],
        },
      },
      { onSuccess: (created) => setSessionId(created.sessionId) }
    );
  }, [start, apply, tripId, targetDate]);

  // firedRef 와 같은 이유 — 훅 반환 객체가 렌더마다 새로 와 effect 가 다시 돌아도 한 번만 연다.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    begin();
  }, [begin]);

  // 세션당 한 번만 반영한다 — 폴링·리렌더가 effect 를 다시 돌려도 apply 가 두 번 나가지 않게.
  const appliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'DRAFT' || sessionId === null) return;
    if (appliedRef.current === sessionId) return;
    appliedRef.current = sessionId;
    apply.mutate(
      { tripId, sessionId },
      {
        // 다시 짠 날로 연다 — 첫 날로 열리면 여행 2일차 이후엔 바뀐 게 안 보인다(#1235 사후 리뷰 W2).
        onSuccess: () =>
          router.replace({
            pathname: '/trips/[tripId]/itinerary/draft',
            params: { tripId, day: targetDate ?? seoulDate(new Date()) },
          }),
      }
    );
  }, [status, sessionId, apply, router, tripId, targetDate]);

  const refusal = startRefusal(start.error);
  return (
    <GeneratingScreen
      refused={
        refusal !== null
          ? { message: refusal, onClose }
          : status === 'NO_SOLUTION'
            ? { message: NO_SOLUTION_MESSAGE, onClose }
            : null
      }
      failed={
        (start.isError && refusal === null) ||
        session.isError ||
        status === 'FAILED' ||
        // 다른 요청이 이 세션을 닫았다(INV-U4-06) — 폴링이 멈춘 채 진행 얼굴로 남지 않게.
        status === 'CANCELED' ||
        apply.isError ||
        capped
      }
      onRetry={begin}
      onBackground={() => {
        // ‹ = 이 재계획을 버린다(생성의 ‹ 는 백그라운드로 계속) — 같은 얼굴이라 말해 준다(#1235 사후 리뷰 W5).
        // 반영 요청이 이미 나갔으면 서버가 반영할 수 있어 "그대로 둘게요"가 거짓이 된다 — 그때는 말하지 않는다.
        if (!apply.isPending) {
          showToast({
            message: REPLAN_STOPPED_TOAST_MESSAGE,
            testID: 'itinerary-generating-replan-stopped-toast',
          });
        }
        onClose();
      }}
    />
  );
}
