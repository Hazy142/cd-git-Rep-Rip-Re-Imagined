import { GoogleGenerativeAI } from '@google/generative-ai';

// Worker receives API Key from the Main Thread
let API_KEY = '';

self.addEventListener('message', async (e) => {
  const { type, data, apiKey } = e.data;

  if (type === 'setApiKey') {
    API_KEY = apiKey;
    return;
  }

  if (type === 'reimplement') {
    if (!API_KEY) {
      self.postMessage({
        type: 'error',
        data: { error: 'API Key not set in worker.' }
      });
      return;
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    try {
      const result = await model.generateContent(data.prompt);
      const response = await result.response;

      self.postMessage({
        type: 'progress',
        data: { text: response.text(), batchIndex: data.batchIndex }
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        data: { error: error.message }
      });
    }
  }
});
