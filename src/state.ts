// src/state.ts

export const state = {
  lastAnalysisContent: '',
  lastFileContents: [] as { path: string; content: string }[],
  reimplementationWorker: null as Worker | null,
};
