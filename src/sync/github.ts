// Read and write one JSON file in a GitHub repo through the contents API.

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
  get isConflict() {
    return this.status === 409 || this.status === 422;
  }
}

const API = "https://api.github.com";

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function url(c: RepoConfig, path: string) {
  const p = path.split("/").map(encodeURIComponent).join("/");
  return `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${p}`;
}

async function fail(res: Response): Promise<never> {
  let detail = "";
  try {
    detail = (await res.json()).message ?? "";
  } catch {
    /* ignore */
  }
  const hint =
    res.status === 401
      ? "The token was rejected. It may have expired."
      : res.status === 403 || res.status === 404
        ? "The token can't access this repo, or the repo name is wrong."
        : "";
  throw new GitHubError([hint, detail].filter(Boolean).join(" ") || `GitHub returned ${res.status}`, res.status);
}

/** Returns null if the file doesn't exist yet. `path` defaults to the configured file. */
export async function readFile(c: RepoConfig, path: string = c.path): Promise<{ text: string; sha: string } | null> {
  const res = await fetch(`${url(c, path)}?ref=${encodeURIComponent(c.branch)}`, { headers: headers(c.token), cache: "no-store" });
  if (res.status === 404) {
    // Distinguish "file missing" from "repo not accessible"
    const repo = await fetch(`${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, { headers: headers(c.token), cache: "no-store" });
    if (repo.status === 404) {
      // The token works but can't see the repo. Say whose token it is, which is the usual mix-up.
      const me = await fetch(`${API}/user`, { headers: headers(c.token), cache: "no-store" });
      const login = me.ok ? (await me.json()).login : null;
      throw new GitHubError(
        login && login.toLowerCase() !== c.owner.toLowerCase()
          ? `This token belongs to ${login}, so it can't see ${c.owner}/${c.repo}. Create the token while signed in as ${c.owner}.`
          : `This token can't see ${c.owner}/${c.repo}. In the token's settings, set Repository access to "Only select repositories" and include ${c.repo}, or check the repo name.`,
        404
      );
    }
    if (!repo.ok) await fail(repo);
    return null;
  }
  if (!res.ok) await fail(res);
  const body = await res.json();
  if (body.content === "" && body.size > 0) {
    // Over 1 MB: fetch the raw blob
    const raw = await fetch(body.git_url, { headers: { ...headers(c.token), Accept: "application/vnd.github.raw" }, cache: "no-store" });
    if (!raw.ok) await fail(raw);
    return { text: await raw.text(), sha: body.sha };
  }
  return { text: fromBase64(body.content), sha: body.sha };
}

/** Writes the file. Throws GitHubError with isConflict when `sha` is out of date. Returns the new sha. */
export async function writeFile(c: RepoConfig, path: string, text: string, sha: string | null, message: string): Promise<string> {
  const res = await fetch(url(c, path), {
    method: "PUT",
    headers: { ...headers(c.token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: toBase64(text), branch: c.branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) await fail(res);
  const body = await res.json();
  return body.content.sha;
}

/** File names in a folder of the repo. Empty if the folder doesn't exist. */
export async function listDir(c: RepoConfig, path: string): Promise<string[]> {
  const res = await fetch(`${url(c, path)}?ref=${encodeURIComponent(c.branch)}`, { headers: headers(c.token), cache: "no-store" });
  if (res.status === 404) return [];
  if (!res.ok) await fail(res);
  const body = await res.json();
  return Array.isArray(body) ? body.filter((x: { type: string }) => x.type === "file").map((x: { name: string }) => x.name) : [];
}
