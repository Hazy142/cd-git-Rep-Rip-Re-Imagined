/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import { marked } from 'marked';
import JSZip from 'jszip';

// Correctly initialize the Google AI client
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error('API_KEY environment variable not set');
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

// Get DOM elements
const repoUrlInput = document.getElementById('repo-url') as HTMLInputElement;
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

async function fetchRepoTree(repoPath: string): Promise<string[]> {
  const branches = ['main', 'master'];
  for (const branch of branches) {
    const url = `https://api.github.com/repos/${repoPath}/git/trees/${branch}?recursive=1`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        return data.tree
          .filter((node: { type: string }) => node.type === 'blob')
          .map((node: { path: string }) => node.path);
      }
    } catch (e) {
      // Ignore and try next branch
    }
  }
  throw new Error(
    `Could not fetch repository tree. Check URL and ensure repository is public.`
  );
}

async function fetchFileContent(
  repoPath: string,
  filePath: string
): Promise<string | null> {
  const branches = ['main', 'master'];
  for (const branch of branches) {
    const url = `https://raw.githubusercontent.com/${repoPath}/${branch}/${filePath}`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
    } catch (e) {
      // Ignore fetch errors
    }
  }
  return null; // Return null if not found in any branch
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

  analyzeButton.disabled = true;
  analyzeButton.textContent = 'Analyzing...';
  promptGenerationArea.style.display = 'none';
  reimplementationPromptOutput.innerHTML = '';
  reimplementationOutput.innerHTML = '';

  try {
    // Step 1: Fetch repository structure
    showStatus('Fetching repository structure...', outputContainer);
    const fileList = await fetchRepoTree(repoPath);
    const readmeContent = (await fetchFileContent(repoPath, 'README.md')) || '';

    // Step 2: Use AI to select important files
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

    // Step 3: Fetch content of selected files
    showStatus(
      `Fetching content for ${selectedFiles.length} files...`,
      outputContainer
    );
    const fileContents: { path: string; content: string }[] = [];
    await Promise.all(
      selectedFiles.map(async (filePath: string) => {
        const content = await fetchFileContent(repoPath, filePath);
        if (content) {
          fileContents.push({ path: filePath, content });
        }
      })
    );
    lastFileContents = fileContents; // Cache for prompt generation

    // Step 4: Perform analysis (either from user input or AI)
    let analysisContent: string;
    const userAnalysis = existingAnalysisInput.value.trim();

    if (userAnalysis) {
      showStatus('Using provided analysis...', outputContainer);
      analysisContent = userAnalysis;
    } else {
      showStatus('AI is performing holistic analysis...', outputContainer);
      const analysisPrompt = `
        You are an expert code reviewer. You have been provided with the content of several key files from a repository.
        Provide a holistic, high-level analysis of the project. Your analysis should cover:
        1.  A summary of the project's purpose and architecture.
        2.  Identification of potential architectural flaws, major bugs, or security vulnerabilities.
        3.  Suggestions for overall improvements in terms of structure, performance, and maintainability.
        
        Structure your response in clear, well-formatted markdown.

        Here is the code from the selected files:
        ${fileContents
          .map(
            (file) =>
              `\n\n--- START OF FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\`\n--- END OF FILE: ${file.path} ---`
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

    // Step 5: Display results
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

    outputContainer.innerHTML = `
        <h2>Analysis Result</h2>
        ${await marked.parse(analysisContent)}
        <h2>Analyzed Files (${fileContents.length})</h2>
        ${fileExplorerHtml}
    `;

    // Show the prompt generation section
    promptGenerationArea.style.display = 'block';
  } catch (error) {
    console.error('Error analyzing repository:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage, outputContainer);
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Analyze Repository';
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

  generatePromptButton.disabled = true;
  generatePromptButton.textContent = 'Generating...';
  reimplementationOutput.innerHTML = '';
  showStatus('Creating detailed prompt...', reimplementationPromptOutput);

  try {
    const prompt = `
      You are a prompt engineering expert. Your task is to create a single, comprehensive, and detailed prompt for a large language model acting as a senior software developer. The goal of this prompt is to instruct the developer AI to re-implement an entire software project from scratch, based on an analysis of its source code. The new implementation must incorporate all the suggestions and bug fixes from the analysis.

      Here is the high-level analysis of the original project:
      --- ANALYSIS START ---
      ${lastAnalysisContent}
      --- ANALYSIS END ---

      Here is the source code of the original files:
      ${lastFileContents
        .map(
          (file) =>
            `\n\n--- START OF FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\`\n--- END OF FILE: ${file.path} ---`
        )
        .join('')}

      Based on all the above information, generate a prompt that instructs an expert developer AI to rebuild the entire project. The prompt should:
      1. Start with a clear role assignment (e.g., "You are an expert software developer...").
      2. Provide a high-level overview of the project to be built.
      3. Give a complete file-by-file implementation plan. For each file, provide the full, corrected, and improved code inside a markdown code block, specifying the file path.
      4. Explicitly state the final directory structure.
      5. The entire output should be a single, copy-pasteable block of text in markdown format.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt,
    });

    const generatedPrompt = response.text;
    const promptId = `prompt-textarea-${Date.now()}`;
    reimplementationPromptOutput.innerHTML = `
      <textarea id="${promptId}" readonly>${escapeHtml(
      generatedPrompt
    )}</textarea>
      <button class="copy-button">Copy to Clipboard</button>
    `;

    reimplementationPromptOutput
      .querySelector('.copy-button')
      ?.addEventListener('click', (event) => {
        const textarea = document.getElementById(
          promptId
        ) as HTMLTextAreaElement;
        textarea.select();
        document.execCommand('copy');
        const button = event.target as HTMLButtonElement;
        button.textContent = 'Copied!';
        setTimeout(() => {
          button.textContent = 'Copy to Clipboard';
        }, 2000);
      });
  } catch (error) {
    console.error('Error generating prompt:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage, reimplementationPromptOutput);
  } finally {
    generatePromptButton.disabled = false;
    generatePromptButton.textContent = 'Generate Re-implementation Prompt';
  }
}

