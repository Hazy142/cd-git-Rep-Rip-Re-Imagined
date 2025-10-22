/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// --- IMPORTS ---
import { GoogleGenAI, HarmBlockThreshold, HarmCategory, Type } from '@google/genai';
import { marked } from 'marked';
import JSZip from 'jszip';
import DOMPurify from 'dompurify';

// --- CONFIGURATION ---
const config = {
  // NOTE: This key is exposed on the client side. This is a security risk.
  // This application is a Proof-of-Concept and should not be deployed publicly
  // without moving API calls to a secure backend.
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-1.5-pro-latest', // Using latest for better features like JSON mode
  maxAnalysisChars: 250000, // Safety limit for analysis payload
  maxBatchChars: 50000, // Limit content size per reimplementation API call
};

if (!config.apiKey) {
  throw new Error('GEMINI_API_KEY environment variable not set.');
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

function renderAnalysisResult(
  analysisContent: string,
  fileContents: { path: string; content: string }[]
) {
  const fileExplorerHtml = fileContents
    .map(file => `
      <details>
        <summary>${escapeHtml(file.path)}</summary>
        <pre><code>${escapeHtml(file.content)}</code></pre>
      </details>
    `).join('');

  const unsafeHtml = marked.parse(analysisContent);
  const safeHtml = DOMPurify.sanitize(unsafeHtml as string);

  outputContainer.innerHTML = `
      <h2>Analysis Result</h2>
      <div class="analysis-content">${safeHtml}</div>
      <h2>Analyzed Files (${fileContents.length})</h2>
      <div class="file-explorer">${fileExplorerHtml}</div>
  `;
  promptGenerationArea.style.display = 'block';
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
    const genAI = ai.getGenerativeModel({ model: config.model, safetySettings });
    const selectionResult = await genAI.generateContent({
      contents: [{ role: 'user', parts: [{ text: selectionPrompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    const selectedFiles = JSON.parse(selectionResult.response.text()).files as string[];
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
    let analysisContent: string;
    const userAnalysis = existingAnalysisInput.value.trim();
    if (userAnalysis) {
      showStatus('Using provided analysis...');
      analysisContent = userAnalysis;
    } else {
      showStatus('AI is performing holistic analysis...');
      const allFileContent = fileContents.map(f => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n');
      if (allFileContent.length > config.maxAnalysisChars) {
          throw new Error(`Project is too large to analyze (${allFileContent.length} chars). Please try a smaller repository or provide an existing analysis.`);
      }
      const analysisPrompt = `
        You are an expert code reviewer. Provide a holistic, high-level analysis of this project based on the following files.
        1.  **Project Purpose and Architecture:** What does it do and how is it built?
        2.  **Potential Flaws & Vulnerabilities:** Identify architectural weaknesses, common bugs, or security risks.
        3.  **Suggestions for Improvement:** Recommend specific, actionable improvements for code quality, performance, and maintainability.
        Format your response in clear, well-structured markdown.

        Code:
        ${allFileContent}
      `;
      const analysisResult = await genAI.generateContent(analysisPrompt);
      analysisContent = analysisResult.response.text();
    }
    state.lastAnalysisContent = analysisContent;

    // Step 6: Display results
    renderAnalysisResult(analysisContent, fileContents);
  } catch (error) {
    console.error('Error analyzing repository:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage);
  } finally {
    setButtonState(analyzeButton, 'Analyze Repository', false);
  }
}

async function reimplementAndZip() {
  if (!state.lastAnalysisContent || state.lastFileContents.length === 0) {
    showError('No analysis data available. Please analyze a repository first.', reimplementationOutput);
    return;
  }

  const repoInfo = parseRepoUrl(repoUrlInput.value);
  if (!repoInfo) {
    showError('Could not parse repository URL for naming the zip file.', reimplementationOutput);
    return;
  }

  setButtonState(reimplementZipButton, 'Working...', true);
  setButtonState(generatePromptButton, 'Generate Demo Prompt', true);
  reimplementationProgress.innerHTML = '';
  reimplementationOutput.innerHTML = '';

  const genAI = ai.getGenerativeModel({ model: config.model, safetySettings });

  try {
    const projectStructure = {
      Configuration: { keywords: ['config', 'vite', 'package.json', 'tsconfig', '.env', 'setup'], files: [] as { path: string; content: string }[] },
      Styling: { keywords: ['.css', '.scss', '.less', 'tailwind', 'styles'], files: [] as { path: string; content: string }[] },
      CoreLogic: { keywords: ['api', 'service', 'util', 'lib', 'core', 'helper', 'logic', 'server', 'controller', 'model'], files: [] as { path: string; content: string }[] },
      UI: { keywords: ['component', 'view', 'page', 'ui', 'layout', 'header', 'footer', '.html'], files: [] as { path: string; content: string }[] },
      Miscellaneous: { keywords: [], files: [] as { path: string; content: string }[] },
    };
    type PartName = keyof typeof projectStructure;

    // Categorize files
    state.lastFileContents.forEach(file => {
      const assignedPart = (Object.keys(projectStructure) as PartName[]).find(partName =>
        projectStructure[partName].keywords.some(kw => file.path.toLowerCase().includes(kw))
      ) || 'Miscellaneous';
      projectStructure[assignedPart].files.push(file);
    });

    const allGeneratedFiles: Record<string, string> = {};

    for (const partName of Object.keys(projectStructure) as PartName[]) {
      const part = projectStructure[partName];
      if (part.files.length === 0) continue;

      // Batch files within the category based on character count
      const batches: { path: string; content: string }[][] = [];
      let currentBatch: { path: string; content: string }[] = [];
      let currentCharCount = 0;
      for (const file of part.files) {
        if (currentBatch.length > 0 && (currentCharCount + file.content.length > config.maxBatchChars)) {
          batches.push(currentBatch);
          currentBatch = [];
          currentCharCount = 0;
        }
        currentBatch.push(file);
        currentCharCount += file.content.length;
      }
      if (currentBatch.length > 0) batches.push(currentBatch);

      const progressItem = document.createElement('li');
      reimplementationProgress.appendChild(progressItem);
      
      for (let i = 0; i < batches.length; i++) {
        const batchFiles = batches[i];
        const statusMsg = batches.length > 1
            ? `⏳ Generating ${partName} (Batch ${i + 1}/${batches.length})...`
            : `⏳ Generating ${partName} (${part.files.length} files)...`;
        progressItem.textContent = statusMsg;
        progressItem.className = 'in-progress';

        const reimplementationPrompt = `
          Based on the provided analysis and source files, re-implement ONLY the following files.
          Provide the full, improved code for each file. Adhere to best practices.

          Analysis Context:
          ---
          ${state.lastAnalysisContent}
          ---

          Files to re-implement in this batch:
          ${batchFiles.map(file => `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\``).join('')}
        `;

        // Using robust JSON mode for the response
        const result = await genAI.generateContent({
            contents: [{role: 'user', parts: [{text: reimplementationPrompt}]}],
            generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        files: {
                            type: Type.OBJECT,
                            description: "An object where keys are file paths (string) and values are the new file contents (string)."
                        }
                    },
                    required: ['files']
                }
            }
        });
        
        const generated = JSON.parse(result.response.text());
        if (generated && generated.files) {
          Object.assign(allGeneratedFiles, generated.files);
        } else {
            throw new Error(`AI returned invalid JSON structure for ${partName}.`);
        }
      }
      progressItem.textContent = `✅ ${partName} (${part.files.length} files) successfully generated.`;
      progressItem.className = 'success';
    }

    // Create and download ZIP file
    const zip = new JSZip();
    for (const [filePath, content] of Object.entries(allGeneratedFiles)) {
      zip.file(filePath, content);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const downloadUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `reimplemented-${repoInfo.repo}.zip`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Error during re-implementation:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage, reimplementationOutput);
  } finally {
    setButtonState(reimplementZipButton, 'Re-implement & Download ZIP', false);
    setButtonState(generatePromptButton, 'Generate Demo Prompt', false);
  }
}

// NOTE: This function is for demonstration and is not part of the core reimplementation flow.
// It shows how a prompt *could* be generated for another tool.
async function generateReimplementationPrompt() {
    if (!state.lastAnalysisContent || state.lastFileContents.length === 0) {
        showError('No analysis data available. Please analyze a repository first.', reimplementationPromptOutput);
        return;
    }

    setButtonState(generatePromptButton, 'Generating...', true);
    reimplementationPromptOutput.innerHTML = '';
    showStatus('Creating demonstration prompt...', reimplementationPromptOutput);

    try {
        const prompt = `
You are an expert AI developer. Re-implement the following project from scratch based on the provided analysis and original source code.
Incorporate all suggestions from the analysis to improve the project.

Analysis:
---
${state.lastAnalysisContent}
---

Original Source Code:
${state.lastFileContents.map(file => `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\``).join('')}

Your task:
1.  Carefully review the analysis and code.
2.  Provide a complete, file-by-file reimplementation of the entire project.
3.  For each file, provide the full, corrected, and improved code. Do not use placeholders or omit code.
4.  Your final response should be a single JSON object. This object must contain one key, "files".
5.  The value for "files" must be another object, where each key is the full file path (e.g., "src/index.ts") and the value is the new file content as a string.
        `;

        reimplementationPromptOutput.innerHTML = `
          <div class="prompt-display">
            <textarea readonly>${escapeHtml(prompt)}</textarea>
            <button class="copy-button">Copy</button>
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
