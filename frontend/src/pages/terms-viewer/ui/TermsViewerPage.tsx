import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactElement } from 'react';

import { termsDocumentTitle } from '@/features/onboarding/model/termsDocumentTitle';
import { TermsViewerScreen } from '@/features/onboarding/ui/TermsViewerScreen';
import { fetchTermsByType } from '@/shared/api';

/**
 * 약관 열람 배선(pages 층, TRIP-937) — `GET /terms/{termsType}` 를 화면에 잇는다. 온보딩·설정·재동의
 * 세 곳에서 push 로 열리고, 뒤로가기는 연 자리로 돌아간다. 실패(네트워크·404)는 오류+재시도로
 * 보인다(INV-4) — 재시도는 같은 조회를 다시 보낸다.
 */
export function TermsViewerPage({
  termsType,
}: {
  termsType: string;
}): ReactElement {
  const router = useRouter();
  const query = useQuery({
    queryKey: ['terms', termsType],
    queryFn: () => fetchTermsByType(termsType),
    // 자동 재시도 끔 — 기본(3회·지수 지연)이면 404 도 약 7초 스피너 뒤에야 오류가 뜬다. 재시도는 버튼이 맡는다.
    retry: false,
  });

  return (
    <TermsViewerScreen
      title={termsDocumentTitle(termsType)}
      status={query.isSuccess ? 'ready' : query.isError ? 'error' : 'loading'}
      body={query.data?.body ?? null}
      onPressBack={() => router.back()}
      onRetry={() => void query.refetch()}
    />
  );
}
