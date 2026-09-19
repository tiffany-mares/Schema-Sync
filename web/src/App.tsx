import { useCallback, useEffect, useState } from "react";
import { fetchBranches, fetchDiff } from "./api";
import { buildView, type TableView } from "./diffView";
import { SchemaFlow } from "./SchemaFlow";
import "./App.css";

const REPO = "demo";

export default function App() {
  const [branches, setBranches] = useState<string[]>([]);
  const [from, setFrom] = useState("main");
  const [to, setTo] = useState("main");
  const [view, setView] = useState<TableView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const compare = useCallback(async (fromBranch: string, toBranch: string) => {
    try {
      setError(null);
      const diff = await fetchDiff(REPO, fromBranch, toBranch);
      setView(buildView(diff.from_schema, diff.to_schema));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchBranches(REPO)
      .then((bs) => {
        setBranches(bs.map((b) => b.name));
        void compare("main", "main");
      })
      .catch((e) => setError((e as Error).message));
  }, [compare]);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">SchemaSync</span>
        <label>
          base
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <span className="arrow">{"→"}</span>
        <label>
          compare
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <button onClick={() => void compare(from, to)}>Compare</button>
        <span className="legend">
          <span className="chip added">added</span>
          <span className="chip dropped">dropped</span>
          <span className="chip modified">modified</span>
        </span>
        {error && <span className="error">{error}</span>}
      </header>
      <main className="canvas">{view && <SchemaFlow tables={view} />}</main>
    </div>
  );
}
