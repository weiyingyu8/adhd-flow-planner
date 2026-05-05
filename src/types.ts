export type Priority = "P0" | "P1" | "P2";

export type View = "todo" | "priority" | "flow" | "done" | "calendar" | "feedback";

export type Stage = "capture" | "prepare" | "focus" | "wrap" | "done";

export interface EvidenceImage {
  id: string;
  taskId: string;
  name: string;
  dataUrl: string;
  stage: number;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  priority: Priority;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  reason: string;
  evidenceImages?: EvidenceImage[];
}

export interface ParkingItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface AdaptationItem {
  id: string;
  text: string;
  status: "观察中" | "尝试中" | "已适配";
  createdAt: string;
  updatedAt?: string;
}

export interface DailySummary {
  date: string;
  summary: string;
  updatedAt: string;
}

export interface PlannerState {
  tasks: Task[];
  parking: ParkingItem[];
  adaptations: AdaptationItem[];
}
