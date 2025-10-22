// src/services/reimplementation.ts

import { state } from '../state';
import { showError, reimplementationOutput, setButtonState, reimplementZipButton, generatePromptButton, reimplementationProgress } from '../ui/dom';
import { parseRepoUrl } from '../api/github';
import { getApiKey } from '../api/ai';
import JSZip from 'jszip';

export async function reimplementAndZip(repoUrl: string, maxBatchChars: number) {
    if (!state.lastAnalysisContent || state.lastFileContents.length === 0) {
        showError('No analysis data available. Please analyze a repository first.', reimplementationOutput);
        return;
    }
    const repoInfo = await parseRepoUrl(repoUrl);
    if (!repoInfo) {
        showError('Could not parse repository URL for naming the zip file.', reimplementationOutput);
        return;
    }

    setButtonState(reimplementZipButton, 'Working...', true);
    setButtonState(generatePromptButton, 'Generate Demo Prompt', true);
    reimplementationProgress.innerHTML = '';
    reimplementationOutput.innerHTML = '';

    if (state.reimplementationWorker) {
        state.reimplementationWorker.terminate();
    }

    state.reimplementationWorker = new Worker(new URL('../reimplementation.worker.ts', import.meta.url), { type: 'module' });

    try {
        state.reimplementationWorker.postMessage({
            type: 'setApiKey',
            apiKey: getApiKey()
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred.';
        showError(message, reimplementationOutput);
        setButtonState(reimplementZipButton, 'Re-implement & Download ZIP', false);
        setButtonState(generatePromptButton, 'Generate Demo Prompt', false);
        if (state.reimplementationWorker) {
            state.reimplementationWorker.terminate();
            state.reimplementationWorker = null;
        }
        return;
    }

    const allGeneratedFiles: { [key: string]: string } = {};
    const batches: { files: { path: string, content: string }[], partName: string }[] = [];

    // This logic is simplified from the original worker.
    // A more sophisticated implementation would handle different project structures.
    const projectStructure: { [key: string]: { files: { path: string; content: string }[] } } = {
        CoreLogic: { files: state.lastFileContents }
    };

    for (const partName of Object.keys(projectStructure)) {
        const part = projectStructure[partName];
        if (part.files.length === 0) continue;

        let currentBatchFiles: { path: string, content: string }[] = [];
        let currentCharCount = 0;
        for (const file of part.files) {
            if (currentBatchFiles.length > 0 && (currentCharCount + file.content.length > maxBatchChars)) {
                batches.push({ files: currentBatchFiles, partName });
                currentBatchFiles = [];
                currentCharCount = 0;
            }
            currentBatchFiles.push(file);
            currentCharCount += file.content.length;
        }
        if (currentBatchFiles.length > 0) {
            batches.push({ files: currentBatchFiles, partName });
        }
    }

    let completedBatches = 0;

    const progressItems: { [key: number]: HTMLLIElement } = {};

    state.reimplementationWorker.onmessage = async (e) => {
        const { type, data } = e.data;
        switch (type) {
            case 'progress':
                try {
                    const result = JSON.parse(data.text);
                    if (result && result.files) {
                        Object.assign(allGeneratedFiles, result.files);
                    }
                    progressItems[data.batchIndex].textContent = `✅ Batch ${data.batchIndex + 1}/${batches.length} successfully generated.`;
                    progressItems[data.batchIndex].className = 'success';
                } catch (error) {
                    progressItems[data.batchIndex].textContent = `❌ Error processing Batch ${data.batchIndex + 1}. Invalid JSON response.`;
                    progressItems[data.batchIndex].className = 'error';
                }

                completedBatches++;
                if (completedBatches === batches.length) {
                    const zip = new JSZip();
                    for (const [filePath, content] of Object.entries(allGeneratedFiles)) {
                        zip.file(filePath, content);
                    }
                    const zipBlob = await zip.generateAsync({ type: 'blob' });

                    const downloadUrl = URL.createObjectURL(zipBlob);
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
                }
                break;
            case 'error':
                showError(data.error, reimplementationOutput);
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

    batches.forEach((batch, index) => {
        const reimplementationPrompt = `
          You are an expert software engineer tasked with refactoring and improving a codebase based on a high-level analysis.
          Your goal is to re-implement ONLY the files provided below, incorporating the suggestions from the analysis.
          You MUST return a JSON object containing a single key "files". The value of "files" should be another object where keys are the full file paths (e.g., "src/components/Button.tsx") and values are the complete, new file contents as strings.
          Do not add any new files. Only re-implement the ones provided. Ensure the code is complete and production-ready.

          --- ANALYSIS CONTEXT ---
          ${state.lastAnalysisContent}
          --- END ANALYSIS CONTEXT ---

          --- SOURCE FILES TO RE-IMPLEMENT ---
          ${batch.files.map(file => `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\`\n`).join('')}
          --- END SOURCE FILES ---
        `;

        const li = document.createElement('li');
        li.textContent = `⏳ Generating Batch ${index + 1}/${batches.length}...`;
        li.className = 'in-progress';
        reimplementationProgress.appendChild(li);
        progressItems[index] = li;

        state.reimplementationWorker?.postMessage({
            type: 'reimplement',
            data: {
                prompt: reimplementationPrompt,
                batchIndex: index
            }
        });
    });
}
