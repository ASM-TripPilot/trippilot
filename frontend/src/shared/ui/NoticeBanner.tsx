import { type ReactElement, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

// 담기/해제 실패 같은 "알림 한 줄" 배너 2종의 공용 틀(TRIP-1360) — 화면마다 복사돼 있던 5벌을 모았다.
// 문구·testID·아이콘은 소비처가 정한다(이 틀은 도메인을 모른다).

export interface NoticeBannerNotice {
  message: string;
  /** 'login' = 로그인하기, 'retry' = 다시 시도, null = 액션 없음. */
  action: 'login' | 'retry' | null;
}

/** 연분홍 알림 박스 — 아이콘(선택) + 문구 + 조건부 액션 버튼. */
export function NoticeBanner({
  testID,
  notice,
  actionTestIDs,
  onPressAction,
  icon,
}: {
  testID: string;
  notice: NoticeBannerNotice;
  actionTestIDs: { login: string; retry: string };
  onPressAction?: () => void;
  icon?: ReactNode;
}): ReactElement {
  const actionTestID =
    notice.action === 'login'
      ? actionTestIDs.login
      : notice.action === 'retry'
        ? actionTestIDs.retry
        : null;
  const actionLabel = notice.action === 'login' ? '로그인하기' : '다시 시도';

  return (
    <View
      testID={testID}
      className="mx-lg mb-sm flex-row items-start gap-[10px] rounded-button bg-primary-pale p-md"
    >
      {icon}
      <Text className="flex-1 font-noto text-label text-primary-text">
        {notice.message}
      </Text>
      {actionTestID ? (
        <Pressable
          testID={actionTestID}
          accessibilityRole="button"
          onPress={onPressAction}
          className="items-center justify-center rounded-pill border-[1.4px] border-primary bg-canvas px-md py-[7px]"
        >
          <Text className="font-noto-bold text-[12.5px] font-bold text-primary-text">
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 회색 알림 줄 — 탭하면 닫힌다(다음 조작으로도 소멸). 아이콘 + 문구. */
export function DismissNotice({
  testID,
  message,
  onDismiss,
  icon,
}: {
  testID: string;
  message: string;
  onDismiss?: () => void;
  icon?: ReactNode;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onDismiss}
      className="mb-md flex-row items-center gap-sm rounded-card bg-surface-soft px-lg py-md"
    >
      {icon}
      <Text className="flex-1 font-noto text-label text-muted">{message}</Text>
    </Pressable>
  );
}
