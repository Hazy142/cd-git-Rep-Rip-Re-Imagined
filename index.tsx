// index.tsx

import { analyzeRepository } from './src/services/analysis';
import { reimplementAndZip } from './src/services/reimplementation';
import { generateReimplementationPrompt } from './src/services/prompt';
import { parseRepoUrl } from './src/api/github';
import { state } from './src/state';
import {
    repoUrlInput,
    githubPatInput,
    existingAnalysisInput,
    analyzeButton,
    generatePromptButton,
    reimplementZipButton,
    setButtonState,
    showError,
    promptGenerationArea,
    reimplementationPromptOutput,
    reimplementationOutput,
    reimplementationProgress
} from './src/ui/dom';

const config = {
  model: 'gemini-2.5-pro',
  maxBatchChars: 50000,
};

async function handleAnalyze() {
    const repoUrl = repoUrlInput.value;
    if (!repoUrl) {
        showError('Please enter a repository URL.');
        return;
    }

    const repoInfo = await parseRepoUrl(repoUrl);
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

    const pat = githubPatInput.value.trim();
    const existingAnalysis = existingAnalysisInput.value.trim();

    const success = await analyzeRepository(repoPath, pat, existingAnalysis, config.model);
    
    if(success) {
        promptGenerationArea.style.display = 'block';
    }

    setButtonState(analyzeButton, 'Analyze Repository', false);
}

function handleReimplement() {
    reimplementAndZip(repoUrlInput.value, config.model, config.maxBatchChars);
}

// Event Listeners
analyzeButton.addEventListener('click', handleAnalyze);
generatePromptButton.addEventListener('click', generateReimplementationPrompt);
reimplementZipButton.addEventListener('click', handleReimplement);

window.addEventListener('beforeunload', () => {
    if (state.reimplementationWorker) {
        state.reimplementationWorker.terminate();
    }
});
