import { createContext, useContext } from 'react';

export const ProjectContext = createContext(null);

export function ProjectProvider({ controller, children }) {
  return <ProjectContext.Provider value={controller}>{children}</ProjectContext.Provider>;
}

export function useProjectController() {
  const controller = useContext(ProjectContext);
  if (!controller) {
    throw new Error('useProjectController 必须在 <ProjectProvider> 内使用');
  }
  return controller;
}

export function useProjectActions() {
  return useProjectController().actions;
}
