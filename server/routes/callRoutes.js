import { Router } from 'express';
import {
  startCall,
  startDirectCall,
  endCall,
  missCall,
  rejectCall,
  updateCall,
  getCallHistory,
} from '../controllers/callController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect); // every call API requires an authenticated session

router.get('/', getCallHistory);
router.get('/history', getCallHistory);
router.post('/start', startDirectCall);
router.post('/end', endCall);
router.post('/missed', missCall);
router.post('/reject', rejectCall);

// Legacy/group endpoints kept for compatibility.
router.post('/', startCall);
router.patch('/:id', updateCall);

export default router;
