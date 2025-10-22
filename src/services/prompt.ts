// src/services/prompt.ts

import { state } from '../state';
import { showError, reimplementationPromptOutput, setButtonState, generatePromptButton, showStatus } from '../ui/dom';
import { escapeHtml } from '../utils';

export async function generateReimplementationPrompt() {
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
