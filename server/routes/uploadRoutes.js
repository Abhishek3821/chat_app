import { Router } from 'express';
import { uploadFiles } from '../controllers/uploadController.js';
import { getMediaToken } from '../controllers/mediaController.js';
import { protect } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();
router.use(protect);

router.post('/', upload.array('files', 10), uploadFiles);
router.get('/access', getMediaToken); // short-lived token for authenticated media URLs

export default router;
