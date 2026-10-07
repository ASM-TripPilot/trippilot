import type { ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-1277 · i05·i06 의 빈 화면 대신 그리는 안내 얼굴(INV-4) — **순수 뷰**(pages · api import 0, preview 가 직접 import).
 *  - `solving-error` — 진행 화면에서 세션 조회가 data 없이 실패. [다시 시도]=재조회 · [취소]=서버 호출 없이 나가기.
 *  - `solving-closed` — 진행 화면인데 세션이 이미 끝났다(APPLIED·CANCELED). [나가기].
 *  - `draft-error` — 재계획안 화면에서 세션 조회가 data 없이 실패. [다시 시도] · [나가기].
 *
 * Figma 프레임이 없어 문구는 이 사이클이 정한 값이다(h07 error 의 문구·버튼 위계만 참고). 모양은
 * `LiveItineraryPage` 의 StateNotice 얼굴과 같다. 부제엔 "다시 시도"를 넣지 않는다 — 버튼과 겹쳐 읽힌다.
 * 소요시간·경과 숫자는 어디에도 없다(INV-3).
 */

type ReplanNoticeKind = 'solving-error' | 'solving-closed' | 'draft-error';

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

const LOAD_FAILED = {
  title: '재계획 상태를 불러오지 못했어요',
  description: '네트워크를 확인해 주세요. 원래 일정은 그대로예요',
};

export interface ReplanNoticeFaceProps {
  kind: ReplanNoticeKind;
  /** 세션 재조회 — `solving-error`·`draft-error` 만 쓴다. */
  onRetry?: () => void;
  /** 서버 호출 없이 나가기. */
  onLeave: () => void;
}

export function ReplanNoticeFace({
  kind,
  onRetry,
  onLeave,
}: ReplanNoticeFaceProps): ReactElement {
  const notice =
    kind === 'solving-closed'
      ? {
          testID: 'planb-solving-closed',
          title: '이미 끝난 재계획이에요',
          // 적용된 세션일 수도 있어 "원래 일정은 그대로"라고 말하지 않는다.
          description: '나가서 지금 일정을 확인해 주세요',
          actions: [
            {
              testID: 'planb-solving-closed-leave',
              label: '나가기',
              variant: 'filled' as const,
              onPress: onLeave,
            },
          ],
        }
      : {
          ...LOAD_FAILED,
          testID:
            kind === 'solving-error'
              ? 'planb-solving-error'
              : 'planb-draft-error',
          actions: [
            {
              testID:
                kind === 'solving-error'
                  ? 'planb-solving-retry'
                  : 'planb-draft-retry',
              label: '다시 시도',
              variant: 'filled' as const,
              onPress: onRetry,
            },
            kind === 'solving-error'
              ? {
                  testID: 'planb-solving-error-cancel',
                  label: '취소',
                  variant: 'outline' as const,
                  onPress: onLeave,
                }
              : {
                  testID: 'planb-draft-error-leave',
                  label: '나가기',
                  variant: 'outline' as const,
                  onPress: onLeave,
                },
          ],
        };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice illustration={NEUTRAL_BADGE} {...notice} />
      </View>
    </SafeAreaView>
  );
}
