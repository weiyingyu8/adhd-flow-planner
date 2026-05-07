import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { FEISHU_FEEDBACK_URL } from "./config";
import { createTask, nextStage, previousStage, stageIndex, stages } from "./rules";
import {
  loadDailySummaries,
  loadPlannerState,
  loadPlannerView,
  loadSidePanelState,
  saveDailySummaries,
  savePlannerState,
  savePlannerView,
  saveSidePanelState,
  type SidePanelKey,
} from "./storage";
import type {
  AdaptationItem,
  DailySummary,
  EvidenceImage,
  ParkingItem,
  PlannerState,
  Priority,
  Stage,
  Task,
  View,
} from "./types";

const priorityMeta: Record<Priority, { label: string; description: string }> = {
  P0: {
    label: "P0 今天必须被看见",
    description: "有截止、外部等待、提交或回复压力。",
  },
  P1: {
    label: "P1 今天推进一点",
    description: "重要但不需要用紧急感压自己。",
  },
  P2: {
    label: "P2 先停好",
    description: "灵感、研究、以后再处理的任务。",
  },
};

const priorityLevels: Priority[] = ["P0", "P1", "P2"];

type GuideId = "global" | View;
type GuidePlacement = "left" | "right" | "top" | "bottom";
type GuideTargetType = "button" | "input" | "card" | "nav";
type PriorityDropPosition = "before" | "after" | "end";

interface GuideStep {
  eyebrow: string;
  title: string;
  body: string;
  target: string;
  fallbackTarget?: string;
  fallbackTargets?: string[];
  targetType: GuideTargetType;
  view?: View;
  placement?: GuidePlacement;
  connectorEnd?: "edge" | "center";
  gap?: number;
}

const fullOnboardingSeenKey = "onboardingSeen";

const guideConfig: Record<GuideId, { label: string; steps: GuideStep[] }> = {
  global: {
    label: "首次完整引导",
    steps: [
      {
        eyebrow: "Todo",
        title: "先倒出任务",
        body: "把脑子里的任务先放出来，一行一个，不用排序。",
        target: "todoInput",
        targetType: "input",
        view: "todo",
        placement: "top",
      },
      {
        eyebrow: "整理",
        title: "交给系统先分流",
        body: "点击 AI 自动整理后，任务会先进入 P0 / P1 / P2，不用一开始就自己排序。",
        target: "organize",
        targetType: "button",
        view: "todo",
        placement: "top",
      },
      {
        eyebrow: "优先级",
        title: "先看下一批",
        body: "任务会被分成 P0 / P1 / P2，帮你先判断今天该看哪一批。",
        target: "priorityGrid",
        targetType: "card",
        view: "priority",
        placement: "right",
      },
      {
        eyebrow: "流程",
        title: "一次只推进一步",
        body: "选一个任务，从“收进来”开始推进，不需要一下子做完。",
        target: "flowQueue",
        targetType: "card",
        view: "flow",
        placement: "right",
      },
      {
        eyebrow: "Done",
        title: "完成会被留下来",
        body: "今天推进到 Done 的任务会出现在这里，帮你回头看见自己做过什么。",
        target: "doneTodayContentZone",
        targetType: "card",
        view: "done",
        placement: "bottom",
      },
      {
        eyebrow: "辅助区",
        title: "右侧是辅助记录区",
        body: "右侧这几个模块是随手记录用的，不是主任务流程。顶部切换条可以快速定位 Done、停车场和生活适配。",
        target: "sidebarTabs",
        targetType: "nav",
        view: "priority",
        placement: "left",
      },
      {
        eyebrow: "今日 Done",
        title: "右侧是今日完成概览",
        body: "这里只显示今天完成的任务，作为轻量提醒，不需要你反复整理。",
        target: "sidebarTodayDone",
        targetType: "card",
        view: "priority",
        placement: "left",
      },
      {
        eyebrow: "停车场",
        title: "被打断的想法先停一下",
        body: "临时冒出来、不想马上处理的想法，可以先停在停车场，避免打断当前任务。",
        target: "sidebarParking",
        targetType: "card",
        view: "priority",
        placement: "left",
      },
      {
        eyebrow: "生活适配",
        title: "记录不适合自己的地方",
        body: "生活适配改造用来记录环境、习惯或安排上的小摩擦，之后再慢慢修改。",
        target: "sidebarLife",
        targetType: "card",
        view: "priority",
        placement: "left",
      },
      {
        eyebrow: "反馈",
        title: "把体验告诉我",
        body: "如果哪里不好用，可以提交反馈，方便后续优化。",
        target: "feedbackButton",
        targetType: "button",
        view: "feedback",
        placement: "top",
      },
      {
        eyebrow: "帮助",
        title: "忘了怎么用，可以点这里再看一次",
        body: "如果后面忘记了怎么操作，可以随时点击标题旁边的 ? 按钮，重新开启当前页面的引导提示。\n不用担心记不住，随时都可以再看一遍。",
        target: "guideHelpButton",
        targetType: "button",
        view: "feedback",
        placement: "bottom",
      },
    ],
  },
  todo: {
    label: "TODO 引导",
    steps: [
      {
        eyebrow: "输入区",
        title: "先把任务倒出来",
        body: "一行写一个任务，不用排序，也不用写得很完美。",
        target: "todoInput",
        targetType: "input",
        placement: "top",
      },
      {
        eyebrow: "自动整理",
        title: "点击 AI 自动整理",
        body: "系统会先帮你把任务分到 P0 / P1 / P2，减少一开始的排序压力。",
        target: "organize",
        targetType: "button",
        placement: "top",
      },
      {
        eyebrow: "停车场",
        title: "被打断的想法先停一下",
        body: "暂时不做、但又怕忘记的想法，可以先放进停车场，避免打断当前任务。",
        target: "todoParkingButton",
        targetType: "button",
        placement: "top",
      },
    ],
  },
  priority: {
    label: "优先级引导",
    steps: [
      {
        eyebrow: "分流",
        title: "这里看 P0 / P1 / P2",
        body: "分组结果不是评价你，而是帮你快速降低选择压力。",
        target: "priorityGrid",
        targetType: "card",
        placement: "right",
      },
      {
        eyebrow: "手动调整",
        title: "可以拖一拖，也可以点一下",
        body: "如果系统分得不够准，可以直接把任务拖到 P0 / P1 / P2 分栏里；\n也可以点击卡片里的 P0 / P1 / P2，快速修改优先级。\n\nP0 表示今天必须看见，\nP1 表示今天推进一点，\nP2 表示先放一放也没关系。",
        target: "prioritySwitcher",
        targetType: "button",
        placement: "right",
        connectorEnd: "center",
        gap: 28,
      },
    ],
  },
  flow: {
    label: "流程引导",
    steps: [
      {
        eyebrow: "单任务",
        title: "先选一个现在要做的任务",
        body: "左边选择当下要做的任务，右边栏会显示这个任务对应的流程阶段、证据区和操作按钮。\n这样你一次只需要推进这一件事，不用同时处理全部任务。",
        target: "flowQueue",
        targetType: "card",
        placement: "right",
      },
      {
        eyebrow: "阶段",
        title: "一次只推进一步",
        body: "阶段依次是：收进来 / 下一步 / 推进中 / 收尾 / 完成。",
        target: "flowStages",
        targetType: "card",
        placement: "top",
      },
      {
        eyebrow: "证据",
        title: "每个阶段可以添加截图证据",
        body: "上传图片或 Ctrl + V 粘贴截图，让推进痕迹被看见。",
        target: "evidence",
        targetType: "card",
        placement: "left",
      },
      {
        eyebrow: "完成",
        title: "推进到完成后，再收进 Done",
        body: "先点击“推进一步”，把任务一步步推进到第 5 步“完成”。\n到达完成阶段后，再执行收进 Done，任务才会进入完成记录，方便你回看自己做完了什么。",
        target: "flowAction",
        targetType: "button",
        placement: "top",
      },
    ],
  },
  done: {
    label: "Done 引导",
    steps: [
      {
        eyebrow: "记录",
        title: "这里保留已完成任务",
        body: "Done 用来回看完成记录，帮助你看见自己已经行动过。",
        target: "doneMainPanel",
        fallbackTargets: ["done-main-panel", "doneTodayContentZone"],
        targetType: "card",
        placement: "right",
      },
      {
        eyebrow: "证据",
        title: "完成后会显示在这里",
        body: "今天推进到 Done 的任务会出现在这里。\n如果任务带有截图证据，也会一起作为缩略图保留下来，方便你回头确认自己真的做过。",
        target: "doneTodayFirstItem",
        fallbackTargets: ["doneTodayDemoItem", "doneTodayContentZone", "doneList"],
        targetType: "card",
        placement: "bottom",
        gap: 24,
      },
    ],
  },
  calendar: {
    label: "日历引导",
    steps: [
      {
        eyebrow: "回顾",
        title: "这里可以查看完成分布",
        body: "日历是用来复盘节奏的，不是增加打卡压力的工具。",
        target: "calendar",
        targetType: "card",
        placement: "right",
      },
      {
        eyebrow: "总结",
        title: "每天可以留一句总结",
        body: "有 Done 记录或没有 Done 记录的日子，都可以写一句轻量复盘。",
        target: "calendarDetail",
        targetType: "card",
        placement: "left",
      },
    ],
  },
  feedback: {
    label: "反馈引导",
    steps: [
      {
        eyebrow: "内测",
        title: "这里用于提交使用反馈",
        body: "你可以填写年龄、风格偏好、帮助评分、建议等内容。",
        target: "feedback",
        targetType: "card",
        placement: "right",
      },
      {
        eyebrow: "表单",
        title: "反馈会跳转到飞书表单",
        body: "点击后会跳转到飞书反馈建议表。这个网页本身不接入数据库，你自己的数据内容只会保留在本地,只有你自己能看到；你提交的建议只会进入飞书表单，用于帮助后续优化。",
        target: "feedbackButton",
        targetType: "button",
        placement: "top",
      },
    ],
  },
};

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatTime(value?: string | number | Date) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromValue(value?: string) {
  return value ? toDateKey(new Date(value)) : "";
}

