/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// --- IMPORTS ---
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// --- WORKER CODE (INLINED) ---
// The entire worker script is embedded as a string to avoid external file loading
// issues in restrictive, sandboxed environments. This is the most robust solution.
const workerCode = `
// --- WORKER SCRIPT ---
// This code runs in a separate thread and has no access to the main DOM.
// Imports use full URLs to be compatible with blob-based workers.

import JSZip from 'https://esm.sh/jszip@^3.10.1';
// Fix: Import enums to ensure the request payload is built correctly.
import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@^0.14.0';

let ai; // Will be initialized on first message

// Fix: Use the official enums for safety settings, matching the main thread.
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

self.onmessage = async (event) => {
    const { analysisContent, fileContents, apiKey, model, maxBatchChars } = event.data;
    if (!ai) {
        ai = new GoogleGenAI({ apiKey });
    }

    try {
        const projectStructure = {
            Configuration: { keywords: ['config', 'vite', 'package.json', 'tsconfig', '.env', 'setup', 'html'], files: [] },
            Styling: { keywords: ['.css', '.scss', '.less', 'tailwind', 'styles'], files: [] },
            CoreLogic: { keywords: ['api', 'service', 'util', 'lib', 'core', 'helper', 'logic', 'server', 'controller', 'model', 'worker', '.ts', '.js'], files: [] },
            UI: { keywords: ['component', 'view', 'page', 'ui', 'layout', 'header', 'footer', '.tsx', '.jsx'], files: [] },
            Miscellaneous: { keywords: [], files: [] },
        };

        fileContents.forEach((file) => {
            const assignedPart = Object.keys(projectStructure).find(partName =>
                projectStructure[partName].keywords.some(kw => file.path.toLowerCase().includes(kw))
            ) || 'Miscellaneous';
            projectStructure[assignedPart].files.push(file);
        });

        const allGeneratedFiles = {};

        for (const partName of Object.keys(projectStructure)) {
            const part = projectStructure[partName];
            if (part.files.length === 0) continue;

            const batches = [];
            let currentBatch = [];
            let currentCharCount = 0;
            for (const file of part.files) {
                if (currentBatch.length > 0 && (currentCharCount + file.content.length > maxBatchChars)) {
                    batches.push(currentBatch);
                    currentBatch = [];
                    currentCharCount = 0;
                }
                currentBatch.push(file);
                currentCharCount += file.content.length;
            }
            if (currentBatch.length > 0) batches.push(currentBatch);
            
            for (let i = 0; i < batches.length; i++) {
                const batchFiles = batches[i];
                const statusMsg = batches.length > 1
                    ? \`Generating \${partName} (Batch \${i + 1}/\${batches.length})...\`
                    : \`Generating \${partName} (\${part.files.length} files)...\`;
                self.postMessage({ type: 'progress', partName, statusMsg, isStarting: i === 0, fileCount: part.files.length });

                const reimplementationPrompt = \`
                  You are an expert software engineer tasked with refactoring and improving a codebase based on a high-level analysis.
                  Your goal is to re-implement ONLY the files provided below, incorporating the suggestions from the analysis.
                  You MUST return a JSON object containing a single key "files". The value of "files" should be another object where keys are the full file paths (e.g., "src/components/Button.tsx") and values are the complete, new file contents as strings.
                  Do not add any new files. Only re-implement the ones provided. Ensure the code is complete and production-ready.

                  --- ANALYSIS CONTEXT ---
                  \${analysisContent}
                  --- END ANALYSIS CONTEXT ---

                  --- SOURCE FILES TO RE-IMPLEMENT ---
                  \${batchFiles.map(file => \`\\n\\n--- FILE: \${file.path} ---\\n\\\`\\\`\\\`\\n\${file.content}\\n\\\`\\\`\\\`\\n\`).join('')}
                  --- END SOURCE FILES ---
                \`;

                const result = await ai.models.generateContent({
                    model: model,
                    contents: [{role: 'user', parts: [{text: reimplementationPrompt}]}],
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                files: {
                                    type: Type.OBJECT,
                                    description: "An object where keys are the file paths (string) and values are the new file contents (string)."
                                }
                            },
                            required: ['files']
                        },
                        safetySettings,
                    }
                });
                
                const generated = JSON.parse(result.text);
                if (generated && generated.files) {
                    Object.assign(allGeneratedFiles, generated.files);
                } else {
                    throw new Error(\`AI returned invalid JSON structure for \${partName}.\`);
                }
            }
            self.postMessage({ type: 'progress-success', partName, fileCount: part.files.length });
        }

        const zip = new JSZip();
        for (const [filePath, content] of Object.entries(allGeneratedFiles)) {
            zip.file(filePath, content);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        self.postMessage({ type: 'complete', blob: zipBlob });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred in the worker.';
        self.postMessage({ type: 'error', message: errorMessage });
    }
};
`;

