// eslint-disable-next-line
import {Draft, PayloadAction, createAsyncThunk, createNextState, createSlice} from '@reduxjs/toolkit';

import log from 'loglevel';
import path from 'path';
import {v4 as uuidv4} from 'uuid';

import {CLUSTER_DIFF_PREFIX, PREVIEW_PREFIX, ROOT_FILE_ENTRY} from '@constants/constants';

import {AlertType} from '@models/alert';
import {ProjectConfig} from '@models/appconfig';
import {
  AppState,
  ClusterToLocalResourcesMatch,
  FileMapType,
  HelmChartMapType,
  HelmValuesMapType,
  PreviewType,
  ResourceFilterType,
  ResourceMapType,
  SelectionHistoryEntry,
} from '@models/appstate';
import {HelmChart} from '@models/helm';
import {K8sResource} from '@models/k8sresource';
import {RootState} from '@models/rootstate';

import {currentConfigSelector} from '@redux/selectors';
import {HelmChartEventEmitter} from '@redux/services/helm';
import {isKustomizationResource} from '@redux/services/kustomize';
import {getK8sVersion} from '@redux/services/projectConfig';
import {reprocessOptionalRefs} from '@redux/services/resourceRefs';
import {resetSelectionHistory} from '@redux/services/selectionHistory';
import {loadClusterDiff} from '@redux/thunks/loadClusterDiff';
import {multiplePathsAdded} from '@redux/thunks/multiplePathsAdded';
import {multiplePathsChanged} from '@redux/thunks/multiplePathsChanged';
import {previewCluster, repreviewCluster} from '@redux/thunks/previewCluster';
import {previewHelmValuesFile} from '@redux/thunks/previewHelmValuesFile';
import {previewKustomization} from '@redux/thunks/previewKustomization';
import {removeResources} from '@redux/thunks/removeResources';
import {replaceSelectedResourceMatches} from '@redux/thunks/replaceSelectedResourceMatches';
import {runPreviewConfiguration} from '@redux/thunks/runPreviewConfiguration';
import {runTrivy} from '@redux/thunks/runTrivy';
import {saveUnsavedResources} from '@redux/thunks/saveUnsavedResources';
import {setRootFolder} from '@redux/thunks/setRootFolder';
import {updateFileEntry} from '@redux/thunks/updateFileEntry';
import {updateManyResources} from '@redux/thunks/updateManyResources';
import {updateResource} from '@redux/thunks/updateResource';

import electronStore from '@utils/electronStore';
import {isDefined} from '@utils/filter';
import {makeResourceNameKindNamespaceIdentifier} from '@utils/resources';
import {DIFF, trackEvent} from '@utils/telemetry';
import {parseYamlDocument} from '@utils/yaml';

import initialState from '../initialState';
import {createFileEntry, getFileEntryForAbsolutePath, removePath, selectFilePath} from '../services/fileEntry';
import {
  deleteResource,
  getResourceKindsWithTargetingRefs,
  isFileResource,
  processResources,
  recalculateResourceRanges,
  saveResource,
} from '../services/resource';
import {clearResourceSelections, highlightResource, updateSelectionAndHighlights} from '../services/selection';
import {setAlert} from './alert';
import {closeClusterDiff} from './ui';

export type SetRootFolderPayload = {
  projectConfig: ProjectConfig;
  fileMap: FileMapType;
  resourceMap: ResourceMapType;
  helmChartMap: HelmChartMapType;
  helmValuesMap: HelmValuesMapType;
  alert?: AlertType;
  isScanExcludesUpdated: 'outdated' | 'applied';
  isScanIncludesUpdated: 'outdated' | 'applied';
};

export type UpdateResourcePayload = {
  resourceId: string;
  content: string;
  preventSelectionAndHighlightsUpdate?: boolean;
  isInClusterMode?: boolean;
};

export type UpdateManyResourcesPayload = {
  resourceId: string;
  content: string;
}[];

export type UpdateFileEntryPayload = {
  path: string;
  content: string;
};

export type SetPreviewDataPayload = {
  previewResourceId?: string;
  previewResources?: ResourceMapType;
  alert?: AlertType;
  previewKubeConfigPath?: string;
  previewKubeConfigContext?: string;
};

export type SetDiffDataPayload = {
  diffResourceId?: string;
  diffContent?: string;
};

export type StartPreviewLoaderPayload = {
  targetId: string;
  previewType: PreviewType;
};

function updateSelectionHistory(type: 'resource' | 'path', isVirtualSelection: boolean, state: AppState) {
  if (isVirtualSelection) {
    return;
  }
  if (type === 'resource' && state.selectedResourceId) {
    state.selectionHistory.push({
      type,
      selectedResourceId: state.selectedResourceId,
    });
  }
  if (type === 'path' && state.selectedPath) {
    state.selectionHistory.push({
      type,
      selectedPath: state.selectedPath,
    });
  }
  state.currentSelectionHistoryIndex = undefined;
}

