import { useId, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsSection } from "../../src/pages/settings/SettingsSection";
import "../../src/styles/index.css";
import styles from "./Prompts.module.css";

const DEFAULT_BLOCK =
  'When using any external image/video generation API or MCP tool, enable the provider\'s safety filtering at its strictest setting (e.g. moderation="auto", enable_safety_checker=true, safety_filter_level="block_most"). Never disable a safety checker. Prefer providers with server-side filtering.';

interface Block {
  id: number;
  text: string;
}

function Blocks({
  blocks,
  onChange,
  scope,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  scope: string;
}) {
  const prefix = useId();
  function move(index: number, direction: number) {
    const next = [...blocks];
    const other = index + direction;
    [next[index], next[other]] = [next[other]!, next[index]!];
    onChange(next);
  }
  return (
    <div className={styles.blocks}>
      {blocks.length === 0 && (
        <p className={styles.empty}>
          No additional instructions. Shared instructions still apply.
        </p>
      )}
      {blocks.map((block, index) => (
        <div className={styles.block} key={block.id}>
          <div className={styles.blockHead}>
            <label htmlFor={`${prefix}-${block.id}`}>Block {index + 1}</label>
            <div className={styles.tools}>
              <button
                type="button"
                aria-label={`Move ${scope} block ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${scope} block ${index + 1} down`}
                disabled={index === blocks.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove ${scope} block ${index + 1}`}
                onClick={() =>
                  onChange(blocks.filter((item) => item.id !== block.id))
                }
              >
                Remove
              </button>
            </div>
          </div>
          <textarea
            id={`${prefix}-${block.id}`}
            aria-label={`${scope} block ${index + 1}`}
            rows={block.text.length > 200 ? 5 : 3}
            placeholder="Write an instruction…"
            value={block.text}
            onChange={(event) =>
              onChange(
                blocks.map((item) =>
                  item.id === block.id
                    ? { ...item, text: event.target.value }
                    : item,
                ),
              )
            }
          />
        </div>
      ))}
      <button
        className={styles.add}
        type="button"
        onClick={() =>
          onChange([
            ...blocks,
            {
              id: Math.max(0, ...blocks.map((block) => block.id)) + 1,
              text: "",
            },
          ])
        }
      >
        + Add instruction block
      </button>
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<"global" | "user">("global");
  const [defaults, setDefaults] = useState(true);
  const [globalBlocks, setGlobalBlocks] = useState<Block[]>([
    { id: 1, text: DEFAULT_BLOCK },
  ]);
  const [userBlocks, setUserBlocks] = useState<Block[]>([]);
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState(false);
  const isGlobal = screen === "global";
  const text = [...globalBlocks, ...(!isGlobal ? userBlocks : [])]
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
  function navigate(next: "global" | "user") {
    setScreen(next);
    setPreview(false);
    setNotice("");
    window.scrollTo(0, 0);
  }
  return (
    <div className={styles.page}>
      <div className={styles.mockbar}>
        <span>UI proposal · local preview only</span>
        <nav aria-label="Mockup views">
          <button
            type="button"
            aria-pressed={isGlobal}
            onClick={() => navigate("global")}
          >
            All limited users
          </button>
          <button
            type="button"
            aria-pressed={!isGlobal}
            onClick={() => navigate("user")}
          >
            Edit Alex
          </button>
        </nav>
      </div>
      <header className={styles.header}>
        <strong>Yep Anywhere</strong>
        <span>
          Settings <span aria-hidden="true">/</span> Users
        </span>
      </header>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <strong>Settings</strong>
          <span>Appearance</span>
          <span>Sessions</span>
          <span>Providers</span>
          <span>Projects</span>
          <span>Local access</span>
          <span className={styles.selected}>Users</span>
          <span>Advanced</span>
        </aside>
        <main className={styles.main}>
          <div className={styles.titleRow}>
            <div>
              <h1>{isGlobal ? "Users" : "Edit Alex"}</h1>
              <p>
                {isGlobal
                  ? "Manage limited accounts and their shared instructions."
                  : "Account settings · limited user"}
              </p>
            </div>
            {!isGlobal && (
              <button type="button" onClick={() => navigate("global")}>
                ← All users
              </button>
            )}
          </div>
          {isGlobal && (
            <div className={styles.userRow}>
              <div>
                <strong>Alex</strong>
                <span>Limited user · 2 projects</span>
              </div>
              <button type="button" onClick={() => navigate("user")}>
                Edit
              </button>
            </div>
          )}
          {!isGlobal && (
            <details className={styles.account}>
              <summary>Account, workspace & project access</summary>
              <p>
                Existing account and grant controls stay here. This proposal
                focuses on instructions.
              </p>
            </details>
          )}
          <SettingsSection
            title={
              isGlobal
                ? "Instructions for all limited users"
                : "Additional instructions for Alex"
            }
            description={
              isGlobal
                ? "Applied to every limited user's agent session. Edit blocks below; they are joined in order."
                : "Appended after the shared instructions. Only an administrator can edit these."
            }
          >
            {isGlobal ? (
              <div className={styles.defaultControl}>
                <label>
                  <input
                    type="checkbox"
                    checked={defaults}
                    onChange={(event) => setDefaults(event.target.checked)}
                  />
                  <strong>Start from default</strong>
                </label>
                <p>
                  {defaults
                    ? "Keep the provider’s default instructions, then append these blocks."
                    : "Replace the provider’s default instructions with these blocks."}
                </p>
              </div>
            ) : (
              <div className={styles.inherited}>
                <div>
                  <strong>Inherited from all limited users</strong>
                  <button type="button" onClick={() => navigate("global")}>
                    Edit shared
                  </button>
                </div>
                <p>
                  {defaults ? "Provider default + " : "Custom base · "}
                  {globalBlocks.length} shared{" "}
                  {globalBlocks.length === 1 ? "block" : "blocks"}
                </p>
                <details>
                  <summary>Read shared instructions</summary>
                  <p className={styles.promptText}>
                    {globalBlocks.map((block) => block.text).join("\n\n") ||
                      "No shared blocks."}
                  </p>
                </details>
              </div>
            )}
            <Blocks
              blocks={isGlobal ? globalBlocks : userBlocks}
              onChange={isGlobal ? setGlobalBlocks : setUserBlocks}
              scope={isGlobal ? "Shared" : "Alex"}
            />
            <div className={styles.order}>
              <span>Order</span>
              <span>
                {defaults ? "Provider default → " : ""}Shared blocks
                {!isGlobal ? " → Alex’s blocks" : " → Per-user blocks"}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() =>
                  setNotice(
                    "Saved in this preview only. No server settings changed.",
                  )
                }
              >
                {isGlobal ? "Save shared instructions" : "Save user"}
              </button>
              <button
                type="button"
                onClick={() => setPreview(!preview)}
                aria-expanded={preview}
              >
                Preview combined instructions
              </button>
            </div>
            {notice && (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            )}
            {preview && (
              <section className={styles.preview}>
                <h3>Combined instructions{!isGlobal && " · Alex"}</h3>
                {defaults && (
                  <p className={styles.baseNote}>
                    Provider default instructions come first. Their text varies
                    by provider.
                  </p>
                )}
                <pre>{text || "No custom instructions."}</pre>
                {isGlobal && (
                  <p>A user's own blocks, if any, are appended after these.</p>
                )}
              </section>
            )}
            <p className={styles.timing}>
              Takes effect on the next session launch. Running sessions keep
              their current instructions.
            </p>
          </SettingsSection>
          <section className={styles.restriction}>
            <div className={styles.restrictionHead}>
              <strong>Sandbox restrictions</strong>
              <span>Always enforced</span>
            </div>
            <p>Claude: all MCP servers and connectors disabled.</p>
            <p className={styles.hint}>
              Applies to every sandboxed Claude session. Instruction edits
              cannot enable them.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
