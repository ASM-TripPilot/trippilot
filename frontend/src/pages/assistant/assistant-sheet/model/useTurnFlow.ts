import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useGetMeLocationConsent } from '@/shared/api/index.hooks';
import { usePressLock } from '@/shared/lib/pressGuard';
import { readDevicePosition } from '@/shared/location';

import type { AssistantSurface, TurnInput } from '../api/assistantContract';
import { isAssistantApiError } from '../api/assistantPort';
import { useSendTurn } from './assistantQueries';
import { newClientTurnId } from './clientTurnId';
import { isSlowTurn, secondsLeft } from './turnTiming';

/**
 * 보내는 턴의 상태(TRIP-1326 · frontend-components §3 · BR-U8-21·44 · INV-U8-05).
 *
 * - `clientTurnId` 는 **보내기 직전 1회** 만들고, 실패·취소 뒤 [다시 보내기]에 그대로 다시 쓴다 — 서버가 이미
 *   처리했으면 같은 응답을 돌려준다(멱등).
 * - 보내는 동안 사용자 발화를 낙관 말풍선으로 보인다. 실패(저장 실패·네트워크)·대기 취소면 그 말풍선이
 *   "보내지 못함 · 다시 보내기"로 바뀐다. 취소는 클라 중단이라 서버 결과는 다음 조회에서 합쳐진다.
 * - 보내는 중엔 새 턴을 막는다(ref 잠금 — 같은 이벤트 루프의 연타도 1회).
 * - 15s 가 지나면 `slow`(진행 표시 유지 + [대기 취소] 강조). 429 면 Retry-After 초 동안 막고 남은 초를 센다.
 * - 현재 위치(U8 O-U8-5): 위치 동의가 켜지면 단말 위치를 **한 번** 읽어 두고(권한 팝업 없음), 보내는 턴마다 그 값을
 *   `deviceLocation` 으로 싣는다. 아직 안 왔으면 기다리지 않고 위치 없이 보낸다 — "오늘 날씨" 가 여행 없이도 답하게 하는 재료다.
 * - 웹 예외: 브라우저 위치 권한은 온보딩(폰)과 따로라 한 번도 안 물어진 채 남는다. 위치 없이 날씨를 **처음** 물으면 그 턴만
 *   권한 창을 한 번 띄우고(마운트당 1회) 답을 기다렸다가 싣는다 — 수원에 있는데 일정의 청계천 날씨가 나왔다(2026-11-06).
 */

interface PendingTurn {
  clientTurnId: string;
  input: TurnInput;
  /** 말풍선에 보일 문구(TEXT 는 원문, ACTION 은 quick reply 라벨). */
  text: string;
  status: 'SENDING' | 'FAILED';
}

export interface TurnFlow {
  pending: PendingTurn | null;
  inFlight: boolean;
  slow: boolean;
  /** 429 로 막힌 남은 초 — 0 이면 막히지 않음. */
  rateLimitedSeconds: number;
  send: (input: TurnInput, text: string) => void;
  resend: () => void;
  cancel: () => void;
}

