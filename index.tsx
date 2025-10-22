/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';
import JSZip from 'jszip';
import DOMPurify from 'dompurify';

// Correctly initialize the Google AI client
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable not set');
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Get DOM elements
const repoUrlInput = document.getElementById('repo-url') as HTMLInputElement;
const githubPatInput = document.getElementById('github-pat') as HTMLInputElement;
const existingAnalysisInput = document.getElementById(
  'existing-analysis-input'
) as HTMLTextAreaElement;
const analyzeButton = document.getElementById(
  'analyze-repo-button'
) as HTMLButtonElement;
const generatePromptButton = document.getElementById(
  'generate-prompt-button'
) as HTMLButtonElement;
const reimplementZipButton = document.getElementById(
  'reimplement-zip-button'
) as HTMLButtonElement;
const outputContainer = document.getElementById(
  'output-container'
) as HTMLDivElement;
const promptGenerationArea = document.getElementById(
  'prompt-generation-area'
) as HTMLDivElement;
const reimplementationPromptOutput = document.getElementById(
  'reimplementation-prompt-output'
) as HTMLDivElement;
const reimplementationOutput = document.getElementById(
  'reimplementation-output'
) as HTMLDivElement;
const reimplementationProgress = document.getElementById(
  'reimplementation-progress'
) as HTMLUListElement;

// Module-level variables to store the last analysis results
let lastAnalysisContent: string | null = null;
let lastFileContents: { path: string; content: string }[] = [];

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setButtonState(
  button: HTMLButtonElement,
  text: string,
  isLoading: boolean
) {
  button.disabled = isLoading;
  let content = `<span>${escapeHtml(text)}</span>`;
  if (isLoading) {
    content = `<div class="spinner"></div>` + content;
  }
  button.innerHTML = content;
}

function showStatus(message: string, container: HTMLElement) {
  container.innerHTML = `
    <div class="status-message">
      <div class="spinner"></div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function showError(message: string, container: HTMLElement) {
  container.innerHTML = `<p style="color: red;"><strong>Error:</strong> ${escapeHtml(
    message
  )}</p>`;
  if (container === outputContainer) {
    promptGenerationArea.style.display = 'none';
  }
}

function showReimplementationError(message: string) {
  const errorElement = document.createElement('p');
  errorElement.style.color = 'red';
  errorElement.style.fontWeight = 'bold';
  errorElement.innerHTML = `<strong>Error:</strong> ${escapeHtml(message)}`;
  reimplementationOutput.appendChild(errorElement);
}

async function fetchFromGitHub(
  url: string,
  headers: HeadersInit = {}
): Promise<any> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `GitHub API Error: ${
        errorData.message || response.statusText
      } (URL: ${url})`
    );
  }
  return response.json();
}

async function fetchDefaultBranch(
  repoPath: string,
  headers: HeadersInit
): Promise<string> {
  const data = await fetchFromGitHub(
    `https://api.github.com/repos/${repoPath}`,
    headers
  );
  return data.default_branch;
}

async function fetchRepoTree(
  repoPath: string,
  branch: string,
  headers: HeadersInit
): Promise<string[]> {
  const url = `https://api.github.com/repos/${repoPath}/git/trees/${branch}?recursive=1`;
  const data = await fetchFromGitHub(url, headers);
  return data.tree
    .filter((node: { type: string }) => node.type === 'blob')
    .map((node: { path: string }) => node.path);
}

