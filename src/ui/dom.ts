// src/ui/dom.ts

import { escapeHtml } from "../utils";

export const repoUrlInput = document.getElementById('repo-url') as HTMLInputElement;
export const githubPatInput = document.getElementById('github-pat') as HTMLInputElement;
export const existingAnalysisInput = document.getElementById(
  'existing-analysis-input'
) as HTMLTextAreaElement;
export const analyzeButton = document.getElementById('analyze-repo-button') as HTMLButtonElement;
export const generatePromptButton = document.getElementById('generate-prompt-button') as HTMLButtonElement;
export const reimplementZipButton = document.getElementById('reimplement-zip-button') as HTMLButtonElement;
export const outputContainer = document.getElementById('output-container') as HTMLDivElement;
export const promptGenerationArea = document.getElementById('prompt-generation-area') as HTMLDivElement;
export const reimplementationPromptOutput = document.getElementById('reimplementation-prompt-output') as HTMLDivElement;
export const reimplementationOutput = document.getElementById('reimplementation-output') as HTMLDivElement;
export const reimplementationProgress = document.getElementById('reimplementation-progress') as HTMLUListElement;


export function setButtonState(button: HTMLButtonElement, text: string, isLoading: boolean) {
  button.disabled = isLoading;
  let content = `<span>${escapeHtml(text)}</span>`;
  if (isLoading) {
    content = `<div class="spinner"></div>` + content;
  }
  button.innerHTML = content;
}

export function showStatus(message: string, container: HTMLElement = outputContainer) {
  container.innerHTML = `
    <div class="status-message">
      <div class="spinner"></div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

export function showError(message: string, container: HTMLElement = outputContainer) {
  const errorMessage = `<strong>Error:</strong> ${escapeHtml(message)}`;
  container.innerHTML = `<p class="error-message">${errorMessage}</p>`;
  if (container === outputContainer) {
    promptGenerationArea.style.display = 'none';
  }
}

export function renderFileExplorer(fileContents: { path: string; content: string }[]): string {
    return `
      <h2>Analyzed Files (${fileContents.length})</h2>
      <div class="file-explorer">
      ${fileContents
        .map(file => `
          <details>
            <summary>${escapeHtml(file.path)}</summary>
            <pre><code>${escapeHtml(file.content)}</code></pre>
          </details>
        `).join('')}
      </div>
    `;
}
