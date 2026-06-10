import { useMemo, useState } from "react";
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
          <h2>Drivers</h2>
          <span className="idtag">
            {rows.length} shown{anonCount ? ` · ${anonCount} anonymous` : ""}
          </span>
        </div>
        <div className="tools">
          <input
            className="search"
            placeholder="Search name or id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="toggle">
            <input
              type="checkbox"
              checked={hideAnon}
              onChange={(e) => setHideAnon(e.target.checked)}
            />
            Hide anonymous
          </label>
          <a className="btn ghost sm" href={csvHref} download>
            ⬇ CSV
          </a>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="big">🗒️</div>
          No people yet — run a scrape to fill this up.
        </div>
      ) : (
        <div className="tbody-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Profile</th>
                <th>Facebook ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const av = avatarFor(p.name);
                return (
                  <tr key={p.user_id}>
                    <td>
                      <div className="name-cell">
                        <span className="avatar" style={{ background: av.color }}>
                          {av.initial}
                        </span>
                        <span dir="auto">{p.name}</span>
                        {p.is_anonymous ? <span className="anon-tag">anon</span> : null}
                      </div>
                    </td>
                    <td>
                      <a className="plink" href={p.profile_url} target="_blank" rel="noreferrer">
                        open profile ↗
                      </a>
                    </td>
                    <td className="idtag mono">{p.user_id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
