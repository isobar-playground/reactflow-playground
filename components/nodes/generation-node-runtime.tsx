"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface GenerationNodeRuntimeState {
  isGenerating: boolean;
  error: string | null;
}

export interface GenerationNodeRuntimeContextValue {
  setGenerationNodeRuntime: (nodeId: string, state: GenerationNodeRuntimeState) => void;
}

const defaultValue: GenerationNodeRuntimeContextValue = {
  setGenerationNodeRuntime: () => {},
};

const GenerationNodeRuntimeContext =
  createContext<GenerationNodeRuntimeContextValue>(defaultValue);

export function GenerationNodeRuntimeProvider({
  value,
  children,
}: {
  value: GenerationNodeRuntimeContextValue;
  children: ReactNode;
}) {
  return (
    <GenerationNodeRuntimeContext.Provider value={value}>
      {children}
    </GenerationNodeRuntimeContext.Provider>
  );
}

export function useGenerationNodeRuntime() {
  return useContext(GenerationNodeRuntimeContext);
}
