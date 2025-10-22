// src/api/ai.ts

export async function analyzeCode(prompt: string, model: string, config: any, fileCount: number, onChunk: (chunk: any) => void): Promise<void> {
    const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, model, config, fileCount }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Backend API Error (${response.status}): ${errorData.message}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        try {
            const jsonChunk = JSON.parse(chunk);
            onChunk(jsonChunk);
        } catch (error) {
            // Ignore parsing errors for incomplete chunks
        }
    }
}
