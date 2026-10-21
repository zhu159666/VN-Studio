// 时间轴的纯函数项目变更（不依赖 React）。

export function setTimelineInProject(project, sceneNodeId, timeline) {
  if (!project?.nodes?.some((node) => node.id === sceneNodeId && node.type === 'scene')) {
    return project;
  }
  if (!timeline) return project;
  return {
    ...project,
    timelines: {
      ...(project.timelines ?? {}),
      [sceneNodeId]: timeline,
    },
  };
}

export function removeTimelineFromProject(project, sceneNodeId) {
  if (!project.timelines || !(sceneNodeId in project.timelines)) return project;
  const timelines = { ...project.timelines };
  delete timelines[sceneNodeId];
  return { ...project, timelines };
}

export function updateTimelineDurationInProject(project, sceneNodeId, durationMs) {
  const timeline = project.timelines?.[sceneNodeId];
  if (!timeline) return project;
  const duration = Math.max(100, Math.round(Number(durationMs) || timeline.durationMs));
  return setTimelineInProject(project, sceneNodeId, { ...timeline, durationMs: duration });
}
