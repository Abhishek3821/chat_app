import { motion } from 'framer-motion';
import Avatar from '../ui/Avatar';

export default function TypingIndicator({ user }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-end gap-2">
      <div className="w-8 shrink-0">{user && <Avatar src={user.avatar} name={user.name} size="xs" />}</div>
      <div className="glass flex items-center gap-1 rounded-[20px] rounded-bl-md px-4 py-3.5 shadow-soft">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-2 w-2 rounded-full bg-content-muted"
            animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </div>
    </motion.div>
  );
}
