import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  Search,
  Users,
} from "lucide-react";
import { api, PeoplePage, Person } from "../api";

const AV_COLORS = [
  "linear-gradient(135deg,#7c5cff,#18d3ff)",
  "linear-gradient(135deg,#ff5ca8,#ff9d5c)",
  "linear-gradient(135deg,#2ee6a6,#18d3ff)",
  "linear-gradient(135deg,#ffb84d,#ff5ca8)",
  "linear-gradient(135deg,#5c8cff,#7c5cff)",
];
function avatarFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { color: AV_COLORS[h % AV_COLORS.length], initial: name.trim()[0]?.toUpperCase() || "?" };
}

// Shows the real FB photo; on load error (e.g. expired signed URL) it falls
// back to the colored initial so the table never shows broken images.
function Avatar({ person }: { person: Person }) {
  const av = avatarFor(person.name);
  const [broken, setBroken] = useState(false);
  return (
    <motion.span
      className="av-wrap"
      whileHover={{ scale: 1.22, rotate: -6 }}
      transition={{ type: "spring", stiffness: 320, damping: 16 }}
    >
      {person.avatar_url && !broken ? (
        <img
          className="avatar"
          src={person.avatar_url}
          alt={person.name}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="avatar" style={{ background: av.color }}>
          {av.initial}
        </span>
      )}
    </motion.span>
  );
}

// Windowed page list: 1 … 4 5 [6] 7 8 … 600
function pageWindow(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set([1, 2, page - 1, page, page + 1, pages - 1, pages]);
  const out: (number | "…")[] = [];
  for (let n = 1; n <= pages; n++) {
    if (wanted.has(n)) out.push(n);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      {/* RTL: "previous" points right, "next" points left */}
      <motion.button
        className="pg-btn nav"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        whileTap={{ scale: 0.9 }}
        aria-label="עמוד קודם"
      >
        <ChevronRight size={15} />
      </motion.button>
      {pageWindow(page, pages).map((n, i) =>
        n === "…" ? (
          <span key={`e${i}`} className="pg-ellipsis">
            …
          </span>
        ) : (
          <motion.button
            key={n}
            className={`pg-btn ${n === page ? "current" : ""}`}
            onClick={() => onPage(n)}
            whileTap={{ scale: 0.9 }}
          >
            {n === page && (
              <motion.span
                layoutId="pg-active"
                className="pg-pill"
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <span className="pg-num mono">{n.toLocaleString()}</span>
          </motion.button>
        )
      )}
      <motion.button
        className="pg-btn nav"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        whileTap={{ scale: 0.9 }}
        aria-label="עמוד הבא"
      >
        <ChevronLeft size={15} />
      </motion.button>
    </div>
  );
}

// Stagger only the first rows of each page so big pages still feel snappy.
const STAGGER_ROWS = 22;
const PER_PAGE_OPTIONS = [25, 50, 100, 200];

export function PeopleTable({
  groupId,
  refreshKey,
  csvHref,
}: {
  groupId: number | null;
  refreshKey: number;
  csvHref: string;
}) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState(""); // debounced — what actually hits the API
  const [hideAnon, setHideAnon] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [data, setData] = useState<PeoplePage | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // any filter change restarts from page 1
  useEffect(() => {
    setPage(1);
  }, [groupId, dq, hideAnon, perPage]);

  useEffect(() => {
    if (groupId == null) {
      setData(null);
      return;
    }
    let stale = false;
    setLoading(true);
    api
      .listPeople(groupId, { includeAnon: !hideAnon, q: dq, page, perPage })
      .then((d) => {
        if (stale) return;
        setData(d);
        // e.g. filter shrank the result set under our feet
        if (d.page !== page) setPage(d.page);
      })
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [groupId, dq, hideAnon, page, perPage, refreshKey]);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="panel people-panel">
      <div className="people-head">
        <div className="left">
          <h2>
            <Users size={17} /> נהגים
          </h2>
          <span className="idtag">
            {total.toLocaleString()} סה״כ
            {data?.anon_count ? ` · ${data.anon_count.toLocaleString()} אנונימיים` : ""}
          </span>
        </div>
        <div className="tools">
          <span className="search-wrap">
            <Search size={14} />
            <input
              className="search"
              placeholder="חיפוש שם או מזהה…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={hideAnon}
              onChange={(e) => setHideAnon(e.target.checked)}
            />
            הסתר אנונימיים
          </label>
          <select
            className="per-page mono"
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value))}
            title="שורות בעמוד"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <a className="btn ghost sm" href={csvHref} download>
            <Download size={14} /> ייצוא CSV
          </a>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <motion.div
            className="big"
            animate={{ y: [0, -7, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <ClipboardList size={46} strokeWidth={1.3} />
          </motion.div>
          {dq || hideAnon
            ? "לא נמצאו תוצאות לסינון הנוכחי."
            : "אין אנשים עדיין — הריצו סריקה כדי למלא את הטבלה."}
        </div>
      ) : (
        <motion.div
          key={`${groupId}-${page}-${dq}-${hideAnon}-${perPage}`}
          className="tbody-wrap"
          initial={{ opacity: 0 }}
          animate={{ opacity: loading ? 0.45 : 1 }}
          transition={{ duration: 0.25 }}
        >
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>פרופיל</th>
                <th>מזהה פייסבוק</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => {
                const cell = (
                  <>
                    <td>
                      <div className="name-cell">
                        <Avatar person={p} />
                        <span dir="auto">{p.name}</span>
                        {p.is_anonymous ? <span className="anon-tag">אנונימי</span> : null}
                      </div>
                    </td>
                    <td>
                      <a className="plink" href={p.profile_url} target="_blank" rel="noreferrer">
                        פתח פרופיל <ExternalLink size={12} />
                      </a>
                    </td>
                    <td className="idtag mono" dir="ltr">{p.user_id}</td>
                  </>
                );
                return i < STAGGER_ROWS ? (
                  <motion.tr
                    key={p.user_id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.025, type: "spring", stiffness: 240, damping: 24 }}
                  >
                    {cell}
                  </motion.tr>
                ) : (
                  <tr key={p.user_id}>{cell}</tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}

      {(rows.length > 0 || pages > 1) && (
        <div className="table-foot">
          <span className="idtag">
            מציג {from.toLocaleString()}–{to.toLocaleString()} מתוך {total.toLocaleString()}
          </span>
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
