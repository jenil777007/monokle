import {createAsyncThunk} from '@reduxjs/toolkit';

import {AppDispatch} from '@models/appdispatch';
import {K8sResource, getFullyQualifiedResourceName} from '@models/k8sresource';
import {RootState} from '@models/rootstate';

import {reprocessAllResources} from '@redux/reducers/main';
import {createRejectionWithAlert} from '@redux/thunks/utils';

import {CommandOptions, runCommandInMainThread} from '@utils/command';
import {RUN_TRIVY, trackEvent} from '@utils/telemetry';
import {LogicalLocation, SarifResult, buildTrivyCommand, createTrivyResult} from '@utils/trivy';

export type TrivyItem = {
  id: string;
  name: string;
  isSelected: boolean;
  violations: SarifResult[];
  description?: string; // short description of rule.
  severity?: string; // severity of rule.
};

export type LeftPanelInput = TrivyItem[];

type Input = string | undefined;
type Payload = LeftPanelInput;

export const runTrivy = createAsyncThunk<
  Payload,
  Input,
  {
    dispatch: AppDispatch;
    state: RootState;
  }
>('main/runTrivy', async (resourceId, thunkAPI) => {
  trackEvent(RUN_TRIVY);
  const resourcePath = resourceId ? thunkAPI.getState().main.resourceMap[resourceId]?.filePath : undefined;
  const filePath = resourcePath ?? thunkAPI.getState().config.selectedProjectRootFolder;

  if (!filePath) {
    return createRejectionWithAlert(thunkAPI, 'Trivy Error', `Unable to run Trivy.`);
  }

  const args = buildTrivyCommand(filePath);

  const commandOptions: CommandOptions = {
    cmd: 'trivy',
    args: args.splice(1),
  };

  const result = await runCommandInMainThread(commandOptions);

  if (result.error || !result.stdout) {
    const msg = result.error ?? `Unable to run Trivy on ${filePath}`;
    return createRejectionWithAlert(thunkAPI, 'Trivy Error', msg);
  }

  const sarif = createTrivyResult(result.stdout);
  console.log('Original output', sarif);
  const run = sarif.runs[0];

  if (!run) {
    return createRejectionWithAlert(thunkAPI, 'Trivy Error', 'No run found');
  }

  // Infer logical location
  const resourceMap = thunkAPI.getState().main.resourceMap;
  const resources = Object.values(resourceMap);
  run.results.forEach(violation => {
    violation.locations.forEach((location, index) => {
      const logicalLocations = inferLogicalLocations(violation, index, resources);
      location.logicalLocation = logicalLocations;
    });
  });

  // Create left panel input
  const leftPanelInput = run.tool.driver.rules.map((rule): TrivyItem => {
    return {
      id: rule.id,
      name: rule.id,
      isSelected: false,
      violations: run.results.filter(violation => violation.ruleId === rule.id),
    };
  });

  thunkAPI.dispatch(reprocessAllResources);
  return leftPanelInput;
});

// Example:
// msg := kubernetes.format(
//  sprintf("Container '%s' of %s '%s' should set 'resources.limits.cpu'",
//          [getNoLimitsCPUContainers[_], kubernetes.kind, kubernetes.name]));

const regex = /Container '([A-za-z]*)' of ([A-Z][a-z]*) '([A-Za-z-]*)'/;

function inferLogicalLocations(
  violation: SarifResult,
  locationIndex: number,
  resources: K8sResource[]
): LogicalLocation[] {
  const file = `/${violation?.locations[locationIndex].physicalLocation?.artifactLocation.uri}`;
  const fileResources = resources.filter(r => r.filePath === file);

  if (fileResources.length === 0) {
    console.error('logical location: not found');
    return [];
  }

  let resource: K8sResource | undefined;
  if (fileResources.length === 1) {
    resource = fileResources[0];
  } else {
    const msg = violation?.message.text;
    const regexMatch = msg?.match(regex);
    if (regexMatch) {
      const kind = regexMatch[1];
      const resourceName = regexMatch[2];
      resource = fileResources.find(r => r.kind === kind && r.name === resourceName);
    }
  }

  if (!resource) {
    console.error('logical location not found for violation', violation);
    return [];
  }

  return [
    {
      kind: 'resource',
      name: resource.name,
      decoratedName: resource.id,
      fullyQualifiedName: getFullyQualifiedResourceName(resource),
    },
  ];
}
