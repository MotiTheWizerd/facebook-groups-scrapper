import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardList, Download, ExternalLink, Search, Users } from "lucide-react";
import { Person } from "../api";

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

// Stagger only the first rows — with hundreds of people a full-table
// stagger would feel sluggish instead of alive.
const STAGGER_ROWS = 22;

export function PeopleTable({
  people,
  csvHref,
}: {
  people: Person[];
  csvHref: string;
}) {
  const [q, setQ] = useState("");
  const [hideAnon, setHideAnon] = useState(false);

  const rows = useMemo(() => {
    return people.filter(
      (p) =>
        (!hideAnon || !p.is_anonymous) &&
        (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.user_id.includes(q))
    );
  }, [people, q, hideAnon]);

  const anonCount = people.filter((p) => p.is_anonymous).length;

  return (
    <div className="panel people-panel">
      <div className="people-head">
        <div className="left">
          <h2>
            <Users size={17} /> נהגים
          </h2>
          <span className="idtag">
            {rows.length} מוצגים{anonCount ? ` · ${anonCount} אנונימיים` : ""}
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
          אין אנשים עדיין — הריצו סריקה כדי למלא את הטבלה.
        </div>
      ) : (
        <div className="tbody-wrap">
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
                    transition={{ delay: i * 0.03, type: "spring", stiffness: 240, damping: 24 }}
                  >
                    {cell}
                  </motion.tr>
                ) : (
                  <tr key={p.user_id}>{cell}</tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
