import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import { useQuestionReminderTurns } from "../hooks/useQuestionReminderTurns";
import {
  collectAsyncQuestions,
  getQuestionReminderStage,
  type AsyncQuestion,
} from "../lib/asyncQuestions";
import { quoteMarkdown } from "../lib/commentAnchors";
import type { ComposerDraftSignal } from "../lib/composerDraftSignal";
import type { SessionRouteScrollSnapshot } from "../lib/sessionRouteSnapshots";
import type { RenderItem } from "../types/renderItems";

const recordSchema = z.object({
  draft: z.string(),
  dismissed: z.boolean(),
  seen: z.boolean(),
  answer: z.string().nullable(),
  edits: z.number().nonnegative(),
});
export type AsyncQuestionRecord = z.infer<typeof recordSchema>;
const emptyRecord: AsyncQuestionRecord = {
  draft: "",
  dismissed: false,
  seen: false,
  answer: null,
  edits: 0,
};

export interface QuestionNavigation {
  capture(): SessionRouteScrollSnapshot | null;
  jump(renderId: string, questionId: string): void;
  restore(snapshot: SessionRouteScrollSnapshot): void;
}

interface AsyncQuestionsState {
  reminderTurns: number;
  questions: readonly AsyncQuestion[];
  records: Readonly<Record<string, AsyncQuestionRecord>>;
  activeId: string | null;
  submittingId: string | null;
  menuOpen: boolean;
  setMenuOpen(open: boolean): void;
  observe(items: readonly RenderItem[]): void;
  navigation: { current: QuestionNavigation | null };
  retainedRenderIds: readonly string[];
  open(question: AsyncQuestion): void;
  returnToPrevious(): void;
  update(id: string, patch: Partial<AsyncQuestionRecord>): void;
  submit(question: AsyncQuestion, answer: string): Promise<boolean>;
  quote(question: AsyncQuestion): void;
}

const AsyncQuestionsContext = createContext<AsyncQuestionsState | null>(null);
export const useAsyncQuestions = () => useContext(AsyncQuestionsContext);

function readRecords(key: string): Record<string, AsyncQuestionRecord> {
  const records: Record<string, AsyncQuestionRecord> = {};
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const storedKey = localStorage.key(index);
      if (!storedKey?.startsWith(`${key}:`)) continue;
      const raw = localStorage.getItem(storedKey);
      if (!raw) continue;
      const parsed = recordSchema.safeParse(JSON.parse(raw));
      if (parsed.success)
        records[storedKey.slice(key.length + 1)] = parsed.data;
    }
  } catch {
    // Private browser storage can be disabled; the current visit still works.
  }
  return records;
}

