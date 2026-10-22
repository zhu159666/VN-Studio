import { useEffect, useState } from 'react';

import { appApi, projectsApi } from './api';
import StartScreen from './screens/StartScreen';
import ProjectWorkspace from './screens/ProjectWorkspace';
import { ProjectProvider } from './state/ProjectContext';
import { useProjectControllerState } from './state/useProjectController';

export default function App() {
  const controller = useProjectControllerState();
  const [screen, setScreen] = useState('start');
  const [appInfo, setAppInfo] = useState(null);
  const [pendingFilter, setPendingFilter] = useState(null);
  const [pendingAudioStudio, setPendingAudioStudio] = useState(false);
  const [focusAssetId, setFocusAssetId] = useState(null);
  const [pendingExport, setPendingExport] = useState(false);

  useEffect(() => {
    controller.actions.refreshRecent();
    appApi
      .getInfo()
      .then(setAppInfo)
      .catch((error) => console.warn('[app] 获取应用信息失败', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 普通启动：无项目；smoke：主进程会在加载后推送一个临时项目。
  useEffect(() => {
    let alive = true;
    appApi
      .getStartupProject()
      .then((result) => {
        if (!alive || !result?.project) return;
        controller.actions.loadFromPayload(result);
        setScreen('editor');
        setFocusAssetId(result.assetIds?.image ?? result.project.editor?.selectedAssetId ?? null);
      })
      .catch((error) => console.warn('[app] 读取启动项目失败', error));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const offLoad = appApi.onSmokeLoadProject((payload) => {
      controller.actions.loadFromPayload(payload);
      setScreen('editor');
      setFocusAssetId(payload.assetIds?.image ?? null);
    });
    const offSelect = appApi.onSmokeSelectAsset((assetId) => {
      setFocusAssetId(assetId);
    });
    return () => {
      offLoad();
      offSelect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateProject = async ({ title, resolution }) => {
    const created = await controller.actions.createProject({ title, resolution });
    if (!created) return;
    setScreen('editor');
    setPendingFilter(null);
    setFocusAssetId(null);
  };

  const handleOpenProject = async () => {
    try {
      const opened = await controller.actions.openProject();
      if (opened) {
        setScreen('editor');
        setPendingFilter(null);
        setFocusAssetId(null);
      }
      return opened;
    } catch {
      return false;
    }
  };

  const handleOpenRecent = async (projectPath) => {
    try {
      const opened = await controller.actions.openProjectPath(projectPath);
      if (opened) {
        setScreen('editor');
        setPendingFilter(null);
        setFocusAssetId(null);
      }
    } catch {
      /* 错误已通过全局 toast 呈现 */
    }
  };

  const handleOpenAssetManager = async (type) => {
    if (controller.project) {
      setPendingFilter(type);
      setPendingAudioStudio(type === 'audio');
      setScreen('editor');
      return;
    }
    try {
      const opened = await controller.actions.openProject();
      if (opened) {
        setPendingFilter(type);
        setPendingAudioStudio(type === 'audio');
        setScreen('editor');
      }
    } catch {
      /* 错误已通过全局 toast 呈现 */
    }
  };

  const handleRemoveRecent = async (projectPath) => {
    try {
      await projectsApi.removeRecent(projectPath);
      await controller.actions.refreshRecent();
    } catch (error) {
      controller.notify(error.message, 'error');
    }
  };

  const handleBackToStart = async () => {
    await controller.actions.closeProject();
    setScreen('start');
    setPendingFilter(null);
    setFocusAssetId(null);
  };

  const handleOpenPackaging = async () => {
    if (controller.project) {
      await controller.actions.exportWeb();
      return;
    }
    // 开始界面的「打包」：先打开项目，打开成功后再自动触发导出。
    setPendingExport(true);
    const opened = await handleOpenProject();
    if (!opened) setPendingExport(false);
  };

  useEffect(() => {
    if (!pendingExport || !controller.project) return;
    setPendingExport(false);
    controller.actions.exportWeb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingExport, controller.project]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        if (controller.project) controller.actions.saveNow();
        return;
      }
      if (key === 'o') {
        event.preventDefault();
        handleOpenProject();
        return;
      }
      if (key === 'n') {
        event.preventDefault();
        if (controller.project) {
          controller.notify('已返回开始界面；点击「创建项目」新建项目', 'info');
          handleBackToStart();
        } else {
          controller.notify('请在开始界面点击「创建项目」', 'info');
        }
        return;
      }
      if (key === 'e' && event.shiftKey) {
        event.preventDefault();
        handleOpenPackaging();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller.project, controller.actions, controller.notify]);

  return (
    <>
      {screen === 'editor' && controller.project ? (
        <ProjectProvider controller={controller}>
          <ProjectWorkspace
            initialFilter={pendingFilter}
            focusAssetId={focusAssetId}
            onBack={handleBackToStart}
            openAudioStudio={pendingAudioStudio}
            onAudioStudioOpened={() => setPendingAudioStudio(false)}
          />
        </ProjectProvider>
      ) : (
        <StartScreen
          appInfo={appInfo}
          recentProjects={controller.recentProjects}
          busy={controller.busy}
          onCreateProject={handleCreateProject}
          onOpenProject={handleOpenProject}
          onOpenRecent={handleOpenRecent}
          onRemoveRecent={handleRemoveRecent}
          onOpenAssetManager={handleOpenAssetManager}
          onOpenPackaging={handleOpenPackaging}
        />
      )}
      {controller.toast ? (
        <div className={`vn-toast vn-toast--${controller.toast.kind ?? 'info'}`} role="status">
          {controller.toast.message}
        </div>
      ) : null}
    </>
  );
}
