import WorkspaceTask from '../models/WorkspaceTask.js';
import { notifyUser } from './notify.js';
import { emitToUser } from '../socket/index.js';

let timer;

export async function dispatchWorkspaceTaskReminders(now = new Date()) {
  const tasks = await WorkspaceTask.find({ status: 'open', assignee: { $ne: null }, dueAt: { $lte: now }, reminderSentAt: null }).select('title assignee dueAt').limit(100);
  for (const task of tasks) {
    const claimed = await WorkspaceTask.updateOne({ _id: task._id, status: 'open', reminderSentAt: null }, { $set: { reminderSentAt: now } });
    if (!claimed.modifiedCount) continue;
    emitToUser(task.assignee, 'workspace-task-updated', { taskId: task._id });
    notifyUser(String(task.assignee), {
      type: 'system',
      title: 'Team task due',
      body: task.title,
      url: '/workspace?tab=tasks',
      tag: `workspace-task:${task._id}`,
      data: { taskId: String(task._id) },
    });
  }
}

export function startWorkspaceTaskReminders() {
  if (timer) return;
  timer = setInterval(() => dispatchWorkspaceTaskReminders().catch(() => {}), 60_000);
  timer.unref?.();
  dispatchWorkspaceTaskReminders().catch(() => {});
}
