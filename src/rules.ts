import type { Priority, Stage, Task } from "./types";

export const stages: Array<{ id: Stage; label: string; hint: string }> = [
  { id: "capture", label: "收进来", hint: "任务已经被看见" },
  { id: "prepare", label: "下一步", hint: "只拆一个小动作" },
  { id: "focus", label: "推进中", hint: "正在发生就算数" },
  { id: "wrap", label: "收尾", hint: "检查、发送、放回原处" },
  { id: "done", label: "完成", hint: "留下完成痕迹" },
];

const urgentWords = [
  "今天",
  "马上",
  "立刻",
  "截止",
  "ddl",
  "deadline",
  "交",
  "提交",
  "回复",
  "回消息",
  "老师",
  "面试",
  "考试",
  "开会",
  "缴费",
  "付款",
  "明天前",
];

const importantWords = [
  "修改",
  "整理",
  "准备",
  "导出",
  "打印",
  "买",
  "联系",
  "预约",
  "洗头",
  "吃饭",
  "睡觉",
  "运动",
  "毕业",
  "论文",
  "作品集",
  "展板",
  "封面",
];

const lowPressureWords = [
  "研究一下",
  "看看",
  "有空",
  "以后",
  "也许",
  "想想",
  "收集",
  "优化",
  "灵感",
  "排版",
];

function hasAny(text: string, words: string[]) {
  const normalized = text.toLowerCase();
  return words.some((word) => normalized.includes(word.toLowerCase()));
}

export function classifyTask(title: string): { priority: Priority; reason: string } {
  const trimmed = title.trim();
  const isUrgent = hasAny(trimmed, urgentWords);
  const isImportant = hasAny(trimmed, importantWords);
  const isLowPressure = hasAny(trimmed, lowPressureWords);

  if (isUrgent && !isLowPressure) {
    return {
      priority: "P0",
      reason: "含有时间、提交、回复或外部等待信号，先放到 P0。",
    };
  }

  if (isLowPressure) {
    return {
      priority: "P2",
      reason: "偏探索或灵感类，先放低压区，避免挤占启动能量。",
    };
  }

  if (isImportant) {
    return {
      priority: "P1",
      reason: "和身体照顾、学习工作产出或准备动作有关，适合今天推进一点。",
    };
  }

  return {
    priority: "P2",
    reason: "暂时没有明显截止信号，先留作可选推进。",
  };
}

export function createTask(title: string): Task {
  const result = classifyTask(title);
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    priority: result.priority,
    stage: "capture",
    createdAt: now,
    updatedAt: now,
    reason: result.reason,
    evidenceImages: [],
  };
}

export function nextStage(stage: Stage): Stage {
  const index = stages.findIndex((item) => item.id === stage);
  return stages[Math.min(index + 1, stages.length - 1)].id;
}

export function previousStage(stage: Stage): Stage {
  const index = stages.findIndex((item) => item.id === stage);
  return stages[Math.max(index - 1, 0)].id;
}

export function stageIndex(stage: Stage) {
  return stages.findIndex((item) => item.id === stage);
}