export function useTurnFlow(
  sessionId: string | undefined,
  surface: AssistantSurface,
  onRestoreDraft: (text: string) => void
): TurnFlow {
  const sendTurn = useSendTurn(sessionId);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlightLock = usePressLock();
  const abortRef = useRef<AbortController | null>(null);

  // 위치 동의는 서버 값만 본다 — 조회 중·실패는 꺼짐이다. 켜지는 순간 한 번만 읽는다(같은 마운트에서 다시 안 읽음).
  const consentOn = useGetMeLocationConsent().data?.legalConsent === true;
  const hereRef = useRef<{ lat: number; lng: number } | null>(null);
  const hereAskedRef = useRef(false);
  const webAskedRef = useRef(false);
  // 묻기를 기다리는 사이 시트가 닫혔는지 — 닫힌 뒤에 새 요청을 시작하지 않는다(대기 중 언마운트, traps-execution).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!consentOn || hereAskedRef.current) return;
    hereAskedRef.current = true;
    void readDevicePosition().then((coords) => {
      hereRef.current = coords;
    });
  }, [consentOn]);

  // 시계 — 보내는 중(15s 판정)이거나 429 로 막힌 동안만 1초마다 다시 그린다.
  const ticking = startedAt !== null || rateLimitedUntil !== null;
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const rateLimitedSeconds =
    rateLimitedUntil === null ? 0 : secondsLeft(rateLimitedUntil, now);
  useEffect(() => {
    if (rateLimitedUntil !== null && rateLimitedSeconds === 0) {
      setRateLimitedUntil(null);
    }
  }, [rateLimitedUntil, rateLimitedSeconds]);

  function dispatch(turn: PendingTurn): void {
    // 전환은 안 본다 — 호출부가 입력칸을 비운 뒤라 전환 때문에 빠지면 쓴 글이 사라진다. 연타는 잠금이 막는다.
    if (!sessionId || !inFlightLock.acquire({ transition: 'ignore' })) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPending({ ...turn, status: 'SENDING' });
    setStartedAt(Date.now());
    setNow(Date.now());
    const post = (): void => {
      const here = consentOn ? hereRef.current : null;
      sendTurn.mutate(
        {
          request: {
            clientTurnId: turn.clientTurnId,
            input: turn.input,
            screen: { surface },
            ...(here ? { deviceLocation: here } : {}),
          },
          signal: controller.signal,
        },
        {
          onSuccess: () => setPending(null),
          onError: (error) => {
            if (isAssistantApiError(error) && error.code === 'RATE_LIMITED') {
              // 서버가 턴을 기록하지 않았다 — 말풍선을 거두고 입력을 돌려준다.
              setPending(null);
              if (turn.input.type === 'TEXT') onRestoreDraft(turn.text);
              const at = Date.now();
              setNow(at);
              setRateLimitedUntil(at + (error.retryAfterSeconds ?? 1) * 1000);
              return;
            }
            if (
              isAssistantApiError(error) &&
              error.code === 'TURN_IN_PROGRESS'
            ) {
              // 서버가 이미 기록해 처리 중이다 — 말풍선·입력을 그대로 두고(복원하면 같은 말이 두 번 나간다)
              // Retry-After 뒤 **같은 clientTurnId** 로만 다시 보내게 막는다.
              setPending({ ...turn, status: 'FAILED' });
              const at = Date.now();
              setNow(at);
              setRateLimitedUntil(at + (error.retryAfterSeconds ?? 1) * 1000);
              return;
            }
            setPending({ ...turn, status: 'FAILED' });
          },
          onSettled: () => {
            inFlightLock.release();
            abortRef.current = null;
            setStartedAt(null);
          },
        }
      );
    };
    // 잠금·말풍선을 세운 뒤에 묻는다 — 묻는 동안 연타해도 한 번만 나가고, 사용자는 보내는 중 표시를 본다.
    // Platform.OS 는 여기서 읽는다(모듈 로드 때 굳히면 테스트가 바꾼 플랫폼을 못 본다).
    const askWeb =
      Platform.OS === 'web' &&
      consentOn &&
      hereRef.current === null &&
      !webAskedRef.current &&
      turn.text.includes('날씨');
    if (!askWeb) {
      post();
      return;
    }
    webAskedRef.current = true;
    // [대기 취소]는 권한 창이 떠 있어도 바로 먹는다 — 끊기면 기다리지 않고 보내(끊긴 신호라 서버에 안 닿는다) 실패
    // 얼굴로 간다. 늦게 온 좌표는 담아 두어 다음 턴·[다시 보내기]가 싣는다.
    const reading = readDevicePosition({ ask: true }).then((coords) => {
      if (coords) hereRef.current = coords;
    });
    const canceled = new Promise<void>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(), {
        once: true,
      });
    });
    void Promise.race([reading, canceled]).then(() => {
      if (mountedRef.current) post();
    });
  }

  function send(input: TurnInput, text: string): void {
    if (rateLimitedSeconds > 0) return;
    dispatch({
      clientTurnId: newClientTurnId(),
      input,
      text,
      status: 'SENDING',
    });
  }

  function resend(): void {
    if (pending?.status !== 'FAILED' || rateLimitedSeconds > 0) return;
    dispatch(pending);
  }

  function cancel(): void {
    const turn = pending;
    abortRef.current?.abort();
    if (turn && turn.input.type === 'TEXT') onRestoreDraft(turn.text);
  }

  return {
    pending,
    inFlight: pending?.status === 'SENDING',
    slow: isSlowTurn(startedAt, now),
    rateLimitedSeconds,
    send,
    resend,
    cancel,
  };
}
