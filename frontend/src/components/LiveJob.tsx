import { useEffect, useRef, useState } from "react";
import { subscribeJob, ProgressEvent } from "../api";
import { AnimatedNumber } from "./AnimatedNumber";

interface LogLine { k: string; v: string; isNew?: boolean; }

export function LiveJob({
  jobId,
  groupName,
  onDone,
}: {
  jobId: string;
  groupName: string;
  onDone: () => void;
}) {
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("starting");
  const [log, setLog] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const push = (l: LogLine) => setLog((p) => [...p.slice(-40), l]);
    const stop = subscribeJob(
      jobId,
      (e: ProgressEvent) => {
        switch (e.event) {
          case "status":
            setStatus(e.status);
            if (e.status === "running") push({ k: "start", v: "scraping…" });
            break;
          case "navigating":
            push({ k: "open", v: "loading group page" });
            break;
          case "scroll":
            setCount(e.count);
            setIndex(e.index);
            setTotal(e.total);
            if (e.new > 0)
              push({ k: `#${e.index}`, v: `+${e.new} new → ${e.count}`, isNew: true });
            break;
          case "saved":
            push({ k: "save", v: `checkpoint ${e.count}` });
            break;
          case "persisted":
            push({ k: "db", v: `saved ${e.found} (+${e.new_in_group} new to group)` });
            break;
          case "done":
            push({ k: "done", v: `${e.count} people · ${e.reason}` });
            break;
        }
      },
      onDone
    );
    return stop;
  }, [jobId, onDone]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const pct = total ? Math.round((index / total) * 100) : 0;
  const finished = status === "done" || status === "error";

  return (
    <div className="panel live">
      <div className="live-head">
        <div className="title">
          ⚡ Scraping <span className="grad-text">{groupName}</span>
        </div>
        <div className="badge-live">
          <span className="dot live" />
          {finished ? status : "live"}
        </div>
      </div>

      <div className="live-big">
        <span className="num">
          <AnimatedNumber value={count} />
        </span>
        <span className="num-label">people found</span>
      </div>

      <div className="progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <span>
          scroll {index} / {total}
        </span>
        <span>{pct}%</span>
      </div>

      <div className="eventlog" ref={logRef}>
        {log.map((l, i) => (
          <div className={`row ${l.isNew ? "new" : ""}`} key={i}>
            <span className="k mono">{l.k}</span>
            <span className="v">{l.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