// --- CONFIGURATION ---
const config = {
  // NOTE: This key is exposed on the client side. This is a security risk.
  // This application is a Proof-of-Concept and should not be deployed publicly
  // without moving API calls to a secure backend.
  apiKey: process.env.API_KEY,
  model: 'gemini-2.5-pro', // Using a powerful and recent model
  maxAnalysisChars: 250000, // Safety limit for analysis payload
  maxBatchChars: 50000, // Limit content size per reimplementation API call
};

if (!config.apiKey || config.apiKey === 'undefined') {
  const err = 'API_KEY environment variable not set. Please create a .env file with API_KEY="YOUR_API_KEY" and restart the development server.';
  const el = document.querySelector('main');
  if (el) {
    el.innerHTML = `<p class="error-message" style="padding: 2rem; text-align: center;"><strong>Configuration Error:</strong> ${err}</p>`;
  }
  throw new Error(err);
}

// --- INITIALIZATION ---
const ai = new GoogleGenAI({ apiKey: config.apiKey });
const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];

// --- APPLICATION STATE ---
const state = {
  lastAnalysisContent: '',
  lastFileContents: [] as { path: string; content: string }[],
  reimplementationWorker: null as Worker | null,
};

// --- DOM ELEMENTS ---
const repoUrlInput = document.getElementById('repo-url') as HTMLInputElement;
const githubPatInput = document.getElementById('github-pat') as HTMLInputElement;
const existingAnalysisInput = document.getElementById(
  'existing-analysis-input'
) as HTMLTextAreaElement;
const analyzeButton = document.getElementById('analyze-repo-button') as HTMLButtonElement;
const generatePromptButton = document.getElementById('generate-prompt-button') as HTMLButtonElement;
const reimplementZipButton = document.getElementById('reimplement-zip-button') as HTMLButtonElement;
const outputContainer = document.getElementById('output-container') as HTMLDivElement;
const promptGenerationArea = document.getElementById('prompt-generation-area') as HTMLDivElement;
const reimplementationPromptOutput = document.getElementById('reimplementation-prompt-output') as HTMLDivElement;
const reimplementationOutput = document.getElementById('reimplementation-output') as HTMLDivElement;
const reimplementationProgress = document.getElementById('reimplementation-progress') as HTMLUListElement;

// --- UTILITY FUNCTIONS ---
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- UI FUNCTIONS ---
function setButtonState(button: HTMLButtonElement, text: string, isLoading: boolean) {
  button.disabled = isLoading;
  let content = `<span>${escapeHtml(text)}</span>`;
  if (isLoading) {
    content = `<div class="spinner"></div>` + content;
  }
  button.innerHTML = content;
}

