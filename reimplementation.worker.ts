
import JSZip from 'jszip';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory, Type } from '@google/genai';

let ai: GoogleGenAI;
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

self.onmessage = async (event: MessageEvent) => {
    const { analysisContent, fileContents, apiKey, model, maxBatchChars } = event.data;
    if (!ai) {
        ai = new GoogleGenAI({ apiKey });
    }

    try {
        // Group files into logical parts of the project
        const projectStructure: Record<string, { keywords: string[], files: any[] }> = {
            Configuration: { keywords: ['config', 'vite', 'package.json', 'tsconfig', '.env', 'setup', 'html'], files: [] },
            Styling: { keywords: ['.css', '.scss', '.less', 'tailwind', 'styles'], files: [] },
            CoreLogic: { keywords: ['api', 'service', 'util', 'lib', 'core', 'helper', 'logic', 'server', 'controller', 'model', 'worker', '.ts', '.js'], files: [] },
            UI: { keywords: ['component', 'view', 'page', 'ui', 'layout', 'header', 'footer', '.tsx', '.jsx'], files: [] },
            Miscellaneous: { keywords: [], files: [] },
        };

        fileContents.forEach((file: {path: string, content: string}) => {
            const assignedPart = Object.keys(projectStructure).find(partName =>
                projectStructure[partName].keywords.some(kw => file.path.toLowerCase().includes(kw))
            ) || 'Miscellaneous';
            projectStructure[assignedPart].files.push(file);
        });

        const allGeneratedFiles: Record<string, string> = {};

        // Process each part of the project structure
        for (const partName of Object.keys(projectStructure)) {
            const part = projectStructure[partName];
            if (part.files.length === 0) continue;

            // Create batches within the part to respect character limits
            const batches = [];
            let currentBatch: any[] = [];
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
            
            // Process each batch
            for (let i = 0; i < batches.length; i++) {
                const batchFiles = batches[i];
                const statusMsg = batches.length > 1
                    ? `Generating ${partName} (Batch ${i + 1}/${batches.length})...`
                    : `Generating ${partName} (${part.files.length} files)...`;
                self.postMessage({ type: 'progress', partName, statusMsg, isStarting: i === 0, fileCount: part.files.length });

                const reimplementationPrompt = `
                  You are an expert software engineer tasked with refactoring and improving a codebase based on a high-level analysis.
                  Your goal is to re-implement ONLY the files provided below, incorporating the suggestions from the analysis.
                  You MUST return a JSON object containing a single key "files". The value of "files" should be another object where keys are the full file paths (e.g., "src/components/Button.tsx") and values are the complete, new file contents as strings.
                  Do not add any new files. Only re-implement the ones provided. Ensure the code is complete and production-ready.

                  --- ANALYSIS CONTEXT ---
                  ${analysisContent}
                  --- END ANALYSIS CONTEXT ---

                  --- SOURCE FILES TO RE-IMPLEMENT ---
                  ${batchFiles.map(file => `\n\n--- FILE: ${file.path} ---\n\`\`\`\n${file.content}\n\`\`\`\n`).join('')}
                  --- END SOURCE FILES ---
                `;

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
                    throw new Error(`AI returned invalid JSON structure for ${partName}.`);
                }
            }
            self.postMessage({ type: 'progress-success', partName, fileCount: part.files.length });
        }

        // Create and send the ZIP file
        const zip = new JSZip();
        for (const [filePath, content] of Object.entries(allGeneratedFiles)) {
            zip.file(filePath, content as string);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        self.postMessage({ type: 'complete', blob: zipBlob });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred in the worker.';
        self.postMessage({ type: 'error', message: errorMessage });
    }
};
