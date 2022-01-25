import {useCallback, useMemo, useState} from 'react';

import {Button, Skeleton, Tooltip} from 'antd';

import {PlusOutlined, ReloadOutlined} from '@ant-design/icons';

import {PluginManagerDrawerReloadTooltip} from '@constants/tooltips';

import {useAppDispatch, useAppSelector} from '@redux/hooks';
import {closePluginsDrawer} from '@redux/reducers/extension';
import {checkForExtensionsUpdates} from '@redux/services/extension';

import Drawer from '@components/atoms/Drawer';

import PluginInformation from './PluginInformation';
import PluginInstallModal from './PluginInstallModal';
import * as S from './PluginManagerDrawer.styled';

function PluginManagerDrawer() {
  const dispatch = useAppDispatch();
  const isLoadingExistingPlugins = useAppSelector(state => state.extension.isLoadingExistingPlugins);
  const isPluginsDrawerVisible = useAppSelector(state => state.extension.isPluginsDrawerVisible);

  const pluginMap = useAppSelector(state => state.extension.pluginMap);
  const templateMap = useAppSelector(state => state.extension.templateMap);
  const templatePackMap = useAppSelector(state => state.extension.templatePackMap);

  const sortedPluginEntries = useMemo(() => {
    return Object.entries(pluginMap).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [pluginMap]);

  const [isInstallModalVisible, setInstallModalVisible] = useState<boolean>(false);

  const onClickInstallPlugin = () => {
    setInstallModalVisible(true);
  };

  const onClickReload = useCallback(
    () => checkForExtensionsUpdates({templateMap, pluginMap, templatePackMap}, dispatch),
    [templateMap, pluginMap, templatePackMap, dispatch]
  );

  const onCloseInstallPlugin = () => {
    setInstallModalVisible(false);
  };

  return (
    <Drawer
      width="400"
      noborder="true"
      title="Plugins Manager"
      placement="right"
      closable={false}
      visible={isPluginsDrawerVisible}
      onClose={() => dispatch(closePluginsDrawer())}
      bodyStyle={{padding: 0}}
    >
      <PluginInstallModal isVisible={isInstallModalVisible} onClose={onCloseInstallPlugin} />
      <S.ButtonsContainer>
        <Tooltip title={PluginManagerDrawerReloadTooltip} placement="bottom">
          <Button
            disabled={sortedPluginEntries.length === 0}
            onClick={onClickReload}
            type="link"
            size="small"
            icon={<ReloadOutlined />}
          >
            Update
          </Button>
        </Tooltip>
        <Button
          onClick={onClickInstallPlugin}
          type="primary"
          ghost
          size="small"
          icon={<PlusOutlined />}
          style={{marginLeft: 8}}
        >
          Install
        </Button>
      </S.ButtonsContainer>
      <S.Container>
        {sortedPluginEntries.length === 0 ? (
          <>{isLoadingExistingPlugins ? <Skeleton /> : <p>No plugins installed yet.</p>}</>
        ) : (
          <>
            {sortedPluginEntries.length > 0 &&
              sortedPluginEntries.map(([path, activePlugin]) => (
                <PluginInformation key={activePlugin.name} plugin={activePlugin} pluginPath={path} />
              ))}
            {!sortedPluginEntries.length && <S.NotFoundLabel>No plugins found.</S.NotFoundLabel>}
          </>
        )}
      </S.Container>
    </Drawer>
  );
}

export default PluginManagerDrawer;