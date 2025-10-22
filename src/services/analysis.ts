// src/services/analysis.ts

import { fetchDefaultBranch, fetchRepoTree, fetchFileContent } from '../api/github';
import { analyzeCode } from '../api/ai';
import { showStatus, showError, renderFileExplorer, outputContainer } from '../ui/dom';
import { state } from '../state';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export async function analyzeRepository(repoPath: string, pat: string, existingAnalysis: string) {
    try {
        const headers: HeadersInit = pat ? { 'Authorization': `Bearer ${pat}` } : {};

        // Steps 1 & 2: Fetch repo metadata and file tree
        showStatus('Fetching repository metadata...');
        const defaultBranch = await fetchDefaultBranch(repoPath, headers);
        showStatus(`Fetching repository file tree for branch '${defaultBranch}'...`);
        const fileList = await fetchRepoTree(repoPath, defaultBranch, headers);
        const readmeContent = (await fetchFileContent(repoPath, defaultBranch, 'README.md')) || '';

        // Step 3: Use AI to select important files
        showStatus('AI is selecting important files...');
        const contextForFileSelection = `
          You are a senior software architect. Analyze the provided README and file list to select up to 100 of the most important source files for a code review.
          Focus on core application logic, configuration, and essential UI components.
          Exclude lock files (package-lock.json, yarn.lock), build outputs, assets (images, fonts), and extensive documentation.
          Respond with a JSON object containing a single key "files", which is an array of the selected file paths.
        `;
        const repoDataForFileSelection = `
          README (first 2000 chars):
          """
          ${readmeContent.substring(0, 2000)}
          """

          File list:
          ${JSON.stringify(fileList)}
        `;

        const selectionResult = await analyzeCode(repoDataForFileSelection, contextForFileSelection);
        const selectedFiles = JSON.parse(selectionResult).files;

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

        const totalChars = fileContents.reduce((acc, file) => acc + file.content.length, 0);
        const totalTokens = Math.ceil(totalChars / 4);
        const cost = (totalTokens / 1000000) * 1.25;

        const confirmed = window.confirm(`This repository has ${selectedFiles.length} files with a total of ${totalChars} characters (~${totalTokens} tokens). The estimated cost for the analysis is $${cost.toFixed(2)}. Do you want to continue?`);
        if (!confirmed) {
            showError('Analysis cancelled by the user.');
            return false;
        }

        // Step 5: Perform analysis
        if (existingAnalysis) {
            showStatus('Using provided analysis...');
            state.lastAnalysisContent = existingAnalysis;
            const parsedAnalysis = await marked.parse(existingAnalysis);
            outputContainer.innerHTML = `
          <h2>Analysis Result</h2>
          <div class="analysis-content">${DOMPurify.sanitize(parsedAnalysis)}</div>
          ${renderFileExplorer(fileContents)}
        `;
        } else {
            showStatus('AI is performing holistic analysis...');
            const allFileContentString = fileContents.map(f => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n');
            const contextForAnalysis = `
            You are an expert code reviewer and senior software architect. Perform a holistic, high-level code review of the following project files.

            Your goal is to provide a comprehensive assessment that would be useful to a new developer joining the team or for a technical lead planning the next phase of development.

            Structure your review into the following sections using Markdown headings:
            1.  **Project Purpose and Architecture:** Briefly describe what the application does and how it's structured (e.g., client-side only, SPA, build system, key libraries).
            2.  **Potential Flaws & Vulnerabilities:** Identify any security risks, architectural weaknesses, potential bugs, or reliability issues. Be specific.
            3.  **Suggestions for Improvement:** Provide actionable recommendations to address the identified flaws. Prioritize the most critical changes.

            Analyze the following code:
          `;
            const repoDataForAnalysis = `
            ---
            ${allFileContentString}
            ---
          `;

            outputContainer.innerHTML = `
                <h2>Analysis Result</h2>
                <div class="analysis-content"></div>
            `;
            const analysisContentDiv = outputContainer.querySelector('.analysis-content') as HTMLDivElement;

            const analysisContent = await analyzeCode(repoDataForAnalysis, contextForAnalysis);
            analysisContentDiv.innerHTML = DOMPurify.sanitize(await marked.parse(analysisContent));
            state.lastAnalysisContent = analysisContent;
            outputContainer.insertAdjacentHTML('beforeend', renderFileExplorer(fileContents));
        }

    } catch (error) {
        console.error('Error analyzing repository:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
        showError(errorMessage);
        return false;
    }
    return true;
}
