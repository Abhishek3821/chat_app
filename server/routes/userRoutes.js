import { Router } from 'express';
import {
  searchUsers,
  getUserById,
  updateProfile,
  updatePrivacy,
  updateSettings,
  getContacts,
  addContact,
  removeContact,
  toggleFavorite,
  toggleBlock,
  toggleChatFlag,
  deleteAccount,
} from '../controllers/userController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/search', searchUsers);
router.patch('/me', updateProfile);
router.patch('/me/privacy', updatePrivacy);
router.patch('/me/settings', updateSettings);
router.delete('/me', deleteAccount);

router.get('/me/contacts', getContacts);
router.post('/me/contacts/:id', addContact);
router.delete('/me/contacts/:id', removeContact);
router.post('/me/favorites/:id', toggleFavorite);
router.post('/me/block/:id', toggleBlock);
router.post('/me/chats/:chatId/:action', toggleChatFlag);

router.get('/:id', getUserById);

export default router;
