import type { Branch, DiffResponse } from "./types";

const BASE = "/api";

export async function fetchBranches(repo: string): Promise<Branch[]> {
  const r = await fetch(`${BASE}/repos/${repo}/branches`);
  if (!r.ok) throw new Error(`branches: ${r.status}`);
  return r.json();
}

export async function fetchDiff(repo: string, from: string, to: string): Promise<DiffResponse> {
  const params = new URLSearchParams({ from, to });
  const r = await fetch(`${BASE}/repos/${repo}/diff?${params}`);
  if (!r.ok) throw new Error(`diff: ${r.status}`);
  return r.json();
}