export function AsyncQuestionsProvider({
  storageKey,
  draftSignal,
  send,
  quote,
  focusComposer,
  children,
}: {
  storageKey: string;
  draftSignal: ComposerDraftSignal;
  send(text: string): Promise<boolean>;
  quote(text: string): unknown;
  focusComposer(): void;
  children: ReactNode;
}) {
  const reminderTurns = useQuestionReminderTurns();
  const [questions, setQuestions] = useState<readonly AsyncQuestion[]>([]);
  const [records, setRecords] = useState(() => readRecords(storageKey));
  const recordsRef = useRef(records);
  const questionsRef = useRef(questions);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const submitting = useRef(false);
  const visit = useRef(0);
  const dirtyEditIds = useRef(new Set<string>());
  const [menuOpen, setMenuOpen] = useState(false);
  const navigation = useRef<QuestionNavigation | null>(null);
  const returnPosition = useRef<SessionRouteScrollSnapshot | null>(null);
  const [returnAnchorId, setReturnAnchorId] = useState<string | null>(null);
  const callbacks = useRef({ send, quote, focusComposer });
  callbacks.current = { send, quote, focusComposer };

  const persistRecord = useCallback(
    (id: string, patch: Partial<AsyncQuestionRecord>) => {
      let record = recordsRef.current[id] ?? emptyRecord;
      try {
        const raw = localStorage.getItem(`${storageKey}:${id}`);
        const parsed = raw ? recordSchema.safeParse(JSON.parse(raw)) : null;
        if (parsed?.success)
          record = {
            ...parsed.data,
            edits: Math.max(record.edits, parsed.data.edits),
          };
        record = {
          ...record,
          ...patch,
          edits: Math.max(record.edits, patch.edits ?? 0),
        };
        localStorage.setItem(`${storageKey}:${id}`, JSON.stringify(record));
      } catch {
        /* Retain drafts and reminder state in memory when storage is unavailable. */
        record = { ...record, ...patch };
      }
      recordsRef.current = { ...recordsRef.current, [id]: record };
      dirtyEditIds.current.delete(id);
    },
    [storageKey],
  );

  const persist = useCallback(() => {
    for (const id of dirtyEditIds.current)
      persistRecord(id, { edits: recordsRef.current[id]!.edits });
  }, [persistRecord]);

  const update = useCallback(
    (id: string, patch: Partial<AsyncQuestionRecord>) => {
      persistRecord(id, patch);
      setRecords(recordsRef.current);
    },
    [persistRecord],
  );

  const observe = useCallback((items: readonly RenderItem[]) => {
    const next = collectAsyncQuestions(items);
    if (JSON.stringify(next) === JSON.stringify(questionsRef.current)) return;
    questionsRef.current = next;
    setQuestions(next);
  }, []);

  useEffect(() => {
    let previous = draftSignal.getDraft();
    return draftSignal.subscribeDraftChanges(({ text }) => {
      const changed = text !== previous;
      previous = text;
      if (!changed || !text) return;
      let stageChanged = false;
      const next = { ...recordsRef.current };
      for (const question of questionsRef.current) {
        const record = next[question.id] ?? emptyRecord;
        if (record.dismissed || record.answer !== null) continue;
        const edits = Math.min(2400, record.edits + 1);
        if (edits === record.edits) continue;
        dirtyEditIds.current.add(question.id);
        stageChanged ||=
          getQuestionReminderStage(question.age, edits, reminderTurns) !==
          getQuestionReminderStage(question.age, record.edits, reminderTurns);
        next[question.id] = { ...record, edits };
      }
      recordsRef.current = next;
      if (stageChanged) {
        setRecords(next);
        persist();
      }
    });
  }, [draftSignal, persist, reminderTurns]);

  useEffect(() => {
    setRecords(recordsRef.current);
  }, [reminderTurns]);

  useEffect(() => {
    const saveWhenHidden = () => {
      if (document.hidden) persist();
    };
    const receive = (event: StorageEvent) => {
      if (!event.key?.startsWith(`${storageKey}:`) || !event.newValue) return;
      const id = event.key.slice(storageKey.length + 1);
      let parsed: ReturnType<typeof recordSchema.safeParse>;
      try {
        parsed = recordSchema.safeParse(JSON.parse(event.newValue));
      } catch {
        return;
      }
      if (!parsed.success) return;
      recordsRef.current = {
        ...recordsRef.current,
        [id]: {
          ...parsed.data,
          edits: Math.max(
            parsed.data.edits,
            recordsRef.current[id]?.edits ?? 0,
          ),
        },
      };
      setRecords(recordsRef.current);
    };
    window.addEventListener("storage", receive);
    document.addEventListener("visibilitychange", saveWhenHidden);
    window.addEventListener("pagehide", persist);
    return () => {
      persist();
      document.removeEventListener("visibilitychange", saveWhenHidden);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("storage", receive);
    };
  }, [persist, storageKey]);

  const open = useCallback((question: AsyncQuestion) => {
    visit.current++;
    returnPosition.current ??= navigation.current?.capture() ?? null;
    setReturnAnchorId(returnPosition.current?.anchor?.id ?? null);
    setMenuOpen(false);
    setActiveId(question.id);
    navigation.current?.jump(question.renderId, question.id);
  }, []);

  const returnToPrevious = useCallback(() => {
    visit.current++;
    setActiveId(null);
    const position = returnPosition.current;
    returnPosition.current = null;
    setReturnAnchorId(null);
    if (position) navigation.current?.restore(position);
    callbacks.current.focusComposer();
  }, []);

  const submit = useCallback(
    async (question: AsyncQuestion, answer: string) => {
      if (!answer.trim() || submitting.current) return false;
      const submittedVisit = visit.current;
      returnPosition.current ??= navigation.current?.capture() ?? null;
      submitting.current = true;
      setSubmittingId(question.id);
      let moved = false;
      const noteMovement = (event: Event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          event.type !== "wheel" &&
          target.closest<HTMLElement>("[data-async-question-reply]")?.dataset
            .asyncQuestionReply === question.id
        )
          return;
        moved = true;
      };
      document.addEventListener("pointerdown", noteMovement, true);
      document.addEventListener("focusin", noteMovement, true);
      document.addEventListener("wheel", noteMovement, {
        capture: true,
        passive: true,
      });
      try {
        const sent = await callbacks.current.send(
          `${quoteMarkdown(question.title)}\n\n${answer}`,
        );
        if (sent) {
          update(question.id, { answer, draft: "", seen: true });
          if (!moved && submittedVisit === visit.current) returnToPrevious();
          else if (submittedVisit === visit.current) {
            setActiveId(null);
            setReturnAnchorId(null);
            returnPosition.current = null;
          }
        }
        return sent;
      } finally {
        submitting.current = false;
        setSubmittingId(null);
        document.removeEventListener("pointerdown", noteMovement, true);
        document.removeEventListener("focusin", noteMovement, true);
        document.removeEventListener("wheel", noteMovement, true);
      }
    },
    [returnToPrevious, update],
  );

  const quoteQuestion = useCallback(
    (question: AsyncQuestion) => {
      open(question);
      setActiveId(null);
      setReturnAnchorId(null);
      returnPosition.current = null;
      callbacks.current.quote(`${quoteMarkdown(question.title)}\n\n`);
    },
    [open],
  );

  const retainedRenderIds = useMemo(() => {
    const active = questions.find((question) => question.id === activeId);
    return [
      ...(active ? [active.renderId] : []),
      ...(returnAnchorId ? [returnAnchorId] : []),
    ];
  }, [questions, activeId, returnAnchorId]);
  const value = useMemo(
    () => ({
      reminderTurns,
      questions,
      records,
      activeId,
      submittingId,
      menuOpen,
      retainedRenderIds,
      setMenuOpen,
      observe,
      navigation,
      open,
      returnToPrevious,
      update,
      submit,
      quote: quoteQuestion,
    }),
    [
      reminderTurns,
      questions,
      records,
      activeId,
      submittingId,
      menuOpen,
      retainedRenderIds,
      observe,
      open,
      returnToPrevious,
      update,
      submit,
      quoteQuestion,
    ],
  );
  return (
    <AsyncQuestionsContext.Provider value={value}>
      {children}
    </AsyncQuestionsContext.Provider>
  );
}