async function fetchFileContent(
  repoPath: string,
  branch: string,
  filePath: string
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repoPath}/${branch}/${filePath}`;
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.text();
    }
  } catch (e) {
    // Ignore fetch errors, will be handled as null
  }
  return null;
}

function parseRepoUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/.]+)/);
  return match ? match[1].replace('.git', '') : null;
}

async function analyzeRepository() {
  const repoUrl = repoUrlInput.value;
  if (!repoUrl) {
    showError('Please enter a repository URL.', outputContainer);
    return;
  }

  const repoPath = parseRepoUrl(repoUrl);
  if (!repoPath) {
    showError('Invalid GitHub repository URL format.', outputContainer);
    return;
  }

  setButtonState(analyzeButton, 'Analyzing...', true);
  promptGenerationArea.style.display = 'none';
  reimplementationPromptOutput.innerHTML = '';
  reimplementationOutput.innerHTML = '';
  reimplementationProgress.innerHTML = '';

  try {
    const pat = githubPatInput.value.trim();
    const headers: HeadersInit = {};
    if (pat) {
      headers['Authorization'] = `token ${pat}`;
    }

    // Step 1: Fetch default branch
    showStatus('Fetching repository metadata...', outputContainer);
    const defaultBranch = await fetchDefaultBranch(repoPath, headers);

    // Step 2: Fetch repository structure
    showStatus(
      `Fetching repository structure for branch '${defaultBranch}'...`,
      outputContainer
    );
    const fileList = await fetchRepoTree(repoPath, defaultBranch, headers);
    const readmeContent =
      (await fetchFileContent(repoPath, defaultBranch, 'README.md')) || '';

    // Step 3: Use AI to select important files
    showStatus('AI is selecting important files...', outputContainer);
    const selectionPrompt = `
      You are a senior software architect. Based on the project's README and the full list of files, select up to 100 of the most important files for a code review.
      Focus on source code, core logic, configuration files, and key components.
      Exclude assets (images, fonts), lock files (package-lock.json, yarn.lock), build outputs, and general documentation (other than the README).
      
      README content:
      """
      ${readmeContent.substring(0, 2000)}
      """

      File list:
      ${JSON.stringify(fileList)}

      Return your selection as a JSON object with a single key "files" which is an array of the file paths you have selected.
    `;

    const selectionResponse = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: selectionPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            files: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['files'],
        },
      },
    });

    const selectedFiles = JSON.parse(selectionResponse.text).files;
    if (!selectedFiles || selectedFiles.length === 0) {
      throw new Error('AI could not select any files to analyze.');
    }

    // Step 4: Fetch content of selected files
    showStatus(
      `Fetching content for ${selectedFiles.length} files...`,
      outputContainer
    );
    const fileContents: { path: string; content: string }[] = [];
    await Promise.all(
      selectedFiles.map(async (filePath: string) => {
        const content = await fetchFileContent(
          repoPath,
          defaultBranch,
          filePath
        );
        if (content) {
          fileContents.push({ path: filePath, content });
        }
      })
    );
    lastFileContents = fileContents; // Cache for prompt generation

    // Step 5: Perform analysis
    let analysisContent: string;
    const userAnalysis = existingAnalysisInput.value.trim();

    if (userAnalysis) {
      showStatus('Using provided analysis...', outputContainer);
      analysisContent = userAnalysis;
    } else {
      showStatus('AI is performing holistic analysis...', outputContainer);
      const analysisPrompt = `
        You are an expert code reviewer. Provide a holistic, high-level analysis of the project based on the following files. Cover:
        1. Project's purpose and architecture.
        2. Potential architectural flaws, bugs, or security vulnerabilities.
        3. Suggestions for overall improvements.
        Structure your response in clear, well-formatted markdown.

        Code:
        ${fileContents
          .map(
            (file) =>
              `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\``
          )
          .join('')}
      `;

      const analysisResponse = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: analysisPrompt,
      });
      analysisContent = analysisResponse.text;
    }

    lastAnalysisContent = analysisContent; // Cache for prompt generation

    // Step 6: Display results securely
    const fileExplorerHtml = fileContents
      .map(
        (file) => `
      <details>
        <summary>${escapeHtml(file.path)}</summary>
        <pre><code>${escapeHtml(file.content)}</code></pre>
      </details>
    `
      )
      .join('');

    const unsafeHtml = await marked.parse(analysisContent);
    const safeHtml = DOMPurify.sanitize(unsafeHtml);

    outputContainer.innerHTML = `
        <h2>Analysis Result</h2>
        ${safeHtml}
        <h2>Analyzed Files (${fileContents.length})</h2>
        ${fileExplorerHtml}
    `;

    promptGenerationArea.style.display = 'block';
  } catch (error) {
    console.error('Error analyzing repository:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage, outputContainer);
  } finally {
    setButtonState(analyzeButton, 'Analyze Repository', false);
  }
}

async function generateReimplementationPrompt() {
  if (!lastAnalysisContent || lastFileContents.length === 0) {
    showError(
      'No analysis data available. Please analyze a repository first.',
      reimplementationPromptOutput
    );
    return;
  }

  setButtonState(generatePromptButton, 'Generating...', true);
  reimplementationOutput.innerHTML = '';
  reimplementationProgress.innerHTML = '';
  showStatus('Creating detailed prompt...', reimplementationPromptOutput);

  try {
    const prompt = `
      Create a single, comprehensive prompt to instruct a senior developer AI to re-implement an entire software project from scratch, incorporating all suggestions from the provided analysis.

      Analysis:
      ---
      ${lastAnalysisContent}
      ---

      Source Code:
      ${lastFileContents
        .map(
          (file) =>
            `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\``
        )
        .join('')}

      Generate a prompt that instructs the AI to:
      1. Act as an expert software developer.
      2. Rebuild the entire project, providing a complete file-by-file implementation plan.
      3. For each file, provide the full, corrected, and improved code.
      4. Ensure the response format is a single JSON object containing a 'files' key. The value should be another object where keys are the full file paths and values are the string content of the files.
    `;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt,
    });

    const generatedPrompt = response.text;

    reimplementationPromptOutput.innerHTML = `
      <div style="position: relative;">
        <textarea readonly>${escapeHtml(generatedPrompt)}</textarea>
        <button class="copy-button">Copy</button>
      </div>
    `;
    reimplementationPromptOutput
      .querySelector('.copy-button')
      ?.addEventListener('click', () => {
        navigator.clipboard.writeText(generatedPrompt).then(() => {
          const button = reimplementationPromptOutput.querySelector(
            '.copy-button'
          ) as HTMLButtonElement;
          if (button) {
            button.textContent = 'Copied!';
            setTimeout(() => {
              button.textContent = 'Copy';
            }, 2000);
          }
        });
      });
  } catch (error) {
    console.error('Error generating reimplementation prompt:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage, reimplementationPromptOutput);
  } finally {
    setButtonState(
      generatePromptButton,
      'Generate Re-implementation Prompt',
      false
    );
  }
}

async function reimplementAndZip() {
  if (!lastAnalysisContent || lastFileContents.length === 0) {
    showReimplementationError(
      'No analysis data available. Please analyze a repository first.'
    );
    return;
  }

  setButtonState(reimplementZipButton, 'Working...', true);
  setButtonState(generatePromptButton, 'Generate Re-implementation Prompt', true);
  reimplementationProgress.innerHTML = '';
  reimplementationOutput.innerHTML = '';

  const MAX_CHARS_PER_BATCH = 50000; // Limit content size per API call

  try {
    const projectParts = [
      {
        name: 'Configuration',
        keywords: ['config', 'vite', 'package.json', 'tsconfig', '.env', 'setup', 'init'],
      },
      { name: 'Styling', keywords: ['.css', '.scss', '.less', 'tailwind', 'styles'] },
      {
        name: 'Core Logic/Services',
        keywords: ['api', 'service', 'util', 'lib', 'core', 'helper', 'logic', 'server'],
      },
      {
        name: 'UI Components',
        keywords: ['component', 'view', 'page', 'ui', 'layout', 'header', 'footer'],
      },
      { name: 'Miscellaneous', keywords: [] },
    ];

    // --- New, more robust categorization logic ---
    const categorizedFiles: { [key: string]: { path: string; content: string }[] } = {};
    projectParts.forEach(part => (categorizedFiles[part.name] = []));

    for (const file of lastFileContents) {
      let assigned = false;
      for (const part of projectParts) {
        if (part.name === 'Miscellaneous') continue;
        if (part.keywords.some(kw => file.path.toLowerCase().includes(kw))) {
          categorizedFiles[part.name].push(file);
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        categorizedFiles['Miscellaneous'].push(file);
      }
    }
    // --- End of new categorization logic ---

    const allGeneratedFiles: { [key: string]: string } = {};

    for (const part of projectParts) {
      const filesToProcess = categorizedFiles[part.name];
      if (filesToProcess.length === 0) continue;

      // --- New batching logic based on character count ---
      const batches: { path: string; content: string }[][] = [];
      let currentBatch: { path: string; content: string }[] = [];
      let currentCharCount = 0;

      for (const file of filesToProcess) {
        const fileCharCount = file.content.length;
        // If a single file is too large, it gets its own batch
        if (currentBatch.length > 0 && (currentCharCount + fileCharCount > MAX_CHARS_PER_BATCH)) {
          batches.push(currentBatch);
          currentBatch = [file];
          currentCharCount = fileCharCount;
        } else {
          currentBatch.push(file);
          currentCharCount += fileCharCount;
        }
      }
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
      // --- End of new batching logic ---

      const progressItem = document.createElement('li');
      reimplementationProgress.appendChild(progressItem);

      const numBatches = batches.length;

      for (let i = 0; i < numBatches; i++) {
        const batchIndex = i + 1;
        const batchFiles = batches[i];

        const updateStatus = (
          message: string,
          statusClass: 'in-progress' | 'success' | 'error' | 'warning'
        ) => {
          progressItem.textContent = message;
          progressItem.className = statusClass;
        };
        
        const statusMsg = numBatches > 1 
            ? `⏳ Generating ${part.name} (Batch ${batchIndex} of ${numBatches})...`
            : `⏳ Generating ${part.name} (${filesToProcess.length} files)...`;

        updateStatus(statusMsg, 'in-progress');

        const reimplementationPrompt = `
          Based on the provided analysis and source files, re-implement ONLY the following files.
          Provide the full, improved code for each file. Adhere to best practices.

          Analysis Context:
          ---
          ${lastAnalysisContent}
          ---

          Files to re-implement in this batch:
          ${batchFiles
            .map(
              (file) =>
                `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\``
            )
            .join('')}

          Your response MUST be a single, valid JSON object with a single key "files".
          The value of "files" should be an object where each key is the file path (e.g., "src/utils/api.ts") and the value is the complete, new string content for that file.
          Do NOT include any markdown formatting (like \`\`\`json) around the JSON object.
        `;

        let success = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await ai.models.generateContent({
              model: 'gemini-2.5-pro',
              contents: reimplementationPrompt,
            });

            let responseText = response.text.trim();
            if (responseText.startsWith('```json')) {
              responseText = responseText.substring(7, responseText.length - 3).trim();
            }

            const result = JSON.parse(responseText);
            if (result && result.files) {
              Object.assign(allGeneratedFiles, result.files);
              success = true;
              break;
            } else {
              throw new Error('Invalid JSON structure in AI response.');
            }
          } catch (error) {
            if (attempt === 2) {
              const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
              updateStatus(`❌ Error in ${part.name} (Batch ${batchIndex}): ${errorMessage}`, 'error');
              throw new Error(`Failed to generate batch for ${part.name}.`);
            }
            updateStatus(`⚠️ Retrying ${part.name} (Batch ${batchIndex})...`, 'warning');
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        if (!success) {
          throw new Error(`Batch generation failed for ${part.name} after retries.`);
        }
      }
      progressItem.textContent = `✅ ${part.name} (${filesToProcess.length} files) successfully generated.`;
      progressItem.className = 'success';
    }

    const zip = new JSZip();
    for (const [filePath, content] of Object.entries(allGeneratedFiles)) {
      zip.file(filePath, content);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const downloadUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'reimplemented-project.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Error during re-implementation:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    showReimplementationError(errorMessage);
  } finally {
    setButtonState(reimplementZipButton, 'Re-implement & Download ZIP', false);
    setButtonState(
      generatePromptButton,
      'Generate Re-implementation Prompt',
      false
    );
  }
}

// Event Listeners
analyzeButton.addEventListener('click', analyzeRepository);
generatePromptButton.addEventListener('click', generateReimplementationPrompt);
reimplementZipButton.addEventListener('click', reimplementAndZip);