function isToday(value?: string | number | Date) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();

  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function getMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(date);
}

function getCalendarDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const startDate = new Date(year, month, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      date,
      dateKey: toDateKey(date),
      inMonth: date.getMonth() === month,
    };
  });
}

const parkingStopWords = new Set([
  "的",
  "了",
  "我",
  "要",
  "想",
  "先",
  "再",
  "一个",
  "一下",
  "可以",
  "怎么",
  "什么",
  "这个",
  "那个",
  "然后",
  "就是",
  "需要",
  "感觉",
]);

const parkingKeywordDictionary = [
  "论文",
  "展板",
  "视频",
  "封面",
  "回消息",
  "洗头",
  "作品集",
  "排版",
  "导出",
  "修改",
  "整理",
  "复盘",
  "灵感",
  "研究",
  "任务",
  "计划",
  "打印",
  "焦虑",
  "启动",
  "推进",
  "休息",
  "毕设",
  "设计",
  "素材",
  "朋友",
  "老师",
  "客户",
  "日历",
  "总结",
];

const wordCloudColors = ["#006cff", "#00a889", "#ff4b00", "#ef2d5e", "#7a3cff", "#d9a400", "#151515"];

function extractParkingKeywords(items: ParkingItem[]) {
  const counts = new Map<string, number>();
  const addKeyword = (word: string) => {
    const clean = word.trim().toLowerCase();
    if (!clean || parkingStopWords.has(clean)) return;
    if (/^[a-z0-9]+$/.test(clean) && clean.length < 3) return;
    if (/^[\u4e00-\u9fa5]+$/.test(clean) && clean.length < 2) return;
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
  };

  items.forEach((item) => {
    const text = item.text.toLowerCase();
    parkingKeywordDictionary.forEach((keyword) => {
      const matches = text.match(new RegExp(keyword, "g"));
      if (matches) {
        matches.forEach(() => addKeyword(keyword));
      }
    });

    const segments = item.text.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]{2,}/g) ?? [];
    segments.forEach((segment) => {
      const normalized = segment.toLowerCase();
      if (/^[\u4e00-\u9fa5]+$/.test(normalized)) {
        if (normalized.length <= 4) addKeyword(normalized);
        for (let length = 2; length <= Math.min(4, normalized.length); length += 1) {
          for (let index = 0; index <= normalized.length - length; index += 1) {
            addKeyword(normalized.slice(index, index + length));
          }
        }
        return;
      }
      addKeyword(normalized);
    });
  });

  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "zh-CN"))
    .slice(0, 24);
}

function getWordCloudStyle(count: number, maxCount: number, index: number): CSSProperties {
  const ratio = maxCount <= 1 ? 0.35 : (count - 1) / (maxCount - 1);
  const size = Math.round(16 + ratio * 38);
  return {
    color: wordCloudColors[index % wordCloudColors.length],
    fontSize: `${size}px`,
    order: (index * 7) % 19,
  };
}

