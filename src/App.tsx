import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
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

const feedbackQuestions = [
  "年龄",
  "身份类型",
  "帮助程度评分 0–10",
  "页面风格优化方向",
  "最有帮助的功能模块",
  "哪里最卡 / 最不好用",
  "其他优化建议",
  "是否愿意继续试用",
  "联系方式，可选",
];

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatTime(value?: string) {
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

function getSummaryExcerpt(summary: string) {
  const clean = summary.trim();
  return clean.length > 18 ? `${clean.slice(0, 18)}...` : clean;
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
    const scale = Math.min(1, 1200 / image.width);
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
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function activeTasks(tasks: Task[]) {
  return tasks.filter((task) => task.stage !== "done");
}

function doneTasks(tasks: Task[]) {
  return tasks.filter((task) => task.stage === "done");
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

  const todaysDoneCount = useMemo(() => {
    const today = toDateKey(new Date());
    return doneTasks(state.tasks).filter((task) => {
      if (!task.completedAt) return false;
      return dateKeyFromValue(task.completedAt) === today;
    }).length;
  }, [state.tasks]);

  const sortedActiveTasks = useMemo(() => {
    const order: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };
    return activeTasks(state.tasks).sort((a, b) => {
      const byPriority = order[a.priority] - order[b.priority];
      if (byPriority !== 0) return byPriority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [state.tasks]);

  const selectedTask = useMemo(() => {
    const fallback = sortedActiveTasks[0];
    return state.tasks.find((task) => task.id === selectedTaskId && task.stage !== "done") ?? fallback ?? null;
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

    const tasks = titles.map(createTask);
    setState((current) => ({
      ...current,
      tasks: [...tasks, ...current.tasks],
    }));
    setDumpText("");
    setSelectedTaskId(tasks[0]?.id ?? null);
    setView("priority");
  }

  function promoteTask(taskId: string, priority: Priority) {
    updateTask(taskId, (task) => ({
      ...task,
      priority,
      updatedAt: new Date().toISOString(),
      reason: "你手动调整了优先级，系统会尊重你的判断。",
    }));
  }

  function pushTask(taskId: string) {
    updateTask(taskId, (task) => {
      const stage = nextStage(task.stage);
      const now = new Date().toISOString();
      return {
        ...task,
        stage,
        updatedAt: now,
        completedAt: stage === "done" ? now : task.completedAt,
      };
    });

    const task = state.tasks.find((item) => item.id === taskId);
    if (task && nextStage(task.stage) === "done") {
      setSelectedTaskId(null);
    } else {
      setSelectedTaskId(taskId);
    }
  }

  function pullTask(taskId: string) {
    updateTask(taskId, (task) => {
      if (task.stage === "done") return task;
      return {
        ...task,
        stage: previousStage(task.stage),
        updatedAt: new Date().toISOString(),
      };
    });
    setSelectedTaskId(taskId);
  }

  async function addEvidenceImages(taskId: string, fileList: FileList, stage: number) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    const currentImages = task.evidenceImages ?? [];
    const stageImages = currentImages.filter((image) => image.stage === stage);
    if (stageImages.length >= 3) {
      window.alert("每个阶段最多添加 3 张视觉证据");
      return;
    }

    const files = Array.from(fileList);
    const invalidFile = files.find((file) => !isSupportedEvidenceFile(file));
    if (invalidFile) {
      window.alert("请上传图片文件");
      return;
    }

    const slots = 3 - stageImages.length;
    if (files.length > slots) {
      window.alert("每个阶段最多添加 3 张视觉证据");
    }

    try {
      const createdAt = new Date().toISOString();
      const images: EvidenceImage[] = [];
      for (const file of files.slice(0, slots)) {
        images.push({
          id: crypto.randomUUID(),
          taskId,
          name: file.name,
          dataUrl: await compressEvidenceImage(file),
          stage,
          createdAt,
        });
      }

      if (images.length === 0) return;
      updateTask(taskId, (currentTask) => ({
        ...currentTask,
        evidenceImages: [...(currentTask.evidenceImages ?? []), ...images],
        updatedAt: new Date().toISOString(),
      }));
    } catch {
      window.alert("图片压缩失败，请换一张图片再试");
    }
  }

  function deleteEvidenceImage(taskId: string, imageId: string) {
    if (!window.confirm("删除这张视觉证据吗？")) return;
    updateTask(taskId, (task) => ({
      ...task,
      evidenceImages: (task.evidenceImages ?? []).filter((image) => image.id !== imageId),
      updatedAt: new Date().toISOString(),
    }));
  }

  function sendToParking(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const item: ParkingItem = {
      id: crypto.randomUUID(),
      text: clean,
      createdAt: new Date().toISOString(),
    };
    setState((current) => ({ ...current, parking: [item, ...current.parking] }));
  }

  function addParking() {
    sendToParking(parkingText);
    setParkingText("");
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
      updatedAt: new Date().toISOString(),
    }));
    setSelectedTaskId(id);
    setView("flow");
  }

  function clearDone() {
    setState((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.stage !== "done"),
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ADHD Flow Planner</p>
          <h1>轻推任务系统</h1>
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
              onClick={() => setView(key as View)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="workspace">
        <section className="primary-panel">
          {view === "todo" && (
            <TodoView
              dumpText={dumpText}
              setDumpText={setDumpText}
              organizeTasks={organizeTasks}
              sendToParking={sendToParking}
            />
          )}

          {view === "priority" && (
            <PriorityView
              tasks={sortedActiveTasks}
              promoteTask={promoteTask}
              openFlow={(id) => {
                setSelectedTaskId(id);
                setView("flow");
              }}
              deleteTask={deleteTask}
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
            />
          )}

          {view === "done" && (
            <DoneView tasks={doneTasks(state.tasks)} restoreTask={restoreTask} clearDone={clearDone} />
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
            />
          )}

          {view === "feedback" && <FeedbackView />}
        </section>

        <aside className="side-rail right-panel" aria-label="辅助记录区">
          <div className="side-rail-tabs top-tabs" aria-label="辅助模块快捷入口">
            <button onClick={() => focusSidePanel("done")}>Done</button>
            <button onClick={() => focusSidePanel("parking")}>停车场</button>
            <button onClick={() => focusSidePanel("life")}>生活适配</button>
          </div>
          <MiniDoneList
            tasks={doneTasks(state.tasks)}
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
      </main>
    </div>
  );
}

function TodoView({
  dumpText,
  setDumpText,
  organizeTasks,
  sendToParking,
}: {
  dumpText: string;
  setDumpText: (value: string) => void;
  organizeTasks: () => void;
  sendToParking: (value: string) => void;
}) {
  return (
    <div className="view-stack">
      <div className="section-heading">
        <p className="eyebrow">Todo 输入页</p>
        <h2>先倒出来，不用排队</h2>
      </div>
      <textarea
        className="brain-dump"
        value={dumpText}
        onChange={(event) => setDumpText(event.target.value)}
        placeholder="把脑子里的任务都倒在这里，一行一个。先不用排序，也不用写得很完美。"
      />
      <div className="action-row">
        <button className="primary-action" onClick={organizeTasks}>
          AI 自动整理
        </button>
        <button
          className="soft-action"
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
  openFlow,
  deleteTask,
}: {
  tasks: Task[];
  promoteTask: (taskId: string, priority: Priority) => void;
  openFlow: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
}) {
  const groups: Record<Priority, Task[]> = {
    P0: tasks.filter((task) => task.priority === "P0"),
    P1: tasks.filter((task) => task.priority === "P1"),
    P2: tasks.filter((task) => task.priority === "P2"),
  };

  return (
    <div className="view-stack">
      <div className="section-heading">
        <p className="eyebrow">优先级分流页</p>
        <h2>只看下一批，不看整座山</h2>
      </div>
      <div className="priority-grid">
        {(Object.keys(groups) as Priority[]).map((priority) => (
          <section className={`priority-lane ${priority.toLowerCase()}`} key={priority}>
            <div className="lane-heading">
              <h3>{priorityMeta[priority].label}</h3>
              <span>{groups[priority].length}</span>
            </div>
            <p>{priorityMeta[priority].description}</p>
            <div className="task-list">
              {groups[priority].length === 0 && <EmptyState text="这里暂时很安静。" />}
              {groups[priority].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onOpen={() => openFlow(task.id)}
                  onDelete={() => deleteTask(task.id)}
                  footer={
                    <div className="priority-switcher" aria-label="调整优先级">
                      {(["P0", "P1", "P2"] as Priority[]).map((item) => (
                        <button
                          key={item}
                          className={task.priority === item ? "chip active" : "chip"}
                          onClick={() => promoteTask(task.id, item)}
                        >
                          {item}
                        </button>
                      ))}
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
}: {
  tasks: Task[];
  selectedTask: Task | null;
  setSelectedTaskId: (id: string) => void;
  pushTask: (taskId: string) => void;
  pullTask: (taskId: string) => void;
  addEvidenceImages: (taskId: string, fileList: FileList, stage: number) => void;
  deleteEvidenceImage: (taskId: string, imageId: string) => void;
  deleteTask: (taskId: string) => void;
}) {
  const [previewImage, setPreviewImage] = useState<EvidenceImage | null>(null);
  const [selectedEvidenceStage, setSelectedEvidenceStage] = useState(0);
  const evidenceImages = selectedTask?.evidenceImages ?? [];
  const selectedStage = stages[selectedEvidenceStage] ?? stages[0];
  const selectedStageImages = evidenceImages.filter((image) => image.stage === selectedEvidenceStage);

  useEffect(() => {
    setPreviewImage(null);
    setSelectedEvidenceStage(selectedTask ? stageIndex(selectedTask.stage) : 0);
  }, [selectedTask?.id, selectedTask?.stage]);

  return (
    <div className="flow-layout">
      <div className="task-queue">
        <div className="section-heading compact">
          <p className="eyebrow">流程图推进页</p>
          <h2>选择一个任务</h2>
        </div>
        <div className="queue-list">
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
            <div className="stage-track" aria-label="任务推进阶段">
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
            <section className="evidence-panel" aria-label="视觉证据">
              <div className="evidence-heading">
                <div>
                  <p className="eyebrow">Evidence</p>
                  <h3>当前阶段证据：{selectedStage.label}</h3>
                  <p>上传截图、导出图或任何能证明你推进过的画面。</p>
                </div>
                <label className="primary-action evidence-upload-button">
                  添加本阶段证据
                  <input
                    className="evidence-file-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={(event) => {
                      if (selectedTask && event.currentTarget.files) {
                        addEvidenceImages(selectedTask.id, event.currentTarget.files, selectedEvidenceStage);
                      }
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              {selectedStageImages.length === 0 && <EmptyState text="这个阶段还没有视觉证据。" />}
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
                        <button onClick={() => deleteEvidenceImage(selectedTask.id, image.id)}>删除</button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </section>
            <div className="action-row">
              <button className="primary-action" onClick={() => pushTask(selectedTask.id)}>
                推进一步
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

function FeedbackView() {
  function openFeedbackForm() {
    window.open(FEISHU_FEEDBACK_URL, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="feedback-view">
      <section className="feedback-hero">
        <div className="section-heading">
          <p className="eyebrow">FEEDBACK</p>
          <h2>内测反馈</h2>
          <p>
            感谢你愿意体验 ADHD Flow Planner。这个工具希望帮助任务过载、启动困难或容易自我消耗的用户，更轻松地整理任务、推进任务，并看见自己的完成痕迹。
          </p>
        </div>

        <button className="primary-action feedback-button" type="button" onClick={openFeedbackForm}>
          填写飞书反馈表
        </button>
      </section>

      <section className="feedback-note" aria-label="隐私说明">
        <p>
          当前版本不会收集你的具体任务内容。反馈将通过飞书表单提交，只用于统计体验问题和后续优化方向。
        </p>
      </section>

      <section className="feedback-card" aria-label="反馈表单会询问的内容">
        <div>
          <p className="eyebrow">Form Preview</p>
          <h3>表单会询问这些内容</h3>
        </div>
        <div className="feedback-question-grid">
          {feedbackQuestions.map((question) => (
            <span key={question}>{question}</span>
          ))}
        </div>
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
      <div className="section-heading calendar-heading">
        <p className="eyebrow">Daily Archive</p>
        <h2>日历</h2>
      </div>

      <div className="calendar-shell">
        <section className="calendar-board" aria-label="月历">
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
              const summary = summariesByDate.get(day.dateKey) ?? "";
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
                  {summary && <span className="calendar-summary">{getSummaryExcerpt(summary)}</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="calendar-detail" aria-label="日期详情">
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
  clearDone,
}: {
  tasks: Task[];
  restoreTask: (taskId: string) => void;
  clearDone: () => void;
}) {
  const [previewImage, setPreviewImage] = useState<EvidenceImage | null>(null);

  return (
    <div className="view-stack">
      <div className="section-heading">
        <p className="eyebrow">Done List</p>
        <h2>完成过的事情会留下来</h2>
      </div>
      <div className="done-toolbar">
        <span>累计完成 {tasks.length}</span>
        <button className="soft-action" onClick={clearDone} disabled={tasks.length === 0}>
          清空 Done
        </button>
      </div>
      <div className="done-list">
        {tasks.length === 0 && <EmptyState text="还没有完成记录。推进到最后一步后会自动来到这里。" />}
        {tasks.map((task) => {
          const images = [...(task.evidenceImages ?? [])].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          const visibleImages = images.slice(0, 6);

          return (
            <article className="done-item" key={task.id}>
              <div className="done-content">
                <span>{formatTime(task.completedAt)}</span>
                <h3>{task.title}</h3>
                {images.length > 0 && (
                  <div className="done-evidence-strip" aria-label="视觉证据缩略图">
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
  return (
    <section
      className={isOpen ? "side-card side-card-done" : "side-card side-card-done side-card-collapsed"}
      ref={panelRef}
    >
      <SidePanelHeader title="Done List" count={tasks.length} isOpen={isOpen} onToggle={onToggle} />
      {isOpen && (
        <div className="side-list">
          {tasks.slice(0, 4).map((task) => (
            <p key={task.id}>{task.title}</p>
          ))}
          {tasks.length === 0 && <p className="muted">完成后会自动出现在这里。</p>}
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
  addItem: () => void;
  isOpen: boolean;
  onToggle: () => void;
  panelRef: RefObject<HTMLElement | null>;
  removeItem: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = normalizedQuery
    ? items.filter((item) => item.text.toLowerCase().includes(normalizedQuery))
    : items;
  const keywordCloud = extractParkingKeywords(items);
  const maxKeywordCount = Math.max(...keywordCloud.map((keyword) => keyword.count), 1);

  return (
    <section
      className={
        isOpen ? "side-card side-card-parking" : "side-card side-card-parking side-card-collapsed"
      }
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
        {normalizedQuery && (
          <p className="parking-count">
            显示 {filteredItems.length} / 共 {items.length}
          </p>
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
      {normalizedQuery && (
        <button className="clear-filter" onClick={() => setQuery("")}>
          清除筛选
        </button>
      )}
      <div className="inline-input">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="先停一下的新想法"
          onKeyDown={(event) => {
            if (event.key === "Enter") addItem();
          }}
        />
        <button onClick={addItem} aria-label="添加到停车场">
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
        {items.length === 0 && <p className="muted">打断你的想法，可以先停在这里。</p>}
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
}: {
  task: Task;
  onOpen: () => void;
  onDelete: () => void;
  footer?: ReactNode;
}) {
  return (
    <article className="task-card">
      <div className="task-card-body">
        <span className={`priority-badge ${task.priority.toLowerCase()}`}>{task.priority}</span>
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
