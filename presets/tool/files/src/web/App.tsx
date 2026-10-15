import { useState } from "react";
import { textStats } from "./lib/stats";
import { AppShell } from "./ui/primitives";
import "./tool.css";

const SAMPLE = "Type or paste text here.\nThe result updates as you type.";

export function App() {
  const [text, setText] = useState(SAMPLE);
  const stats = textStats(text);
  return (
    <AppShell title="{{APP_NAME}}">
      <h1>{{APP_NAME}}</h1>
      <div className="tool">
        <div className="pane">
          <label htmlFor="input">Input</label>
          <textarea id="input" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="pane">
          <h2>Result</h2>
          <output htmlFor="input" aria-live="polite">
            <div className="stats">
              <span data-testid="words">{stats.words} words</span>
              <span>{stats.characters} characters</span>
              <span>{stats.lines} lines</span>
            </div>
          </output>
        </div>
      </div>
    </AppShell>
  );
}