export const performResourceContentUpdate = (
  resource: K8sResource,
  newText: string,
  fileMap: FileMapType,
  resourceMap: ResourceMapType
) => {
  if (isFileResource(resource)) {
    const updatedFileText = saveResource(resource, newText, fileMap);
    resource.text = updatedFileText;
    resource.content = parseYamlDocument(updatedFileText).toJS();
    recalculateResourceRanges(resource, fileMap, resourceMap);
  } else {
    resource.text = newText;
    resource.content = parseYamlDocument(newText).toJS();
  }
};

export const updateShouldOptionalIgnoreUnsatisfiedRefs = createAsyncThunk(
  'main/resourceRefsProcessingOptions/shouldIgnoreOptionalUnsatisfiedRefs',
  async (shouldIgnore: boolean, thunkAPI: {getState: Function; dispatch: Function}) => {
    const state: RootState = thunkAPI.getState();

    const nextMainState = createNextState(state.main, mainState => {
      electronStore.set('main.resourceRefsProcessingOptions.shouldIgnoreOptionalUnsatisfiedRefs', shouldIgnore);
      state.main.resourceRefsProcessingOptions.shouldIgnoreOptionalUnsatisfiedRefs = shouldIgnore;

      const projectConfig = currentConfigSelector(state);
      const schemaVersion = getK8sVersion(projectConfig);
      const userDataDir = String(state.config.userDataDir);
      const resourceMap = getActiveResourceMap(mainState);

      reprocessOptionalRefs(schemaVersion, userDataDir, resourceMap, mainState.resourceRefsProcessingOptions);
    });

    return nextMainState;
  }
);

export const addResource = createAsyncThunk(
  'main/addResource',
  async (resource: K8sResource, thunkAPI: {getState: Function; dispatch: Function}) => {
    const state: RootState = thunkAPI.getState();
    const projectConfig = currentConfigSelector(state);
    const schemaVersion = getK8sVersion(projectConfig);
    const userDataDir = String(state.config.userDataDir);

    const nextMainState = createNextState(state.main, mainState => {
      mainState.resourceMap[resource.id] = resource;
      const resourceKinds = getResourceKindsWithTargetingRefs(resource);

      processResources(
        schemaVersion,
        userDataDir,
        getActiveResourceMap(mainState),
        mainState.resourceRefsProcessingOptions,
        {
          resourceIds: [resource.id],
          resourceKinds,
        }
      );
    });

    return nextMainState;
  }
);

export const addMultipleResources = createAsyncThunk(
  'main/addMultipleResources',
  async (resources: K8sResource[], thunkAPI: {getState: Function; dispatch: Function}) => {
    const state: RootState = thunkAPI.getState();
    const projectConfig = currentConfigSelector(state);
    const schemaVersion = getK8sVersion(projectConfig);
    const userDataDir = String(state.config.userDataDir);

    const nextMainState = createNextState(state.main, mainState => {
      resources.forEach(resource => {
        mainState.resourceMap[resource.id] = resource;
        const resourceKinds = getResourceKindsWithTargetingRefs(resource);

        processResources(
          schemaVersion,
          userDataDir,
          getActiveResourceMap(mainState),
          mainState.resourceRefsProcessingOptions,
          {
            resourceIds: [resource.id],
            resourceKinds,
          }
        );
      });
    });

    return nextMainState;
  }
);

export const reprocessResource = createAsyncThunk(
  'main/reprocessResource',
  async (resource: K8sResource, thunkAPI: {getState: Function; dispatch: Function}) => {
    const state: RootState = thunkAPI.getState();
    const projectConfig = currentConfigSelector(state);
    const schemaVersion = getK8sVersion(projectConfig);
    const userDataDir = String(state.config.userDataDir);

    const nextMainState = createNextState(state.main, mainState => {
      const resourceKinds = getResourceKindsWithTargetingRefs(resource);

      processResources(
        schemaVersion,
        userDataDir,
        getActiveResourceMap(mainState),
        mainState.resourceRefsProcessingOptions,
        {
          resourceIds: [resource.id],
          resourceKinds,
          trivy: state.main.trivy,
        }
      );
    });

    return nextMainState;
  }
);

export const reprocessAllResources = createAsyncThunk(
  'main/reprocessAllResources',
  async (_: any, thunkAPI: {getState: Function; dispatch: Function}) => {
    const state: RootState = thunkAPI.getState();
    const projectConfig = currentConfigSelector(state);
    const userDataDir = String(state.config.userDataDir);
    const schemaVersion = getK8sVersion(projectConfig);

    const nextMainState = createNextState(state.main, mainState => {
      processResources(schemaVersion, userDataDir, mainState.resourceMap, mainState.resourceRefsProcessingOptions);
    });

    return nextMainState;
  }
);

export const multiplePathsRemoved = createAsyncThunk(
  'main/multiplePathsRemoved',
  async (filePaths: Array<string>, thunkAPI: {getState: Function; dispatch: Function}) => {
    const state: RootState = thunkAPI.getState();

    const nextMainState = createNextState(state.main, mainState => {
      filePaths.forEach((filePath: string) => {
        let fileEntry = getFileEntryForAbsolutePath(filePath, mainState.fileMap);
        if (fileEntry) {
          removePath(filePath, mainState, fileEntry);
        }
      });
    });

    return nextMainState;
  }
);

