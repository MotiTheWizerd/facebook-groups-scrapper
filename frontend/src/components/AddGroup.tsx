import { useState } from "react";
import { motion } from "framer-motion";
import { Link2, Plus } from "lucide-react";

export function AddGroup({ onAdd }: { onAdd: (url: string, name?: string) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(url.trim(), name.trim() || undefined);
      setUrl("");
      setName("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel add-row">
      <span className="icon">
        <Link2 size={19} />
      </span>
      <input
        className="field"
        dir="ltr"
        placeholder="הדביקו קישור לקבוצת פייסבוק ציבורית…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        className="field"
        style={{ flex: "0 0 200px" }}
        placeholder="תווית (רשות)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <motion.button
        className="btn"
        onClick={submit}
        disabled={busy || !url.trim()}
        whileTap={{ scale: 0.95 }}
      >
        <Plus size={16} />
        {busy ? "מוסיף…" : "הוספת קבוצה"}
      </motion.button>
    </div>
  );
}
