import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, Variants } from "framer-motion";
import confetti from "canvas-confetti";
import {
  CheckCircle2,
  Crosshair,
  FolderOpen,
  Folders,
  Play,
  Satellite,
  Settings2,
  Users,
} from "lucide-react";
import { api, Group, Person } from "./api";
import { AddGroup } from "./components/AddGroup";
import { LiveJob } from "./components/LiveJob";
import { PeopleTable } from "./components/PeopleTable";
import { AnimatedNumber } from "./components/AnimatedNumber";
import { Aurora } from "./components/Aurora";
import { TiltCard } from "./components/TiltCard";

const BRAND_COLORS = ["#7c5cff", "#18d3ff", "#ff5ca8", "#2ee6a6"];

function celebrate() {
  confetti({ particleCount: 90, spread: 75, origin: { y: 0.75 }, colors: BRAND_COLORS });
  setTimeout(
    () => confetti({ particleCount: 55, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors: BRAND_COLORS }),
    180
  );
  setTimeout(
    () => confetti({ particleCount: 55, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: BRAND_COLORS }),
    330
  );
}

const page: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const rise: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 130, damping: 17 } },
};

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
    celebrate();
    flash("הסריקה הושלמה ✓");
    setTimeout(() => setActiveJob(null), 4000);
  }, [refreshGroups, loadPeople, selected]);

  const selectedGroup = groups.find((g) => g.id === selected) || null;
  const totalPeople = groups.reduce((s, g) => s + g.people_count, 0);

  return (
    <>
      <Aurora />
      <motion.div className="app" variants={page} initial="hidden" animate="show">
        <motion.div className="topbar" variants={rise}>
          <div className="brand">
            <div className="logo-wrap">
              <div className="orbit-ring" />
              <motion.div
                className="logo"
                animate={{ y: [0, -3.5, 0] }}
                transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <Satellite size={24} />
              </motion.div>
            </div>
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
        </motion.div>

        <motion.div className="stats" variants={rise}>
          <TiltCard className="panel stat">
            <div className="label">
              <FolderOpen size={15} /> קבוצות במעקב
            </div>
            <div className="value">
              <AnimatedNumber value={groups.length} />
            </div>
            <div className="spark">
              <Folders size={72} strokeWidth={1.2} />
            </div>
          </TiltCard>
          <TiltCard className="panel stat accent">
            <div className="label">
              <Users size={15} /> אנשים במאגר
            </div>
            <div className="value">
              <AnimatedNumber value={totalPeople} />
            </div>
            <div className="spark">
              <Users size={72} strokeWidth={1.2} />
            </div>
          </TiltCard>
          <TiltCard className="panel stat">
            <div className="label">
              <Crosshair size={15} /> הקבוצה הנבחרת
            </div>
            <div className="value">
              <AnimatedNumber value={selectedGroup?.people_count ?? 0} />
            </div>
            <div className="spark">
              <Crosshair size={72} strokeWidth={1.2} />
            </div>
          </TiltCard>
        </motion.div>

        <motion.div variants={rise}>
          <AddGroup onAdd={addGroup} />
        </motion.div>

        <motion.div className="grid" variants={rise}>
          <div className="panel groups">
            <div className="section-title">
              <FolderOpen size={14} /> קבוצות
            </div>
            {groups.length === 0 && (
              <div className="idtag">אין קבוצות עדיין — הוסיפו אחת למעלה ↑</div>
            )}
            <AnimatePresence initial={false}>
              {groups.map((g) => (
                <motion.div
                  key={g.id}
                  layout
                  initial={{ opacity: 0, y: 14, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 280, damping: 24 }}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  className={`gcard ${g.id === selected ? "active" : ""}`}
                  onClick={() => setSelected(g.id)}
                >
                  {g.id === selected && (
                    <motion.div
                      layoutId="gactive"
                      className="gactive-ring"
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  )}
                  <div className="gname" dir="auto">
                    {g.name || `קבוצה ${g.fb_group_id}`}
                  </div>
                  <div className="gmeta">
                    <span className="mono">מזהה {g.fb_group_id}</span>
                  </div>
                  <motion.div
                    key={`count-${g.people_count}`}
                    className="count-badge"
                    initial={{ scale: 1.5 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 14 }}
                  >
                    {g.people_count}
                  </motion.div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div>
            <div className="panel add-row" style={{ marginBottom: 18 }}>
              <span className="icon">
                <Settings2 size={19} />
              </span>
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
              <motion.button
                className="btn"
                onClick={runScrape}
                disabled={selected == null || activeJob != null}
                whileTap={{ scale: 0.95 }}
              >
                <Play size={15} fill="currentColor" />
                {activeJob ? "סורק…" : "התחל סריקה"}
              </motion.button>
            </div>

            <AnimatePresence>
              {activeJob && (
                <motion.div
                  key={activeJob.id}
                  initial={{ opacity: 0, y: -18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 200, damping: 22 }}
                >
                  <LiveJob
                    jobId={activeJob.id}
                    groupName={selectedGroup?.name || `קבוצה ${selectedGroup?.fb_group_id}`}
                    onDone={onJobDone}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <PeopleTable
              people={people}
              csvHref={selected != null ? api.csvUrl(selected, true) : "#"}
            />
          </div>
        </motion.div>

        <AnimatePresence>
          {toast && (
            <motion.div
              className="toast"
              initial={{ opacity: 0, y: 26, x: "-50%", scale: 0.92 }}
              animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
              exit={{ opacity: 0, y: 14, x: "-50%", scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
            >
              <CheckCircle2 size={17} />
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}