function escapeCsvCell(value: string | number | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportLifeAdaptationsCsv(items: AdaptationItem[]) {
  if (items.length === 0) {
    window.alert("暂无可导出的内容");
    return;
  }

  const headers = ["序号", "内容", "状态", "创建时间", "更新时间"];
  const rows = items.map((item, index) => [
    index + 1,
    item.text,
    item.status,
    item.createdAt,
    item.updatedAt ?? item.createdAt,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "life-adaptation-board.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isSupportedEvidenceFile(file: File) {
  const supportedTypes = ["image/png", "image/jpeg", "image/webp"];
  return supportedTypes.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function isEvidencePasteZoneElement(element: Element | null) {
  return element instanceof HTMLElement && Boolean(element.closest('[data-evidence-paste-zone="true"]'));
}

function getEvidenceFilesFromClipboardData(clipboardData: DataTransfer | null | undefined) {
  const items = Array.from(clipboardData?.items ?? []);
  const itemFiles = items
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const dataFiles = Array.from(clipboardData?.files ?? []).filter(
    (file) => file.type.startsWith("image/") || isSupportedEvidenceFile(file),
  );

  return [...itemFiles, ...dataFiles].filter(isSupportedEvidenceFile).filter((file, index, files) => {
    const key = `${file.name}-${file.type}-${file.size}`;
    return files.findIndex((item) => `${item.name}-${item.type}-${item.size}` === key) === index;
  });
}

function imageFileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImageFromUrl(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load failed"));
    image.src = url;
  });
}

async function compressEvidenceImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageFromUrl(objectUrl);
    const scale = Math.min(1, 1200 / image.width, 1200 / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return imageFileToDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getTaskDoneAt(task: Task) {
  return task.completedAt ?? task.doneAt ?? task.createdAt;
}

function isDoneTask(task: Task) {
  return Boolean(task.completedAt ?? task.doneAt);
}

function activeTasks(tasks: Task[]) {
  return tasks.filter((task) => !isDoneTask(task));
}

function comparePriorityOrder(a: Task, b: Task) {
  return (a.order ?? 0) - (b.order ?? 0) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function getPriorityLaneTasks(tasks: Task[], priority: Priority) {
  return activeTasks(tasks)
    .filter((task) => task.priority === priority)
    .sort(comparePriorityOrder);
}

function doneTasks(tasks: Task[]) {
  return tasks.filter(isDoneTask);
}

function getTodayDoneTasks(tasks: Task[]) {
  return doneTasks(tasks)
    .filter((task) => isToday(getTaskDoneAt(task)))
    .sort((a, b) => new Date(getTaskDoneAt(b)).getTime() - new Date(getTaskDoneAt(a)).getTime());
}

export default function App() {
  const [state, setState] = useState<PlannerState>(() => loadPlannerState());
  const [view, setView] = useState<View>(() => loadPlannerView());
  const [dumpText, setDumpText] = useState("");
  const [parkingText, setParkingText] = useState("");
  const [adaptationText, setAdaptationText] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>(() => loadDailySummaries());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [summaryDraft, setSummaryDraft] = useState("");
  const [sidePanels, setSidePanels] = useState(() => loadSidePanelState());
  const [activeGuideId, setActiveGuideId] = useState<GuideId | null>(
    () =>
      window.localStorage.getItem(fullOnboardingSeenKey) === "true" ||
      window.localStorage.getItem("guide_seen_global") === "true"
        ? null
        : "global",
  );
  const [activeGuideStepIndex, setActiveGuideStepIndex] = useState(0);
  const donePanelRef = useRef<HTMLElement | null>(null);
  const parkingPanelRef = useRef<HTMLElement | null>(null);
  const lifePanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    savePlannerState(state);
  }, [state]);

  useEffect(() => {
    savePlannerView(view);
  }, [view]);

  useEffect(() => {
    saveDailySummaries(dailySummaries);
  }, [dailySummaries]);

  useEffect(() => {
    saveSidePanelState(sidePanels);
  }, [sidePanels]);

  useEffect(() => {
    setSummaryDraft(dailySummaries.find((item) => item.date === selectedDate)?.summary ?? "");
  }, [dailySummaries, selectedDate]);

  const todayDoneTasks = useMemo(() => getTodayDoneTasks(state.tasks), [state.tasks]);
  const todaysDoneCount = todayDoneTasks.length;

  const sortedActiveTasks = useMemo(() => {
    return activeTasks(state.tasks).sort((a, b) => {
      const byPriority = priorityLevels.indexOf(a.priority) - priorityLevels.indexOf(b.priority);
      if (byPriority !== 0) return byPriority;
      return comparePriorityOrder(a, b);
    });
  }, [state.tasks]);

  const selectedTask = useMemo(() => {
    const fallback = sortedActiveTasks[0];
    return state.tasks.find((task) => task.id === selectedTaskId && !isDoneTask(task)) ?? fallback ?? null;
  }, [selectedTaskId, sortedActiveTasks, state.tasks]);

  function updateTask(taskId: string, updater: (task: Task) => Task) {
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.id === taskId ? updater(task) : task)),
    }));
  }

  function organizeTasks() {
    const titles = dumpText
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    if (titles.length === 0) return;

    const tasks = titles.map((title, index) => ({
      ...createTask(title),
      order: index - titles.length,
    }));
    setState((current) => ({
      ...current,
      tasks: rebalancePriorityOrders([...tasks, ...current.tasks]),
    }));
    setDumpText("");
    setSelectedTaskId(tasks[0]?.id ?? null);
    setView("priority");
  }

  function promoteTask(taskId: string, priority: Priority) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || task.priority === priority) return;
    placePriorityTask(taskId, priority, undefined, "end", true);
  }

  function rebalancePriorityOrders(tasks: Task[]) {
    const orderById = new Map<string, number>();
    priorityLevels.forEach((priority) => {
      getPriorityLaneTasks(tasks, priority).forEach((task, index) => {
        orderById.set(task.id, index);
      });
    });

    return tasks.map((task) => (orderById.has(task.id) ? { ...task, order: orderById.get(task.id) } : task));
  }

  function placePriorityTask(
    taskId: string,
    targetPriority: Priority,
    overTaskId?: string,
    position: PriorityDropPosition = "end",
    updateReason = false,
  ) {
    setState((current) => {
      const movingTask = current.tasks.find((task) => task.id === taskId);
      if (!movingTask || isDoneTask(movingTask)) return current;

      const now = new Date().toISOString();
      const lanes = priorityLevels.reduce(
        (acc, priority) => ({
          ...acc,
          [priority]: getPriorityLaneTasks(current.tasks, priority).filter((task) => task.id !== taskId),
        }),
        {} as Record<Priority, Task[]>,
      );

      const targetLane = lanes[targetPriority];
      const overIndex = overTaskId ? targetLane.findIndex((task) => task.id === overTaskId) : -1;
      const insertIndex =
        overIndex >= 0 ? overIndex + (position === "after" ? 1 : 0) : targetLane.length;
      const nextMovingTask: Task = {
        ...movingTask,
        priority: targetPriority,
        updatedAt: now,
        reason:
          updateReason || movingTask.priority !== targetPriority
            ? "你手动调整了优先级，系统会尊重你的判断。"
            : movingTask.reason,
      };

      lanes[targetPriority] = [
        ...targetLane.slice(0, insertIndex),
        nextMovingTask,
        ...targetLane.slice(insertIndex),
      ];

      const priorityById = new Map<string, Priority>();
      const orderById = new Map<string, number>();
      priorityLevels.forEach((priority) => {
        lanes[priority].forEach((task, index) => {
          priorityById.set(task.id, priority);
          orderById.set(task.id, index);
        });
      });

      return {
        ...current,
        tasks: current.tasks.map((task) => {
          if (!priorityById.has(task.id)) return task;
          const nextPriority = priorityById.get(task.id) ?? task.priority;
          return {
            ...task,
            priority: nextPriority,
            order: orderById.get(task.id) ?? task.order,
            updatedAt: task.id === taskId ? now : task.updatedAt,
            reason: task.id === taskId ? nextMovingTask.reason : task.reason,
          };
        }),
      };
    });
  }

  function reorderPriorityTask(taskId: string, priority: Priority, overTaskId?: string, position: PriorityDropPosition = "end") {
    placePriorityTask(taskId, priority, overTaskId, position);
  }

  function pushTask(taskId: string) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    const currentStageIndex = stageIndex(task.stage);
    const lastStageIndex = stages.length - 1;
    const now = new Date().toISOString();

    if (currentStageIndex < lastStageIndex) {
      updateTask(taskId, (currentTask) => ({
        ...currentTask,
        stage: nextStage(currentTask.stage),
        completedAt: undefined,
        updatedAt: now,
      }));
      setSelectedTaskId(taskId);
      return;
    }

    updateTask(taskId, (currentTask) => ({
      ...currentTask,
      stage: currentTask.stage,
      completedAt: now,
      updatedAt: now,
    }));
    setSelectedTaskId(null);
  }

  function pullTask(taskId: string) {
    updateTask(taskId, (task) => {
      if (isDoneTask(task)) return task;
      return {
        ...task,
        stage: previousStage(task.stage),
        completedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
    });
    setSelectedTaskId(taskId);
  }

  async function addEvidenceImages(taskId: string, fileList: FileList | File[], stage: number) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return false;

    const currentImages = task.evidenceImages ?? [];
    const stageImages = currentImages.filter((image) => image.stage === stage);
    if (stageImages.length >= 3) {
      window.alert("当前阶段最多添加 3 张证据");
      return false;
    }

    const files = Array.from(fileList);
    const invalidFile = files.find((file) => !isSupportedEvidenceFile(file));
    if (invalidFile) {
      window.alert("请上传图片文件");
      return false;
    }

    const slots = 3 - stageImages.length;
    if (files.length > slots) {
      window.alert("当前阶段最多添加 3 张证据");
    }

    try {
      const createdAt = new Date().toISOString();
      const images: EvidenceImage[] = [];
      for (const file of files.slice(0, slots)) {
        images.push({
          id: crypto.randomUUID(),
          taskId,
          name: file.name || `evidence-${createdAt}.jpg`,
          dataUrl: await compressEvidenceImage(file),
          stage,
          createdAt,
        });
      }

      if (images.length === 0) return false;
      updateTask(taskId, (currentTask) => ({
        ...currentTask,
        evidenceImages: [...(currentTask.evidenceImages ?? []), ...images],
        updatedAt: new Date().toISOString(),
      }));
      return true;
    } catch {
      window.alert("图片压缩失败，请换一张图片再试");
      return false;
    }
  }

  function deleteEvidenceImage(taskId: string, imageId: string) {
    updateTask(taskId, (task) => ({
      ...task,
      evidenceImages: (task.evidenceImages ?? []).filter((image) => image.id !== imageId),
      updatedAt: new Date().toISOString(),
    }));
  }

  function sendToParking(text: string) {
    const clean = text.trim();
    if (!clean) return false;
    const item: ParkingItem = {
      id: crypto.randomUUID(),
      text: clean,
      createdAt: new Date().toISOString(),
    };
    setState((current) => ({ ...current, parking: [item, ...current.parking] }));
    return true;
  }

  function addParking() {
    const added = sendToParking(parkingText);
    if (!added) return false;
    setParkingText("");
    return true;
  }

  function addAdaptation() {
    const text = adaptationText.trim();
    if (!text) return;
    const now = new Date().toISOString();
    const item: AdaptationItem = {
      id: crypto.randomUUID(),
      text,
      status: "观察中",
      createdAt: now,
      updatedAt: now,
    };
    setState((current) => ({ ...current, adaptations: [item, ...current.adaptations] }));
    setAdaptationText("");
  }

  function cycleAdaptation(id: string) {
    const nextStatus: Record<AdaptationItem["status"], AdaptationItem["status"]> = {
      观察中: "尝试中",
      尝试中: "已适配",
      已适配: "观察中",
    };
    setState((current) => ({
      ...current,
      adaptations: current.adaptations.map((item) =>
        item.id === id ? { ...item, status: nextStatus[item.status], updatedAt: new Date().toISOString() } : item,
      ),
    }));
  }

  function deleteTask(id: string) {
    setState((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id !== id),
    }));
    if (selectedTaskId === id) setSelectedTaskId(null);
  }

  function restoreTask(id: string) {
    updateTask(id, (task) => ({
      ...task,
      stage: "capture",
      completedAt: undefined,
      doneAt: undefined,
      updatedAt: new Date().toISOString(),
    }));
    setSelectedTaskId(id);
    setView("flow");
  }

  function clearTodayDone() {
    setState((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => !isDoneTask(task) || !isToday(getTaskDoneAt(task))),
    }));
  }

  function saveSelectedSummary() {
    const summary = summaryDraft.trim();
    setDailySummaries((current) => {
      const rest = current.filter((item) => item.date !== selectedDate);
      if (!summary) return rest;
      return [
        ...rest,
        {
          date: selectedDate,
          summary,
          updatedAt: new Date().toISOString(),
        },
      ];
    });
  }

  function toggleSidePanel(panel: SidePanelKey) {
    setSidePanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  function focusSidePanel(panel: SidePanelKey) {
    setSidePanels((current) => ({ ...current, [panel]: true }));
    const refs: Record<SidePanelKey, RefObject<HTMLElement | null>> = {
      done: donePanelRef,
      parking: parkingPanelRef,
      life: lifePanelRef,
    };
    window.setTimeout(() => {
      refs[panel].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function openGuide(guideId: GuideId) {
    setActiveGuideStepIndex(0);
    setActiveGuideId(guideId);
  }

  function openCurrentViewGuide() {
    openGuide(guideConfig[view] ? view : "global");
  }

  function closeGuide() {
    if (activeGuideId === "global") {
      window.localStorage.setItem(fullOnboardingSeenKey, "true");
      window.localStorage.setItem("guide_seen_global", "true");
    }
    setActiveGuideStepIndex(0);
    setActiveGuideId(null);
  }

  useEffect(() => {
    if (activeGuideId !== "global") return;
    const step = guideConfig.global.steps[activeGuideStepIndex];
    if (step.view && step.view !== view) {
      setView(step.view);
    }
    if (
      step.target === "sidebarTabs" ||
      step.target === "sidebarTodayDone" ||
      step.target === "sidebarParking" ||
      step.target === "sidebarLife"
    ) {
      setSidePanels((current) => ({
        ...current,
        done: true,
        parking: true,
        life: true,
      }));
    }
  }, [activeGuideId, activeGuideStepIndex, view]);

  const isSingleColumnView = view === "todo" || view === "feedback";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <p className="eyebrow">ADHD Flow Planner</p>
          <div className="brand-title-row">
            <h1>轻推任务系统</h1>
            <button
              className="guide-help-button"
              type="button"
              data-guide-target="guideHelpButton"
              data-tooltip="忘了怎么用？点这里重新查看当前页面引导"
              aria-label="打开当前页面引导"
              onClick={openCurrentViewGuide}
            >
              ?
            </button>
          </div>
        </div>
        <button className="today-panel" aria-label="打开日历" onClick={() => setView("calendar")}>
          <span>{formatDate(new Date())}</span>
          <strong>今日完成 {todaysDoneCount}</strong>
        </button>
        <nav className="nav-tabs" aria-label="主导航">
          {[
            ["todo", "Todo"],
            ["priority", "优先级"],
            ["flow", "流程"],
            ["done", "Done"],
            ["calendar", "日历"],
            ["feedback", "反馈"],
          ].map(([key, label]) => (
            <button
              className={view === key ? "nav-tab active" : "nav-tab"}
              key={key}
              data-guide-target={`nav-${key}`}
              onClick={() => setView(key as View)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className={isSingleColumnView ? `workspace workspace-single workspace-${view}` : "workspace"}>
        <section
          className="primary-panel"
          data-guide={view === "done" ? "done-main-panel" : undefined}
          data-guide-target={view === "done" ? "doneMainPanel" : undefined}
        >
          {view === "todo" && (
            <TodoView
              dumpText={dumpText}
              setDumpText={setDumpText}
              organizeTasks={organizeTasks}
              sendToParking={sendToParking}
              onOpenGuide={() => openGuide("todo")}
            />
          )}

          {view === "priority" && (
            <PriorityView
              tasks={sortedActiveTasks}
              promoteTask={promoteTask}
              reorderTask={reorderPriorityTask}
              openFlow={(id) => {
                setSelectedTaskId(id);
                setView("flow");
              }}
              deleteTask={deleteTask}
              onOpenGuide={() => openGuide("priority")}
            />
          )}

          {view === "flow" && (
            <FlowView
              tasks={sortedActiveTasks}
              selectedTask={selectedTask}
              setSelectedTaskId={setSelectedTaskId}
              pushTask={pushTask}
              pullTask={pullTask}
              addEvidenceImages={addEvidenceImages}
              deleteEvidenceImage={deleteEvidenceImage}
              deleteTask={deleteTask}
              onOpenGuide={() => openGuide("flow")}
            />
          )}

          {view === "done" && (
            <DoneView
              tasks={todayDoneTasks}
              restoreTask={restoreTask}
              clearTodayDone={clearTodayDone}
              showGuideDemo={activeGuideId === "done" && activeGuideStepIndex === 1 && todayDoneTasks.length === 0}
              onOpenGuide={() => openGuide("done")}
            />
          )}

          {view === "calendar" && (
            <CalendarView
              tasks={doneTasks(state.tasks)}
              dailySummaries={dailySummaries}
              visibleMonth={visibleMonth}
              selectedDate={selectedDate}
              summaryDraft={summaryDraft}
              setVisibleMonth={setVisibleMonth}
              setSelectedDate={setSelectedDate}
              setSummaryDraft={setSummaryDraft}
              saveSelectedSummary={saveSelectedSummary}
              onOpenGuide={() => openGuide("calendar")}
            />
          )}

          {view === "feedback" && <FeedbackView onOpenGuide={() => openGuide("feedback")} />}
        </section>

        {!isSingleColumnView && (
          <aside className="side-rail right-panel" aria-label="辅助记录区">
            <div className="side-rail-tabs top-tabs" data-guide-target="sidebarTabs" aria-label="辅助模块快捷入口">
              <button onClick={() => focusSidePanel("done")}>Done</button>
              <button onClick={() => focusSidePanel("parking")}>停车场</button>
              <button onClick={() => focusSidePanel("life")}>生活适配</button>
            </div>
            <MiniDoneList
              tasks={todayDoneTasks}
              isOpen={sidePanels.done}
              onToggle={() => toggleSidePanel("done")}
              panelRef={donePanelRef}
            />
            <div className="side-bottom-row">
              <ParkingLot
                items={state.parking}
                text={parkingText}
                setText={setParkingText}
                addItem={addParking}
                isOpen={sidePanels.parking}
                onToggle={() => toggleSidePanel("parking")}
                panelRef={parkingPanelRef}
                removeItem={(id) =>
                  setState((current) => ({
                    ...current,
                    parking: current.parking.filter((item) => item.id !== id),
                  }))
                }
              />
              <LifeBoard
                items={state.adaptations}
                text={adaptationText}
                setText={setAdaptationText}
                addItem={addAdaptation}
                cycleItem={cycleAdaptation}
                isOpen={sidePanels.life}
                onToggle={() => toggleSidePanel("life")}
                panelRef={lifePanelRef}
                removeItem={(id) =>
                  setState((current) => ({
                    ...current,
                    adaptations: current.adaptations.filter((item) => item.id !== id),
                  }))
                }
              />
            </div>
          </aside>
        )}
      </main>
      {activeGuideId && <GuideOverlay guideId={activeGuideId} onClose={closeGuide} onStepChange={setActiveGuideStepIndex} />}
    </div>
  );
}

interface GuideRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type FocusGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
};

interface GuideTargetMeasurement {
  element: Element;
  rect: GuideRect;
}

interface GuideLayout {
  cardStyle: CSSProperties;
  connectorPath?: string;
  focusRingStyle?: CSSProperties;
  overlayPath: string;
  viewBox: string;
}

const guideCardSize = {
  width: 330,
  height: 220,
};
const guideViewportPadding = 24;
const defaultGuideGap = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getGuideTargetElement(target: string, fallbackTarget?: string, fallbackTargets: string[] = []) {
  const targets = [target, ...fallbackTargets, ...(fallbackTarget ? [fallbackTarget] : [])];
  for (const item of targets) {
    const element = document.querySelector(`[data-guide-target="${item}"]`) ?? document.querySelector(`[data-guide="${item}"]`);
    if (element) return element;
  }
  return null;
}

function getGuideTargetMeasurement(target: string, fallbackTarget?: string, fallbackTargets: string[] = []): GuideTargetMeasurement | null {
  const targets = [target, ...fallbackTargets, ...(fallbackTarget ? [fallbackTarget] : [])];

  for (const item of targets) {
    const element = document.querySelector(`[data-guide-target="${item}"]`) ?? document.querySelector(`[data-guide="${item}"]`);
    const rect = element?.getBoundingClientRect();

    if (element && rect && rect.width > 0 && rect.height > 0) {
      return {
        element,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      };
    }
  }

  console.warn(`Guide target not found or has no visible size: ${target}`);
  return null;
}

function getGuideTargetCopy(step: GuideStep) {
  const element = getGuideTargetElement(step.target, step.fallbackTarget, step.fallbackTargets) as HTMLElement | null;

  return {
    eyebrow: element?.dataset.guideEyebrow ?? step.eyebrow,
    title: element?.dataset.guideTitle ?? step.title,
    body: element?.dataset.guideBody ?? step.body,
  };
}

function getComputedRadius(element: Element, fallback: number) {
  const radius = Number.parseFloat(window.getComputedStyle(element).borderTopLeftRadius);
  return Number.isFinite(radius) && radius > 0 ? radius : fallback;
}

function getGuideTargetMetrics(targetType: GuideTargetType, rect: GuideRect, element: Element) {
  if (targetType === "button") {
    return { paddingX: 6, paddingY: 6, radius: Math.min((rect.height + 12) / 2, 999) };
  }

  if (targetType === "input") {
    return { paddingX: 10, paddingY: 10, radius: getComputedRadius(element, 28) + 10 };
  }

  if (targetType === "nav") {
    return { paddingX: 8, paddingY: 6, radius: 999 };
  }

  return { paddingX: 12, paddingY: 12, radius: getComputedRadius(element, 28) + 12 };
}

function getFocusGeometry(measurement: GuideTargetMeasurement, targetType: GuideTargetType): FocusGeometry {
  const { rect, element } = measurement;
  const { paddingX, paddingY, radius } = getGuideTargetMetrics(targetType, rect, element);
  const left = clamp(rect.left - paddingX, 0, window.innerWidth);
  const top = clamp(rect.top - paddingY, 0, window.innerHeight);
  const width = Math.min(window.innerWidth - left, rect.width + paddingX * 2);
  const height = Math.min(window.innerHeight - top, rect.height + paddingY * 2);

  return {
    left,
    top,
    width,
    height,
    radius: Math.min(radius, width / 2, height / 2),
  };
}

function getGuideCardSize() {
  return {
    width: Math.min(guideCardSize.width, window.innerWidth - guideViewportPadding * 2),
    height: Math.min(guideCardSize.height, window.innerHeight - guideViewportPadding * 2),
  };
}

function getGuidePlacementWithFallback(targetRect: GuideRect, placement: GuidePlacement, gap: number) {
  if (placement !== "right") return placement;

  const { width: cardWidth, height: cardHeight } = getGuideCardSize();
  const rightFits = targetRect.left + targetRect.width + gap + cardWidth <= window.innerWidth - guideViewportPadding;
  if (rightFits) return "right";

  const bottomFits = targetRect.top + targetRect.height + gap + cardHeight <= window.innerHeight - guideViewportPadding;
  if (bottomFits) return "bottom";

  const topFits = targetRect.top - gap - cardHeight >= guideViewportPadding;
  return topFits ? "top" : "bottom";
}

function getGuideCardPosition(targetRect: GuideRect, placement: GuidePlacement, gap = defaultGuideGap) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const padding = guideViewportPadding;
  const { width: cardWidth, height: cardHeight } = getGuideCardSize();
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  let left = padding;
  let top = padding;

  if (placement === "right") {
    left = targetRect.left + targetRect.width + gap;
    top = targetCenterY - cardHeight / 2;
  }

  if (placement === "left") {
    left = targetRect.left - cardWidth - gap;
    top = targetCenterY - cardHeight / 2;
  }

  if (placement === "top") {
    left = targetCenterX - cardWidth / 2;
    top = targetRect.top - cardHeight - gap;
  }

  if (placement === "bottom") {
    left = targetCenterX - cardWidth / 2;
    top = targetRect.top + targetRect.height + gap;
  }

  return {
    left: clamp(left, padding, viewportWidth - cardWidth - padding),
    top: clamp(top, padding, viewportHeight - cardHeight - padding),
    width: cardWidth,
    height: cardHeight,
  };
}

function getRelativeGuideSide(cardRect: GuideRect, targetRect: GuideRect): GuidePlacement {
  if (cardRect.left > targetRect.left + targetRect.width) return "right";
  if (cardRect.left + cardRect.width < targetRect.left) return "left";
  if (cardRect.top > targetRect.top + targetRect.height) return "bottom";
  return "top";
}

function getGuideConnectorPath(cardRect: GuideRect, targetRect: GuideRect, connectorEnd: GuideStep["connectorEnd"] = "edge") {
  const side = getRelativeGuideSide(cardRect, targetRect);
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;
  let startX = cardRect.left + cardRect.width / 2;
  let startY = cardRect.top + cardRect.height / 2;
  let endX = targetCenterX;
  let endY = targetCenterY;

  if (side === "right") {
    startX = cardRect.left;
    startY = clamp(targetCenterY, cardRect.top + 36, cardRect.top + cardRect.height - 36);
    endX = targetRect.left + targetRect.width + 14;
    endY = targetCenterY;
  } else if (side === "left") {
    startX = cardRect.left + cardRect.width;
    startY = clamp(targetCenterY, cardRect.top + 36, cardRect.top + cardRect.height - 36);
    endX = targetRect.left - 14;
    endY = targetCenterY;
  } else if (side === "bottom") {
    startX = clamp(targetCenterX, cardRect.left + 44, cardRect.left + cardRect.width - 44);
    startY = cardRect.top;
    endX = targetCenterX;
    endY = targetRect.top + targetRect.height + 14;
  } else {
    startX = clamp(targetCenterX, cardRect.left + 44, cardRect.left + cardRect.width - 44);
    startY = cardRect.top + cardRect.height;
    endX = targetCenterX;
    endY = targetRect.top - 14;
  }

  if (connectorEnd === "center") {
    endX = targetCenterX;
    endY = targetCenterY;
  }

  const horizontal = side === "left" || side === "right";
  const controlOneX = horizontal ? startX + (endX - startX) * 0.48 : startX;
  const controlOneY = horizontal ? startY : startY + (endY - startY) * 0.48;
  const controlTwoX = horizontal ? startX + (endX - startX) * 0.52 : endX;
  const controlTwoY = horizontal ? endY : startY + (endY - startY) * 0.52;

  return `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${controlOneX.toFixed(1)} ${controlOneY.toFixed(1)}, ${controlTwoX.toFixed(1)} ${controlTwoY.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
}

function roundedRectPath({ left, top, width, height, radius }: FocusGeometry) {
  const right = left + width;
  const bottom = top + height;
  const r = Math.min(radius, width / 2, height / 2);

  return [
    `M ${left + r} ${top}`,
    `H ${right - r}`,
    `Q ${right} ${top} ${right} ${top + r}`,
    `V ${bottom - r}`,
    `Q ${right} ${bottom} ${right - r} ${bottom}`,
    `H ${left + r}`,
    `Q ${left} ${bottom} ${left} ${bottom - r}`,
    `V ${top + r}`,
    `Q ${left} ${top} ${left + r} ${top}`,
    "Z",
  ].join(" ");
}

function getGuideOverlayPath(focus: FocusGeometry | null) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const fullScreen = `M 0 0 H ${viewportWidth} V ${viewportHeight} H 0 Z`;
  return focus ? `${fullScreen} ${roundedRectPath(focus)}` : fullScreen;
}

function getGuideLayout(step: GuideStep): GuideLayout {
  const measurement = getGuideTargetMeasurement(step.target, step.fallbackTarget, step.fallbackTargets);
  const focus = measurement ? getFocusGeometry(measurement, step.targetType) : null;
  const targetRect = focus ?? {
    left: window.innerWidth * 0.5 - 70,
    top: window.innerHeight * 0.45 - 36,
    width: 140,
    height: 72,
  };
  const preferredPlacement = step.placement ?? (targetRect.left < window.innerWidth / 2 ? "right" : "left");
  const gap = step.gap ?? defaultGuideGap;
  const placement = getGuidePlacementWithFallback(targetRect, preferredPlacement, gap);
  const cardRect = getGuideCardPosition(targetRect, placement, gap);

  return {
    cardStyle: {
      left: cardRect.left,
      top: cardRect.top,
      width: cardRect.width,
    },
    connectorPath: focus ? getGuideConnectorPath(cardRect, focus, step.connectorEnd) : undefined,
    focusRingStyle: focus
      ? {
          left: focus.left,
          top: focus.top,
          width: focus.width,
          height: focus.height,
          borderRadius: focus.radius,
        }
      : undefined,
    overlayPath: getGuideOverlayPath(focus),
    viewBox: `0 0 ${window.innerWidth} ${window.innerHeight}`,
  };
}

function GuideCutoutOverlay({ path, viewBox, onClose }: { path: string; viewBox: string; onClose: () => void }) {
  return (
    <svg className="guide-cutout-svg" viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="rgba(0, 0, 0, 0.56)" fillRule="evenodd" onClick={onClose} />
    </svg>
  );
}

function GuideConnector({ path, viewBox }: { path: string; viewBox: string }) {
  return (
    <svg className="guide-path" viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <marker id="guide-arrowhead" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
          <path d="M2 2 L10 6 L2 10" />
        </marker>
      </defs>
      <path d={path} markerEnd="url(#guide-arrowhead)" />
    </svg>
  );
}

function GuideOverlay({
  guideId,
  onClose,
  onStepChange,
}: {
  guideId: GuideId;
  onClose: () => void;
  onStepChange: (stepIndex: number) => void;
}) {
  const guide = guideConfig[guideId];
  const [stepIndex, setStepIndex] = useState(0);
  const step = guide.steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === guide.steps.length - 1;
  const [layout, setLayout] = useState<GuideLayout | null>(null);
  const [stepCopy, setStepCopy] = useState(() => getGuideTargetCopy(step));

  useEffect(() => {
    setStepIndex(0);
  }, [guideId]);

  useEffect(() => {
    onStepChange(stepIndex);
  }, [onStepChange, stepIndex]);

  useLayoutEffect(() => {
    function updateLayout() {
      setLayout(getGuideLayout(step));
      setStepCopy(getGuideTargetCopy(step));
    }

    updateLayout();
    const frame = window.requestAnimationFrame(updateLayout);
    const targetElement = getGuideTargetElement(step.target, step.fallbackTarget, step.fallbackTargets);
    const resizeObserver = targetElement ? new ResizeObserver(updateLayout) : null;
    if (targetElement) {
      resizeObserver?.observe(targetElement);
    }
    const mutationObserver = new MutationObserver(updateLayout);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", updateLayout, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", updateLayout, true);
    };
  }, [guideId, step]);

  return (
    <div className={`guide-overlay guide-target-${step.target}`} role="dialog" aria-modal="true" aria-label={guide.label}>
      {layout && <GuideCutoutOverlay path={layout.overlayPath} viewBox={layout.viewBox} onClose={onClose} />}
      {layout?.focusRingStyle && <div className="guide-focus-ring" style={layout.focusRingStyle} aria-hidden="true" />}
      {layout?.connectorPath && <GuideConnector path={layout.connectorPath} viewBox={layout.viewBox} />}

      <button className="guide-close" type="button" onClick={onClose} aria-label="关闭引导">
        关闭
      </button>

      <article
        className="guide-card"
        style={layout ? layout.cardStyle : { opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span>
          {guide.label} · {stepCopy.eyebrow} · {stepIndex + 1}/{guide.steps.length}
        </span>
        <h3>{stepCopy.title}</h3>
        <p>{stepCopy.body}</p>
        <div className="guide-actions">
          <button className="guide-text-button" type="button" onClick={onClose}>
            跳过
          </button>
          <div>
            <button className="guide-text-button" type="button" onClick={() => setStepIndex((index) => Math.max(0, index - 1))} disabled={isFirst}>
              上一步
            </button>
            <button
              className="guide-primary-button"
              type="button"
              onClick={() => {
                if (isLast) {
                  onClose();
                } else {
                  setStepIndex((index) => Math.min(guide.steps.length - 1, index + 1));
                }
              }}
            >
              {isLast ? "完成" : "下一步"}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function GuideHeading({
  eyebrow,
  title,
  compact,
  className = "",
  children,
}: {
  eyebrow: string;
  title: string;
  onOpenGuide?: () => void;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={["section-heading", "guide-section-heading", compact ? "compact" : "", className].filter(Boolean).join(" ")}>
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function TodoView({
  dumpText,
  setDumpText,
  organizeTasks,
  sendToParking,
  onOpenGuide,
}: {
  dumpText: string;
  setDumpText: (value: string) => void;
  organizeTasks: () => void;
  sendToParking: (value: string) => void;
  onOpenGuide: () => void;
}) {
  return (
    <div className="view-stack">
      <GuideHeading eyebrow="Todo 输入页" title="先倒出来，不用排队" onOpenGuide={onOpenGuide} />
      <textarea
        className="brain-dump"
        data-guide-target="todoInput"
        value={dumpText}
        onChange={(event) => setDumpText(event.target.value)}
        placeholder="把脑子里的任务都倒在这里，一行一个。先不用排序，也不用写得很完美。"
      />
      <div className="action-row">
        <button className="primary-action" data-guide-target="organize" onClick={organizeTasks}>
          AI 自动整理
        </button>
        <button
          className="soft-action"
          data-guide-target="todoParkingButton"
          onClick={() => {
            sendToParking(dumpText);
            setDumpText("");
          }}
        >
          放进停车场
        </button>
      </div>
      <div className="quiet-note">
        第一版使用本地规则模拟 AI：根据截止、回复、提交、身体照顾、探索类关键词自动分到 P0 / P1 / P2。
      </div>
    </div>
  );
}

function PriorityView({
  tasks,
  promoteTask,
  reorderTask,
  openFlow,
  deleteTask,
  onOpenGuide,
}: {
  tasks: Task[];
  promoteTask: (taskId: string, priority: Priority) => void;
  reorderTask: (taskId: string, priority: Priority, overTaskId?: string, position?: PriorityDropPosition) => void;
  openFlow: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  onOpenGuide: () => void;
}) {
  type PriorityDragState = {
    taskId: string;
    overPriority: Priority;
    overTaskId?: string;
    position: PriorityDropPosition;
    startX: number;
    startY: number;
    moved: boolean;
  };

  const [dragState, setDragState] = useState<PriorityDragState | null>(null);
  const dragStateRef = useRef<PriorityDragState | null>(null);
  const groups: Record<Priority, Task[]> = {
    P0: tasks.filter((task) => task.priority === "P0"),
    P1: tasks.filter((task) => task.priority === "P1"),
    P2: tasks.filter((task) => task.priority === "P2"),
  };
  const firstPrioritySwitcherTaskId = tasks[0]?.id;

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    if (!dragState) return;

    function handlePointerMove(event: PointerEvent) {
      const current = dragStateRef.current;
      if (!current) return;

      const moved = current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4;
      if (!moved) return;

      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const laneElement = target?.closest<HTMLElement>("[data-priority-lane]");
      if (!laneElement) {
        setDragState((state) => (state ? { ...state, moved } : state));
        return;
      }

      const overPriority = laneElement.dataset.priorityLane as Priority;
      const taskElement = target?.closest<HTMLElement>("[data-priority-task-id]");
      const overTaskId = taskElement && laneElement.contains(taskElement) ? taskElement.dataset.priorityTaskId : undefined;
      let position: PriorityDropPosition = "end";

      if (overTaskId && overTaskId !== current.taskId && taskElement) {
        const rect = taskElement.getBoundingClientRect();
        position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      }

      setDragState((state) =>
        state
          ? {
              ...state,
              moved,
              overPriority,
              overTaskId: overTaskId === current.taskId ? undefined : overTaskId,
              position,
            }
          : state,
      );
    }

    function finishDrag() {
      const current = dragStateRef.current;
      if (current?.moved) {
        reorderTask(current.taskId, current.overPriority, current.overTaskId, current.position);
      }
      setDragState(null);
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", finishDrag);
    document.addEventListener("pointercancel", finishDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishDrag);
      document.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragState?.taskId, reorderTask]);

  function startDrag(task: Task, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragState({
      taskId: task.id,
      overPriority: task.priority,
      position: "end",
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    });
  }

  return (
    <div className="view-stack">
      <GuideHeading eyebrow="优先级分流页" title="只看下一批，不看整座山" onOpenGuide={onOpenGuide}>
        <p className="priority-help-text">
          系统先帮你分成 P0 / P1 / P2。如果不准，直接点任务里的 P0 / P1 / P2 改掉就好。
        </p>
      </GuideHeading>
      <div className={dragState ? "priority-grid priority-grid-dragging" : "priority-grid"} data-guide-target="priorityGrid">
        {(Object.keys(groups) as Priority[]).map((priority) => (
          <section
            className={`priority-lane ${priority.toLowerCase()}${dragState?.overPriority === priority ? " drag-over" : ""}`}
            data-priority-lane={priority}
            key={priority}
          >
            <div className="priority-lane-header">
              <div className="lane-heading">
                <h3>{priorityMeta[priority].label}</h3>
                <span>{groups[priority].length}</span>
              </div>
              <p>{priorityMeta[priority].description}</p>
              <div className="lane-divider" aria-hidden="true" />
            </div>
            <div className="task-list">
              {groups[priority].length === 0 && <EmptyState text="这里暂时很安静。" />}
              {groups[priority].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onOpen={() => openFlow(task.id)}
                  onDelete={() => deleteTask(task.id)}
                  isDragging={dragState?.taskId === task.id}
                  isDropBefore={dragState?.overTaskId === task.id && dragState.position === "before"}
                  isDropAfter={dragState?.overTaskId === task.id && dragState.position === "after"}
                  onDragStart={(event) => startDrag(task, event)}
                  footer={
                    <div className="priority-adjust">
                      <span>拖拽或点击改优先级</span>
                      <div
                        className="priority-switcher"
                        data-guide-target={task.id === firstPrioritySwitcherTaskId ? "prioritySwitcher" : undefined}
                        aria-label="调整优先级"
                      >
                        {(["P0", "P1", "P2"] as Priority[]).map((item) => (
                          <button
                            key={item}
                            className={task.priority === item ? `chip priority-chip ${item.toLowerCase()} active` : `chip priority-chip ${item.toLowerCase()}`}
                            onClick={() => promoteTask(task.id, item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function FlowView({
  tasks,
  selectedTask,
  setSelectedTaskId,
  pushTask,
  pullTask,
  addEvidenceImages,
  deleteEvidenceImage,
  deleteTask,
  onOpenGuide,
}: {
  tasks: Task[];
  selectedTask: Task | null;
  setSelectedTaskId: (id: string) => void;
  pushTask: (taskId: string) => void;
  pullTask: (taskId: string) => void;
  addEvidenceImages: (taskId: string, fileList: FileList | File[], stage: number) => Promise<boolean>;
  deleteEvidenceImage: (taskId: string, imageId: string) => void;
  deleteTask: (taskId: string) => void;
  onOpenGuide: () => void;
}) {
  const [previewImage, setPreviewImage] = useState<EvidenceImage | null>(null);
  const [selectedEvidenceStage, setSelectedEvidenceStage] = useState(0);
  const [pasteStatus, setPasteStatus] = useState("等待粘贴");
  const evidenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const evidenceImages = selectedTask?.evidenceImages ?? [];
  const selectedStage = stages[selectedEvidenceStage] ?? stages[0];
  const selectedStageImages = evidenceImages.filter((image) => image.stage === selectedEvidenceStage);
  const isFinalStage = selectedTask ? stageIndex(selectedTask.stage) === stages.length - 1 : false;

  async function pasteImagesIntoCurrentTask(files: File[]) {
    if (!selectedTask || files.length === 0) return false;

    const currentStage = stageIndex(selectedTask.stage);
    const currentStageImages = (selectedTask.evidenceImages ?? []).filter((image) => image.stage === currentStage);
    if (currentStageImages.length >= 3) {
      setPasteStatus("当前阶段最多添加 3 张证据");
      return false;
    }
    if (files.length > 3 - currentStageImages.length) {
      setPasteStatus("当前阶段最多添加 3 张证据");
    }

    setSelectedEvidenceStage(currentStage);
    const added = await addEvidenceImages(selectedTask.id, files, currentStage);
    if (added) {
      setPasteStatus("已添加截图证据");
    }
    return added;
  }

  function openEvidenceFilePicker() {
    if (!selectedTask) return;

    const currentStage = stageIndex(selectedTask.stage);
    const currentStageImages = (selectedTask.evidenceImages ?? []).filter((image) => image.stage === currentStage);
    if (currentStageImages.length >= 3) {
      setPasteStatus("当前阶段最多添加 3 张证据");
      window.alert("当前阶段最多添加 3 张证据");
      return;
    }

    setSelectedEvidenceStage(currentStage);
    evidenceFileInputRef.current?.click();
  }

  async function handleEvidenceFileChange(fileList: FileList | null) {
    if (!selectedTask || !fileList || fileList.length === 0) return;

    const currentStage = stageIndex(selectedTask.stage);
    const currentStageImages = (selectedTask.evidenceImages ?? []).filter((image) => image.stage === currentStage);
    if (currentStageImages.length >= 3) {
      setPasteStatus("当前阶段最多添加 3 张证据");
      window.alert("当前阶段最多添加 3 张证据");
      return;
    }

    setSelectedEvidenceStage(currentStage);
    const added = await addEvidenceImages(selectedTask.id, fileList, currentStage);
    if (added) {
      setPasteStatus("已添加截图证据");
    }
  }

  function removeEvidenceImage(imageId: string) {
    if (!selectedTask) return;
    deleteEvidenceImage(selectedTask.id, imageId);
    setPasteStatus("已删除视觉证据");
  }

  async function handleClipboardImagePaste(event: ClipboardEvent | ReactClipboardEvent<HTMLElement>) {
    if (!selectedTask) return;
    if (event.defaultPrevented) return;

    const active = document.activeElement;
    const isEvidencePasteZone =
      isEvidencePasteZoneElement(active) ||
      (event.currentTarget instanceof Element && isEvidencePasteZoneElement(event.currentTarget));
    const isTextEditing = isEditableElement(active);

    if (isTextEditing && !isEvidencePasteZone) return;

    setPasteStatus("已触发粘贴事件");
    const files = getEvidenceFilesFromClipboardData(event.clipboardData);
    if (files.length === 0) {
      setPasteStatus("剪贴板里没有图片");
      if (isEvidencePasteZone) event.preventDefault();
      return;
    }

    event.preventDefault();
    await pasteImagesIntoCurrentTask(files);
  }

  useEffect(() => {
    setPreviewImage(null);
    setSelectedEvidenceStage(selectedTask ? stageIndex(selectedTask.stage) : 0);
    setPasteStatus("等待粘贴");
  }, [selectedTask?.id, selectedTask?.stage]);

  useEffect(() => {
    if (!selectedTask || previewImage) return;

    function handleDocumentPaste(event: ClipboardEvent) {
      void handleClipboardImagePaste(event);
    }

    document.addEventListener("paste", handleDocumentPaste);
    return () => document.removeEventListener("paste", handleDocumentPaste);
  }, [addEvidenceImages, previewImage, selectedTask]);

  return (
    <div className="flow-layout">
      <div className="task-queue">
        <GuideHeading eyebrow="流程图推进页" title="选择一个任务" onOpenGuide={onOpenGuide} compact />
        <div className="queue-list" data-guide-target="flowQueue">
          {tasks.length === 0 && <EmptyState text="没有正在推进的任务。" />}
          {tasks.map((task) => (
            <button
              key={task.id}
              className={selectedTask?.id === task.id ? "queue-item active" : "queue-item"}
              onClick={() => setSelectedTaskId(task.id)}
            >
              <span>{task.priority}</span>
              {task.title}
            </button>
          ))}
        </div>
      </div>

      <div className="flow-board">
        {!selectedTask && <EmptyState text="从左侧选择一个任务，或者先去 Todo 页倒出任务。" />}
        {selectedTask && (
          <>
            <div className="flow-title">
              <span className={`priority-badge ${selectedTask.priority.toLowerCase()}`}>{selectedTask.priority}</span>
              <h2>{selectedTask.title}</h2>
              <p>{selectedTask.reason}</p>
            </div>
            <div className="stage-track" data-guide-target="flowStages" aria-label="任务推进阶段">
              {stages.map((stage, index) => {
                const active = index <= stageIndex(selectedTask.stage);
                const current = stage.id === selectedTask.stage;
                const stageEvidence = evidenceImages.filter((image) => image.stage === index);
                return (
                  <button
                    type="button"
                    className={[
                      "stage",
                      active ? "active" : "",
                      selectedEvidenceStage === index ? "selected-evidence-stage" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={stage.id}
                    onClick={() => setSelectedEvidenceStage(index)}
                  >
                    <div className={current ? "stage-dot current" : "stage-dot"}>{index + 1}</div>
                    <div>
                      <strong>{stage.label}</strong>
                      <span>{stage.hint}</span>
                    </div>
                    {stageEvidence.length > 0 && (
                      <div className="stage-evidence-mini">
                        <img src={stageEvidence[0].dataUrl} alt="" />
                        <span>证据 {stageEvidence.length}</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <section className="evidence-panel" data-guide-target="evidence" aria-label="视觉证据">
              <div className="evidence-heading">
                <div>
                  <p className="eyebrow">Evidence</p>
                  <h3>当前阶段证据：{selectedStage.label}</h3>
                </div>
                <button className="primary-action evidence-upload-button" type="button" onClick={openEvidenceFilePicker}>
                  添加本阶段证据
                </button>
              </div>
              <div className="evidence-description">
                <p>上传截图、导出图或任何能证明你推进过的画面。</p>
                <p>也可以直接 Ctrl + V 粘贴截图。</p>
              </div>
              <input
                className="evidence-file-input"
                ref={evidenceFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => {
                  void handleEvidenceFileChange(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
              />

              {selectedStageImages.length === 0 && (
                <div className="evidence-empty-state">
                  <p>这个阶段还没有视觉证据。</p>
                  <p>你可以点击右上角按钮添加，也可以直接 Ctrl + V 粘贴截图。</p>
                </div>
              )}
              {selectedStageImages.length > 0 && (
                <div className="evidence-grid">
                  {selectedStageImages.map((image) => (
                    <figure className="evidence-card" key={image.id}>
                      <button className="evidence-thumb" onClick={() => setPreviewImage(image)}>
                        <img src={image.dataUrl} alt={image.name} />
                      </button>
                      <figcaption>
                        <span>{formatTime(image.createdAt)}</span>
                        <span>{stages[image.stage]?.label ?? "流程中"}</span>
                        <button onClick={() => removeEvidenceImage(image.id)}>删除</button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <div
                className="evidence-paste-zone"
                data-evidence-paste-zone="true"
                tabIndex={0}
                role="textbox"
                aria-label="点击这里，然后 Ctrl + V 粘贴截图"
                onPaste={(event) => {
                  void handleClipboardImagePaste(event);
                }}
              >
                点击这里，然后 Ctrl + V 粘贴截图
              </div>
              <p className="evidence-paste-status">粘贴状态：{pasteStatus}</p>
            </section>
            <div className="action-row" data-guide-target="flowAction">
              <button className="primary-action" onClick={() => pushTask(selectedTask.id)}>
                {isFinalStage ? "完成并收进 Done" : "推进一步"}
              </button>
              <button
                className="soft-action"
                disabled={stageIndex(selectedTask.stage) === 0}
                onClick={() => pullTask(selectedTask.id)}
              >
                退回一步
              </button>
              <button className="soft-action danger" onClick={() => deleteTask(selectedTask.id)}>
                删除
              </button>
            </div>
            {previewImage && (
              <div className="evidence-preview" role="dialog" aria-modal="true" onClick={() => setPreviewImage(null)}>
                <div className="evidence-preview-content" onClick={(event) => event.stopPropagation()}>
                  <button className="evidence-preview-close" onClick={() => setPreviewImage(null)}>
                    关闭
                  </button>
                  <img src={previewImage.dataUrl} alt={previewImage.name} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FeedbackView({ onOpenGuide }: { onOpenGuide: () => void }) {
  function openFeedbackForm() {
    window.open(FEISHU_FEEDBACK_URL, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="feedback-view">
      <section className="feedback-hero" data-guide-target="feedback">
        <GuideHeading eyebrow="FEEDBACK" title="内测反馈" onOpenGuide={onOpenGuide}>
          <p>
            感谢你愿意体验 ADHD Flow Planner。这个工具希望帮助任务过载、启动困难或容易自我消耗的用户，更轻松地整理任务、推进任务，并看见自己的完成痕迹。
          </p>
        </GuideHeading>

        <button className="primary-action feedback-button" data-guide-target="feedbackButton" type="button" onClick={openFeedbackForm}>
          填写飞书反馈表
        </button>
      </section>

      <section className="feedback-note" aria-label="隐私说明">
        <p>
          当前版本不会收集你的具体任务内容。反馈将通过飞书表单提交，只用于统计体验问题和后续优化方向。
        </p>
      </section>
    </div>
  );
}

function CalendarView({
  tasks,
  dailySummaries,
  visibleMonth,
  selectedDate,
  summaryDraft,
  setVisibleMonth,
  setSelectedDate,
  setSummaryDraft,
  saveSelectedSummary,
  onOpenGuide,
}: {
  tasks: Task[];
  dailySummaries: DailySummary[];
  visibleMonth: Date;
  selectedDate: string;
  summaryDraft: string;
  setVisibleMonth: (date: Date) => void;
  setSelectedDate: (date: string) => void;
  setSummaryDraft: (summary: string) => void;
  saveSelectedSummary: () => void;
  onOpenGuide: () => void;
}) {
  const todayKey = toDateKey(new Date());
  const summariesByDate = new Map(dailySummaries.map((item) => [item.date, item.summary]));
  const doneByDate = tasks.reduce<Map<string, Task[]>>((map, task) => {
    const dateKey = dateKeyFromValue(task.completedAt);
    if (!dateKey) return map;
    map.set(dateKey, [...(map.get(dateKey) ?? []), task]);
    return map;
  }, new Map());
  const calendarDays = getCalendarDays(visibleMonth);
  const selectedDoneTasks = doneByDate.get(selectedDate) ?? [];

  function shiftMonth(offset: number) {
    const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
    setVisibleMonth(nextMonth);
    setSelectedDate(toDateKey(nextMonth));
  }

  return (
    <div className="calendar-view">
      <GuideHeading eyebrow="Daily Archive" title="日历" onOpenGuide={onOpenGuide} className="calendar-heading" />

      <div className="calendar-shell">
        <section className="calendar-board" data-guide-target="calendar" aria-label="月历">
          <div className="calendar-toolbar">
            <button className="soft-action" onClick={() => shiftMonth(-1)}>
              上个月
            </button>
            <h3>{getMonthLabel(visibleMonth)}</h3>
            <button className="soft-action" onClick={() => shiftMonth(1)}>
              下个月
            </button>
          </div>

          <div className="calendar-weekdays" aria-hidden="true">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="calendar-grid">
            {calendarDays.map((day) => {
              const doneCount = doneByDate.get(day.dateKey)?.length ?? 0;
              const hasSummary = Boolean((summariesByDate.get(day.dateKey) ?? "").trim());
              const summaryDotTone = ["pink", "purple", "blue", "green", "yellow"][day.date.getDate() % 5];
              const className = [
                "calendar-day",
                day.inMonth ? "" : "outside-month",
                day.dateKey === todayKey ? "today" : "",
                day.dateKey === selectedDate ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button className={className} key={day.dateKey} onClick={() => setSelectedDate(day.dateKey)}>
                  <span className="calendar-date-number">{day.date.getDate()}</span>
                  {doneCount > 0 && <span className="calendar-done-count">Done {doneCount}</span>}
                  {hasSummary && (
                    <span
                      className={`calendar-summary-dot ${summaryDotTone}`}
                      aria-label="这一天有每日总结"
                      title="这一天有每日总结"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="calendar-detail" data-guide-target="calendarDetail" aria-label="日期详情">
          <div>
            <p className="eyebrow">Selected Day</p>
            <h3>{selectedDate}</h3>
            <span>{selectedDoneTasks.length} done</span>
          </div>

          <div className="calendar-done-list">
            {selectedDoneTasks.length === 0 && <EmptyState text="这一天还没有完成记录。" />}
            {selectedDoneTasks.map((task) => (
              <article className="calendar-done-item" key={task.id}>
                <span>{formatTime(task.completedAt)}</span>
                <h4>{task.title}</h4>
              </article>
            ))}
          </div>

          <label className="summary-editor">
            <span>每日总结</span>
            <textarea
              value={summaryDraft}
              onChange={(event) => setSummaryDraft(event.target.value)}
              placeholder="给这一天留一句简短记录。"
            />
          </label>

          <button className="primary-action" onClick={saveSelectedSummary}>
            保存总结
          </button>
        </section>
      </div>
    </div>
  );
}

function DoneView({
  tasks,
  restoreTask,
  clearTodayDone,
  showGuideDemo,
  onOpenGuide,
}: {
  tasks: Task[];
  restoreTask: (taskId: string) => void;
  clearTodayDone: () => void;
  showGuideDemo: boolean;
  onOpenGuide: () => void;
}) {
  const [previewImage, setPreviewImage] = useState<EvidenceImage | null>(null);
  const firstDoneTaskId = tasks[0]?.id;

  return (
    <div className="view-stack">
      <GuideHeading eyebrow="Done List" title="今天完成的事情会留下来" onOpenGuide={onOpenGuide} />
      <div className="done-completion-area">
        <div className="done-toolbar">
          <span>今日完成 {tasks.length}</span>
          <button className="soft-action" onClick={clearTodayDone} disabled={tasks.length === 0}>
            清空今日 Done
          </button>
        </div>
        <div className="done-list done-today-content-zone" data-guide="done-today-content-zone" data-guide-target="doneTodayContentZone">
          {tasks.length === 0 && !showGuideDemo && (
            <EmptyState text="今天完成的任务会出现在这里。" />
          )}
          {showGuideDemo && (
            <article
              className="guide-demo-done-item"
              data-guide="done-today-demo-item"
              data-guide-target="doneTodayDemoItem"
              data-guide-title="完成后会显示在这里"
              data-guide-body={
                "今天推进到 Done 的任务会出现在这里。\n如果任务带有截图证据，也会一起作为缩略图保留下来，方便你回头确认自己真的做过。\n下面这个示例只是帮助你理解展示方式，不会写入真实记录。"
              }
            >
              <div className="guide-demo-main">
                <span className="guide-demo-time">示例时间</span>
                <h3 className="guide-demo-title">微信视频号发布</h3>
                <p className="guide-demo-meta">完成 · 共 1 张证据</p>
              </div>
              <div className="guide-demo-thumb" aria-hidden="true">
                示例缩略图
              </div>
              <p className="guide-demo-note">示例展示，仅用于引导</p>
            </article>
          )}
          {tasks.map((task) => {
            const images = [...(task.evidenceImages ?? [])].sort(
              (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
            );
            const visibleImages = images.slice(0, 6);

            return (
              <article
                className="done-item"
                key={task.id}
                data-guide={task.id === firstDoneTaskId ? "done-today-first-item" : undefined}
                data-guide-target={task.id === firstDoneTaskId ? "doneTodayFirstItem" : undefined}
                data-guide-title={task.id === firstDoneTaskId ? "完成后会显示在这里" : undefined}
                data-guide-body={
                  task.id === firstDoneTaskId
                    ? "今天推进到 Done 的任务会出现在这里。\n如果任务带有截图证据，也会一起作为缩略图保留下来，方便你回头确认自己真的做过。"
                    : undefined
                }
              >
                <div className="done-content">
                  <span>{formatTime(getTaskDoneAt(task))}</span>
                  <h3>{task.title}</h3>
                  {images.length > 0 && (
                    <div
                      className="done-evidence-strip"
                      aria-label="视觉证据缩略图"
                    >
                      <p>共 {images.length} 张证据</p>
                      <div>
                        {visibleImages.map((image) => (
                          <button className="done-evidence-thumb" key={image.id} onClick={() => setPreviewImage(image)}>
                            <img src={image.dataUrl} alt={image.name} />
                            <span>{stages[image.stage]?.label ?? "流程中"}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button className="chip" onClick={() => restoreTask(task.id)}>
                  放回流程
                </button>
              </article>
            );
          })}
        </div>
      </div>
      {previewImage && (
        <div className="evidence-preview" role="dialog" aria-modal="true" onClick={() => setPreviewImage(null)}>
          <div className="evidence-preview-content" onClick={(event) => event.stopPropagation()}>
            <button className="evidence-preview-close" onClick={() => setPreviewImage(null)}>
              关闭
            </button>
            <img src={previewImage.dataUrl} alt={previewImage.name} />
          </div>
        </div>
      )}
    </div>
  );
}

function SidePanelHeader({
  title,
  count,
  isOpen,
  onToggle,
}: {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button className="side-heading side-heading-button" onClick={onToggle}>
      <h2>{title}</h2>
      <span className="side-heading-meta">
        <span className="side-count">{count}</span>
        <span className="side-arrow">{isOpen ? "▲" : "▼"}</span>
      </span>
    </button>
  );
}

function MiniDoneList({
  tasks,
  isOpen,
  onToggle,
  panelRef,
}: {
  tasks: Task[];
  isOpen: boolean;
  onToggle: () => void;
  panelRef: RefObject<HTMLElement | null>;
}) {
  const visibleTasks = tasks.slice(0, 5);
  const hiddenCount = Math.max(0, tasks.length - visibleTasks.length);

  return (
    <section
      className={isOpen ? "side-card side-card-done" : "side-card side-card-done side-card-collapsed"}
      data-guide-target="sidebarTodayDone"
      ref={panelRef}
    >
      <SidePanelHeader title="今日 Done" count={tasks.length} isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="side-list">
          {visibleTasks.map((task) => (
            <p key={task.id}>{task.title}</p>
          ))}
          {hiddenCount > 0 && <p className="muted">还有 {hiddenCount} 条今日完成记录</p>}
          {tasks.length === 0 && <p className="muted">今天完成的任务会出现在这里。</p>}
        </div>
      )}
    </section>
  );
}

function ParkingLot({
  items,
  text,
  setText,
  addItem,
  isOpen,
  onToggle,
  panelRef,
  removeItem,
}: {
  items: ParkingItem[];
  text: string;
  setText: (value: string) => void;
  addItem: () => boolean;
  isOpen: boolean;
  onToggle: () => void;
  panelRef: RefObject<HTMLElement | null>;
  removeItem: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = Boolean(normalizedQuery);
  const filteredItems = normalizedQuery
    ? items.filter((item) => item.text.toLowerCase().includes(normalizedQuery))
    : items;
  const keywordCloud = extractParkingKeywords(items);
  const maxKeywordCount = Math.max(...keywordCloud.map((keyword) => keyword.count), 1);

  function handleAddItem() {
    const added = addItem();
    if (added) {
      setQuery("");
    }
  }

  return (
    <section
      className={
        isOpen ? "side-card side-card-parking" : "side-card side-card-parking side-card-collapsed"
      }
      data-guide-target="sidebarParking"
      ref={panelRef}
    >
      <SidePanelHeader title="停车场" count={items.length} isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <>
      <div className="parking-tools">
        <input
          className="parking-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索停车场"
        />
        {isSearching && (
          <div className="parking-search-status">
            <p>搜索中：“{query.trim()}” · 找到 {filteredItems.length} 条</p>
            <button type="button" onClick={() => setQuery("")}>
              查看全部
            </button>
          </div>
        )}
      </div>
      <div className="parking-word-cloud" aria-label="停车场词云">
        {keywordCloud.length === 0 && <p className="muted">停车场积累后，会在这里生成词云。</p>}
        {keywordCloud.map((keyword, index) => (
          <button
            className="word-cloud-term"
            key={keyword.word}
            onClick={() => setQuery(keyword.word)}
            style={getWordCloudStyle(keyword.count, maxKeywordCount, index)}
          >
            {keyword.word}
          </button>
        ))}
      </div>
      <div className="inline-input">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="先停一下的新想法"
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAddItem();
          }}
        />
        <button onClick={handleAddItem} aria-label="添加到停车场">
          +
        </button>
      </div>
      <div className="side-list parking-list">
        {filteredItems.map((item) => (
          <div className="side-row" key={item.id}>
            <p>{item.text}</p>
            <button onClick={() => removeItem(item.id)} aria-label="删除停车场记录">
              ×
            </button>
          </div>
        ))}
        {items.length === 0 && <p className="muted">停车场积累后，会在这里生成词云。</p>}
        {items.length > 0 && filteredItems.length === 0 && (
          <p className="muted">没找到相关想法。清除搜索后可以查看全部。</p>
        )}
      </div>
        </>
      )}
    </section>
  );
}

function LifeBoard({
  items,
  text,
  setText,
  addItem,
  cycleItem,
  isOpen,
  onToggle,
  panelRef,
  removeItem,
}: {
  items: AdaptationItem[];
  text: string;
  setText: (value: string) => void;
  addItem: () => void;
  cycleItem: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  panelRef: RefObject<HTMLElement | null>;
  removeItem: (id: string) => void;
}) {
  return (
    <section
      className={isOpen ? "side-card side-card-life" : "side-card side-card-life side-card-collapsed"}
      data-guide-target="sidebarLife"
      ref={panelRef}
    >
      <SidePanelHeader title="生活适配改造" count={items.length} isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <>
      <button className="life-export-button" onClick={() => exportLifeAdaptationsCsv(items)}>
        导出表格
      </button>
      <div className="inline-input">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="想调整的环境或习惯"
          onKeyDown={(event) => {
            if (event.key === "Enter") addItem();
          }}
        />
        <button onClick={addItem} aria-label="添加生活适配">
          +
        </button>
      </div>
      <div className="side-list adaptation-list">
        {items.map((item) => (
          <div className="adaptation-item" key={item.id}>
            <p>{item.text}</p>
            <div>
              <button className="status-pill" onClick={() => cycleItem(item.id)}>
                {item.status}
              </button>
              <button onClick={() => removeItem(item.id)} aria-label="删除生活适配记录">
                ×
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="muted">记录那些“不适合我”的地方，再慢慢改。</p>}
      </div>
        </>
      )}
    </section>
  );
}

function TaskCard({
  task,
  onOpen,
  onDelete,
  footer,
  isDragging = false,
  isDropBefore = false,
  isDropAfter = false,
  onDragStart,
  guideTarget,
}: {
  task: Task;
  onOpen: () => void;
  onDelete: () => void;
  footer?: ReactNode;
  isDragging?: boolean;
  isDropBefore?: boolean;
  isDropAfter?: boolean;
  onDragStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  guideTarget?: string;
}) {
  return (
    <article
      className={[
        "task-card",
        isDragging ? "task-card-dragging" : "",
        isDropBefore ? "drop-before" : "",
        isDropAfter ? "drop-after" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-guide-target={guideTarget}
      data-priority-task-id={task.id}
    >
      <div className="task-card-body">
        <div className="task-card-top">
          <span className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</span>
          {onDragStart && (
            <button
              className="drag-handle"
              type="button"
              aria-label="拖动调整顺序或优先级"
              title="拖动调整顺序或优先级"
              onPointerDown={onDragStart}
            >
              ⋮⋮
            </button>
          )}
        </div>
        <h3>{task.title}</h3>
        <p>{task.reason}</p>
      </div>
      {footer}
      <div className="task-actions">
        <button className="soft-action" onClick={onOpen}>
          进入流程
        </button>
        <button className="icon-button" onClick={onDelete} aria-label="删除任务">
          ×
        </button>
      </div>
    </article>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}
