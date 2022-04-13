import React from 'react';

import {SectionRenderer, TitleBar} from '@molecules';

import {TrivySection} from '@src/navsections/ScanningSectionBlueprint/TrivySection';
import sectionBlueprintMap from '@src/navsections/sectionBlueprintMap';

import * as S from './styled';

export default function ScanningPane() {
  return (
    <S.ScanningPaneContainer id="ScanningPane">
      <TitleBar title="Resource scanners" closable />
      <S.List id={TrivySection.containerElementId}>
        <SectionRenderer sectionBlueprint={TrivySection} level={0} isLastSection={false} />
      </S.List>
    </S.ScanningPaneContainer>
  );
}

sectionBlueprintMap.register(TrivySection);
