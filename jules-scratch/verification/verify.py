from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()
    page.goto("http://localhost:3001/")
    page.fill("#repo-url", "https://github.com/google/generative-ai-docs")
    page.click("#analyze-repo-button")
    page.wait_for_selector(".analysis-content", timeout=60000)
    page.screenshot(path="jules-scratch/verification/verification.png")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
