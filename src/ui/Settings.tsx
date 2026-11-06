import { useState } from "react";
import { readFile } from "../sync/github";
import { saveConfig, type Config } from "../sync/store";
import { Section } from "./common";
import { useTaskLube } from "./context";

export function Settings({ config }: { config: Config }) {
  const { data, dispatch, store } = useTaskLube();
  const [name, setName] = useState("");
  const [target, setTarget] = useState(3);

  return (
    <div className="page">
      <Section title="Planning">
        <label className="field">
          <span className="label">Daily estimate guideline (hours)</span>
          <input
            type="number"
            min={1}
            max={16}
            step={0.5}
            value={data.settings.capacityHours}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (v > 0) dispatch({ type: "updateSettings", patch: { capacityHours: v } });
            }}
          />
          <span className="hint">How many hours of estimated work to plan per working day. A starting point; adjust once you see your estimate ratio.</span>
        </label>
      </Section>

      <Section title="Habits">
        {data.habits.map((h) => (
          <div key={h.id} className="habit-edit">
            <input defaultValue={h.name} onBlur={(e) => e.target.value.trim() && e.target.value !== h.name && dispatch({ type: "updateHabit", id: h.id, patch: { name: e.target.value.trim() } })} />
            <input
              type="number"
              min={1}
              max={7}
              defaultValue={h.target}
              onBlur={(e) => {
                const v = parseInt(e.target.value, 10);
                if (v > 0 && v !== h.target) dispatch({ type: "updateHabit", id: h.id, patch: { target: v } });
              }}
            />
            <span className="muted small">/ week</span>
            <button className="mini" onClick={() => dispatch({ type: "updateHabit", id: h.id, patch: { archived: !h.archived } })}>
              {h.archived ? "Restore" : "Archive"}
            </button>
          </div>
        ))}
        <form
          className="habit-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            dispatch({ type: "addHabit", habit: { name: name.trim(), target } });
            setName("");
          }}
        >
          <input placeholder="New habit" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" min={1} max={7} value={target} onChange={(e) => setTarget(parseInt(e.target.value, 10) || 1)} />
          <span className="muted small">/ week</span>
          <button className="mini" type="submit">
            Add
          </button>
        </form>
      </Section>

      <Section title="Data">
        <p className="muted small">
          {config.mode === "github" ? (
            <>
              Saved to <code>{`${config.owner}/${config.repo}/${config.path}`}</code> on GitHub ({config.branch}).
            </>
          ) : (
            "Stored only in this browser. Connect GitHub to sync across devices and let Claude read it."
          )}
        </p>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              const blob = new Blob([store.exportJson()], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `tasklube-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
            }}
          >
            Download a copy
          </button>
          <button
            className="btn danger"
            onClick={() => {
              const pending = store.pendingCount;
              if (confirm(pending ? `${pending} change(s) aren't saved yet and will be lost. Disconnect anyway?` : "Disconnect this device? Your data stays where it is.")) {
                saveConfig(null);
                location.reload();
              }
            }}
          >
            Disconnect this device
          </button>
        </div>
      </Section>
    </div>
  );
}

export function Setup({ onDone }: { onDone: (c: Config) => void }) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("tl-data");
  const [branch, setBranch] = useState("main");
  const [path, setPath] = useState("logger.json");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="setup">
      <h1>TaskLube</h1>
      <p>A neutral record of what you planned and what you did.</p>
      <div className="card">
        <h2>Connect your data repo</h2>
        <p className="muted small">
          Your data is one JSON file in a private GitHub repo. Create a{" "}
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
            fine-grained token
          </a>{" "}
          with access to <strong>only that repo</strong> and <strong>Contents: Read and write</strong>. The token is stored only in this browser.
        </p>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const c: Config = { mode: "github", owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || "main", path: path.trim() || "logger.json", token: token.trim() };
            setBusy(true);
            setMsg("");
            try {
              const f = await readFile(c);
              setMsg(f ? "Connected." : "Connected. The data file will be created.");
              saveConfig(c);
              onDone(c);
            } catch (err) {
              setMsg(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid2">
            <label className="field">
              <span className="label">Owner</span>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="GitHub username" required />
            </label>
            <label className="field">
              <span className="label">Repo</span>
              <input value={repo} onChange={(e) => setRepo(e.target.value)} required />
            </label>
            <label className="field">
              <span className="label">Branch</span>
              <input value={branch} onChange={(e) => setBranch(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">File</span>
              <input value={path} onChange={(e) => setPath(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="label">Token</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" />
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? "Checking…" : "Connect"}
          </button>
          {msg && <p className="hint">{msg}</p>}
        </form>
      </div>
      <button
        className="btn link"
        onClick={() => {
          const c: Config = { mode: "local" };
          saveConfig(c);
          onDone(c);
        }}
      >
        Try it without GitHub (data stays in this browser)
      </button>
    </div>
  );
}
