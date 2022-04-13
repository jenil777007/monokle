import React from 'react';

import styled from 'styled-components';

import {ItemCustomComponentProps} from '@models/navigator';

import type {TrivyItem} from '@redux/thunks/runTrivy';

import Colors, {FontColors} from '@styles/Colors';

export function TrivyItemCounter({itemInstance}: ItemCustomComponentProps) {
  const item = itemInstance.meta as TrivyItem;
  const count = item.violations.length;

  return <Counter selected={itemInstance.isSelected}>{count}</Counter>;
}

const Counter = styled.span<{selected: boolean}>`
  margin-left: 8px;
  font-size: 14px;
  cursor: pointer;
  ${props => (props.selected ? `color: ${Colors.blackPure};` : `color: ${FontColors.grey};`)}
`;