const clearSelectedResourceOnPreviewExit = (state: AppState) => {
  if (state.selectedResourceId) {
    const selectedResource = state.resourceMap[state.selectedResourceId];
    if (selectedResource && selectedResource.filePath.startsWith(PREVIEW_PREFIX)) {
      state.selectedResourceId = undefined;
    }
  }
};

/**
 * Returns a resourceMap containing only active resources depending if we are in preview mode
 */

export function getActiveResourceMap(state: AppState) {
  if (state.previewResourceId || state.previewValuesFileId) {
    let activeResourceMap: ResourceMapType = {};
    Object.values(state.resourceMap)
      .filter(r => r.filePath.startsWith(PREVIEW_PREFIX))
      .forEach(r => {
        activeResourceMap[r.id] = r;
      });

    return activeResourceMap;
  }
  return state.resourceMap;
}

/**
 * Returns a resourceMap containing only local resources
 */

export function getLocalResourceMap(state: AppState) {
  let localResourceMap: ResourceMapType = {};
  Object.values(state.resourceMap)
    .filter(r => !r.filePath.startsWith(PREVIEW_PREFIX) && !r.filePath.startsWith(CLUSTER_DIFF_PREFIX))
    .forEach(r => {
      localResourceMap[r.id] = r;
    });

  return localResourceMap;
}

/**
 * The main reducer slice
 */

