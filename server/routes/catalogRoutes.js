import { Router } from 'express';
import {
  listMyCatalog,
  listCatalog,
  createProduct,
  updateProduct,
  deleteProduct,
  shareProduct,
} from '../controllers/catalogController.js';
import { protect } from '../middleware/auth.js';

const router = Router();
router.use(protect);

router.get('/mine', listMyCatalog);
router.post('/', createProduct);
router.post('/:id/share', shareProduct);
router.patch('/:id', updateProduct);
router.delete('/:id', deleteProduct);
router.get('/:workspaceId', listCatalog); // browse a business's catalog (keep last: greedy param)

export default router;
