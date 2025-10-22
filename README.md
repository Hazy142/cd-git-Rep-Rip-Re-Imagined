# AI GitHub Repository Analyzer & Re-implementer

This is a client-side web application that uses Generative AI to analyze and re-implement GitHub repositories.

## Features

*   **Fetches Repository Data:** Uses the GitHub API to fetch the repository's file tree and the content of key files.
*   **AI-Powered File Selection:** Leverages a Generative AI model to intelligently select the most relevant source code files for analysis.
*   **Holistic Code Analysis:** Generates a high-level code review, identifying the project's purpose, architecture, flaws, and potential improvements.
*   **AI-Powered Re-implementation:** Re-writes the entire project from scratch, incorporating the suggested improvements.
*   **Downloadable Output:** The result of the re-implementation is packaged into a ZIP archive and made available for download.

## Architecture

The application is a single-page application (SPA) built with TypeScript, HTML, and CSS. It uses Vite for development and bundling. The core logic is now split between the client and a new Node.js/Express backend server.

*   **Client:** The frontend is responsible for the UI, user interactions, and communication with the GitHub API.
*   **Server:** The backend is a simple Express.js server that handles all communication with the Google AI API. This ensures that the API key is kept secure on the server.

## Getting Started

### Prerequisites

*   Node.js and npm
*   A Google AI API key

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```
2.  **Install frontend dependencies:**
    ```bash
    npm install
    ```
3.  **Install backend dependencies:**
    ```bash
    cd server
    npm install
    ```
4.  **Configure the backend:**
    *   Create a `.env` file in the `server` directory.
    *   Add your Google AI API key to the `.env` file:
        ```
        API_KEY="YOUR_API_KEY"
        ```

### Running the Application

1.  **Start the backend server:**
    ```bash
    cd server
    npm start
    ```
2.  **Start the frontend development server:**
    ```bash
    npm run dev
    ```
3.  Open your browser and navigate to the URL provided by Vite (usually `http://localhost:5173`).

## How to Use

1.  Enter a public GitHub repository URL.
2.  Optionally, provide a GitHub Personal Access Token to avoid API rate limits.
3.  Click "Analyze Repository".
4.  Once the analysis is complete, you can re-implement the project by clicking "Re-implement & Download ZIP".
