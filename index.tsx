// index.tsx

import { analyzeRepository } from './src/services/analysis';
import { reimplementAndZip } from './src/services/reimplementation';
import { generateReimplementationPrompt } from './src/services/prompt';
import { parseRepoUrl } from './src/api/github';
import { state } from './src/state';
import { setApiKey } from './src/api/ai';
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

// API Key UI Management
const apiKeyContainer = document.getElementById('api-key-container') as HTMLDivElement;
const toggleButton = document.getElementById('api-key-toggle-button') as HTMLButtonElement;
const saveButton = document.getElementById('api-key-save-button') as HTMLButtonElement;
const clearButton = document.getElementById('api-key-clear-button') as HTMLButtonElement;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const badge = toggleButton.querySelector('.badge') as HTMLSpanElement;

function displayErrorMessage(message: string) {
  const errorContainer = document.getElementById('error-message');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.classList.remove('hidden', 'success');
    errorContainer.classList.add('error');

    // Auto-dismiss nach 5 Sekunden
    setTimeout(() => {
      errorContainer.classList.add('hidden');
    }, 5000);
  }
}

function displaySuccessMessage(message: string) {
  const errorContainer = document.getElementById('error-message');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.classList.remove('hidden', 'error');
    errorContainer.classList.add('success');

    setTimeout(() => {
      errorContainer.classList.add('hidden');
    }, 3000);
  }
}

function updateUIBasedOnKey(key: string | null) {
    if (key) {
        setApiKey(key);
        apiKeyInput.value = key;
        badge.style.display = 'none';
        apiKeyContainer.classList.remove('collapsed');
    } else {
        badge.style.display = 'block';
        apiKeyContainer.classList.remove('collapsed'); // Show panel if no key
    }
}

toggleButton.addEventListener('click', () => {
    apiKeyContainer.classList.toggle('collapsed');
});

saveButton.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();

    // Validierung
    if (!key) {
      displayErrorMessage('❌ API Key cannot be empty');
      return;
    }
    if (!key.startsWith('AIza')) {
      displayErrorMessage('❌ Invalid format. Gemini keys start with "AIza"');
      return;
    }
    if (key.length < 30) {
      displayErrorMessage('❌ API Key is too short');
      return;
    }

    // Wenn alles OK
    setApiKey(key);
    sessionStorage.setItem('gemini_api_key', key);
    displaySuccessMessage('✅ API Key saved!');
    apiKeyContainer.classList.add('collapsed');
});

clearButton.addEventListener('click', () => {
    sessionStorage.removeItem('gemini_api_key');
    setApiKey('');
    apiKeyInput.value = '';
    displaySuccessMessage('🗑️ API Key cleared.');
    updateUIBasedOnKey(null);
});


// Load key from session storage on startup
const storedKey = sessionStorage.getItem('gemini_api_key');
updateUIBasedOnKey(storedKey);

// Hide panel on outside click
document.addEventListener('click', (event) => {
    if (!apiKeyContainer.contains(event.target as Node) && !toggleButton.contains(event.target as Node)) {
        apiKeyContainer.classList.add('collapsed');
    }
});

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

    const success = await analyzeRepository(repoPath, pat, existingAnalysis);
    
    if(success) {
        promptGenerationArea.style.display = 'block';
    }

    setButtonState(analyzeButton, 'Analyze Repository', false);
}

function handleReimplement() {
    reimplementAndZip(repoUrlInput.value, config.maxBatchChars);
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
