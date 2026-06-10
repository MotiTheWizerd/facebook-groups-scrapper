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
            if (e.status === "running") push({ k: "התחלה", v: "סורק…" });
            break;
          case "navigating":
            push({ k: "טעינה", v: "טוען את עמוד הקבוצה" });
            break;
          case "scroll":
            setCount(e.count);
            setIndex(e.index);
            setTotal(e.total);
            if (e.new > 0)
              push({ k: `#${e.index}`, v: `+${e.new} חדשים ← ${e.count}`, isNew: true });
            break;
          case "saved":
            push({ k: "שמירה", v: `נקודת שמירה ${e.count}` });
            break;
          case "persisted":
            push({ k: "מסד", v: `נשמרו ${e.found} (+${e.new_in_group} חדשים לקבוצה)` });
            break;
          case "done":
            push({ k: "סיום", v: `${e.count} אנשים · ${e.reason}` });
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
  const statusLabel: Record<string, string> = {
    running: "רץ",
    done: "הושלם",
    error: "שגיאה",
    starting: "מתחיל",
  };

  return (
    <div className="panel live">
      <div className="live-head">
        <div className="title">
          ⚡ סורק את <span className="grad-text">{groupName}</span>
        </div>
        <div className="badge-live">
          <span className="dot live" />
          {finished ? statusLabel[status] ?? status : "חי"}
        </div>
      </div>

      <div className="live-big">
        <span className="num">
          <AnimatedNumber value={count} />
        </span>
        <span className="num-label">אנשים נמצאו</span>
      </div>

      <div className="progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-meta">
        <span>
          גלילה {index} / {total}
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
