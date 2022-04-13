import React, {useCallback} from 'react';

import styled from 'styled-components';

import {SectionCustomComponentProps} from '@models/navigator';

import {useAppDispatch} from '@redux/hooks';
import {runTrivy} from '@redux/thunks/runTrivy';

import Colors from '@styles/Colors';

export function TrivySectionActions({sectionInstance}: SectionCustomComponentProps) {
  const dispatch = useAppDispatch();

  const handleScan = useCallback(() => {
    dispatch(runTrivy());
  }, [dispatch]);

  return (
    <SuffixContainer>
      <StyledButton isSelected={sectionInstance.isSelected} onClick={() => handleScan()}>
        Scan
      </StyledButton>
    </SuffixContainer>
  );
}

const SuffixContainer = styled.span`
  display: inline-block;
`;

const StyledButton = styled.span<{isSelected: boolean}>`
  margin-right: 15px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  color: ${props => (props.isSelected ? Colors.blackPure : Colors.blue6)};
`;