export const mainSlice = createSlice({
  name: 'main',
  initialState: initialState.main,
  reducers: {
    setAppRehydrating: (state: Draft<AppState>, action: PayloadAction<boolean>) => {
      state.isRehydrating = action.payload;
      if (!action.payload) {
        state.wasRehydrated = !action.payload;
      }
    },
    /**
     * called by the file monitor when a path is removed from the file system
     */
    multiplePathsRemoved: (state: Draft<AppState>, action: PayloadAction<Array<string>>) => {
      let filePaths: Array<string> = action.payload;
      filePaths.forEach((filePath: string) => {
        let fileEntry = getFileEntryForAbsolutePath(filePath, state.fileMap);
        if (fileEntry) {
          removePath(filePath, state, fileEntry);
        }
      });
    },
    /**
     * Marks the specified resource as selected and highlights all related resources
     */
    selectK8sResource: (
      state: Draft<AppState>,
      action: PayloadAction<{resourceId: string; isVirtualSelection?: boolean}>
    ) => {
      const resource = state.resourceMap[action.payload.resourceId];
      if (resource) {
        updateSelectionAndHighlights(state, resource);
        updateSelectionHistory('resource', Boolean(action.payload.isVirtualSelection), state);
      }
    },
    /**
     * Marks the specified values as selected
     */
    selectHelmValuesFile: (
      state: Draft<AppState>,
      action: PayloadAction<{valuesFileId: string; isVirtualSelection?: boolean}>
    ) => {
      const valuesFileId = action.payload.valuesFileId;
      Object.values(state.helmValuesMap).forEach(values => {
        values.isSelected = values.id === valuesFileId;
      });

      state.selectedValuesFileId = state.helmValuesMap[valuesFileId].isSelected ? valuesFileId : undefined;
      selectFilePath(state.helmValuesMap[valuesFileId].filePath, state);
      updateSelectionHistory('path', Boolean(action.payload.isVirtualSelection), state);
    },
    /**
     * Marks the specified file as selected and highlights all related resources
     */
    selectFile: (state: Draft<AppState>, action: PayloadAction<{filePath: string; isVirtualSelection?: boolean}>) => {
      const filePath = action.payload.filePath;
      if (filePath.length > 0) {
        selectFilePath(filePath, state);
        updateSelectionHistory('path', Boolean(action.payload.isVirtualSelection), state);
      }
    },
    selectPreviewConfiguration: (state: Draft<AppState>, action: PayloadAction<string>) => {
      state.selectedPreviewConfigurationId = action.payload;
      state.selectedPath = undefined;
      state.selectedResourceId = undefined;
      state.selectedValuesFileId = undefined;
    },
    setSelectingFile: (state: Draft<AppState>, action: PayloadAction<boolean>) => {
      state.isSelectingFile = action.payload;
    },
    setFiltersToBeChanged: (state: Draft<AppState>, action: PayloadAction<ResourceFilterType | undefined>) => {
      state.filtersToBeChanged = action.payload;
    },
    setApplyingResource: (state: Draft<AppState>, action: PayloadAction<boolean>) => {
      state.isApplyingResource = action.payload;
    },
    clearPreview: (state: Draft<AppState>) => {
      clearSelectedResourceOnPreviewExit(state);
      setPreviewData({}, state);
      state.previewType = undefined;
      state.checkedResourceIds = [];
    },
    clearPreviewAndSelectionHistory: (state: Draft<AppState>) => {
      clearSelectedResourceOnPreviewExit(state);
      setPreviewData({}, state);
      state.previewType = undefined;
      state.currentSelectionHistoryIndex = undefined;
      state.selectionHistory = [];
      state.clusterDiff.shouldReload = true;
      state.checkedResourceIds = [];
    },
    startPreviewLoader: (state: Draft<AppState>, action: PayloadAction<StartPreviewLoaderPayload>) => {
      state.previewLoader.isLoading = true;
      state.previewLoader.targetId = action.payload.targetId;
      state.previewType = action.payload.previewType;
    },
    stopPreviewLoader: (state: Draft<AppState>) => {
      state.previewLoader.isLoading = false;
      state.previewLoader.targetId = undefined;
    },
    resetResourceFilter: (state: Draft<AppState>) => {
      state.resourceFilter = {labels: {}, annotations: {}};
    },
    updateResourceFilter: (state: Draft<AppState>, action: PayloadAction<ResourceFilterType>) => {
      if (state.checkedResourceIds.length && !state.filtersToBeChanged) {
        state.filtersToBeChanged = action.payload;
        return;
      }

      if (state.filtersToBeChanged) {
        state.filtersToBeChanged = undefined;
      }

      state.resourceFilter = action.payload;
    },
    extendResourceFilter: (state: Draft<AppState>, action: PayloadAction<ResourceFilterType>) => {
      const filter = action.payload;

      if (state.checkedResourceIds.length && !state.filtersToBeChanged) {
        state.filtersToBeChanged = filter;
        return;
      }

      if (state.filtersToBeChanged) {
        state.filtersToBeChanged = undefined;
      }

      // construct new filter
      let newFilter: ResourceFilterType = {
        namespace: filter.namespace
          ? filter.namespace === state.resourceFilter.namespace
            ? undefined
            : filter.namespace
          : state.resourceFilter.namespace,
        kind: filter.kind
          ? filter.kind === state.resourceFilter.kind
            ? undefined
            : filter.kind
          : state.resourceFilter.kind,
        fileOrFolderContainedIn: filter.fileOrFolderContainedIn
          ? filter.fileOrFolderContainedIn === state.resourceFilter.fileOrFolderContainedIn
            ? undefined
            : filter.fileOrFolderContainedIn
          : state.resourceFilter.fileOrFolderContainedIn,
        name: state.resourceFilter.name,
        labels: state.resourceFilter.labels,
        annotations: state.resourceFilter.annotations,
      };

      Object.keys(filter.labels).forEach(key => {
        if (newFilter.labels[key] === filter.labels[key]) {
          delete newFilter.labels[key];
        } else {
          newFilter.labels[key] = filter.labels[key];
        }
      });
      Object.keys(filter.annotations).forEach(key => {
        if (newFilter.annotations[key] === filter.annotations[key]) {
          delete newFilter.annotations[key];
        } else {
          newFilter.annotations[key] = filter.annotations[key];
        }
      });
      state.resourceFilter = newFilter;
    },
    setDiffResourceInClusterDiff: (state: Draft<AppState>, action: PayloadAction<string | undefined>) => {
      state.clusterDiff.diffResourceId = action.payload;
    },
    setClusterDiffRefreshDiffResource: (state: Draft<AppState>, action: PayloadAction<boolean | undefined>) => {
      state.clusterDiff.refreshDiffResource = action.payload;
    },
    selectClusterDiffMatch: (state: Draft<AppState>, action: PayloadAction<string>) => {
      const matchId = action.payload;
      if (!state.clusterDiff.selectedMatches.includes(matchId)) {
        state.clusterDiff.selectedMatches.push(matchId);
      }
    },
    selectMultipleClusterDiffMatches: (state: Draft<AppState>, action: PayloadAction<string[]>) => {
      state.clusterDiff.selectedMatches = action.payload;
    },
    unselectClusterDiffMatch: (state: Draft<AppState>, action: PayloadAction<string>) => {
      const matchId = action.payload;
      if (state.clusterDiff.selectedMatches.includes(matchId)) {
        state.clusterDiff.selectedMatches = state.clusterDiff.selectedMatches.filter(m => m !== matchId);
      }
    },
    unselectAllClusterDiffMatches: (state: Draft<AppState>) => {
      state.clusterDiff.selectedMatches = [];
    },
    reloadClusterDiff: (state: Draft<AppState>) => {
      state.clusterDiff.shouldReload = true;
    },
    setSelectionHistory: (
      state: Draft<AppState>,
      action: PayloadAction<{nextSelectionHistoryIndex?: number; newSelectionHistory: SelectionHistoryEntry[]}>
    ) => {
      state.currentSelectionHistoryIndex = action.payload.nextSelectionHistoryIndex;
      state.selectionHistory = action.payload.newSelectionHistory;
    },
    editorHasReloadedSelectedPath: (state: Draft<AppState>) => {
      state.shouldEditorReloadSelectedPath = false;
    },
    checkResourceId: (state: Draft<AppState>, action: PayloadAction<string>) => {
      if (!state.checkedResourceIds.includes(action.payload)) {
        state.checkedResourceIds.push(action.payload);
      }
    },
    uncheckResourceId: (state: Draft<AppState>, action: PayloadAction<string>) => {
      state.checkedResourceIds = state.checkedResourceIds.filter(resourceId => action.payload !== resourceId);
    },
    checkMultipleResourceIds: (state: Draft<AppState>, action: PayloadAction<string[]>) => {
      action.payload.forEach(resourceId => {
        if (!state.checkedResourceIds.includes(resourceId)) {
          state.checkedResourceIds.push(resourceId);
        }
      });
    },
    uncheckAllResourceIds: (state: Draft<AppState>) => {
      state.checkedResourceIds = [];
    },
    uncheckMultipleResourceIds: (state: Draft<AppState>, action: PayloadAction<string[]>) => {
      state.checkedResourceIds = state.checkedResourceIds.filter(resourceId => !action.payload.includes(resourceId));
    },
    openResourceDiffModal: (state: Draft<AppState>, action: PayloadAction<string>) => {
      trackEvent(DIFF);
      state.resourceDiff.targetResourceId = action.payload;
    },
    closeResourceDiffModal: (state: Draft<AppState>) => {
      state.resourceDiff.targetResourceId = undefined;
    },
    toggleClusterOnlyResourcesInClusterDiff: (state: Draft<AppState>) => {
      state.clusterDiff.hideClusterOnlyResources = !state.clusterDiff.hideClusterOnlyResources;
      state.clusterDiff.selectedMatches = [];
    },
    addMultipleKindHandlers: (state: Draft<AppState>, action: PayloadAction<string[]>) => {
      action.payload.forEach(kind => {
        if (!state.registeredKindHandlers.includes(kind)) {
          state.registeredKindHandlers.push(kind);
        }
      });
    },
    addKindHandler: (state: Draft<AppState>, action: PayloadAction<string>) => {
      if (!state.registeredKindHandlers.includes(action.payload)) {
        state.registeredKindHandlers.push(action.payload);
      }
    },
    seenNotifications: (state: Draft<AppState>) => {
      state.notifications.forEach(notification => {
        notification.hasSeen = true;
      });
    },
    clearNotifications: (state: Draft<AppState>) => {
      state.notifications = [];
    },
    openPreviewConfigurationEditor: (
      state: Draft<AppState>,
      action: PayloadAction<{helmChartId: string; previewConfigurationId?: string}>
    ) => {
      const {helmChartId, previewConfigurationId} = action.payload;
      state.prevConfEditor = {
        helmChartId,
        previewConfigurationId,
        isOpen: true,
      };
    },
    closePreviewConfigurationEditor: (state: Draft<AppState>) => {
      state.prevConfEditor = {
        isOpen: false,
        helmChartId: undefined,
        previewConfigurationId: undefined,
      };
    },
    selectTrivyRule: (state: Draft<AppState>, action: PayloadAction<{ruleId: string}>) => {
      const rule = state.trivy?.find(item => item.id === action.payload.ruleId);
      const resourceMap = state.resourceMap;

      if (!rule) {
        return;
      }

      state.trivy?.forEach(item => {
        item.isSelected = false;
      });
      rule.isSelected = true;

      clearResourceSelections(resourceMap);
      rule.violations
        .flatMap(violation => {
          return violation.locations.flatMap(location => {
            return location.logicalLocation?.flatMap(l => l.decoratedName);
          });
        })
        .filter(isDefined)
        .forEach(resource => highlightResource(resourceMap, resource));
    },
  },
  extraReducers: builder => {
    builder.addCase(setAlert, (state, action) => {
      const notification: AlertType = action.payload;
      notification.id = uuidv4();
      notification.hasSeen = false;
      notification.createdAt = new Date().getTime();
      state.notifications = [notification, ...state.notifications];
    });

    builder
      .addCase(previewKustomization.fulfilled, (state, action) => {
        setPreviewData(action.payload, state);
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        resetSelectionHistory(state, {initialResourceIds: [state.previewResourceId]});
        state.selectedResourceId = action.payload.previewResourceId;
        state.selectedPath = undefined;
        state.selectedValuesFileId = undefined;
        state.selectedPreviewConfigurationId = undefined;
        state.clusterDiff.shouldReload = true;
        state.checkedResourceIds = [];
      })
      .addCase(previewKustomization.rejected, state => {
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        state.previewType = undefined;
      });

    builder
      .addCase(previewHelmValuesFile.fulfilled, (state, action) => {
        setPreviewData(action.payload, state);
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        state.currentSelectionHistoryIndex = undefined;
        resetSelectionHistory(state);
        state.selectedResourceId = undefined;
        state.checkedResourceIds = [];
        if (action.payload.previewResourceId && state.helmValuesMap[action.payload.previewResourceId]) {
          selectFilePath(state.helmValuesMap[action.payload.previewResourceId].filePath, state);
        }
        state.selectedValuesFileId = action.payload.previewResourceId;
      })
      .addCase(previewHelmValuesFile.rejected, state => {
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        state.previewType = undefined;
      });

    builder
      .addCase(runPreviewConfiguration.fulfilled, (state, action) => {
        setPreviewData(action.payload, state);
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        state.currentSelectionHistoryIndex = undefined;
        resetSelectionHistory(state);
        state.selectedResourceId = undefined;
        state.selectedPath = undefined;
        state.checkedResourceIds = [];
      })
      .addCase(runPreviewConfiguration.rejected, state => {
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        state.previewType = undefined;
      });

    builder
      .addCase(previewCluster.fulfilled, (state, action) => {
        setPreviewData(action.payload, state);
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        resetSelectionHistory(state, {initialResourceIds: [state.previewResourceId]});
        state.selectedResourceId = undefined;
        state.selectedPath = undefined;
        state.selectedValuesFileId = undefined;
        state.selectedPreviewConfigurationId = undefined;
        state.checkedResourceIds = [];
        Object.values(state.resourceMap).forEach(resource => {
          resource.isSelected = false;
          resource.isHighlighted = false;
        });
      })
      .addCase(previewCluster.rejected, state => {
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        state.previewType = undefined;
      });

    builder
      .addCase(repreviewCluster.fulfilled, (state, action) => {
        setPreviewData(action.payload, state);
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        let resource = null;
        if (action && action.payload && action.payload.previewResources && state && state.selectedResourceId) {
          resource = action.payload.previewResources[state.selectedResourceId];
        }
        if (resource) {
          updateSelectionAndHighlights(state, resource);
        }
      })
      .addCase(repreviewCluster.rejected, state => {
        state.previewLoader.isLoading = false;
        state.previewLoader.targetId = undefined;
        state.previewType = undefined;
      });

    builder.addCase(setRootFolder.pending, state => {
      const existingHelmCharts: HelmChart[] = JSON.parse(JSON.stringify(Object.values(state.helmChartMap)));
      if (existingHelmCharts.length) {
        setImmediate(() => existingHelmCharts.forEach(chart => HelmChartEventEmitter.emit('remove', chart.id)));
      }
    });

    builder.addCase(setRootFolder.fulfilled, (state, action) => {
      state.resourceMap = action.payload.resourceMap;
      state.fileMap = action.payload.fileMap;
      state.helmChartMap = action.payload.helmChartMap;
      state.helmValuesMap = action.payload.helmValuesMap;
      state.trivy = undefined;
      state.previewLoader.isLoading = false;
      state.previewLoader.targetId = undefined;
      state.selectedResourceId = undefined;
      state.selectedValuesFileId = undefined;
      state.selectedPath = undefined;
      state.previewResourceId = undefined;
      state.previewConfigurationId = undefined;
      state.previewType = undefined;
      state.previewValuesFileId = undefined;
      state.selectedPreviewConfigurationId = undefined;
      state.previewLoader = {
        isLoading: false,
        targetId: undefined,
      };
      state.checkedResourceIds = [];
      state.resourceDiff = {
        targetResourceId: undefined,
      };
      state.isSelectingFile = false;
      state.isApplyingResource = false;
      state.clusterDiff = {
        hasLoaded: false,
        hasFailed: false,
        hideClusterOnlyResources: true,
        clusterToLocalResourcesMatches: [],
        diffResourceId: undefined,
        refreshDiffResource: undefined,
        selectedMatches: [],
      };
      resetSelectionHistory(state);
    });

    builder.addCase(saveUnsavedResources.fulfilled, (state, action) => {
      const rootFolder = state.fileMap[ROOT_FILE_ENTRY].filePath;

      action.payload.resourcePayloads.forEach(resourcePayload => {
        const resource = state.resourceMap[resourcePayload.resourceId];
        const relativeFilePath = resourcePayload.resourceFilePath.substr(rootFolder.length);
        const resourceFileEntry = state.fileMap[relativeFilePath];

        if (resourceFileEntry) {
          resourceFileEntry.timestamp = resourcePayload.fileTimestamp;
        } else {
          const newFileEntry = {...createFileEntry(relativeFilePath, state.fileMap), isSupported: true};
          newFileEntry.timestamp = resourcePayload.fileTimestamp;
          const childFileName = path.basename(relativeFilePath);
          const parentPath = path.join(path.sep, relativeFilePath.replace(`${path.sep}${childFileName}`, '')).trim();
          if (parentPath === path.sep) {
            const rootFileEntry = state.fileMap[ROOT_FILE_ENTRY];
            if (rootFileEntry.children) {
              rootFileEntry.children.push(childFileName);
              rootFileEntry.children.sort();
            } else {
              rootFileEntry.children = [childFileName];
            }
          } else {
            const parentPathFileEntry = state.fileMap[parentPath];
            if (parentPathFileEntry) {
              if (parentPathFileEntry.children !== undefined) {
                parentPathFileEntry.children.push(childFileName);
                parentPathFileEntry.children.sort();
              } else {
                parentPathFileEntry.children = [childFileName];
              }
            } else {
              log.warn(`[saveUnsavedResource]: Couldn't find parent path for ${relativeFilePath}`);
            }
          }
        }

        if (resource) {
          resource.filePath = relativeFilePath;
          resource.range = resourcePayload.resourceRange;
        }
      });
    });

    builder
      .addCase(loadClusterDiff.pending, state => {
        state.clusterDiff.hasLoaded = false;
        state.clusterDiff.diffResourceId = undefined;
        state.clusterDiff.refreshDiffResource = undefined;
        state.clusterDiff.shouldReload = undefined;
        state.clusterDiff.selectedMatches = [];
      })
      .addCase(loadClusterDiff.rejected, state => {
        state.clusterDiff.hasLoaded = true;
        state.clusterDiff.hasFailed = true;
        state.clusterDiff.diffResourceId = undefined;
        state.clusterDiff.refreshDiffResource = undefined;
        state.clusterDiff.shouldReload = undefined;
        state.clusterDiff.selectedMatches = [];
      })
      .addCase(loadClusterDiff.fulfilled, (state, action) => {
        const clusterResourceMap = action.payload.resourceMap;
        if (!clusterResourceMap) {
          return;
        }

        const isInPreviewMode =
          Boolean(state.previewResourceId) ||
          Boolean(state.previewValuesFileId) ||
          Boolean(state.previewConfigurationId);

        // get the local resources from state.resourceMap
        let localResources: K8sResource[] = [];
        localResources = Object.values(state.resourceMap).filter(
          resource =>
            !resource.filePath.startsWith(CLUSTER_DIFF_PREFIX) &&
            !resource.name.startsWith('Patch:') &&
            !isKustomizationResource(resource)
        );

        // if we are in preview mode, localResources must contain only the preview resources
        if (isInPreviewMode) {
          localResources = localResources.filter(resource => resource.filePath.startsWith(PREVIEW_PREFIX));
        }

        // this groups local resources by {name}{kind}{namespace}
        const groupedLocalResources = groupResourcesByIdentifier(
          localResources,
          makeResourceNameKindNamespaceIdentifier
        );

        // remove previous cluster diff resources
        Object.values(state.resourceMap)
          .filter(r => r.filePath.startsWith(CLUSTER_DIFF_PREFIX))
          .forEach(r => deleteResource(r, state.resourceMap));
        // add resources from cluster diff to the resource map
        Object.values(clusterResourceMap).forEach(r => {
          // add prefix to the resource id to avoid replacing local resources that might have the same id
          // this happens only if the local resource has it's metadata.uid defined
          const clusterResourceId = `${CLUSTER_DIFF_PREFIX}${r.id}`;
          r.id = clusterResourceId;
          state.resourceMap[clusterResourceId] = r;
        });

        const clusterResources = Object.values(clusterResourceMap);
        // this groups cluster resources by {name}{kind}{namespace}
        // it's purpose is to allow us to find matches in the groupedLocalResources Record using the identifier
        const groupedClusterResources = groupResourcesByIdentifier(
          clusterResources,
          makeResourceNameKindNamespaceIdentifier
        );

        let clusterToLocalResourcesMatches: ClusterToLocalResourcesMatch[] = [];
        // this keeps track of local resources that have already been matched
        const localResourceIdsAlreadyMatched: string[] = [];

        Object.entries(groupedClusterResources).forEach(([identifier, value]) => {
          // the value should always be an array of length 1 so we take the first entry
          const currentClusterResource = value[0];
          const matchingLocalResources = groupedLocalResources[identifier];
          if (!matchingLocalResources || matchingLocalResources.length === 0) {
            // if there are no matching resources, we create a cluster only match
            clusterToLocalResourcesMatches.push({
              id: identifier,
              clusterResourceId: currentClusterResource.id,
              resourceName: currentClusterResource.name,
              resourceKind: currentClusterResource.kind,
              resourceNamespace: currentClusterResource.namespace || 'default',
            });
          } else {
            const matchingLocalResourceIds = matchingLocalResources.map(r => r.id);
            clusterToLocalResourcesMatches.push({
              id: identifier,
              localResourceIds: matchingLocalResourceIds,
              clusterResourceId: currentClusterResource.id,
              resourceName: currentClusterResource.name,
              resourceKind: currentClusterResource.kind,
              resourceNamespace: currentClusterResource.namespace || 'default',
            });
            localResourceIdsAlreadyMatched.push(...matchingLocalResourceIds);
          }
        });

        // optionally filter out all the cluster only matches
        if (state.clusterDiff.hideClusterOnlyResources) {
          clusterToLocalResourcesMatches = clusterToLocalResourcesMatches.filter(match => match.localResourceIds);
        }

        // remove deduplicates if there are any
        const localResourceIdentifiersNotMatched = [
          ...new Set(
            localResources
              .filter(r => !localResourceIdsAlreadyMatched.includes(r.id))
              .map(r => makeResourceNameKindNamespaceIdentifier(r))
          ),
        ];

        // create local only matches
        localResourceIdentifiersNotMatched.forEach(identifier => {
          const currentLocalResources = groupedLocalResources[identifier];
          if (!currentLocalResources || currentLocalResources.length === 0) {
            return;
          }
          clusterToLocalResourcesMatches.push({
            id: identifier,
            localResourceIds: currentLocalResources.map(r => r.id),
            resourceName: currentLocalResources[0].name,
            resourceKind: currentLocalResources[0].kind,
            resourceNamespace: currentLocalResources[0].namespace || 'default',
          });
        });

        state.clusterDiff.clusterToLocalResourcesMatches = clusterToLocalResourcesMatches;
        state.clusterDiff.hasLoaded = true;
        state.clusterDiff.hasFailed = false;
        state.clusterDiff.diffResourceId = undefined;
        state.clusterDiff.refreshDiffResource = undefined;
        state.clusterDiff.shouldReload = undefined;
        state.clusterDiff.selectedMatches = [];
      });

    builder.addCase(closeClusterDiff.type, state => {
      // remove previous cluster diff resources
      Object.values(state.resourceMap)
        .filter(r => r.filePath.startsWith(CLUSTER_DIFF_PREFIX))
        .forEach(r => deleteResource(r, state.resourceMap));
      state.clusterDiff.clusterToLocalResourcesMatches = [];
      state.clusterDiff.hasLoaded = false;
      state.clusterDiff.hasFailed = false;
      state.clusterDiff.diffResourceId = undefined;
      state.clusterDiff.refreshDiffResource = undefined;
      state.clusterDiff.shouldReload = undefined;
      state.clusterDiff.selectedMatches = [];
    });

    builder
      .addCase(replaceSelectedResourceMatches.pending, state => {
        state.clusterDiff.hasLoaded = false;
      })
      .addCase(replaceSelectedResourceMatches.fulfilled, state => {
        state.clusterDiff.hasLoaded = true;
      })
      .addCase(replaceSelectedResourceMatches.rejected, state => {
        state.clusterDiff.hasLoaded = true;
      });

    builder.addCase(multiplePathsChanged.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(multiplePathsAdded.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(updateResource.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(removeResources.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(updateManyResources.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(updateFileEntry.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(updateShouldOptionalIgnoreUnsatisfiedRefs.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(addResource.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(addMultipleResources.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(reprocessResource.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(reprocessAllResources.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(multiplePathsRemoved.fulfilled, (state, action) => {
      return action.payload;
    });

    builder.addCase(runTrivy.fulfilled, (state, action) => {
      state.trivy = action.payload;
    });

    builder.addMatcher(
      () => true,
      (state, action) => {
        if (action.payload?.alert) {
          const notification: AlertType = action.payload.alert;
          notification.id = uuidv4();
          notification.hasSeen = false;
          notification.createdAt = new Date().getTime();
          state.notifications = [notification, ...state.notifications];
        }
      }
    );
  },
});

function groupResourcesByIdentifier(
  resources: K8sResource[],
  makeIdentifier: (resource: K8sResource) => string
): Record<string, K8sResource[]> {
  const groupedResources: Record<string, K8sResource[]> = {};
  resources.forEach(resource => {
    const identifier = makeIdentifier(resource);
    if (groupedResources[identifier]) {
      groupedResources[identifier].push(resource);
    } else {
      groupedResources[identifier] = [resource];
    }
  });
  return groupedResources;
}

/**
 * Sets/clears preview resources
 */

function setPreviewData(payload: SetPreviewDataPayload, state: AppState) {
  state.previewResourceId = undefined;
  state.previewValuesFileId = undefined;
  state.previewConfigurationId = undefined;

  if (payload.previewResourceId) {
    if (state.previewType === 'kustomization') {
      if (state.resourceMap[payload.previewResourceId]) {
        state.previewResourceId = payload.previewResourceId;
      } else {
        log.error(`Unknown preview id: ${payload.previewResourceId}`);
      }
    }
    if (state.previewType === 'helm') {
      if (state.helmValuesMap[payload.previewResourceId]) {
        state.previewValuesFileId = payload.previewResourceId;
      } else {
        log.error(`Unknown preview id: ${payload.previewResourceId}`);
      }
    }
    if (state.previewType === 'cluster') {
      state.previewResourceId = payload.previewResourceId;
      state.previewKubeConfigPath = payload.previewKubeConfigPath;
      state.previewKubeConfigContext = payload.previewKubeConfigContext;
    }
    if (state.previewType === 'helm-preview-config') {
      state.previewConfigurationId = payload.previewResourceId;
    }
  }

  // remove previous preview resources
  Object.values(state.resourceMap)
    .filter(r => r.filePath.startsWith(PREVIEW_PREFIX))
    .forEach(r => deleteResource(r, state.resourceMap));

  if (payload.previewResourceId && payload.previewResources) {
    Object.values(payload.previewResources).forEach(r => {
      state.resourceMap[r.id] = r;
    });
  }
}

export const {
  setAppRehydrating,
  selectK8sResource,
  selectFile,
  setSelectingFile,
  setApplyingResource,
  selectHelmValuesFile,
  clearPreview,
  clearPreviewAndSelectionHistory,
  startPreviewLoader,
  stopPreviewLoader,
  updateResourceFilter,
  extendResourceFilter,
  setDiffResourceInClusterDiff,
  setClusterDiffRefreshDiffResource,
  selectClusterDiffMatch,
  selectMultipleClusterDiffMatches,
  unselectClusterDiffMatch,
  unselectAllClusterDiffMatches,
  reloadClusterDiff,
  toggleClusterOnlyResourcesInClusterDiff,
  setSelectionHistory,
  editorHasReloadedSelectedPath,
  checkResourceId,
  uncheckAllResourceIds,
  uncheckResourceId,
  resetResourceFilter,
  checkMultipleResourceIds,
  uncheckMultipleResourceIds,
  closeResourceDiffModal,
  openResourceDiffModal,
  setFiltersToBeChanged,
  addMultipleKindHandlers,
  addKindHandler,
  seenNotifications,
  clearNotifications,
  openPreviewConfigurationEditor,
  closePreviewConfigurationEditor,
  selectPreviewConfiguration,
  selectTrivyRule,
} = mainSlice.actions;
export default mainSlice.reducer;