function showStatus(message: string, container: HTMLElement = outputContainer) {
  container.innerHTML = `
    <div class="status-message">
      <div class="spinner"></div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function showError(message: string, container: HTMLElement = outputContainer) {
  const errorMessage = `<strong>Error:</strong> ${escapeHtml(message)}`;
  container.innerHTML = `<p class="error-message">${errorMessage}</p>`;
  if (container === outputContainer) {
    promptGenerationArea.style.display = 'none';
  }
}

function renderFileExplorer(fileContents: { path: string; content: string }[]): string {
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


// --- GITHUB API FUNCTIONS ---
function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  return match ? { owner: match[1], repo: match[2].replace('.git', '') } : null;
}

async function fetchFromGitHub<T>(url: string, headers: HeadersInit = {}): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`GitHub API Error (${response.status}): ${errorData.message}`);
  }
  return response.json() as Promise<T>;
}

async function fetchDefaultBranch(repoPath: string, headers: HeadersInit): Promise<string> {
  type RepoInfo = { default_branch: string };
  const data = await fetchFromGitHub<RepoInfo>(`https://api.github.com/repos/${repoPath}`, headers);
  return data.default_branch;
}

async function fetchRepoTree(repoPath: string, branch: string, headers: HeadersInit): Promise<string[]> {
  type TreeNode = { type: 'blob' | 'tree'; path: string };
  type TreeResponse = { tree: TreeNode[]; truncated: boolean };
  const url = `https://api.github.com/repos/${repoPath}/git/trees/${branch}?recursive=1`;
  const data = await fetchFromGitHub<TreeResponse>(url, headers);
  if (data.truncated) {
    console.warn('Repository file tree is truncated. Some files may not be included.');
  }
  return data.tree.filter(node => node.type === 'blob').map(node => node.path);
}

