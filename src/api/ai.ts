import { GoogleGenerativeAI } from '@google/generative-ai';

// API Key will be provided by AI Studio
// Option 1: Via environment variable (AI Studio managed)
// const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || ''; // This is now implicitly handled by getApiKey

// Option 2: User Input field (for prototyping)
let userApiKey: string = '';

export function setApiKey(key: string) {
  userApiKey = key;
}

export function getApiKey(): string {
  // Priority 1: User-Input
  if (userApiKey) return userApiKey;

  // Priority 2: Environment
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envKey) return envKey;

  // Error
  throw new Error('⚠️ Kein API Key gefunden');
}

export async function analyzeCode(
  repoData: string,
  context: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const prompt = `${context}\n\nRepository Data:\n${repoData}`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw new Error('Failed to analyze repository');
  }
}

// Batch-processing for large repos
export async function analyzeBatch(
  batches: Array<{ content: string; context: string }>
): Promise<string[]> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const results: string[] = [];

  for (const batch of batches) {
    const result = await model.generateContent(
      `${batch.context}\n\n${batch.content}`
    );
    results.push((await result.response).text());
  }

  return results;
}
