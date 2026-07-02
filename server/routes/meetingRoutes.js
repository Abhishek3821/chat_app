import { Router } from 'express';
import { createMeeting, getMeetings, updateMeeting, rsvp, cancelMeeting } from '../controllers/meetingController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', getMeetings);
router.post('/', createMeeting);
router.patch('/:id', updateMeeting);
router.post('/:id/rsvp', rsvp);
router.delete('/:id', cancelMeeting);

export default router;