async function fetchFileContent(repoPath: string, branch: string, filePath: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repoPath}/${branch}/${encodeURIComponent(filePath)}`;
  try {
    const response = await fetch(url);
    if (response.ok) return await response.text();
    console.warn(`Failed to fetch ${filePath}: ${response.statusText}`);
    return null;
  } catch (e) {
    console.error(`Error fetching file content for ${filePath}:`, e);
    return null;
  }
}

// --- CORE APPLICATION LOGIC ---
async function analyzeRepository() {
  const repoUrl = repoUrlInput.value;
  if (!repoUrl) {
    showError('Please enter a repository URL.');
    return;
  }

  const repoInfo = parseRepoUrl(repoUrl);
  if (!repoInfo) {
    showError('Invalid GitHub repository URL format. Use "github.com/owner/repo".');
    return;
  }
  const repoPath = `${repoInfo.owner}/${repoInfo.repo}`;

  setButtonState(analyzeButton, 'Analyzing...', true);
  promptGenerationArea.style.display = 'none';
  reimplementationPromptOutput.innerHTML = '';
  reimplementationOutput.innerHTML = '';
  reimplementationProgress.innerHTML = '';

  try {
    const pat = githubPatInput.value.trim();
    const headers: HeadersInit = pat ? { 'Authorization': `Bearer ${pat}` } : {};

    // Steps 1 & 2: Fetch repo metadata and file tree
    showStatus('Fetching repository metadata...');
    const defaultBranch = await fetchDefaultBranch(repoPath, headers);
    showStatus(`Fetching repository file tree for branch '${defaultBranch}'...`);
    const fileList = await fetchRepoTree(repoPath, defaultBranch, headers);
    const readmeContent = (await fetchFileContent(repoPath, defaultBranch, 'README.md')) || '';

    // Step 3: Use AI to select important files
    showStatus('AI is selecting important files...');
    const selectionPrompt = `
      You are a senior software architect. Analyze the provided README and file list to select up to 100 of the most important source files for a code review.
      Focus on core application logic, configuration, and essential UI components.
      Exclude lock files (package-lock.json, yarn.lock), build outputs, assets (images, fonts), and extensive documentation.

      README (first 2000 chars):
      """
      ${readmeContent.substring(0, 2000)}
      """

      File list:
      ${JSON.stringify(fileList)}

      Respond with a JSON object containing a single key "files", which is an array of the selected file paths.
    `;
    const selectionResult = await ai.models.generateContent({
      model: config.model,
      contents: [{ role: 'user', parts: [{ text: selectionPrompt }] }],
      config: { responseMimeType: 'application/json', safetySettings },
    });
    const selectedFiles = JSON.parse(selectionResult.text).files as string[];
    if (!selectedFiles || selectedFiles.length === 0) {
      throw new Error('AI could not select any files. The repository might be empty or unsupported.');
    }

    // Step 4: Fetch content of selected files
    showStatus(`Fetching content for ${selectedFiles.length} files...`);
    const fileContents = (await Promise.all(
      selectedFiles.map(async (filePath: string) => {
        const content = await fetchFileContent(repoPath, defaultBranch, filePath);
        return content ? { path: filePath, content } : null;
      })
    )).filter(Boolean) as { path: string; content: string }[];
    state.lastFileContents = fileContents;

    // Step 5: Perform analysis
    const userAnalysis = existingAnalysisInput.value.trim();
    if (userAnalysis) {
      showStatus('Using provided analysis...');
      state.lastAnalysisContent = userAnalysis;
      const parsedAnalysis = await marked.parse(userAnalysis);
      outputContainer.innerHTML = `
          <h2>Analysis Result</h2>
          <div class="analysis-content">${DOMPurify.sanitize(parsedAnalysis)}</div>
          ${renderFileExplorer(fileContents)}
        `;
    } else {
      showStatus('AI is performing holistic analysis...');
      const allFileContentString = fileContents.map(f => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n');
      const totalChars = allFileContentString.length;

      let analysisPromise;
      if (totalChars > config.maxAnalysisChars) {
        showStatus(`Project is large (${totalChars} chars). Starting batched analysis...`);
        const batches: { path: string; content: string }[][] = [];
        let currentBatch: { path: string; content: string }[] = [];
        let currentCharCount = 0;
        for (const file of fileContents) {
          if (currentBatch.length > 0 && (currentCharCount + file.content.length > config.maxBatchChars)) {
            batches.push(currentBatch);
            currentBatch = [];
            currentCharCount = 0;
          }
          currentBatch.push(file);
          currentCharCount += file.content.length;
        }
        if (currentBatch.length > 0) batches.push(currentBatch);

        const partialAnalyses: string[] = [];
        for (let i = 0; i < batches.length; i++) {
          const batchFiles = batches[i];
          showStatus(`Analyzing file batch ${i + 1} of ${batches.length}...`);
          const batchContent = batchFiles.map(f => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n');
          const partialAnalysisPrompt = `
              You are an expert code reviewer. You are analyzing one part of a larger project.
              Provide a concise summary and analysis for ONLY the files provided below.
              Focus on the purpose of these specific files and identify any potential issues or areas for improvement within them.
              Do NOT provide a full project overview, as you only have a partial view.

              Analyze the following code files:
              ---
              ${batchContent}
              ---
            `;
          const partialResult = await ai.models.generateContent({ model: config.model, contents: [{ role: 'user', parts: [{ text: partialAnalysisPrompt }] }], config: { safetySettings } });
          partialAnalyses.push(partialResult.text);
        }

        showStatus('Synthesizing partial analyses into a final report...');
        const finalAnalysisPrompt = `
            You are an expert software architect. You have been provided with several partial code analyses from different parts of a single software project.
            Your task is to synthesize these partial reviews into a single, cohesive, high-level code review of the entire project.

            Identify the overarching themes and combine the individual points into a holistic assessment. Do not simply list the partial analyses.

            Structure your final review into the following sections using Markdown headings:
            1.  **Project Purpose and Architecture:** Describe what the application does and how it's structured based on all the provided context.
            2.  **Potential Flaws & Vulnerabilities:** Synthesize the key risks, weaknesses, and potential bugs from the partial analyses.
            3.  **Suggestions for Improvement:** Provide a prioritized, actionable list of recommendations for the whole project.

            Synthesize the following partial analyses:
            ---
            ${partialAnalyses.map((p, i) => `### Partial Analysis ${i + 1}\n${p}`).join('\n\n---\n\n')}
            ---
          `;
        analysisPromise = ai.models.generateContentStream({ model: config.model, contents: [{ role: 'user', parts: [{ text: finalAnalysisPrompt }] }], config: { safetySettings } });
      } else {
        const analysisPrompt = `
            You are an expert code reviewer and senior software architect. Perform a holistic, high-level code review of the following project files.

            Your goal is to provide a comprehensive assessment that would be useful to a new developer joining the team or for a technical lead planning the next phase of development.

            Structure your review into the following sections using Markdown headings:
            1.  **Project Purpose and Architecture:** Briefly describe what the application does and how it's structured (e.g., client-side only, SPA, build system, key libraries).
            2.  **Potential Flaws & Vulnerabilities:** Identify any security risks, architectural weaknesses, potential bugs, or reliability issues. Be specific.
            3.  **Suggestions for Improvement:** Provide actionable recommendations to address the identified flaws. Prioritize the most critical changes.

            Analyze the following code:
            ---
            ${allFileContentString}
            ---
          `;
        analysisPromise = ai.models.generateContentStream({ model: config.model, contents: [{ role: 'user', parts: [{ text: analysisPrompt }] }], config: { safetySettings } });
      }
      
      outputContainer.innerHTML = `
        <h2>Analysis Result</h2>
        <div class="analysis-content"></div>
      `;
      const analysisContentDiv = outputContainer.querySelector('.analysis-content') as HTMLDivElement;
      
      let analysisContent = '';
      for await (const chunk of await analysisPromise) {
        analysisContent += chunk.text;
        analysisContentDiv.innerHTML = DOMPurify.sanitize(await marked.parse(analysisContent));
      }
      state.lastAnalysisContent = analysisContent;
      outputContainer.insertAdjacentHTML('beforeend', renderFileExplorer(fileContents));
    }
    
    promptGenerationArea.style.display = 'block';

  } catch (error) {
    console.error('Error analyzing repository:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage);
  } finally {
    setButtonState(analyzeButton, 'Analyze Repository', false);
  }
}

function reimplementAndZip() {
  if (!state.lastAnalysisContent || state.lastFileContents.length === 0) {
    showError('No analysis data available. Please analyze a repository first.', reimplementationOutput);
    return;
  }
  const repoInfo = parseRepoUrl(repoUrlInput.value);
  if (!repoInfo) {
    showError('Could not parse repository URL for naming the zip file.', reimplementationOutput);
    return;
  }

  // Fix: Add a robust check to ensure the API key is valid before proceeding.
  if (!config.apiKey || config.apiKey === 'undefined' || !config.apiKey.trim()) {
    showError('API Key is not configured correctly. Please ensure your API_KEY is set in the .env file and the development server was restarted.', reimplementationOutput);
    return;
  }

  setButtonState(reimplementZipButton, 'Working...', true);
  setButtonState(generatePromptButton, 'Generate Demo Prompt', true);
  reimplementationProgress.innerHTML = '';
  reimplementationOutput.innerHTML = '';

  // Terminate any existing worker to prevent race conditions or memory leaks
  if (state.reimplementationWorker) {
    state.reimplementationWorker.terminate();
  }

  // Create the worker from the inlined code string.
  // This is the most robust method for restrictive environments as it avoids
  // any external file loading, which was causing security errors.
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  state.reimplementationWorker = new Worker(workerUrl, { type: 'module' });
  URL.revokeObjectURL(workerUrl); // Clean up the object URL immediately after use

  const progressItems: Record<string, HTMLLIElement> = {};

  state.reimplementationWorker.onmessage = (e) => {
    const { type, partName, statusMsg, isStarting, fileCount, blob, message } = e.data;
    switch (type) {
      case 'progress':
        if (isStarting && !progressItems[partName]) {
          const li = document.createElement('li');
          reimplementationProgress.appendChild(li);
          progressItems[partName] = li;
        }
        progressItems[partName].textContent = `⏳ ${statusMsg}`;
        progressItems[partName].className = 'in-progress';
        break;
      case 'progress-success':
        progressItems[partName].textContent = `✅ ${partName} (${fileCount} files) successfully generated.`;
        progressItems[partName].className = 'success';
        break;
      case 'complete':
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `reimplemented-${repoInfo.repo}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
        setButtonState(reimplementZipButton, 'Re-implement & Download ZIP', false);
        setButtonState(generatePromptButton, 'Generate Demo Prompt', false);
        state.reimplementationWorker?.terminate();
        state.reimplementationWorker = null;
        break;
      case 'error':
        showError(message, reimplementationOutput);
        setButtonState(reimplementZipButton, 'Re-implement & Download ZIP', false);
        setButtonState(generatePromptButton, 'Generate Demo Prompt', false);
        state.reimplementationWorker?.terminate();
        state.reimplementationWorker = null;
        break;
    }
  };

  state.reimplementationWorker.onerror = (e) => {
    console.error('Error in re-implementation worker:', e);
    showError(`Worker error: ${e.message}`, reimplementationOutput);
    setButtonState(reimplementZipButton, 'Re-implement & Download ZIP', false);
    setButtonState(generatePromptButton, 'Generate Demo Prompt', false);
    state.reimplementationWorker?.terminate();
    state.reimplementationWorker = null;
  };

  state.reimplementationWorker.postMessage({
      analysisContent: state.lastAnalysisContent,
      fileContents: state.lastFileContents,
      apiKey: config.apiKey,
      model: config.model,
      maxBatchChars: config.maxBatchChars
  });
}

