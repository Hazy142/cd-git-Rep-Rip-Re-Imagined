<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AI-Powered GitHub Repository Analyzer & Re-implementer

This project is an advanced, AI-powered tool for developers. It analyzes public GitHub repositories, provides a holistic code review, and can even re-implement the entire project from scratch based on its findings.

---

## 🚨 Security Warning: Proof-of-Concept Only 🚨

This application is a **proof-of-concept and is not secure for production use**.

The current architecture requires the `API_KEY` to be available in the client-side JavaScript environment. This means **if you build it into the bundle, anyone who visits the deployed web page can easily find and use your API key at your expense.**

For a production-ready version, all interactions with the Gemini API must be moved to a secure backend server that protects the API key.

---

## How It Works

1.  **Analyze**: A user provides a public GitHub repository URL.
    - The application fetches the repository's file tree.
    - It uses the Gemini AI to intelligently select the most relevant source files.
    - It fetches the content of these files.
    - It performs a second, larger call to Gemini to generate a high-level code review, identifying the project's purpose, architecture, potential flaws, and areas for improvement.

2.  **Re-implement**: Based on the analysis, the application can re-implement the project.
    - It intelligently batches the project's files into logical chunks (e.g., configuration, styling, core logic).
    - It sends each chunk to Gemini, along with the analysis, instructing it to rewrite the code with the suggested improvements.
    - Finally, it packages the new, improved code into a downloadable ZIP file.

## Features

-   **Intelligent File Selection**: Uses AI to automatically identify the most important files in a repository, saving you from manual selection.
-   **Holistic Code Analysis**: Provides high-level insights into architecture, potential bugs, and security vulnerabilities.
-   **AI-Powered Refactoring**: Re-implements the entire codebase, applying best practices and the analysis's recommendations.
-   **Batch Processing**: Handles larger projects by breaking them into manageable chunks for the AI.
-   **ZIP Export**: Downloads the complete, re-implemented project as a single `.zip` file.

## Technology Stack

-   **Framework**: Vanilla TypeScript (No React, Vue, etc.)
-   **AI Model**: Google Gemini 2.5 Pro
-   **APIs**: GitHub API, Google AI JavaScript SDK
-   **Build Tool**: Vite
-   **Key Libraries**: `marked` (Markdown parsing), `JSZip` (ZIP creation), `DOMPurify` (HTML sanitization)

## Run Locally

**Prerequisites:** [Node.js](https://nodejs.org/) installed.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up your environment variables:**
    Create a file named `.env` in the root of the project and add your Gemini API key:
    ```
    API_KEY="YOUR_API_KEY"
    ```

4.  **Run the development server:**
    ```bash
    npm run dev
    ```

The application will be available at `http://localhost:5173`.