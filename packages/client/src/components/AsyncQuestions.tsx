import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComposerOverflowTier } from "../hooks/useMessageInputToolbarLayout";
import { useAsyncQuestions } from "../contexts/AsyncQuestionsContext";
import { useI18n } from "../i18n";
import {
  getQuestionReminderStage,
  type AsyncQuestion,
} from "../lib/asyncQuestions";
import styles from "./AsyncQuestions.module.css";
import { MarkdownPreview } from "./MarkdownPreview";
import { renderFixedFontRichContent } from "./ui/FixedFontMathToggle";

function QuestionIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M21 11a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.8-5A9 9 0 1 1 21 11Z" />
      <path d="M9.6 8a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 1.7-2.4 3.5M12 15h.01" />
    </svg>
  );
}

function QuestionMenuRow({
  question,
  showDismissed,
}: {
  question: AsyncQuestion;
  showDismissed: boolean;
}) {
  const state = useAsyncQuestions()!;
  const { t } = useI18n();
  const [contextOpen, setContextOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const dismissed = state.records[question.id]?.dismissed === true;
  const dismiss = () => {
    state.update(question.id, { dismissed: !dismissed });
    setContextOpen(false);
  };
  return (
    <li className={styles.menuRow}>
      <span
        className={styles.turnAge}
        role="img"
        aria-label={t("asyncQuestionTurnsAgo", { count: question.age })}
      >
        {question.age}
      </span>
      <div className={styles.previewBox}>
        <button
          type="button"
          className={styles.preview}
          title={question.title}
          aria-label={question.title}
          onClick={() => {
            if (held.current) {
              held.current = false;
              return;
            }
            state.open(question);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            clearTimer();
            setContextOpen(true);
          }}
          onTouchStart={() => {
            held.current = false;
            clearTimer();
            timer.current = setTimeout(() => {
              held.current = true;
              setContextOpen(true);
            }, 450);
          }}
          onTouchMove={clearTimer}
          onTouchEnd={clearTimer}
          onTouchCancel={clearTimer}
        >
          <span className={styles.previewText}>{question.title}</span>
          {!state.records[question.id]?.seen && (
            <span
              className={styles.unseen}
              role="img"
              aria-label={t("asyncQuestionUnseen")}
            />
          )}
        </button>
        <button
          type="button"
          className={styles.dismiss}
          onClick={dismiss}
          aria-label={t(
            dismissed ? "asyncQuestionRestore" : "asyncQuestionDismiss",
            { question: question.title },
          )}
        >
          {dismissed && showDismissed ? "↶" : "×"}
        </button>
        {contextOpen && (
          <div className={styles.rowMenu} role="menu">
            <button type="button" role="menuitem" onClick={dismiss}>
              {t(
                dismissed
                  ? "asyncQuestionRestoreShort"
                  : "asyncQuestionDismissShort",
              )}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function AsyncQuestionsButton({
  overflow = false,
  compact = "none",
}: {
  overflow?: boolean;
  compact?: ComposerOverflowTier;
}) {
  const state = useAsyncQuestions();
  const { t } = useI18n();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [position, setPosition] = useState({
    left: 8,
    bottom: 0,
    width: 360,
    maxHeight: 400,
  });
  const pending =
    state?.questions.filter(
      (question) => state.records[question.id]?.answer == null,
    ) ?? [];
  const visible = pending.filter(
    (question) => showDismissed || !state?.records[question.id]?.dismissed,
  );
  const reminders = pending.filter(
    (question) => !state?.records[question.id]?.dismissed,
  );
  const recent = reminders.filter(
    (question) =>
      getQuestionReminderStage(
        question.age,
        state?.records[question.id]?.edits ?? 0,
        state?.reminderTurns,
      ) === "recent",
  );
  const retired = reminders.every(
    (question) =>
      getQuestionReminderStage(
        question.age,
        state?.records[question.id]?.edits ?? 0,
        state?.reminderTurns,
      ) === "retired",
  );
  const newest = recent[recent.length - 1];
  const setMenuOpen = state?.setMenuOpen;
  const close = () => {
    setOpen(false);
    setMenuOpen?.(false);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(520, window.innerWidth - 16);
      setPosition({
        left: Math.max(
          8,
          Math.min(rect.right - width, window.innerWidth - width - 8),
        ),
        bottom: window.innerHeight - rect.top + 6,
        width,
        maxHeight: Math.max(100, rect.top - 16),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    const previews = panel.current?.querySelectorAll<HTMLButtonElement>(
      `button.${styles.preview}`,
    );
    previews?.[previews.length - 1]?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        panel.current?.contains(event.target) ||
        button.current?.contains(event.target)
      )
        return;
      setOpen(false);
      setMenuOpen?.(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      setMenuOpen?.(false);
      button.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, setMenuOpen]);

  useEffect(() => {
    if (state?.menuOpen === false) setOpen(false);
  }, [state?.menuOpen]);
  if (
    !state ||
    state.reminderTurns === 0 ||
    state.questions.length === 0 ||
    (!overflow && retired && !open && !focused)
  )
    return null;
  const label = newest
    ? `${t(recent.length === 1 ? "asyncQuestionSingle" : "asyncQuestionCount", { count: recent.length })} · ${t(newest.age === 1 ? "asyncQuestionOneTurnAgo" : "asyncQuestionTurnsAgo", { count: newest.age })}`
    : t("asyncQuestionsTitle");
  return (
    <>
      <button
        ref={button}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        type="button"
        className={`${styles.indicator} ${recent.length ? styles.recent : ""} ${overflow ? styles.overflowEntry : ""}`}
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        role={overflow ? "menuitem" : undefined}
        onClick={() => {
          setOpen(!open);
          setMenuOpen?.(!open);
        }}
      >
        <QuestionIcon />
        {newest && !overflow ? (
          <>
            <span>{recent.length}</span>
            {compact !== "late" && (
              <span>
                {t(
                  recent.length === 1
                    ? "asyncQuestionWord"
                    : "asyncQuestionsWord",
                )}
              </span>
            )}
            {compact === "none" && (
              <span>
                ·{" "}
                {t(
                  newest.age === 1
                    ? "asyncQuestionOneTurnAgo"
                    : "asyncQuestionTurnsAgo",
                  { count: newest.age },
                )}
              </span>
            )}
          </>
        ) : (
          <span>{t("asyncQuestionsTitle")}</span>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          className={styles.menu}
          style={position}
          role="dialog"
          aria-label={t("asyncQuestionsTitle")}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const targets = [
              ...(panel.current?.querySelectorAll<HTMLButtonElement>(
                `button.${styles.preview}`,
              ) ?? []),
            ];
            const current = targets.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (!targets.length) return;
            event.preventDefault();
            targets[
              (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                targets.length) %
                targets.length
            ]?.focus();
          }}
        >
          <div className={styles.menuHeading}>
            <strong>{t("asyncQuestionsTitle")}</strong>
            <button
              type="button"
              className={styles.dismiss}
              aria-label={t("asyncQuestionCloseMenu")}
              onClick={close}
            >
              ×
            </button>
          </div>
          <ul ref={list} className={styles.questionList}>
            {visible.map((question) => (
              <QuestionMenuRow
                key={question.id}
                question={question}
                showDismissed={showDismissed}
              />
            ))}
          </ul>
          {visible.length === 0 && <p>{t("asyncQuestionsNone")}</p>}
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setShowDismissed(!showDismissed)}
          >
            {t(
              showDismissed
                ? "asyncQuestionHideDismissed"
                : "asyncQuestionShowDismissed",
            )}
          </button>
        </div>
      )}
    </>
  );
}

function InlineQuestion({ question }: { question: AsyncQuestion }) {
  const state = useAsyncQuestions()!;
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const record = state.records[question.id];
  const active = state.activeId === question.id;
  const busy = state.submittingId === question.id;
  const answered = record?.answer != null;
  const update = state.update;
  const titleHtml = useMemo(
    () => renderFixedFontRichContent(question.title, { diffAware: false }).html,
    [question.title],
  );
  useEffect(() => {
    if (record?.seen || !root.current) return;
    let visible = false;
    const markSeen = () => {
      if (visible && !document.hidden) update(question.id, { seen: true });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = (entry?.intersectionRatio ?? 0) >= 0.6;
        markSeen();
      },
      { threshold: 0.6 },
    );
    observer.observe(root.current);
    document.addEventListener("visibilitychange", markSeen);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", markSeen);
    };
  }, [question.id, record?.seen, update]);
  const send = async (answer: string) => {
    setError(false);
    try {
      if (!(await state.submit(question, answer))) setError(true);
    } catch {
      setError(true);
    }
  };
  return (
    <div
      className={`${styles.inlineQuestion} ${active ? styles.activeQuestion : ""}`}
      data-async-question-reply={question.id}
    >
      <div ref={root}>
        <MarkdownPreview className={styles.questionTitle} html={titleHtml} />
      </div>
      {question.options.length > 0 && (
        <>
          <p className={styles.hint}>{t("asyncQuestionClickToSend")}</p>
          <ul className={styles.options}>
            {question.options.map((option, index) => (
              <li key={`${index}:${option}`}>
                <button
                  type="button"
                  disabled={busy || answered}
                  onClick={() => void send(option)}
                >
                  <span aria-hidden="true">•</span>
                  <span>{option}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {answered ? (
        <p className={styles.sent}>
          {t("asyncQuestionReplySent", { answer: record.answer! })}
        </p>
      ) : (
        <>
          {!active && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => state.open(question)}
            >
              {t("asyncQuestionReply")}
            </button>
          )}
          {active && (
            <form
              className={styles.replyForm}
              onSubmit={(event) => {
                event.preventDefault();
                void send(record?.draft ?? "");
              }}
            >
              <textarea
                rows={3}
                value={record?.draft ?? ""}
                aria-label={t("asyncQuestionReplyTo", {
                  question: question.title,
                })}
                placeholder={t("asyncQuestionReplyPlaceholder")}
                readOnly={busy}
                onChange={(event) =>
                  update(question.id, { draft: event.target.value })
                }
              />
              <div className={styles.replyActions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={state.returnToPrevious}
                >
                  {t("asyncQuestionBack")}
                </button>
                <button
                  type="submit"
                  className={styles.send}
                  disabled={busy || !record?.draft.trim()}
                >
                  {t(busy ? "asyncQuestionSending" : "asyncQuestionSend")}
                </button>
              </div>
            </form>
          )}
          <button
            type="button"
            className={styles.secondary}
            onClick={() => state.quote(question)}
          >
            {t("asyncQuestionQuoteMain")}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {t("asyncQuestionSendFailed")}
        </p>
      )}
    </div>
  );
}

export function AsyncQuestionMessage({
  renderId,
  fallback,
}: {
  renderId: string;
  fallback: ReactNode;
}) {
  const state = useAsyncQuestions();
  const questions =
    state?.questions.filter((question) => question.renderId === renderId) ?? [];
  if (!questions.length) return fallback;
  return (
    <>
      {questions.map((question) => (
        <InlineQuestion key={question.id} question={question} />
      ))}
    </>
  );
}
