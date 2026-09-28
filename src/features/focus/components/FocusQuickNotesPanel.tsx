import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { FocusQuickNoteDto } from "../../../../server/features/focus/types";
import { useTranslation, type Language } from "../../../core/i18n/translations";
import { focusApi } from "../api/focusApi";
import { createFocusIdempotencyKey } from "../runtime/idempotency";

export interface FocusQuickNotesPanelHandle {
  flush(): Promise<boolean>;
}

interface FocusQuickNotesPanelProps {
  sessionId: string;
  language: Language;
  online: boolean;
}

type NoteSaveState = "saved" | "saving" | "pending";

interface QuickNoteDraft {
  content: string;
  noteId: string | null;
  createIdempotencyKey: string;
}

const unsavedQuickNoteDrafts = new Map<string, QuickNoteDraft>();

export const FocusQuickNotesPanel = forwardRef<
  FocusQuickNotesPanelHandle,
  FocusQuickNotesPanelProps
>(function FocusQuickNotesPanel({ sessionId, language, online }, ref) {
  const { t } = useTranslation(language);
  const [notes, setNotes] = useState<FocusQuickNoteDto[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [saveState, setSaveState] = useState<NoteSaveState>("saved");
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const contentRef = useRef("");
  const savedContentRef = useRef("");
  const createIdempotencyKeyRef = useRef<string | null>(null);
  if (!createIdempotencyKeyRef.current) {
    createIdempotencyKeyRef.current = createFocusIdempotencyKey();
  }
  const mountedRef = useRef(true);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveCurrentRef = useRef<() => Promise<boolean>>(async () => true);

  const updateContent = useCallback((value: string) => {
    contentRef.current = value;
    setContent(value);
    setSaveError(false);
    setSaveState(value === savedContentRef.current ? "saved" : "pending");
    if (value === savedContentRef.current) {
      unsavedQuickNoteDrafts.delete(sessionId);
    } else {
      unsavedQuickNoteDrafts.set(sessionId, {
        content: value,
        noteId: selectedIdRef.current,
        createIdempotencyKey: createIdempotencyKeyRef.current!,
      });
    }
  }, [sessionId]);

  const applySavedNote = useCallback((note: FocusQuickNoteDto, text: string) => {
    selectedIdRef.current = note.id;
    savedContentRef.current = text;
    setLoadError(false);
    const draft = unsavedQuickNoteDrafts.get(sessionId);
    if (!draft || draft.content === text) {
      unsavedQuickNoteDrafts.delete(sessionId);
    } else {
      unsavedQuickNoteDrafts.set(sessionId, { ...draft, noteId: note.id });
    }
    if (!mountedRef.current) return;
    setSelectedNoteId(note.id);
    setSavedContent(text);
    if (contentRef.current === text || !contentRef.current) {
      contentRef.current = text;
      setContent(text);
      setSaveState("saved");
    }
    setNotes((current) => {
      const next = [note, ...current.filter((item) => item.id !== note.id)];
      return next.sort((a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    });
  }, [sessionId]);

  const persist = useCallback((text: string): Promise<boolean> => {
    const normalized = text;
    if (normalized.length > 2_000) return Promise.resolve(false);
    if (!normalized.trim()) return Promise.resolve(selectedIdRef.current === null);
    if (text === savedContentRef.current) {
      return saveQueueRef.current.then(() => true);
    }

    if (!online) {
      if (mountedRef.current) setSaveState("pending");
      return Promise.resolve(false);
    }

    if (mountedRef.current) {
      setSaveState("saving");
      setSaveError(false);
    }

    const queued = saveQueueRef.current.then(async () => {
      const existingId = selectedIdRef.current;
      if (existingId) {
        const note = await focusApi.updateQuickNote(existingId, { content: normalized });
        applySavedNote(note, normalized);
      } else {
        const result = await focusApi.createQuickNote({
          focusSessionId: sessionId,
          content: normalized,
          idempotencyKey: createIdempotencyKeyRef.current!,
        });
        createIdempotencyKeyRef.current = createFocusIdempotencyKey();
        applySavedNote(result.note, normalized);
      }
      return true;
    }).catch(() => {
      if (mountedRef.current) {
        setSaveError(true);
        setSaveState("pending");
      }
      return false;
    });

    saveQueueRef.current = queued;
    return queued;
  }, [applySavedNote, online, sessionId]);

  saveCurrentRef.current = async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    return persist(contentRef.current);
  };

  useImperativeHandle(ref, () => ({
    flush: () => saveCurrentRef.current(),
  }), []);

  useEffect(() => {
    mountedRef.current = true;
    let current = true;
    setIsLoading(true);
    setLoadError(false);
    void focusApi.listQuickNotes({
      sessionId,
      status: "ACTIVE",
      limit: 50,
    }).then((loadedNotes) => {
      if (!current) return;
      const ordered = [...loadedNotes].sort((a, b) =>
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      setNotes(ordered);
      const draft = unsavedQuickNoteDrafts.get(sessionId);
      if (draft) {
        const matchedNote = draft.noteId
          ? ordered.find((note) => note.id === draft.noteId)
          : undefined;
        const baseline = matchedNote?.content ?? "";
        createIdempotencyKeyRef.current = draft.createIdempotencyKey;
        selectedIdRef.current = draft.noteId;
        savedContentRef.current = baseline;
        contentRef.current = draft.content;
        setSelectedNoteId(draft.noteId);
        setSavedContent(baseline);
        setContent(draft.content);
        setSaveState(draft.content === baseline ? "saved" : "pending");
        if (draft.content === baseline) unsavedQuickNoteDrafts.delete(sessionId);
        return;
      }
      const latest = ordered[0];
      if (latest && !contentRef.current) {
        selectedIdRef.current = latest.id;
        savedContentRef.current = latest.content;
        setSelectedNoteId(latest.id);
        setSavedContent(latest.content);
        contentRef.current = latest.content;
        setContent(latest.content);
      }
    }).catch(() => {
      if (current) setLoadError(true);
    }).finally(() => {
      if (current) setIsLoading(false);
    });

    return () => {
      current = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (content === savedContent || !content.trim() || content.length > 2_000) return;
    if (!online) {
      setSaveState("pending");
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void persist(content);
    }, 750);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [content, online, persist, savedContent]);

  useEffect(() => {
    if (online && contentRef.current !== savedContentRef.current) {
      void saveCurrentRef.current();
    }
  }, [online]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (contentRef.current !== savedContentRef.current) {
      void persist(contentRef.current);
    }
  }, [persist]);

  const selectNote = async (note: FocusQuickNoteDto) => {
    if (!await saveCurrentRef.current()) return;
    selectedIdRef.current = note.id;
    savedContentRef.current = note.content;
    contentRef.current = note.content;
    setSelectedNoteId(note.id);
    setSavedContent(note.content);
    setContent(note.content);
    setSaveState("saved");
    setSaveError(false);
  };

  const startNewNote = async () => {
    if (!await saveCurrentRef.current()) return;
    selectedIdRef.current = null;
    savedContentRef.current = "";
    contentRef.current = "";
    setSelectedNoteId(null);
    setSavedContent("");
    setContent("");
    setSaveState("saved");
    setSaveError(false);
  };

  const statusLabel = saveError
    ? t("focusActiveNotesError")
    : saveState === "saving"
      ? t("focusActiveNotesSaving")
      : saveState === "pending"
        ? t("focusActiveNotesPending")
        : t("focusActiveNotesSaved");

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t("focusActiveNotesTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("focusActiveNotesSubtitle")}</p>
        </div>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void startNewNote()}
          className="min-h-11 shrink-0 rounded-xl border border-border px-3 text-sm font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("focusActiveNotesNew")}
        >
          {t("focusActiveNotesNew")}
        </button>
      </div>

      {notes.length > 1 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label={t("focusActiveNotesTitle")}>
          {notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => void selectNote(note)}
              className={`min-h-11 max-w-48 shrink-0 truncate rounded-xl px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selectedNoteId === note.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-foreground hover:bg-muted"
              }`}
            >
              {note.content.trim().split(/\s+/).slice(0, 5).join(" ") || t("focusActiveNotesNew")}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" aria-hidden="true" />
      ) : loadError ? (
        <div className="mt-4 rounded-xl bg-muted p-3 text-sm text-muted-foreground" role="status">
          {t("focusActiveNotesLoadError")}
        </div>
      ) : notes.length === 0 && !content ? (
        <p className="mt-4 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
          {t("focusActiveNotesEmpty")}
        </p>
      ) : null}

      <label className="mt-4 block">
        <span className="sr-only">{t("focusActiveNotesTitle")}</span>
        <textarea
          value={content}
          disabled={isLoading}
          onChange={(event) => updateContent(event.target.value)}
          maxLength={2_000}
          rows={4}
          dir="auto"
          placeholder={t("focusActiveNotesPlaceholder")}
          className="min-h-28 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
        />
      </label>

      <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span role="status" aria-live="polite">{statusLabel}</span>
        <span dir="ltr">{content.length}/2000</span>
      </div>
    </section>
  );
});