// src/services/reimplementation.ts

import { state } from '../state';
import { showError, reimplementationOutput, setButtonState, reimplementZipButton, generatePromptButton, reimplementationProgress } from '../ui/dom';
import { parseRepoUrl } from '../api/github';

export function reimplementAndZip(repoUrl: string, model: string, maxBatchChars: number) {
    if (!state.lastAnalysisContent || state.lastFileContents.length === 0) {
        showError('No analysis data available. Please analyze a repository first.', reimplementationOutput);
        return;
    }
    const repoInfo = parseRepoUrl(repoUrl);
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
        model: model,
        maxBatchChars: maxBatchChars
    });
}