async function reimplementAndZip() {
  if (!lastAnalysisContent || lastFileContents.length === 0) {
    showError(
      'No analysis data available. Please analyze a repository first.',
      reimplementationOutput
    );
    return;
  }

  reimplementZipButton.disabled = true;
  reimplementZipButton.textContent = 'Re-implementing...';
  reimplementationPromptOutput.innerHTML = '';
  showStatus('AI is re-implementing the project...', reimplementationOutput);

  try {
    const prompt = `
      You are an expert software developer tasked with re-implementing a project from scratch based on a code review and the original source files.
      Your task is to rewrite the entire project, incorporating all the suggestions, bug fixes, and improvements from the analysis.
      You MUST return the complete, re-implemented project.

      Here is the high-level analysis and recommendations:
      --- ANALYSIS START ---
      ${lastAnalysisContent}
      --- ANALYSIS END ---

      Here is the source code of the original files:
      ${lastFileContents
        .map(
          (file) =>
            `\n\n--- START OF FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\`\n--- END OF FILE: ${file.path} ---`
        )
        .join('')}

      Your response MUST be a single JSON object. This object must contain one key: "files".
      The value of "files" must be an array of objects. Each object in the array must have two keys:
      1. "path": A string with the full file path.
      2. "content": A string with the full, complete, and improved code for that file.

      Do not include any files that were not in the original file list. Ensure all provided files are re-implemented.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            files: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  path: { type: Type.STRING },
                  content: { type: Type.STRING },
                },
                required: ['path', 'content'],
              },
            },
          },
          required: ['files'],
        },
      },
    });

    let newProject: { files: { path: string; content: string }[] };

    try {
      // Clean the response before parsing. The model should return raw JSON,
      // but sometimes it might wrap it in markdown.
      let jsonText = response.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.substring(7, jsonText.length - 3).trim();
      }
      newProject = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse JSON response from AI:', response.text);
      throw new Error(
        'The AI returned a malformed or incomplete JSON response. This can happen if the generated project is too large and the output is truncated. Please try again with a smaller repository.'
      );
    }

    if (!newProject.files || newProject.files.length === 0) {
      throw new Error('AI did not return any files for the new project.');
    }

    showStatus('Generating ZIP file...', reimplementationOutput);
    const zip = new JSZip();
    for (const file of newProject.files) {
      zip.file(file.path, file.content);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'reimplemented-project.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    reimplementationOutput.innerHTML = `<p style="color: green; text-align: center;"><strong>Success!</strong> Your download has started.</p>`;
  } catch (error) {
    console.error('Error re-implementing project:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred.';
    showError(errorMessage, reimplementationOutput);
  } finally {
    reimplementZipButton.disabled = false;
    reimplementZipButton.textContent = 'Re-implement & Download ZIP';
  }
}

function main() {
  if (analyzeButton) {
    analyzeButton.addEventListener('click', analyzeRepository);
  }

  if (generatePromptButton) {
    generatePromptButton.addEventListener('click', generateReimplementationPrompt);
  }

  if (reimplementZipButton) {
    reimplementZipButton.addEventListener('click', reimplementAndZip);
  }

  if (repoUrlInput) {
    repoUrlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        analyzeRepository();
      }
    });
  }
}

main();
