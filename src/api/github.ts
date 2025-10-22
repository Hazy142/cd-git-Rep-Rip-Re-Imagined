// src/api/github.ts

export async function parseRepoUrl(url: string): Promise<{ owner: string; repo: string } | null> {
    const match = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
    return match ? { owner: match[1], repo: match[2].replace('.git', '') } : null;
}

async function fetchFromGitHub<T>(url: string, headers: HeadersInit = {}): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`GitHub API Error (${response.status}): ${errorData.message}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchDefaultBranch(repoPath: string, headers: HeadersInit): Promise<string> {
  type RepoInfo = { default_branch: string };
  const data = await fetchFromGitHub<RepoInfo>(`https://api.github.com/repos/${repoPath}`, headers);
  return data.default_branch;
}

export async function fetchRepoTree(repoPath: string, branch: string, headers: HeadersInit): Promise<string[]> {
  type TreeNode = { type: 'blob' | 'tree'; path: string };
  type TreeResponse = { tree: TreeNode[]; truncated: boolean };
  const url = `https://api.github.com/repos/${repoPath}/git/trees/${branch}?recursive=1`;
  const data = await fetchFromGitHub<TreeResponse>(url, headers);
  if (data.truncated) {
    console.warn('Repository file tree is truncated. Some files may not be included.');
  }
  return data.tree.filter(node => node.type === 'blob').map(node => node.path);
}

export async function fetchFileContent(repoPath: string, branch: string, filePath: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${repoPath}/${branch}/${encodeURIComponent(filePath)}`;
  try {
    const response = await fetch(url);
    if (response.ok) return await response.text();
    console.warn(`Failed to fetch ${filePath}: ${response.statusText}`);
    return null;
  } catch (e) {
    console.error(`Error fetching file content for ${filePath}:`, e);
    return null;
  }
}
