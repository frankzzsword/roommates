import {
  PropsWithChildren,
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";

import {
  buildLocalPenalty,
  createRoommate as createRoommateRecord,
  createPenalty,
  fetchHouseholdSnapshot,
  getPreviewSnapshot,
  saveChore,
  saveHouseSettings,
  savePenaltyRule,
  saveReminderPreferences,
  saveRoommate,
  saveTaskTemplate,
  sendTestReminder
} from "@/src/lib/api";
import {
  getActiveRoommate,
  getHouseSummary
} from "@/src/data/mock";
import type {
  HouseholdSnapshot,
  HouseholdState,
  RoommateDraft,
  ReminderPreferences,
  UiChore,
  UiPenaltyRule,
  UiRoommate,
  UiTaskTemplate
} from "@/src/lib/types";

interface HouseholdContextValue extends HouseholdState {
  activeRoommate: UiRoommate;
  summary: ReturnType<typeof getHouseSummary>;
  setActiveRoommate: (roommateId: string) => void;
  reload: (options?: { showNotice?: boolean }) => Promise<void>;
  clearSyncNotice: () => void;
  createRoommate: (draft: RoommateDraft) => Promise<void>;
  updateRoommate: (roommateId: string, patch: Partial<UiRoommate>) => Promise<void>;
  updateReminderSettings: (
    roommateId: string,
    patch: Partial<ReminderPreferences>
  ) => Promise<void>;
  updateHouseSettings: (patch: Partial<HouseholdSnapshot["settings"]>) => Promise<void>;
  updatePenaltyRule: (patch: Partial<UiPenaltyRule>) => Promise<void>;
  saveChoreDraft: (draft: UiChore) => Promise<void>;
  saveTaskTemplateDraft: (draft: UiTaskTemplate) => Promise<void>;
  addPenalty: (roommateId: string, reason: string) => Promise<void>;
  triggerTestReminder: (roommateId: string) => Promise<void>;
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

function sortRoommates(roommates: UiRoommate[]) {
  return [...roommates].sort((left, right) => {
    if (left.sortOrder === right.sortOrder) {
      return left.name.localeCompare(right.name);
    }

    return left.sortOrder - right.sortOrder;
  });
}

function replaceRoommate(
  snapshot: HouseholdSnapshot,
  roommateId: string,
  updater: (roommate: UiRoommate) => UiRoommate
) {
  return {
    ...snapshot,
    roommates: sortRoommates(
      snapshot.roommates.map((roommate) =>
        roommate.id === roommateId ? updater(roommate) : roommate
      )
    )
  };
}

function replaceChore(
  snapshot: HouseholdSnapshot,
  draft: UiChore
) {
  const exists = snapshot.chores.some((chore) => chore.id === draft.id);
  return {
    ...snapshot,
    chores: exists
      ? snapshot.chores.map((chore) => (chore.id === draft.id ? draft : chore))
      : [draft, ...snapshot.chores]
  };
}

function addRoommate(snapshot: HouseholdSnapshot, roommate: UiRoommate) {
  return {
    ...snapshot,
    roommates: sortRoommates([...snapshot.roommates, roommate])
  };
}

function replaceTaskTemplate(
  snapshot: HouseholdSnapshot,
  draft: UiTaskTemplate
) {
  const exists = snapshot.taskTemplates.some((template) => template.id === draft.id);
  return {
    ...snapshot,
    taskTemplates: exists
      ? snapshot.taskTemplates.map((template) => (template.id === draft.id ? draft : template))
      : [draft, ...snapshot.taskTemplates]
  };
}

function mergeTaskTemplates(
  serverTemplates: UiTaskTemplate[],
  localTemplates: UiTaskTemplate[]
) {
  const templates = new Map<string, UiTaskTemplate>();

  for (const template of serverTemplates) {
    templates.set(template.id, template);
  }

  for (const template of localTemplates) {
    templates.set(template.id, template);
  }

  return Array.from(templates.values());
}

export function HouseholdProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<HouseholdState>({
    snapshot: getPreviewSnapshot(),
    loading: true,
    mode: "preview",
    error: null,
    syncNotice: null
  });
  const [localTaskTemplates, setLocalTaskTemplates] = useState<UiTaskTemplate[]>([]);

  async function reload(options?: { showNotice?: boolean }) {
    const showNotice = options?.showNotice ?? false;

    startTransition(() => {
      setState((current) => ({ ...current, loading: true, error: null }));
    });

    try {
      const result = await fetchHouseholdSnapshot();
      setState((current) => ({
        ...current,
        snapshot: {
          ...result.snapshot,
          taskTemplates: mergeTaskTemplates(result.snapshot.taskTemplates, localTaskTemplates)
        },
        loading: false,
        mode: result.mode,
        error: null,
        syncNotice: showNotice ? "Synced with the house feed just now." : current.syncNotice
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        mode: "preview",
        error:
          error instanceof Error
            ? `${error.message}. Showing local preview data instead.`
            : "Unable to reach the backend. Showing local preview data instead.",
        syncNotice: showNotice
          ? getErrorNotice(error, "Unable to refresh right now.")
          : current.syncNotice
      }));
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state.syncNotice) {
      return;
    }

    const timer = setTimeout(() => {
      setState((current) =>
        current.syncNotice === state.syncNotice ? { ...current, syncNotice: null } : current
      );
    }, 3600);

    return () => clearTimeout(timer);
  }, [state.syncNotice]);

  function getErrorNotice(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
  }

  async function createRoommate(draft: RoommateDraft) {
    const nextSortOrder =
      state.snapshot.roommates.reduce(
        (highest, roommate) => Math.max(highest, roommate.sortOrder),
        0
      ) + 1;
    const optimisticRoommate: UiRoommate = {
      id: `local-roommate-${Date.now()}`,
      name: draft.name,
      whatsappNumber: draft.whatsappNumber,
      role: draft.note || "New roommate",
      note: draft.note || "New roommate added from admin",
      isActive: draft.isActive,
      sortOrder: nextSortOrder,
      reliability: 80,
      pendingCount: 0,
      completedCount: 0,
      missedCount: 0,
      strikeCount: 0,
      rescueCount: 0,
      reminderPreferences: draft.reminderPreferences
    };

    setState((current) => ({
      ...current,
      snapshot: addRoommate(current.snapshot, optimisticRoommate)
    }));

    try {
      const result = await createRoommateRecord(draft);
      if (result.synced) {
        await reload();
      }

      setState((current) => ({
        ...current,
        syncNotice: result.notice ?? "Roommate added."
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to create the roommate right now.")
      }));
    }
  }

  async function updateRoommate(roommateId: string, patch: Partial<UiRoommate>) {
    setState((current) => ({
      ...current,
      snapshot: replaceRoommate(current.snapshot, roommateId, (roommate) => ({
        ...roommate,
        ...patch
      }))
    }));

    try {
      const result = await saveRoommate(roommateId, patch);
      setState((current) => ({ ...current, syncNotice: result.notice ?? null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to save roommate right now.")
      }));
    }
  }

  async function updateReminderSettings(
    roommateId: string,
    patch: Partial<ReminderPreferences>
  ) {
    const roommate = state.snapshot.roommates.find((entry) => entry.id === roommateId);
    if (!roommate) {
      return;
    }

    const merged = {
      ...roommate.reminderPreferences,
      ...patch
    };

    setState((current) => ({
      ...current,
      snapshot: replaceRoommate(current.snapshot, roommateId, (entry) => ({
        ...entry,
        reminderPreferences: merged
      }))
    }));

    try {
      const result = await saveReminderPreferences(roommateId, merged);
      setState((current) => ({ ...current, syncNotice: result.notice ?? null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to update reminder settings right now.")
      }));
    }
  }

  async function updateHouseSettings(patch: Partial<HouseholdSnapshot["settings"]>) {
    const nextSettings = {
      ...state.snapshot.settings,
      ...patch
    };

    setState((current) => ({
      ...current,
      snapshot: {
        ...current.snapshot,
        settings: nextSettings
      }
    }));

    try {
      const result = await saveHouseSettings(nextSettings);
      setState((current) => ({ ...current, syncNotice: result.notice ?? null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to update house settings right now.")
      }));
    }
  }

  async function updatePenaltyRule(patch: Partial<UiPenaltyRule>) {
    const nextRule = {
      ...state.snapshot.penaltyRule,
      ...patch
    };

    setState((current) => ({
      ...current,
      snapshot: {
        ...current.snapshot,
        penaltyRule: nextRule
      }
    }));

    try {
      const result = await savePenaltyRule(nextRule);
      setState((current) => ({ ...current, syncNotice: result.notice ?? null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to update the penalty rule right now.")
      }));
    }
  }

  async function saveChoreDraft(draft: UiChore) {
    const nextDraft = draft.id
      ? draft
      : {
          ...draft,
          id: `local-${Date.now()}`
        };

    setState((current) => ({
      ...current,
      snapshot: replaceChore(current.snapshot, nextDraft)
    }));

    try {
      const result = await saveChore(nextDraft);
      setState((current) => ({ ...current, syncNotice: result.notice ?? null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to save the chore right now.")
      }));
    }
  }

  async function saveTaskTemplateDraft(draft: UiTaskTemplate) {
    const normalized = {
      ...draft,
      id: draft.id || `local-template-${Date.now()}`
    };

    setLocalTaskTemplates((current) => {
      const next = mergeTaskTemplates(current, [normalized]);
      return next;
    });

    setState((current) => ({
      ...current,
      snapshot: replaceTaskTemplate(current.snapshot, normalized)
    }));

    try {
      const result = await saveTaskTemplate(normalized);
      if (!result.synced) {
        setState((current) => ({ ...current, syncNotice: result.notice ?? null }));
        return;
      }

      const remainingLocalTemplates = localTaskTemplates.filter(
        (template) => template.id !== normalized.id
      );
      setLocalTaskTemplates(remainingLocalTemplates);

      const refreshed = await fetchHouseholdSnapshot();
      setState((current) => ({
        ...current,
        snapshot: {
          ...refreshed.snapshot,
          taskTemplates: mergeTaskTemplates(
            refreshed.snapshot.taskTemplates,
            remainingLocalTemplates
          )
        },
        mode: refreshed.mode,
        loading: false,
        syncNotice: result.notice ?? null
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to save the template right now.")
      }));
    }
  }

  async function addPenalty(roommateId: string, reason: string) {
    const roommate = state.snapshot.roommates.find((entry) => entry.id === roommateId);
    if (!roommate) {
      return;
    }

    const penalty = buildLocalPenalty(
      roommate,
      state.snapshot.penaltyRule.amount,
      state.snapshot.penaltyRule.currency,
      reason
    );

    setState((current) => ({
      ...current,
      snapshot: {
        ...current.snapshot,
        penalties: [penalty, ...current.snapshot.penalties]
      }
    }));

    try {
      const result = await createPenalty({
        roommateId: roommate.id,
        roommateName: roommate.name,
        reason,
        amount: state.snapshot.penaltyRule.amount
      });

      setState((current) => ({ ...current, syncNotice: result.notice ?? null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(error, "Unable to create the penalty right now.")
      }));
    }
  }

  async function triggerTestReminder(roommateId: string) {
    const roommate = state.snapshot.roommates.find((entry) => entry.id === roommateId);
    if (!roommate) {
      return;
    }

    try {
      const result = await sendTestReminder(roommate);
      setState((current) => ({
        ...current,
        syncNotice: result.notice ?? null,
        snapshot: {
          ...current.snapshot,
          activity: [
            {
              id: `activity-${Date.now()}`,
              type: "reminder",
              title: `Reminder ping queued for ${roommate.name}`,
              actor: result.synced ? "Twilio" : "Preview mode",
              timestamp: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })
            },
            ...current.snapshot.activity
          ]
        }
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        syncNotice: getErrorNotice(
          error,
          "Reminder send failed. Make sure the number has joined the Twilio WhatsApp sandbox."
        )
      }));
    }
  }

  const activeRoommate = getActiveRoommate(state.snapshot);
  const summary = getHouseSummary(state.snapshot);

  const value = useMemo<HouseholdContextValue>(
    () => ({
      ...state,
      activeRoommate,
      summary,
      setActiveRoommate: (roommateId: string) =>
        setState((current) => ({
          ...current,
          snapshot: {
            ...current.snapshot,
            activeRoommateId: roommateId
          }
        })),
      reload,
      clearSyncNotice: () =>
        setState((current) => ({
          ...current,
          syncNotice: null
        })),
      createRoommate,
      updateRoommate,
      updateReminderSettings,
      updateHouseSettings,
      updatePenaltyRule,
      saveChoreDraft,
      saveTaskTemplateDraft,
      addPenalty,
      triggerTestReminder
    }),
    [activeRoommate, state, summary]
  );

  return (
    <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
  );
}

export function useHousehold() {
  const context = useContext(HouseholdContext);
  if (!context) {
    throw new Error("useHousehold must be used inside HouseholdProvider");
  }

  return context;
}
