import WorkspaceAudit from '../models/WorkspaceAudit.js';

export async function logWorkspaceAction(user, action, target = '', detail = '') {
  if (!user?.workspace) return;
  await WorkspaceAudit.create({ workspace: user.workspace, actor: user._id, action, target: String(target), detail });
}
