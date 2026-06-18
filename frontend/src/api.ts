// Typed client for the FastAPI backend. Uses relative /api (vite proxy in dev).

export interface Group {
  id: number;
  url: string;
  fb_group_id: string | null;
  name: string | null;
  created_at: number;
  people_count: number;
}

export interface Person {
  id: number;
  user_id: string;
  name: string;
  profile_url: string;
  avatar_url: string;
  is_anonymous: number;
  first_seen: number;
  last_seen: number;
}

export interface PeoplePage {
  items: Person[];
  total: number;
  anon_count: number;
  page: number;
  per_page: number;
  pages: number;
}

export interface Job {
  id: string;
  group_id: number;
  status: string;
  scrolls: number;
  found: number;
  new_found: number;
  reason: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface ScrollEvent {
  event: "scroll";
  index: number;
  total: number;
  count: number;
  new: number;
  idle: number;
  stall: number;
}
export type ProgressEvent =
  | ScrollEvent
  | { event: "status"; status: string; error?: string; group_id?: number }
  | { event: "navigating"; url: string }
  | { event: "saved"; count: number; file: string }
  | { event: "resumed"; count: number; file: string }
  | { event: "done"; count: number; new_this_run: number; reason: string }
  | { event: "persisted"; found: number; new_in_group: number };

const J = { "Content-Type": "application/json" };

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export const api = {
  listGroups: () => jget<Group[]>("/api/groups"),
  addGroup: (url: string, name?: string) =>
    fetch("/api/groups", { method: "POST", headers: J, body: JSON.stringify({ url, name }) })
      .then((r) => r.json() as Promise<Group>),
  listPeople: (
    groupId: number,
    opts: { includeAnon?: boolean; q?: string; page?: number; perPage?: number } = {}
  ) => {
    const p = new URLSearchParams({
      include_anon: String(opts.includeAnon ?? true),
      q: opts.q ?? "",
      page: String(opts.page ?? 1),
      per_page: String(opts.perPage ?? 50),
    });
    return jget<PeoplePage>(`/api/groups/${groupId}/people?${p}`);
  },
  startScrape: (groupId: number, scrolls: number) =>
    fetch("/api/scrape", {
      method: "POST",
      headers: J,
      body: JSON.stringify({ group_id: groupId, scrolls, resume: true }),
    }).then((r) => r.json() as Promise<{ job_id: string }>),
  stopScrape: (jobId: string) =>
    fetch(`/api/jobs/${jobId}/stop`, { method: "POST" }).then((r) => r.json()),
  deleteGroup: (groupId: number) =>
    fetch(`/api/groups/${groupId}`, { method: "DELETE" }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    }),
  csvUrl: (groupId: number, includeAnon: boolean) =>
    `/api/groups/${groupId}/people.csv?include_anon=${includeAnon}`,
};

// Subscribe to a job's live progress via SSE. Returns a cleanup function.
export function subscribeJob(
  jobId: string,
  onEvent: (e: ProgressEvent) => void,
  onEnd: () => void
): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/stream`);
  es.onmessage = (m) => {
    try {
      onEvent(JSON.parse(m.data));
    } catch {
      /* keep-alive comment lines arrive here as parse failures; ignore */
    }
  };
  es.addEventListener("end", () => {
    es.close();
    onEnd();
  });
  es.onerror = () => {
    es.close();
    onEnd();
  };
  return () => es.close();
}
