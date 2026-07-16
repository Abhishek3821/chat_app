import { Router } from 'express';
import {
  createMeeting,
  getMeetings,
  updateMeeting,
  rsvp,
  cancelMeeting,
  getMeetingByCode,
  joinMeetingByCode,
} from '../controllers/meetingController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/', getMeetings);
router.post('/', createMeeting);
// Shareable-link (Google-Meet-style) join flow — kept above /:id routes.
router.get('/code/:code', getMeetingByCode);
router.post('/code/:code/join', joinMeetingByCode);
router.patch('/:id', updateMeeting);
router.post('/:id/rsvp', rsvp);
router.delete('/:id', cancelMeeting);

export default router;
