import { Router } from 'express';
import { uploadFiles } from '../controllers/uploadController.js';
import { getMediaToken } from '../controllers/mediaController.js';
import { protect } from '../middleware/auth.js';
import { upload, handleUploadErrors, MAX_FILES } from '../middleware/upload.js';

const router = Router();
router.use(protect);

// handleUploadErrors sits between multer and the controller so size/type
// rejections answer 400/413 with a usable message instead of a generic 500.
router.post('/', upload.array('files', MAX_FILES), handleUploadErrors, uploadFiles);
router.get('/access', getMediaToken); // short-lived token for authenticated media URLs

export default router;
