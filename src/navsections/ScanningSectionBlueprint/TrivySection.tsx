import {SectionBlueprint} from '@models/navigator';

import {selectTrivyRule} from '@redux/reducers/main';
import {LeftPanelInput, TrivyItem} from '@redux/thunks/runTrivy';

import {TrivyItemCounter} from './TrivyItemCounter';
import {TrivySectionActions} from './TrivySectionActions';

type TrivyScope = {
  output: LeftPanelInput | undefined;
};

export const TrivySection: SectionBlueprint<TrivyItem, TrivyScope> = {
  id: 'trivy',
  name: 'Trivy',
  containerElementId: 'trivy-sections-container',
  rootSectionId: 'trivy',
  getScope: state => {
    return {
      hack: 'hack',
      output: state.main.trivy,
    };
  },
  builder: {
    getRawItems: scope => {
      return scope.output ?? [];
    },
    isLoading: () => false,
    isInitialized: () => true,
    isEmpty: () => false,
    isVisible: () => true,
  },
  customization: {
    nameSuffix: {
      component: TrivySectionActions,
      options: {
        isVisibleOnHover: true,
      },
    },
  },
  itemBlueprint: {
    getName: item => item.id,
    getInstanceId: item => item.id,
    builder: {
      getMeta: item => item,
      isSelected: item => item.isSelected,
      isHighlighted: () => false,
      isDisabled: () => false,
      isVisible: () => true,
    },
    instanceHandler: {
      onClick: (instance, dispatch) => {
        dispatch(selectTrivyRule({ruleId: instance.id}));
      },
    },
    customization: {
      suffix: {
        component: TrivyItemCounter,
      },
    },
  },
};
