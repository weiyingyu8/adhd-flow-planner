import type { DailySummary, PlannerState, View } from "./types";

const STORAGE_KEY = "adhd-flow-planner-state-v1";
const VIEW_STORAGE_KEY = "adhd-flow-planner-view-v1";
const DAILY_SUMMARIES_KEY = "adhd-flow-daily-summaries";
const SIDE_PANEL_STATE_KEY = "adhd-flow-side-panel-state-v1";
const validViews: View[] = ["todo", "priority", "flow", "done", "calendar", "feedback"];

export type SidePanelKey = "done" | "parking" | "life";
export type SidePanelState = Record<SidePanelKey, boolean>;

export const defaultSidePanelState: SidePanelState = {
  done: true,
  parking: true,
  life: true,
};

export const defaultState: PlannerState = {
  tasks: [],
  parking: [],
  adaptations: [],
};

export function loadPlannerState(): PlannerState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as PlannerState;

    return {
      tasks: Array.isArray(parsed.tasks)
        ? parsed.tasks.map((task) => ({
            ...task,
            evidenceImages: Array.isArray(task.evidenceImages) ? task.evidenceImages : [],
          }))
        : [],
      parking: Array.isArray(parsed.parking) ? parsed.parking : [],
      adaptations: Array.isArray(parsed.adaptations) ? parsed.adaptations : [],
    };
  } catch {
    return defaultState;
  }
}

export function savePlannerState(state: PlannerState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadPlannerView(): View {
  const savedView = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return validViews.includes(savedView as View) ? (savedView as View) : "todo";
}

export function savePlannerView(view: View) {
  window.localStorage.setItem(VIEW_STORAGE_KEY, view);
}

export function loadDailySummaries(): DailySummary[] {
  try {
    const raw = window.localStorage.getItem(DAILY_SUMMARIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DailySummary[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            typeof item.date === "string" &&
            typeof item.summary === "string" &&
            typeof item.updatedAt === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export function saveDailySummaries(summaries: DailySummary[]) {
  window.localStorage.setItem(DAILY_SUMMARIES_KEY, JSON.stringify(summaries));
}

export function loadSidePanelState(): SidePanelState {
  try {
    const raw = window.localStorage.getItem(SIDE_PANEL_STATE_KEY);
    if (!raw) return defaultSidePanelState;
    const parsed = JSON.parse(raw) as Partial<SidePanelState>;
    return {
      done: typeof parsed.done === "boolean" ? parsed.done : defaultSidePanelState.done,
      parking: typeof parsed.parking === "boolean" ? parsed.parking : defaultSidePanelState.parking,
      life: typeof parsed.life === "boolean" ? parsed.life : defaultSidePanelState.life,
    };
  } catch {
    return defaultSidePanelState;
  }
}

export function saveSidePanelState(state: SidePanelState) {
  window.localStorage.setItem(SIDE_PANEL_STATE_KEY, JSON.stringify(state));
}
