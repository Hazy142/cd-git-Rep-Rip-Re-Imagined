const express = require('express');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration to allow requests from the frontend
app.use(cors());

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour per IP
  message: 'Too many requests from this IP, please try again after an hour'
});

app.use(limiter);

// Middleware to handle JSON requests and set a timeout
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
    req.setTimeout(120000, () => { // 2 minute timeout
        res.status(504).send('Request timed out.');
    });
    next();
});

const ai = new GoogleGenerativeAI(process.env.API_KEY);

app.get('/', (req, res) => {
    res.send('Backend server is running.');
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { prompt } = req.body;
    const { model, config } = req.body;

    if (req.body.fileCount > 200) {
      return res.status(400).json({ error: 'Too many files in the repository. The maximum is 200.' });
    }

    const result = await ai.getGenerativeModel({ model }).generateContentStream(prompt, config);

    res.setHeader('Content-Type', 'application/json');
    for await (const chunk of result.stream) {
      res.write(JSON.stringify(chunk));
    }
    res.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
