import { useEffect, useRef, useState } from 'react';

import { assetsApi, savesApi } from '../../api';
import { createRuntime } from '../../../../runtime/runtime.js';
import '../../../../runtime/runtime.css';
import '../../styles/runtime-preview.css';

/**
 * 编辑器「演示」Tab：内嵌纯浏览器运行时。
 * 资源通过主进程 vnasset:// 协议提供；运行时本身不依赖 Electron。
 */
export default function RuntimePreview({ project, projectDir }) {
  const stageRef = useRef(null);
  const runtimeRef = useRef(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    setError('');
    const stage = stageRef.current;
    if (!stage) return undefined;

    const resolveAssetUrl = async (relativePath) => {
      try {
        const result = await assetsApi.assetUrl({ projectDir, relativePath });
        return result.url;
      } catch (assetError) {
        console.warn('[runtime-preview] 资源地址解析失败', relativePath, assetError);
        return '';
      }
    };

    try {
      // Electron 编辑器内使用项目 saves/ 目录的 JSON 存档；独立运行时默认 IndexedDB。
      const storage = {
        list: async () => {
          const result = await savesApi.list({ projectDir });
          return result.saves ?? [];
        },
        get: async (_projectId, kind, slot) => {
          const result = await savesApi.get({ projectDir, kind, slot });
          return result.save ?? null;
        },
        put: async (save) => {
          const result = await savesApi.put({ projectDir, save });
          return result.save ?? save;
        },
        remove: async (_projectId, kind, slot) => {
          await savesApi.remove({ projectDir, kind, slot });
        },
      };

      const runtime = createRuntime({
        root: stage,
        project,
        resolveAssetUrl,
        storage,
        autoStart: true,
        showTitle: false,
        onStateChange: (state) => {
          if (!alive) return;
          if (state?.status === 'error') setError(state.error || '运行时错误');
          setStatus(state?.status ?? 'running');
        },
      });
      runtimeRef.current = runtime;
      setStatus('running');
    } catch (runtimeError) {
      console.error('[runtime-preview] 启动失败', runtimeError);
      setError(runtimeError.message || String(runtimeError));
      setStatus('error');
    }

    return () => {
      alive = false;
      try {
        runtimeRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      runtimeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.meta?.id, projectDir]);

  const restart = () => {
    try {
      runtimeRef.current?.restart?.();
      setError('');
      setStatus('running');
    } catch (runtimeError) {
      setError(runtimeError.message || String(runtimeError));
    }
  };

  return (
    <div className="vn-preview">
      <div className="vn-preview__toolbar">
        <span className="vn-preview__title">演示预览</span>
        <span className="vn-preview__scene">
          {project.settings?.startNodeId ? `起始节点：${project.settings.startNodeId}` : '未设置起始节点'}
        </span>
        <span className="vn-preview__hint">点击画面 / Space / Enter 推进 · 右上角菜单可存档读档</span>
        <button type="button" className="vn-btn vn-btn--ghost" onClick={restart}>
          重新开始
        </button>
      </div>
      <div className="vn-preview__stage" ref={stageRef} />
      {error ? (
        <div className="vn-preview__error">
          <strong>运行时错误</strong>
          <span>{error}</span>
        </div>
      ) : null}
      {status === 'ended' ? <div className="vn-preview__status">已到结尾，可点击「重新开始」。</div> : null}
    </div>
  );
}
