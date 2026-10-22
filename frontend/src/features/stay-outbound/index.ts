// 순수 뷰는 index.view 가 정본이고, 여기엔 네트워크 훅을 더한다.
export * from './index.view';

export {
  useStayOutboundFlow,
  type OutboundTarget,
} from './model/useStayOutboundFlow';
export type { OutboundQuery } from './model/stayOutbound';
