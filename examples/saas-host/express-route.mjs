import { createChatKonectClient } from '../../packages/node/src/index.js';

// Pass your Express app and YOUR session middleware. It must set req.user.
// Do not accept a user id from query parameters or request bodies here.
export function installChatKonectRoute(app, requireLogin) {
  const chatkonect = createChatKonectClient({
    apiUrl: process.env.CHATKONECT_API,
    appId: process.env.CHATKONECT_APP_ID,
    appSecret: process.env.CHATKONECT_APP_SECRET,
  });
  app.get('/chat-token', requireLogin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user?.id) return res.status(401).json({ message: 'Sign in to your platform first.' });
    try {
      const session = await chatkonect.createUserSession({
        id: req.user.id,
        name: req.user.fullName || req.user.name,
        avatar: req.user.photoUrl || req.user.avatar || '',
      });
      return res.json({ token: session.token, expiresInSeconds: session.expiresInSeconds });
    } catch {
      return res.status(502).json({ message: 'Chat is temporarily unavailable. Please retry.' });
    }
  });
}
