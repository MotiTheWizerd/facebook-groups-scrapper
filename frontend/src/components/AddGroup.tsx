import { useState } from "react";

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
      <span className="icon">🔗</span>
      <input
        className="field"
        placeholder="Paste a public Facebook group URL…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        className="field"
        style={{ flex: "0 0 200px" }}
        placeholder="Label (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button className="btn" onClick={submit} disabled={busy || !url.trim()}>
        {busy ? "Adding…" : "+ Add group"}
      </button>
    </div>
  );
}
