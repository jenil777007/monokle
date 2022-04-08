import {createAsyncThunk} from '@reduxjs/toolkit';

import {AppDispatch} from '@models/appdispatch';
import {RootState} from '@models/rootstate';

import {createRejectionWithAlert} from '@redux/thunks/utils';

import {CommandOptions, runCommandInMainThread} from '@utils/command';
import {RUN_TRIVY, trackEvent} from '@utils/telemetry';
import {buildTrivyCommand} from '@utils/trivy';

type Input = string | undefined;
type Payload = undefined;

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

  if (result.error) {
    return createRejectionWithAlert(thunkAPI, 'Trivy Error', result.error);
  }

  if (result.stdout) {
    console.log('trivy ok', result.stdout);
    return undefined;
  }

  return createRejectionWithAlert(thunkAPI, 'Trivy Error', `Unable to run Trivy on ${filePath}`);
});