async function generateReimplementationPrompt() {
    if (!state.lastAnalysisContent || state.lastFileContents.length === 0) {
        showError('No analysis data available. Please analyze a repository first.', reimplementationPromptOutput);
        return;
    }
    setButtonState(generatePromptButton, 'Generating...', true);
    reimplementationPromptOutput.innerHTML = '';
    showStatus('Creating demonstration prompt...', reimplementationPromptOutput);

    try {
        // Use the first file as an example for the demo prompt
        const demoFile = state.lastFileContents[0];
        
        const prompt = `You are an expert software engineer tasked with refactoring and improving a codebase based on a high-level analysis.
Your goal is to re-implement ONLY the files provided below, incorporating the suggestions from the analysis.
You MUST return a JSON object containing a single key "files". The value of "files" should be another object where keys are the full file paths (e.g., "src/components/Button.tsx") and values are the complete, new file contents as strings.
Do not add any new files. Only re-implement the ones provided. Ensure the code is complete and production-ready.

--- ANALYSIS CONTEXT ---
${state.lastAnalysisContent}
--- END ANALYSIS CONTEXT ---

--- SOURCE FILES TO RE-IMPLEMENT ---
--- FILE: ${demoFile.path} ---
\`\`\`
${demoFile.content}
\`\`\`
--- END SOURCE FILES ---
`;

        const escapedPrompt = escapeHtml(prompt);
        reimplementationPromptOutput.innerHTML = `
            <div class="prompt-display">
                <button class="copy-button">Copy</button>
                <pre><code>${escapedPrompt}</code></pre>
            </div>
        `;
        reimplementationPromptOutput.querySelector('.copy-button')?.addEventListener('click', (e) => {
            const button = e.target as HTMLButtonElement;
            navigator.clipboard.writeText(prompt).then(() => {
                button.textContent = 'Copied!';
                setTimeout(() => { button.textContent = 'Copy'; }, 2000);
            });
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        showError(errorMessage, reimplementationPromptOutput);
    } finally {
        setButtonState(generatePromptButton, 'Generate Demo Prompt', false);
    }
}

// --- EVENT LISTENERS ---
analyzeButton.addEventListener('click', analyzeRepository);
generatePromptButton.addEventListener('click', generateReimplementationPrompt);
reimplementZipButton.addEventListener('click', reimplementAndZip);