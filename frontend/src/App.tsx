import { useCallback, useEffect, useState } from "react";
import { api, Group, Person } from "./api";
import { AddGroup } from "./components/AddGroup";
import { LiveJob } from "./components/LiveJob";
import { PeopleTable } from "./components/PeopleTable";
import { AnimatedNumber } from "./components/AnimatedNumber";

export default function App() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [activeJob, setActiveJob] = useState<{ id: string; group: number } | null>(null);
  const [scrolls, setScrolls] = useState(60);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };

  const refreshGroups = useCallback(async () => {
    const g = await api.listGroups();
    setGroups(g);
    setSelected((cur) => cur ?? (g[0]?.id ?? null));
  }, []);

  const loadPeople = useCallback(async (gid: number) => {
    setPeople(await api.listPeople(gid, true));
  }, []);

  useEffect(() => {
    refreshGroups();
  }, [refreshGroups]);

  useEffect(() => {
    if (selected != null) loadPeople(selected);
  }, [selected, loadPeople]);

  const addGroup = async (url: string, name?: string) => {
    const g = await api.addGroup(url, name);
    await refreshGroups();
    setSelected(g.id);
    flash(`הקבוצה "${g.name || g.fb_group_id}" נוספה`);
  };

  const runScrape = async () => {
    if (selected == null) return;
    const { job_id } = await api.startScrape(selected, scrolls);
    setActiveJob({ id: job_id, group: selected });
  };

  const onJobDone = useCallback(async () => {
    await refreshGroups();
    if (selected != null) await loadPeople(selected);
    flash("הסריקה הושלמה ✓");
    setTimeout(() => setActiveJob(null), 4000);
  }, [refreshGroups, loadPeople, selected]);

  const selectedGroup = groups.find((g) => g.id === selected) || null;
  const totalPeople = groups.reduce((s, g) => s + g.people_count, 0);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">🛰️</div>
          <div>
            <h1>
              Group<span className="grad-text">Harvest</span>
            </h1>
            <p>סורק חברי קבוצות פייסבוק · לוח בקרה חי</p>
          </div>
        </div>
        <div className="pill">
          <span className="dot" /> השרת מחובר
        </div>
      </div>

      <div className="stats">
        <div className="panel stat">
          <div className="label">קבוצות במעקב</div>
          <div className="value">
            <AnimatedNumber value={groups.length} />
          </div>
          <div className="spark">📁</div>
        </div>
        <div className="panel stat accent">
          <div className="label">אנשים במאגר</div>
          <div className="value">
            <AnimatedNumber value={totalPeople} />
          </div>
          <div className="spark">👥</div>
        </div>
        <div className="panel stat">
          <div className="label">הקבוצה הנבחרת</div>
          <div className="value">
            <AnimatedNumber value={selectedGroup?.people_count ?? 0} />
          </div>
          <div className="spark">🎯</div>
        </div>
      </div>

      <AddGroup onAdd={addGroup} />

      <div className="grid">
        <div className="panel groups">
          <div className="section-title">קבוצות</div>
          {groups.length === 0 && (
            <div className="idtag">אין קבוצות עדיין — הוסיפו אחת למעלה ↑</div>
          )}
          {groups.map((g) => (
            <div
              key={g.id}
              className={`gcard ${g.id === selected ? "active" : ""}`}
              onClick={() => setSelected(g.id)}
            >
              <div className="gname" dir="auto">
                {g.name || `קבוצה ${g.fb_group_id}`}
              </div>
              <div className="gmeta">
                <span className="mono">מזהה {g.fb_group_id}</span>
              </div>
              <div className="count-badge">{g.people_count}</div>
            </div>
          ))}
        </div>

        <div>
          <div className="panel add-row" style={{ marginBottom: 18 }}>
            <span className="icon">⚙️</span>
            <span style={{ color: "var(--muted)", fontSize: 14, flex: 1 }}>
              {selectedGroup
                ? `סריקת "${selectedGroup.name || selectedGroup.fb_group_id}" — `
                : "בחרו קבוצה לסריקה — "}
              עומק
            </span>
            <input
              className="scrolls-input mono"
              type="number"
              min={5}
              max={500}
              value={scrolls}
              onChange={(e) => setScrolls(Number(e.target.value))}
            />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>גלילות</span>
            <button
              className="btn"
              onClick={runScrape}
              disabled={selected == null || activeJob != null}
            >
              {activeJob ? "סורק…" : "▶ התחל סריקה"}
            </button>
          </div>

          {activeJob && (
            <LiveJob
              jobId={activeJob.id}
              groupName={selectedGroup?.name || `קבוצה ${selectedGroup?.fb_group_id}`}
              onDone={onJobDone}
            />
          )}

          <PeopleTable
            people={people}
            csvHref={selected != null ? api.csvUrl(selected, true) : "#"}
          />
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
