import { motion } from 'framer-motion';
import { MessagesSquare, Sparkles } from 'lucide-react';
import ChatSidebar from '../components/chat/ChatSidebar';
import ChatArea from '../components/chat/ChatArea';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import { useChat } from '../store/useChat';
import { useUI } from '../store/useUI';
import { cn } from '../lib/utils';

export default function ChatsPage() {
  // Narrow subscriptions — re-render only when the chat list or selection
  // changes, not on typing/presence/message traffic.
  const chats = useChat((s) => s.chats);
  const activeChatId = useChat((s) => s.activeChatId);
  const chatListOpen = useUI((s) => s.chatListOpen);
  const openModal = useUI((s) => s.openModal);
  const activeChat = chats.find((c) => c._id === activeChatId);

  return (
    <div className="flex h-full">
      {/* Chat list — full width on mobile when open, fixed column on desktop */}
      <div className={cn('h-full w-full md:block md:w-auto', activeChatId && !chatListOpen ? 'hidden' : 'block')}>
        <ChatSidebar />
      </div>

      {/* Conversation area */}
      <div className={cn('h-full min-w-0 flex-1', activeChatId && !chatListOpen ? 'block' : 'hidden md:block')}>
        {activeChat ? (
          <ChatArea key={activeChat._id} chat={activeChat} />
        ) : (
          <div className="grid h-full place-items-center">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <EmptyState
                icon={MessagesSquare}
                title="Your conversations live here"
                description="Select a chat to start messaging, or spark a brand-new conversation. Everything is end-to-end delightful."
                action={
                  <Button onClick={() => openModal('newChat')}>
                    <Sparkles size={16} /> Start a new chat
                  </Button>
                }
              />
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
