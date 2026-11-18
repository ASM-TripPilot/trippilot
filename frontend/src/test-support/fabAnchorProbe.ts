import { screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

/** snapPoints 를 가진 host 노드 = 시트 본체(통과형 목이 props 를 host 에 펼친다). */
export function sheetHost(): ReactTestInstance {
  const host = screen.root
    .findAll((node) => Array.isArray(node.props?.snapPoints))
    .find((node) => typeof node.type === 'string');
  if (!host) throw new Error('시트 host 노드가 없다');
  return host;
}
